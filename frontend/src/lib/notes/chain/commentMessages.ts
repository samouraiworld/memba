import type { AminoMsg } from '../../grc20'
import { commentText } from './comments'
import { address, check, decimal, encode64, id, NOTES_REALM } from './schema'

export type CommentAction =
  | { kind: 'add'; bodyRevision: string; epoch: string; parent?: string; anchor: string; body: string }
  | { kind: 'delete'; revision: string }
  | { kind: 'resolve'; revision: string; resolved: boolean }
  | { kind: 'hide'; revision: string; hidden: boolean }
export interface CommentOperation { caller: string; noteId: string; commentId: string; operationId: string; action: CommentAction }
const idArg = (value: string) => encode64(Uint8Array.from(id(value).match(/../g)!, byte => parseInt(byte, 16)))
function textArg(value: string, anchor = false): string {
  check(typeof value === 'string' && value.length <= (anchor ? 600 : 4000))
  const bytes = new TextEncoder().encode(value); check(commentText(bytes, anchor) === value); return encode64(bytes)
}
export function publicCommentMessage(operation: CommentOperation, maxDepositUgnot: string): AminoMsg {
  const caller = address(operation.caller), note = idArg(operation.noteId), comment = idArg(operation.commentId), op = idArg(operation.operationId)
  const a = operation.action; let func: string, args: string[]
  switch (a.kind) {
    case 'add':
      check(a.parent !== operation.commentId)
      func = 'AddComment'; args = [note, comment, decimal(a.bodyRevision, 64, true), decimal(a.epoch, 32), a.parent ? idArg(a.parent) : encode64(new Uint8Array(16)), textArg(a.anchor, true), textArg(a.body), op]; break
    case 'delete': func = 'DeleteComment'; args = [note, comment, decimal(a.revision, 64, true), op]; break
    case 'resolve': check(typeof a.resolved === 'boolean'); func = 'ResolveComment'; args = [note, comment, decimal(a.revision, 64, true), String(a.resolved), op]; break
    case 'hide': check(typeof a.hidden === 'boolean'); func = 'HideComment'; args = [note, comment, decimal(a.revision, 64, true), String(a.hidden), op]; break
    default: throw new Error('Unknown comment operation')
  }
  return { type: 'vm/MsgCall', value: { caller, send: '', pkg_path: NOTES_REALM, func, args, max_deposit: `${decimal(maxDepositUgnot, 63)}ugnot` } }
}
