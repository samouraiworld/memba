import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bech32Encode } from '../../dao/realmAddress'
import { NotesReadClient } from './client'
import { commentText, parsePublicComment, readPublicComment, readPublicComments } from './comments'
import { decodeResponse, encode64, NOTES_REALM } from './schema'

import keeper from './__fixtures__/keeper-comments.json'

const rpc = vi.hoisted(() => ({ query: vi.fn(), identity: vi.fn(), url: 'https://rpc.test' }))
vi.mock('../../config', () => ({ GNO_CHAIN_ID: 'test-chain' }))
vi.mock('../../rpcFallback', () => ({ getRpcUrlsInOrder: () => [rpc.url], resilientAbciQueryDetailed: (...args: unknown[]) => rpc.query(...args) }))
vi.mock('../../dao/chainIdentity', () => ({ assertRpcChain: (...args: unknown[]) => rpc.identity(...args) }))
const owner = bech32Encode('g', new Uint8Array(20).fill(1)), noteId = '01'.repeat(16), commentId = '02'.repeat(16)
const b64 = (s: string) => encode64(new TextEncoder().encode(s))
const row = () => ({ id: commentId, parent: '0'.repeat(32), author: owner, encrypted: false, body_revision: '9007199254740993', epoch: '0', revision: '1', anchor_blob: b64('Selected passage'), body_blob: b64('Public reply 🐱'), created_height: '20', op_id: '03'.repeat(16), actor: owner, height: '20', deleted: false, hidden: false, resolved: false })
const client = () => new NotesReadClient({ chainId: 'test-chain', deployment: { realm: NOTES_REALM, version: 1 }, rpcUrls: [rpc.url], isCurrent: () => true })
beforeEach(() => { vi.clearAllMocks(); rpc.identity.mockResolvedValue(undefined); rpc.query.mockImplementation(async (_path, _query, guard) => { await guard(rpc.url); return { kind: 'ok', text: `(${JSON.stringify(JSON.stringify(row()))} string)` } }) })

describe('public comments schema and transport', () => {
  it('parses unmodified qeval output from the exact-runtime keeper including Unicode and moderation', async () => {
    const publicComment = parsePublicComment(decodeResponse(keeper.public))
    expect([...publicComment.body]).toHaveLength(1000)
    expect(publicComment.body).toBe('😀'.repeat(1000))
    expect(publicComment.anchor).toBe('{"quote":"body"}')
    expect(parsePublicComment(decodeResponse(keeper.moderated))).toMatchObject({ hidden: true, resolved: true, revision: '3' })
    expect(parsePublicComment(decodeResponse(keeper.deleted))).toMatchObject({ deleted: true, body: '', anchor: '', revision: '4' })
    const result = await readPublicComments({ commentsRaw: vi.fn(async () => decodeResponse(keeper.page)) }, noteId, '0', '1')
    expect(result.items).toHaveLength(1); expect(result.nextCursor).toBe('')
  })
  it('uses exact bounded keeper getter expressions after validating every interpolated argument', async () => {
    expect((await readPublicComment(client(), noteId, commentId))?.bodyRevision).toBe('9007199254740993')
    expect(rpc.query).toHaveBeenLastCalledWith('vm/qeval', `${NOTES_REALM}.CommentJSON("${noteId}","${commentId}")`, expect.any(Function))
    await client().commentsRaw(noteId, '', 5)
    expect(rpc.query).toHaveBeenLastCalledWith('vm/qeval', `${NOTES_REALM}.CommentsJSON("${noteId}","",5)`, expect.any(Function))
    expect(rpc.identity).toHaveBeenCalledWith(rpc.url, 'test-chain')
    const count = rpc.query.mock.calls.length
    for (const args of [['bad', '', 20], [noteId, '");Attack()', 20], [noteId, '', 6]] as const) await expect(client().commentsRaw(...args)).rejects.toThrow()
    await expect(client().getCommentRaw(noteId, 'bad')).rejects.toThrow()
    expect(rpc.query).toHaveBeenCalledTimes(count)
  })
  it('bounds public body independently by bytes and 1000 Unicode code points, anchor by 600 bytes', () => {
    const text = (value: string, anchor = false) => commentText(new TextEncoder().encode(value), anchor)
    expect(text('🐱'.repeat(1000))).toHaveLength(2000)
    expect(text('é'.repeat(300), true)).toHaveLength(300)
    for (const value of ['', 'x'.repeat(1001), '🐱'.repeat(1001)]) expect(() => text(value)).toThrow()
    expect(() => text('é'.repeat(301), true)).toThrow()
    expect(() => commentText(new Uint8Array([255]))).toThrow()
    for (const patch of [{ extra: true }, { body_blob: 'AB==' }, { body_revision: 1 }, { parent: commentId }, { height: '19' }, { encrypted: 'false' }, { actor: 'bad' }]) expect(() => parsePublicComment({ ...row(), ...patch })).toThrow()
  })
  it('distinguishes tombstones, moderation and opaque encrypted historical comments', () => {
    expect(parsePublicComment({ ...row(), hidden: true, resolved: true })).toMatchObject({ hidden: true, resolved: true, body: 'Public reply 🐱' })
    expect(() => parsePublicComment({ ...row(), deleted: true })).toThrow()
    expect(parsePublicComment({ ...row(), deleted: true, body_blob: '', anchor_blob: '' })).toMatchObject({ deleted: true, body: '', anchor: '' })
    expect(parsePublicComment({ ...row(), encrypted: true, anchor_blob: '', body_blob: encode64(new Uint8Array(59)) })).toMatchObject({ encrypted: true, body: '', anchor: '' })
  })
  it('checks page size, order, versions, duplicate IDs and advancing cursor identity', async () => {
    const next = '00000000000000000001:' + commentId
    const api = { commentsRaw: vi.fn(async () => ({ items: [row()], next_cursor: next })) }
    expect((await readPublicComments(api, noteId, '0', '9007199254740993', '', 1)).nextCursor).toBe(next)
    for (const value of [
      { items: [row(), row()], next_cursor: '' },
      { items: [{ ...row(), epoch: '1' }], next_cursor: '' },
      { items: [{ ...row(), body_revision: '9007199254740994' }], next_cursor: '' },
      { items: [row()], next_cursor: next.replace(commentId, '04'.repeat(16)) },
      { items: [row(), { ...row(), id: '04'.repeat(16), created_height: '19' }], next_cursor: '' },
    ]) { api.commentsRaw.mockResolvedValueOnce(value); await expect(readPublicComments(api, noteId, '0', '9007199254740993', '', 2)).rejects.toThrow() }
    await expect(readPublicComments(api, noteId, '0', '9007199254740993', next, 1)).rejects.toThrow()
    await expect(readPublicComment({ getCommentRaw: vi.fn(async () => row()) }, noteId, '04'.repeat(16))).rejects.toThrow()
    expect(await readPublicComment({ getCommentRaw: vi.fn(async () => null) }, noteId, commentId)).toBeNull()
  })
})
