import type { AminoMsg } from '../../grc20'
import { address, check, decimal, encode64, id, NOTES_REALM, publicText } from './schema'
import type { ChainConfig } from './schema'

export type PublicNoteAction =
  | { kind: 'create'; mode: 3 | 4; title: string; body: string; maxFeeUgnot: string }
  | { kind: 'commit'; revision: string; epoch: string; title?: string; body?: string }
  | { kind: 'rename'; revision: string; epoch: string; title: string }
  | { kind: 'delete'; revision: string }
  | { kind: 'comments'; revision: string; open: boolean }
export interface PublicNoteOperation { caller: string; noteId: string; operationId: string; action: PublicNoteAction }
function idArg(value: string): string { return encode64(Uint8Array.from(id(value).match(/../g)!, byte => parseInt(byte, 16))) }
function textArg(value: string, title = false): string {
  check(typeof value === 'string' && value.length <= 131072)
  const bytes = new TextEncoder().encode(value)
  // Reject unpaired surrogates instead of silently replacing a user's content.
  check(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) === value); publicText(bytes, title); return encode64(bytes)
}
/** MsgCall byte arrays AND byte slices are canonical padded base64 (keeper e75). */
export function publicNoteMessage(operation: PublicNoteOperation, maxDepositUgnot: string, config?: ChainConfig): AminoMsg {
  const caller = address(operation.caller), note = idArg(operation.noteId), op = idArg(operation.operationId)
  const a = operation.action; let func: string, args: string[], send = ''
  const deposit = decimal(maxDepositUgnot, 63)
  switch (a.kind) {
    case 'create': {
      check(config?.realm === NOTES_REALM && !config.paused && (a.mode === 3 || a.mode === 4))
      const fee = decimal(config.createFeeUgnot, 63), cap = decimal(a.maxFeeUgnot, 63)
      check(BigInt(fee) <= BigInt(cap)); address(config.treasury)
      send = fee === '0' ? '' : `${fee}ugnot`
      func = 'CreateNote'; args = [note, String(a.mode), textArg(a.title, true), textArg(a.body), '', '', cap, op]; break
    }
    case 'commit': {
      check(a.title !== undefined || a.body !== undefined)
      const mask = (a.title === undefined ? 0 : 1) | (a.body === undefined ? 0 : 2)
      func = 'Commit'; args = [note, decimal(a.revision, 64, true), decimal(a.epoch, 32), String(mask), a.title === undefined ? '' : textArg(a.title, true), a.body === undefined ? '' : textArg(a.body), op]; break
    }
    case 'rename': func = 'Rename'; args = [note, decimal(a.revision, 64, true), decimal(a.epoch, 32), textArg(a.title, true), op]; break
    case 'delete': func = 'Delete'; args = [note, decimal(a.revision, 64, true), op]; break
    case 'comments':
      check(typeof a.open === 'boolean'); func = 'SetCommentMode'; args = [note, decimal(a.revision, 64, true), String(a.open), op]; break
    default: throw new Error('Unknown Notes operation')
  }
  return { type: 'vm/MsgCall', value: { caller, send, pkg_path: NOTES_REALM, func, args, max_deposit: `${deposit}ugnot` } }
}
