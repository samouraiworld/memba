import { hexToBytes } from '@noble/hashes/utils.js'
import type { AminoMsg } from '../../grc20'
import type { ChainConfig, ChainNote } from '../chain/schema'
import { address, check, decimal, encode64, id, realmPath } from '../chain/schema'
import { equalBytes, requireBytes, u32, u64 } from '../crypto/bytes'
import { decodeManifest } from '../crypto/manifest'
import { addressBytes } from '../identity/chain'
import type { EncryptedEpoch } from './engine'
import type { PrivateEpoch } from './schema'

/** Create ("only me") and Commit (an edit, by the owner or a writer); access, rotate, reveal and publish arrive with their own reviews. */
export type PrivateNoteAction = { kind: 'create'; prepared: EncryptedEpoch; maxFeeUgnot: string }
  | { kind: 'commit'; title?: Uint8Array; body?: Uint8Array; previousManifest: Uint8Array }
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
    // The 10-09 Commit case: an unrevealed private epoch, the reviewed revision, and a caller who owns the note or
    // writes in its current manifest. Each changed field is sealed at its next field revision.
    check(note && note.id === noteId && !note.deleted && note.mode <= 2)
    const revision = decimal(note.stateRevision, 64, true), epoch = Number(decimal(note.epoch, 32, true))
    check(BigInt(revision) < 0xffffffffffffffffn && state.epoch && state.epoch.epoch === note.epoch && equalBytes(state.epoch.commitment, note.commitment) && state.epoch.revealedKey.length === 0)
    const before = decodeManifest(a.previousManifest, epoch), who = addressBytes(caller)
    check((caller === note.owner || before.some(r => equalBytes(r.address, who) && r.writer)) && (a.title !== undefined || a.body !== undefined))
    const mask = (a.title === undefined ? 0 : 1) | (a.body === undefined ? 0 : 2)
    func = 'Commit'; args = [noteArg, revision, String(epoch), String(mask), a.title === undefined ? '' : cipher(a.title, epoch, 1, BigInt(note.titleRevision) + 1n), a.body === undefined ? '' : cipher(a.body, epoch, 2, BigInt(note.bodyRevision) + 1n), op]
  }
  return { type: 'vm/MsgCall', value: { caller, send, pkg_path: pkg, func, args, max_deposit: `${deposit}ugnot` } }
}
