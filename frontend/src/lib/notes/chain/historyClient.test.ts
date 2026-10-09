import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { NotesReadClient } from './client'
import { readPublicHistoryBody } from './historyBody'
import { encode64, NOTES_REALM } from './schema'
import info from './__fixtures__/history/info.json'
import page from './__fixtures__/history/page.json'
import entry from './__fixtures__/history/entry.json'
import version from './__fixtures__/history/version.json'
import body from './__fixtures__/history/body.json'
import comment from './__fixtures__/history/comment.json'

const rpc = vi.hoisted(() => ({ query: vi.fn(), identity: vi.fn(), url: 'https://rpc.test' }))
vi.mock('../../config', () => ({ GNO_CHAIN_ID: 'test-chain' }))
vi.mock('../../rpcFallback', () => ({ getRpcUrlsInOrder: () => [rpc.url], resilientAbciQueryDetailed: (...args: unknown[]) => rpc.query(...args) }))
vi.mock('../../dao/chainIdentity', () => ({ assertRpcChain: (...args: unknown[]) => rpc.identity(...args) }))
const wanted = info.id, cid = comment.comment_id
const response = (value: unknown) => ({ kind: 'ok', text: `(${JSON.stringify(JSON.stringify(value))} string)` })
function client(isCurrent = () => true) { return new NotesReadClient({ chainId: 'test-chain', deployment: { realm: NOTES_REALM, version: 1 }, rpcUrls: [rpc.url], isCurrent }) }
const fixtures: Record<string, unknown> = { PublicHistoryInfoJSON: info, PublicHistoryJSON: page, PublicHistoryEntryJSON: entry, PublicHistoryVersionJSON: version, PublicHistoryBodyChunkJSON: body, PublicHistoryCommentJSON: comment }
const calls = (c: NotesReadClient) => [() => c.publicHistoryInfo(wanted), () => c.publicHistory(wanted), () => c.publicHistoryEntry(wanted, '2'),
  () => c.publicHistoryVersion(wanted, '1'), () => c.publicHistoryBodyChunk(wanted, '1'), () => c.publicHistoryComment(wanted, cid)]
