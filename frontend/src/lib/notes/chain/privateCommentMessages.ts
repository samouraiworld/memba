import type { AminoMsg } from '../../grc20'
import { publicCommentMessage, type CommentAction, type CommentOperation } from './commentMessages'
import { checkCommentCipher } from './privateComments'
import { address, blob, check, decimal, encode64, id, NotesChainError, realmPath, validNotesRealm } from './schema'

export type PrivateCommentAction = Exclude<CommentAction, { kind: 'add' }> | { kind: 'add'; bodyRevision: string; epoch: string; parent?: string; ciphertext: Uint8Array }
export interface PrivateCommentOperation extends Omit<CommentOperation, 'action'> { action: PrivateCommentAction }
const idArg = (value: string) => encode64(Uint8Array.from(id(value).match(/../g)!, byte => parseInt(byte, 16)))
/** `realm` is the deployment's Notes realm path. The anchor argument stays empty: a quote is inside the ciphertext. */
export function privateCommentMessage(operation: PrivateCommentOperation, maxDepositUgnot: string, realm: string): AminoMsg {
  const a = operation.action
  if (a.kind !== 'add') return publicCommentMessage({ ...operation, action: a }, maxDepositUgnot, realm)
  check(a.parent !== operation.commentId); checkCommentCipher(a.ciphertext, a.epoch)
  return { type: 'vm/MsgCall', value: { caller: address(operation.caller), send: '', pkg_path: realmPath(realm), func: 'AddComment',
    args: [idArg(operation.noteId), idArg(operation.commentId), decimal(a.bodyRevision, 64, true), decimal(a.epoch, 32, true), a.parent ? idArg(a.parent) : encode64(new Uint8Array(16)), '', encode64(a.ciphertext), idArg(operation.operationId)],
    max_deposit: `${decimal(maxDepositUgnot, 63)}ugnot` } }
}
/**
 * Bounded fallback (the quote simulates first), from keeper measurements of memba_notes_v1 (samcrew-deployer e485e2a on
 * gno e75fef82, 100 ugnot/B):
 * - AddComment, M0 rows 7 (279 B ciphertext of a 200 B comment): 1,000,000 ugnot for an author's first comment on the
 *   note, 787,100 for the same author again, 23.0-26.2 M gas; the 10-08 maximum (5,687 B): 1,232,900-1,545,900 ugnot,
 *   24.7 M gas. Estimate (ciphertext + 10,000 B) × 100: 1,027,900 for 279 B, 1,568,700 at 5,687 B, at or above every row.
 * - Hide (10-08: +2,400 to +6,000 ugnot) and Resolve (0): 500 B, 50,000 ugnot. Delete returns deposit (−600,800 for a
 *   5,687 B comment): 0, a refund is never assumed. All three used 13.2-13.6 M gas.
 * Cap (max_deposit) = estimate × 1.2 rounded up to 0.1 GNOT, at least 0.1 GNOT. Gas = 60 M + 2,200 per ciphertext byte,
 * rounded up to 1 M: 61 M for 279 B (≥ 2.3× M0), 73 M at 5,687 B (≥ 2.9×); 60 M otherwise (≥ 4.4×). Encrypted comments
 * write no public history, so a busy note does not add history gas.
 */
export function privateCommentBudget(message: AminoMsg): { gasWanted: number; estimatedDepositUgnot: string; suggestedCapUgnot: string } {
  check(message.type === 'vm/MsgCall' && validNotesRealm(message.value.pkg_path))
  const { func, args } = message.value; check(Array.isArray(args))
  if (func === 'AddComment') { check(args.length === 8 && args[5] === ''); return encryptedCommentBudget(blob(args[6], 5687).length) }
  if (func === 'DeleteComment') { check(args.length === 4); return budget(0, 0) }
  if (func === 'HideComment' || func === 'ResolveComment') { check(args.length === 5); return budget(0, 50_000) }
  throw new NotesChainError('format')
}
/** AddComment's bounded figures for a ciphertext of `bytes` (the composer prices the text before it is sealed). */
export function encryptedCommentBudget(bytes: number) { check(Number.isSafeInteger(bytes) && bytes >= 59 && bytes <= 5687); return budget(bytes, (bytes + 10_000) * 100) }
const budget = (bytes: number, estimate: number) => ({ gasWanted: Math.ceil((60_000_000 + bytes * 2_200) / 1_000_000) * 1_000_000, estimatedDepositUgnot: String(estimate),
  suggestedCapUgnot: String(Math.max(1, Math.ceil(estimate * 12 / 1_000_000)) * 100_000) })
