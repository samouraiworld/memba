import type { NotesReadClient } from './client'
import { address, blob, check, cursor, decimal, id, record } from './schema'

// Conservative query budget; kept aligned with the keeper's CommentsJSON cap.
export const COMMENTS_PAGE_SIZE = 5
export interface PublicComment {
  id: string; parent: string; author: string; encrypted: boolean; bodyRevision: string; epoch: string; revision: string
  anchor: string; body: string; createdHeight: string; operationId: string; actor: string; height: string
  deleted: boolean; hidden: boolean; resolved: boolean
}
export interface CommentsPage { items: PublicComment[]; nextCursor: string }
export type CommentsClient = Pick<NotesReadClient, 'commentsRaw'>
const ZERO_ID = '0'.repeat(32)
const KEYS = ['id', 'parent', 'author', 'encrypted', 'body_revision', 'epoch', 'revision', 'anchor_blob', 'body_blob', 'created_height', 'op_id', 'actor', 'height', 'deleted', 'hidden', 'resolved']
/** Public text only: limits count UTF-8 bytes and Unicode code points independently. */
export function commentText(bytes: Uint8Array, anchor = false): string {
  check(bytes.length <= (anchor ? 600 : 4000))
  let value: string
  try { value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { check(false) }
  check(anchor || (bytes.length > 0 && [...value!].length <= 1000)); return value!
}
export function parsePublicComment(raw: unknown): PublicComment {
  const v = record(raw, KEYS)
  check(['encrypted', 'deleted', 'hidden', 'resolved'].every(key => typeof v[key] === 'boolean'))
  const parent = v.parent === ZERO_ID ? '' : id(v.parent), commentId = id(v.id)
  check(parent !== commentId)
  const anchor = blob(v.anchor_blob, 600), body = blob(v.body_blob, v.encrypted ? 5687 : 4000)
  if (v.deleted) check(!anchor.length && !body.length)
  else if (v.encrypted) check(!anchor.length && body.length >= 59)
  const value: PublicComment = {
    id: commentId, parent, author: address(v.author), encrypted: v.encrypted as boolean,
    bodyRevision: decimal(v.body_revision, 64, true), epoch: decimal(v.epoch, 32), revision: decimal(v.revision, 64, true),
    anchor: v.deleted || v.encrypted ? '' : commentText(anchor, true), body: v.deleted || v.encrypted ? '' : commentText(body),
    createdHeight: decimal(v.created_height, 63, true), operationId: id(v.op_id), actor: address(v.actor), height: decimal(v.height, 63, true),
    deleted: v.deleted as boolean, hidden: v.hidden as boolean, resolved: v.resolved as boolean,
  }
  check(BigInt(value.height) >= BigInt(value.createdHeight)); return value
}
export async function readPublicComments(client: CommentsClient, noteId: string, epoch: string, bodyRevision: string, pageCursor = '', limit = COMMENTS_PAGE_SIZE): Promise<CommentsPage> {
  id(noteId); decimal(epoch, 32); decimal(bodyRevision, 64, true); cursor(pageCursor)
  check(Number.isInteger(limit) && limit >= 1 && limit <= COMMENTS_PAGE_SIZE)
  const v = record(await client.commentsRaw(noteId, pageCursor, limit), ['items', 'next_cursor'])
  check(Array.isArray(v.items) && v.items.length <= limit)
  const items = v.items.map(parsePublicComment), nextCursor = cursor(v.next_cursor)
  check(new Set(items.map(item => item.id)).size === items.length)
  check(items.every((item, index) => BigInt(item.epoch) <= BigInt(epoch) && BigInt(item.bodyRevision) <= BigInt(bodyRevision)
    && (!index || BigInt(item.createdHeight) >= BigInt(items[index - 1].createdHeight))))
  check(!nextCursor || (items.length === limit && BigInt(nextCursor.slice(0, 20)) > BigInt(pageCursor ? pageCursor.slice(0, 20) : '0') && nextCursor.slice(21) === items.at(-1)!.id))
  return { items, nextCursor }
}
export async function readPublicComment(client: Pick<NotesReadClient, 'getCommentRaw'>, noteId: string, commentId: string): Promise<PublicComment | null> {
  id(noteId); id(commentId)
  const raw = await client.getCommentRaw(noteId, commentId)
  if (raw === null) return null
  const value = parsePublicComment(raw); check(value.id === commentId); return value
}