function bodyReplies(bytes: Uint8Array, patch: (raw: Record<string, unknown>, offset: number) => unknown = raw => raw) {
  return async (_path: string, expression: string, verify: (url: string) => Promise<void>) => {
    await verify(rpc.url)
    const m = expression.match(/\.PublicHistoryBodyChunkJSON\("[a-f0-9]{32}",1,([0-9]+),8192\)$/)
    if (!m) throw new Error('unexpected/unbounded history expression')
    const offset = Number(m[1]), chunk = bytes.slice(offset, offset + 8192)
    return response(patch({ ...body, sha256: bytesToHex(sha256(bytes)), total: String(bytes.length), offset: String(offset), next_offset: String(offset + chunk.length), chunk_blob: encode64(chunk) }, offset))
  }
}
beforeEach(() => {
  vi.clearAllMocks(); rpc.identity.mockResolvedValue(undefined)
  rpc.query.mockImplementation(async (_path, expression, verify) => {
    await verify(rpc.url); const name = String(expression).split('.')[String(expression).split('.').length - 1].split('(')[0]
    if (!(name in fixtures)) throw new Error('unexpected getter')
    return response(fixtures[name])
  })
})
describe('history client methods and bounded assembly', () => {
  it('reads all six real keeper responses through the existing verified transport', async () => {
    for (const call of calls(client())) expect(await call()).toMatchObject({ id: wanted })
    expect(rpc.query.mock.calls.map(call => call[1])).toEqual([
      `${NOTES_REALM}.PublicHistoryInfoJSON("${wanted}")`, `${NOTES_REALM}.PublicHistoryJSON("${wanted}",0,0,20)`,
      `${NOTES_REALM}.PublicHistoryEntryJSON("${wanted}",2)`, `${NOTES_REALM}.PublicHistoryVersionJSON("${wanted}",1)`,
      `${NOTES_REALM}.PublicHistoryBodyChunkJSON("${wanted}",1,0,8192)`, `${NOTES_REALM}.PublicHistoryCommentJSON("${wanted}","${cid}")`,
    ])
    expect(rpc.identity).toHaveBeenCalledTimes(6)
  })
  it('returns null for absent/private records, never treating getter errors as an empty history', async () => {
    rpc.query.mockResolvedValue(response(null))
    for (const call of calls(client())) expect(await call()).toBeNull()
    await expect(readPublicHistoryBody(client(), wanted, '1')).resolves.toBeNull()
    rpc.query.mockResolvedValue({ kind: 'empty' })
    for (const call of calls(client())) await expect(call()).rejects.toThrow('unavailable')
  })
  it('rejects malformed query arguments before any RPC', async () => {
    const c = client()
    const invalid = [() => c.publicHistoryInfo('00'.repeat(16)), () => c.publicHistory(wanted, '1', '0'), () => c.publicHistory(wanted, '0', '0', 21),
      () => c.publicHistoryEntry(wanted, '1);Attack()'), () => c.publicHistoryVersion(wanted, '0'), () => c.publicHistoryComment(wanted, 'bad'),
      () => c.publicHistoryBodyChunk(wanted, '1', -1), () => c.publicHistoryBodyChunk(wanted, '1', 0, 8193), () => c.publicHistoryBodyChunk(wanted, '1', 131073)]
    for (const call of invalid) await expect(call()).rejects.toThrow('format')
    expect(rpc.query).not.toHaveBeenCalled()
  })
  it('does not reuse live-note revisions or require a current note for immutable bodies', async () => {
    await expect(readPublicHistoryBody(client(), wanted, '1')).resolves.toEqual({ id: wanted, bodyRevision: '1', sha256: body.sha256, text: 'Body' })
    expect(rpc.query).toHaveBeenCalledOnce()
    expect(rpc.query.mock.calls[0][1]).not.toContain('.Note')
  })
  it('assembles exactly sixteen chunks at128KiB and decodes UTF8 after split code points', async () => {
    const text = 'a'.repeat(8191) + '😸' + 'b'.repeat(131072 - 8195)
    rpc.query.mockImplementation(bodyReplies(new TextEncoder().encode(text)))
    expect((await readPublicHistoryBody(client(), wanted, '1'))?.text).toBe(text)
    expect(rpc.query).toHaveBeenCalledTimes(16)
  })
  it('checks an empty body with one query and its exact digest', async () => {
    rpc.query.mockImplementation(bodyReplies(new Uint8Array()))
    expect((await readPublicHistoryBody(client(), wanted, '1'))?.text).toBe('')
    expect(rpc.query).toHaveBeenCalledOnce()
  })
  it('refuses chunk substitution, disappearance and nonprogress without looping', async () => {
    const bytes = new Uint8Array(8193).fill(97)
    for (const patch of [(raw: Record<string, unknown>) => ({ ...raw, total: '8194' }), (raw: Record<string, unknown>) => ({ ...raw, sha256: 'f'.repeat(64) }),
      () => null, (raw: Record<string, unknown>) => ({ ...raw, next_offset: '8192', chunk_blob: '' }), (raw: Record<string, unknown>) => ({ ...raw, body_revision: '2' })]) {
      rpc.query.mockClear().mockImplementation(bodyReplies(bytes, (raw, offset) => offset ? patch(raw) : raw))
      await expect(readPublicHistoryBody(client(), wanted, '1')).rejects.toThrow()
      expect(rpc.query).toHaveBeenCalledTimes(2)
    }
  })
  it('rejects a wrong final digest and invalid UTF8 even when the digest matches', async () => {
    rpc.query.mockImplementation(bodyReplies(new TextEncoder().encode('abc'), raw => ({ ...raw, sha256: 'f'.repeat(64) })))
    await expect(readPublicHistoryBody(client(), wanted, '1')).rejects.toThrow('format')
    rpc.query.mockImplementation(bodyReplies(new Uint8Array([255])))
    await expect(readPublicHistoryBody(client(), wanted, '1')).rejects.toThrow('format')
  })
  it('rechecks session after endpoint identity and each returned chunk', async () => {
    let active = true
    rpc.identity.mockImplementationOnce(async () => { active = false })
    await expect(client(() => active).publicHistoryInfo(wanted)).rejects.toThrow('session')
    active = true
    rpc.query.mockClear().mockImplementation(bodyReplies(new Uint8Array(8193).fill(97), (raw, offset) => { if (offset) active = false; return raw }))
    await expect(readPublicHistoryBody(client(() => active), wanted, '1')).rejects.toThrow('session')
    expect(rpc.query).toHaveBeenCalledTimes(2)
  })
})
