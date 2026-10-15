import { hexToBytes } from '@noble/hashes/utils.js'
import type { AminoMsg } from '../../grc20'
import type { ChainConfig, ChainNote } from '../chain/schema'
import { address, check, decimal, encode64, id, realmPath } from '../chain/schema'
import { equalBytes, requireBytes, u32, u64 } from '../crypto/bytes'
import { decodeManifest } from '../crypto/manifest'
import { addressBytes } from '../identity/chain'
import type { EncryptedEpoch } from './engine'
import type { PrivateEpoch } from './schema'

/** Create only in this version ("only me"); edit, access, rotate, reveal and publish arrive with their own reviews. */
export type PrivateNoteAction = { kind: 'create'; prepared: EncryptedEpoch; maxFeeUgnot: string }
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
  const a = operation.action, deposit = decimal(maxDepositUgnot, 63)
  check(a.kind === 'create' && state.note === null && state.epoch === null && state.config?.realm === pkg && !state.config.paused)
  const p = a.prepared
  check(p.chainId === operation.chainId && p.realm === pkg && p.noteId === noteId && p.epoch === 1 && p.titleRevision === 1n && p.bodyRevision === 1n)
  // Only me: mode 0 with one envelope, the owner's own (writer) key.
  check(p.mode === 0 && accessManifest(p.manifest, 1, p.mode, caller).length === 1); requireBytes(p.commitment, 32)
  const fee = decimal(state.config.createFeeUgnot, 63), cap = decimal(a.maxFeeUgnot, 63); check(BigInt(fee) <= BigInt(cap))
  const args = [noteArg, String(p.mode), cipher(p.title, 1, 1, 1n), cipher(p.body, 1, 2, 1n), encode64(p.manifest), encode64(p.commitment), cap, op]
  return { type: 'vm/MsgCall', value: { caller, send: fee === '0' ? '' : `${fee}ugnot`, pkg_path: pkg, func: 'CreateNote', args, max_deposit: `${deposit}ugnot` } }
}
