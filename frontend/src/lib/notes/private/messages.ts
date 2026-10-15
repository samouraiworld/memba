import { hexToBytes } from '@noble/hashes/utils.js'
import type { AminoMsg } from '../../grc20'
import type { ChainConfig, ChainNote } from '../chain/schema'
import { address, check, decimal, encode64, id, realmPath } from '../chain/schema'
import { equalBytes, requireBytes, u32, u64 } from '../crypto/bytes'
import { decodeManifest, type Recipient } from '../crypto/manifest'
import { addressBytes } from '../identity/chain'
import type { EncryptedEpoch } from './engine'
import type { PrivateEpoch } from './schema'

/**
 * Create ("only me"), Commit (an edit, by the owner or a writer), and the owner's access changes. Access (ApplyAccess,
 * the current epoch): wraps it for more readers, or makes ONE current reader a writer. Rotate (a new epoch): removes
 * readers, or makes ONE writer a reader again (the realm refuses a writer downgrade without a new epoch). A private
 * note's writers are only these manifest flags: AddWriter/RemoveWriter are public-note calls on the realm. Reveal and
 * publish arrive with their own reviews.
 */
export type PrivateNoteAction = { kind: 'create'; prepared: EncryptedEpoch; maxFeeUgnot: string }
  | { kind: 'commit'; title?: Uint8Array; body?: Uint8Array; previousManifest: Uint8Array }
  | { kind: 'access'; mode: 0 | 1; manifest: Uint8Array; previousManifest: Uint8Array; acknowledgeEpochHistory: boolean }
  | { kind: 'rotate'; prepared: EncryptedEpoch; previousManifest: Uint8Array }
export interface PrivateNoteOperation { chainId: string; caller: string; noteId: string; operationId: string; action: PrivateNoteAction }
export interface PrivateOperationState { note: ChainNote | null; epoch: PrivateEpoch | null; config?: ChainConfig }
function cipher(value: Uint8Array, epoch: number, field: 1 | 2, revision: bigint): string {
  check(value instanceof Uint8Array && value.length >= 59 && value.length <= (field === 1 ? 231 : 135223)
    && value[0] === 1 && value[1] === 1 && equalBytes(value.subarray(2, 6), u32(epoch)) && value[6] === field
    && equalBytes(value.subarray(7, 15), u64(revision)))
  return encode64(value)
}
function accessManifest(data: Uint8Array, epoch: number, mode: number, owner: string) {
  check(mode === 0 || mode === 1 || mode === 2)
  const list = decodeManifest(data, epoch), who = addressBytes(owner)
  check(list.some(r => equalBytes(r.address, who) && r.writer) && (mode !== 0 || list.length === 1) && (mode !== 2 || list.every(r => r.writer)))
  return list
}
const same = (x: Recipient, y: Recipient) => equalBytes(x.address, y.address)
/** The envelopes of `after` whose holder was in `before` with the other role: made writers (`writer`) or readers. */
export function changedRole(before: readonly Recipient[], after: readonly Recipient[], writer: boolean): Recipient[] {
  return after.filter(next => next.writer === writer && before.some(old => same(old, next) && old.writer !== writer))
}
/**
 * Pure MsgCall construction for this deployment's realm (`realm`, the client's). Signers must bind this exact message
 * to fresh CAS/registry reads and a durable intent.
 */
