import { equalBytes, u32, u64 } from '../crypto/bytes'
import type { NotesReadClient } from './client'
import { COMMENTS_PAGE_SIZE, parsePublicComment, type PublicComment } from './comments'
import { blob, check, cursor, decimal, id, record } from './schema'

/** An encrypted comment as the realm stores it: public metadata, and one ciphertext holding its text and quote. */
export interface PrivateComment extends Omit<PublicComment, 'body' | 'anchor' | 'encrypted'> { encrypted: true; ciphertext: Uint8Array }
/** The realm's header check (validateCipher): version 1, suite 1, this epoch, field 3 (comment), field revision 1, 59-5,687 B. */
export function checkCommentCipher(bytes: Uint8Array, epoch: string): void {
  check(bytes.length >= 59 && bytes.length <= 5687 && bytes[0] === 1 && bytes[1] === 1 && bytes[6] === 3
    && equalBytes(bytes.subarray(2, 6), u32(Number(decimal(epoch, 32, true)))) && equalBytes(bytes.subarray(7, 15), u64(1n)))
}
export function parsePrivateComment(raw: unknown): PrivateComment {
  const parsed = parsePublicComment(raw)
  check(parsed.encrypted && parsed.epoch !== '0')
  const ciphertext = blob((raw as Record<string, unknown>).body_blob, 5687)
  if (!parsed.deleted) checkCommentCipher(ciphertext, parsed.epoch)
  const { body, anchor, ...metadata } = parsed
  check(body === '' && anchor === '')
  return { ...metadata, encrypted: true, ciphertext }
}
export async function readPrivateComment(client: Pick<NotesReadClient, 'getCommentRaw'>, noteId: string, commentId: string): Promise<PrivateComment | null> {
  id(noteId); id(commentId)
  const raw = await client.getCommentRaw(noteId, commentId)
  if (raw === null) return null
  const value = parsePrivateComment(raw); check(value.id === commentId); return value
}
/** The page of comments PublicComments shows (same cursor and size), with each one's ciphertext. */
export async function readPrivateCommentPage(client: Pick<NotesReadClient, 'commentsRaw'>, noteId: string, pageCursor: string): Promise<PrivateComment[]> {
  id(noteId); cursor(pageCursor)
  const v = record(await client.commentsRaw(noteId, pageCursor, COMMENTS_PAGE_SIZE), ['items', 'next_cursor'])
  check(Array.isArray(v.items) && v.items.length <= COMMENTS_PAGE_SIZE)
  return v.items.map(parsePrivateComment)
}