export function privateNoteMessage(operation: PrivateNoteOperation, realm: string, maxDepositUgnot: string, state: PrivateOperationState): AminoMsg {
  const pkg = realmPath(realm), caller = address(operation.caller), noteId = id(operation.noteId), noteArg = encode64(hexToBytes(noteId)), op = encode64(hexToBytes(id(operation.operationId)))
  const a = operation.action, deposit = decimal(maxDepositUgnot, 63), note = state.note
  let func: string, args: string[], send = ''
  if (a.kind === 'create') {
    check(note === null && state.epoch === null && state.config?.realm === pkg && !state.config.paused)
    const p = a.prepared
    check(p.chainId === operation.chainId && p.realm === pkg && p.noteId === noteId && p.epoch === 1 && p.titleRevision === 1n && p.bodyRevision === 1n)
    // Only me: mode 0 with one envelope, the owner's own (writer) key.
    check(p.mode === 0 && accessManifest(p.manifest, 1, p.mode, caller).length === 1); requireBytes(p.commitment, 32)
    const fee = decimal(state.config.createFeeUgnot, 63), cap = decimal(a.maxFeeUgnot, 63); check(BigInt(fee) <= BigInt(cap))
    send = fee === '0' ? '' : `${fee}ugnot`
    func = 'CreateNote'; args = [noteArg, String(p.mode), cipher(p.title, 1, 1, 1n), cipher(p.body, 1, 2, 1n), encode64(p.manifest), encode64(p.commitment), cap, op]
  } else {
    // The 10-09 cases: an unrevealed private epoch (Rotate may replace a revealed one), the reviewed revision, and the
    // envelopes the operation was reviewed against.
    check(note && note.id === noteId && !note.deleted && note.mode <= 2)
    const revision = decimal(note.stateRevision, 64, true), epoch = Number(decimal(note.epoch, 32, true))
    check(BigInt(revision) < 0xffffffffffffffffn && state.epoch && state.epoch.epoch === note.epoch && equalBytes(state.epoch.commitment, note.commitment))
    if (a.kind !== 'rotate') check(state.epoch.revealedKey.length === 0)
    const before = decodeManifest(a.previousManifest, epoch), who = addressBytes(caller)
    if (a.kind === 'commit') {
      // Each changed field is sealed at its next field revision, by the owner or a writer of the current manifest.
      check((caller === note.owner || before.some(r => equalBytes(r.address, who) && r.writer)) && (a.title !== undefined || a.body !== undefined))
      const mask = (a.title === undefined ? 0 : 1) | (a.body === undefined ? 0 : 2)
      func = 'Commit'; args = [noteArg, revision, String(epoch), String(mask), a.title === undefined ? '' : cipher(a.title, epoch, 1, BigInt(note.titleRevision) + 1n), a.body === undefined ? '' : cipher(a.body, epoch, 2, BigInt(note.bodyRevision) + 1n), op]
    } else if (a.kind === 'access') {
      // Owner only; Private may become Shared. Every current envelope stays (the realm refuses a removal or a writer
      // downgrade), and exactly one of: readers ADDED (a new envelope is never a writer, every role kept), or the same
      // holders with ONE reader made a writer.
      check(caller === note.owner && a.acknowledgeEpochHistory === true && (a.mode === 0 || a.mode === 1) && (a.mode === note.mode || (note.mode === 0 && a.mode === 1)))
      const after = accessManifest(a.manifest, epoch, a.mode, note.owner), promoted = changedRole(before, after, true)
      check(before.every(old => after.some(next => same(old, next) && (old.writer === next.writer || promoted.includes(next))))
        && after.every(next => !next.writer || before.some(old => same(old, next)))
        && (after.length > before.length ? promoted.length === 0 : after.length === before.length && promoted.length === 1))
      func = 'ApplyAccess'; args = [noteArg, revision, String(epoch), String(a.mode), encode64(a.manifest), op]
    } else {
      // Owner only: the whole next epoch (fresh key and commitment, both fields at their next revision). Every remaining
      // envelope was in the reviewed epoch, and exactly one of: holders REMOVED (every role kept), or ONE writer made a
      // reader again (holders whose key is turned off may go in the same epoch: the realm accepts only active keys).
      const p = a.prepared
      check(caller === note.owner && p.chainId === operation.chainId && p.realm === pkg && p.noteId === noteId && p.epoch === epoch + 1 && (p.mode === 0 || p.mode === 1)
        && p.titleRevision === BigInt(note.titleRevision) + 1n && p.bodyRevision === BigInt(note.bodyRevision) + 1n && !equalBytes(requireBytes(p.commitment, 32), note.commitment))
      const after = accessManifest(p.manifest, p.epoch, p.mode, note.owner), demoted = changedRole(before, after, false)
      check(after.every(next => before.some(old => same(old, next) && (old.writer === next.writer || demoted.includes(next))))
        && (demoted.length === 0 ? after.length < before.length : demoted.length === 1 && after.length <= before.length))
      func = 'Rotate'; args = [noteArg, revision, String(epoch), String(p.mode), cipher(p.title, p.epoch, 1, p.titleRevision), cipher(p.body, p.epoch, 2, p.bodyRevision), encode64(p.manifest), encode64(p.commitment), op]
    }
  }
  return { type: 'vm/MsgCall', value: { caller, send, pkg_path: pkg, func, args, max_deposit: `${deposit}ugnot` } }
}
