import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bech32Encode } from '../../dao/realmAddress'
import { NotesReadClient } from './client'
import { publicNoteMessage } from './messages'
import { blob, decodeResponse, encode64, NOTES_REALM, parseConfig, parseKey, parseNote, parsePage } from './schema'
import keeper from './__fixtures__/keeper-public.json'

const rpc = vi.hoisted(() => ({ query: vi.fn(), identity: vi.fn(), direct: vi.fn(), url: 'https://rpc.test' }))
vi.mock('../../config', () => ({ GNO_CHAIN_ID: 'test-chain' }))
vi.mock('../../rpcFallback', () => ({ getRpcUrlsInOrder: () => [rpc.url], resilientAbciQueryDetailed: (...args: unknown[]) => rpc.query(...args), directRpcCall: (...args: unknown[]) => rpc.direct(...args) }))
vi.mock('../../dao/chainIdentity', () => ({ assertRpcChain: (...args: unknown[]) => rpc.identity(...args) }))
const owner = bech32Encode('g', new Uint8Array(20).fill(1)), other = bech32Encode('g', new Uint8Array(20).fill(2))
const noteId = '01'.repeat(16), operationId = '02'.repeat(16)
const b64 = (s: string) => encode64(new TextEncoder().encode(s))
const configJSON = () => ({ realm: NOTES_REALM, admin: owner, pending_admin: '', treasury: other, create_fee_ugnot: '100000', paused: false })
const noteJSON = () => ({ id: noteId, owner, pending_owner: '', owner_generation: '1', mode: 3, state_revision: '9007199254740993', title_revision: '1', body_revision: '2', epoch: '0', title_blob: b64('Résumé 🐱'), commitment: '', deleted: false, listed: true, created_height: '20', op_id: operationId, actor: owner, height: '30', body_blob: b64('# Hello\n') })
const quote = (v: unknown) => `(${JSON.stringify(JSON.stringify(v))} string)`
function client(isCurrent = () => true) { return new NotesReadClient({ chainId: 'test-chain', deployment: { realm: NOTES_REALM, version: 1 }, rpcUrls: [rpc.url], isCurrent }) }
function chunkReplies(note = noteJSON(), patch: (value: Record<string, unknown>, kind: 'meta' | 'chunk') => Record<string, unknown> = value => value) {
  const { body_blob, ...fields } = note, body = blob(body_blob, 135223)
  return async (_path: string, data: string, verify: (url: string) => Promise<void>) => {
    await verify(rpc.url)
    if (data.includes('.NoteMetaJSON(')) return { kind: 'ok', text: quote(patch({ ...fields, body_bytes: String(body.length) }, 'meta')) }
    const match = data.match(/\.NoteBodyChunkJSON\("[a-f0-9]+",[0-9]+,([0-9]+),8192\)$/)
    if (!match) throw new Error('Unexpected or unbounded getter')
    const offset = Number(match[1]), bytes = body.slice(offset, offset + 8192)
    return { kind: 'ok', text: quote(patch({ id: note.id, state_revision: note.state_revision, body_revision: note.body_revision, epoch: note.epoch, offset: String(offset), total: String(body.length), next_offset: String(offset + bytes.length), chunk_blob: encode64(bytes) }, 'chunk')) }
  }
}
beforeEach(() => {
  vi.clearAllMocks(); rpc.identity.mockResolvedValue(undefined)
  rpc.query.mockImplementation(chunkReplies())
})
it('bounds private metadata/wrap expressions and rejects query injection before RPC', async () => {
  rpc.query.mockImplementation(async (_path: string, _data: string, verify: (url: string) => Promise<void>) => { await verify(rpc.url); return { kind: 'ok', text: quote(null) } })
  const c = client()
  await c.epochMetadataRaw(noteId, '2'); expect(rpc.query.mock.calls.at(-1)?.[1]).toBe(`${NOTES_REALM}.EpochsJSON("${noteId}",1,1)`)
  await c.wrapRaw(noteId, '2', owner); expect(rpc.query.mock.calls.at(-1)?.[1]).toBe(`${NOTES_REALM}.WrapJSON("${noteId}",2,address("${owner}"))`)
  await c.readersRaw(noteId); expect(rpc.query.mock.calls.at(-1)?.[1]).toBe(`${NOTES_REALM}.ReadersJSON("${noteId}")`)
  await expect(c.epochMetadataRaw(noteId, '0')).rejects.toThrow()
  await expect(c.wrapRaw(noteId, '2', 'bad"),Foo()')).rejects.toThrow()
  expect(rpc.query).toHaveBeenCalledTimes(3)
})
describe('strict getter schemas', () => {
  it('parses actual keeper e75 qeval outputs from the realm integration suite', () => {
    const note = parseNote(decodeResponse(keeper.note)), config = parseConfig(decodeResponse(keeper.config))
    expect(new TextDecoder().decode(note.title)).toBe('Fixture title 😀')
    expect(new TextDecoder().decode(note.body)).toBe('Public fixture body')
    expect(note.height).toBe('42'); expect(note.mode).toBe(3)
    expect(config.createFeeUgnot).toBe('100000')
    expect(parseKey(decodeResponse(keeper.key), note.owner)).toMatchObject({ generation: '0', active: false })
  })
  it('preserves 64-bit revisions and Unicode, permits retained epochs after Publish', () => {
    const n = parseNote(noteJSON()); expect(n.stateRevision).toBe('9007199254740993')
    expect(new TextDecoder().decode(n.title)).toBe('Résumé 🐱')
    expect(parseNote({ ...noteJSON(), epoch: '3' }).epoch).toBe('3')
  })
  it.each([1, '01', '-1', '18446744073709551616', '1e3', ''])('rejects malformed revision %s', revision => {
    expect(() => parseNote({ ...noteJSON(), state_revision: revision })).toThrow()
  })
  it('rejects unknown fields, wrong addresses, blob overflow, noncanonical base64 and UTF8', () => {
    expect(() => parseNote({ ...noteJSON(), extra: true })).toThrow()
    expect(() => parseNote({ ...noteJSON(), actor: owner.toUpperCase() })).toThrow()
    expect(() => parseNote({ ...noteJSON(), body_blob: encode64(new Uint8Array(131073)) })).toThrow()
    expect(() => parseNote({ ...noteJSON(), body_blob: '/w==' })).toThrow()
    for (const bad of ['AB==', 'YQ=\n', 'YQ', ' YQ==']) expect(() => blob(bad, 10)).toThrow()
  })
  it('bounds tombstones, list schemas, duplicate IDs and cursor counts', () => {
    expect(() => parseNote({ ...noteJSON(), deleted: true })).toThrow()
    expect(parseNote({ ...noteJSON(), deleted: true, listed: false, title_blob: '', body_blob: '' }).deleted).toBe(true)
    const { body_blob, ...row } = noteJSON(); expect(body_blob).toBeTruthy()
    expect(parsePage({ items: [row], next_cursor: '' }, 2).items).toHaveLength(1)
    expect(() => parsePage({ items: [row, row], next_cursor: '' }, 2)).toThrow()
    expect(() => parsePage({ items: [row], next_cursor: '0'.repeat(20) + ':' + noteId }, 2)).toThrow()
    expect(() => parsePage({ items: [noteJSON()], next_cursor: '' }, 2)).toThrow()
  })
  it('distinguishes unknown/revoked registry records and refuses replacement identity guesses', () => {
    const base = { address: owner, suite: 'xwing-v1', generation: '0', active: false, public_key: '', op_id: '', height: '0' }
    expect(parseKey(base, owner).generation).toBe('0')
    const active = { ...base, generation: '5', active: true, public_key: encode64(new Uint8Array(1216)), op_id: operationId, height: '50' }
    expect(parseKey(active, owner).publicKey.length).toBe(1216)
    expect(parseKey({ ...active, active: false, public_key: '' }, owner).generation).toBe('5')
    expect(() => parseKey(active, other)).toThrow()
    expect(() => parseKey({ ...active, public_key: '' }, owner)).toThrow()
    expect(() => parseKey({ ...base, generation: '5' }, owner)).toThrow()
  })
  it('requires strict qeval framing and does not confuse malformed/empty with missing notes', () => {
    expect(decodeResponse(quote(null))).toBeNull()
    for (const raw of ['', 'null', '({} string)', '("null" bool)', '("not json" string)', 'x'.repeat(400001)]) expect(() => decodeResponse(raw)).toThrow()
  })
})
describe('bound network reads', () => {
  it('uses the exact shared index getter with bounded metadata pages and rejects injected arguments', async () => {
    const { body_blob, ...row } = noteJSON(); expect(body_blob).toBeTruthy()
    const next = '00000000000000000001:' + noteId
    rpc.query.mockResolvedValue({ kind: 'ok', text: quote({ items: [row], next_cursor: next }) })
    const c = client(), page = await c.sharedWith(other, '', 1)
    expect(page.items[0].body).toBeUndefined(); expect(page.nextCursor).toBe(next)
    expect(rpc.query.mock.calls.at(-1)?.[1]).toBe(`${NOTES_REALM}.ListSharedWithJSON(address("${other}"),"",1)`)
    await c.sharedWith(other, next, 1)
    expect(rpc.query.mock.calls.at(-1)?.[1]).toBe(`${NOTES_REALM}.ListSharedWithJSON(address("${other}"),"${next}",1)`)
    for (const args of [[other, '"', 1], ['bad"', '', 1], [other, '', 51]] as const) await expect(c.sharedWith(args[0], args[1], args[2])).rejects.toThrow()
    expect(rpc.query).toHaveBeenCalledTimes(2)
    rpc.query.mockResolvedValueOnce({ kind: 'ok', text: quote({ items: [{ ...row, deleted: true, listed: false, title_blob: '' }], next_cursor: '' }) })
    await expect(c.sharedWith(other)).rejects.toThrow()
    rpc.query.mockResolvedValueOnce({ kind: 'ok', text: quote({ items: [noteJSON()], next_cursor: '' }) })
    await expect(c.sharedWith(other)).rejects.toThrow()
    rpc.query.mockResolvedValueOnce({ kind: 'ok', text: quote([]) })
    await c.writersRaw(noteId)
    expect(rpc.query.mock.calls.at(-1)?.[1]).toBe(`${NOTES_REALM}.WritersJSON("${noteId}")`)
    await expect(c.writersRaw('"')).rejects.toThrow()
    expect(rpc.query).toHaveBeenCalledTimes(5)
  })
  it('reads fresh quote heights only from the configured chain at a caught-up node', async () => {
    const status = { node_info: { network: 'test-chain' }, sync_info: { latest_block_height: '1234567890123456', catching_up: false } }
    rpc.direct.mockResolvedValueOnce(status)
    expect(await client().height()).toBe('1234567890123456')
    expect(rpc.direct).toHaveBeenCalledWith(rpc.url, 'status')
    rpc.direct.mockResolvedValueOnce({ ...status, node_info: { network: 'wrong' } })
    await expect(client().height()).rejects.toThrow('network')
    rpc.direct.mockResolvedValueOnce({ ...status, sync_info: { ...status.sync_info, catching_up: true } })
    await expect(client().height()).rejects.toThrow()
  })
  it('verifies the configured endpoint and exact getter target', async () => {
    expect((await client().note(noteId))?.id).toBe(noteId)
    expect(rpc.identity).toHaveBeenCalledWith(rpc.url, 'test-chain')
    expect(rpc.query).toHaveBeenCalledWith('vm/qeval', `${NOTES_REALM}.NoteMetaJSON("${noteId}")`, expect.any(Function))
  })
  it('refuses arbitrary realms, chains, endpoints and injected expressions before IO', async () => {
    const context = { chainId: 'test-chain', deployment: { realm: NOTES_REALM, version: 1 as const }, rpcUrls: [rpc.url], isCurrent: () => true }
    expect(() => new NotesReadClient({ ...context, chainId: 'other' })).toThrow()
    expect(() => new NotesReadClient({ ...context, rpcUrls: ['https://evil.test'] })).toThrow()
    expect(() => new NotesReadClient({ ...context, deployment: { realm: 'gno.land/r/evil', version: 1 } })).toThrow()
    await expect(client().note('");Attack()')).rejects.toThrow()
    await expect(client().byOwner(owner, '"', 50)).rejects.toThrow()
    expect(rpc.query).not.toHaveBeenCalled()
  })
  it('rechecks session after the endpoint probe and after the query', async () => {
    let current = true
    rpc.identity.mockImplementationOnce(async () => { current = false })
    await expect(client(() => current).note(noteId)).rejects.toThrow('session')
    current = true
    rpc.query.mockImplementationOnce(async () => { current = false; return { kind: 'ok', text: quote(noteJSON()) } })
    await expect(client(() => current).note(noteId)).rejects.toThrow('session')
  })
  it('fails closed for unavailable, wrong IDs and wrong directory owner', async () => {
    rpc.query.mockResolvedValueOnce({ kind: 'empty' })
    await expect(client().note(noteId)).rejects.toThrow('unavailable')
    rpc.query.mockResolvedValueOnce({ kind: 'ok', text: quote(null) })
    await expect(client().note(noteId)).resolves.toBeNull()
    rpc.query.mockResolvedValueOnce({ kind: 'ok', text: quote({ ...noteJSON(), id: operationId }) })
    await expect(client().note(noteId)).rejects.toThrow()
    const { body_blob, ...row } = noteJSON(); expect(body_blob).toBeTruthy()
    rpc.query.mockResolvedValueOnce({ kind: 'ok', text: quote({ items: [{ ...row, owner: other }], next_cursor: '' }) })
    await expect(client().byOwner(owner)).rejects.toThrow()
  })
  it('assembles maximum public UTF-8 split across bounded chunks, without a full-body getter', async () => {
    const text = 'x'.repeat(8191) + '😸' + 'y'.repeat(131072 - 8195)
    rpc.query.mockImplementation(chunkReplies({ ...noteJSON(), body_blob: b64(text) }))
    const note = await client().note(noteId)
    expect(new TextDecoder().decode(note?.body)).toBe(text)
    expect(note?.bodyBytes).toBe(131072)
    expect(rpc.query).toHaveBeenCalledTimes(18)
    expect(rpc.query.mock.calls.some(([, data]) => String(data).includes('.NoteJSON('))).toBe(false)
  })
  it('assembles maximum private ciphertext and zero-body tombstones', async () => {
    rpc.query.mockImplementation(chunkReplies({ ...noteJSON(), mode: 0, epoch: '2', commitment: encode64(new Uint8Array(32).fill(1)), title_blob: encode64(new Uint8Array(231)), body_blob: encode64(new Uint8Array(135223)) }))
    expect((await client().note(noteId))?.body?.length).toBe(135223)
    expect(rpc.query).toHaveBeenCalledTimes(19)
    rpc.query.mockClear().mockImplementation(chunkReplies({ ...noteJSON(), deleted: true, listed: false, title_blob: '', body_blob: '' }))
    expect((await client().note(noteId))?.deleted).toBe(true)
    expect(rpc.query).toHaveBeenCalledTimes(2)
  })
  it('refuses mixed revisions, bad offsets, oversized chunks and changed final metadata', async () => {
    for (const patch of [{ state_revision: '9' }, { next_offset: '0' }, { total: '0' }, { chunk_blob: encode64(new Uint8Array(8193)) }]) {
      rpc.query.mockImplementation(chunkReplies(noteJSON(), (value, kind) => kind === 'chunk' ? { ...value, ...patch } : value))
      await expect(client().note(noteId)).rejects.toThrow()
    }
    let metadataReads = 0
    rpc.query.mockImplementation(chunkReplies(noteJSON(), (value, kind) => kind === 'meta' && ++metadataReads > 1 ? { ...value, state_revision: '9007199254740994' } : value))
    await expect(client().note(noteId)).rejects.toThrow('stale')
  })
})
describe('canonical public messages', () => {
  it('encodes exact keeper args, exact fee and explicit storage cap', () => {
    expect(publicNoteMessage({ caller: owner, noteId, operationId, action: { kind: 'create', mode: 3, title: 'Note', body: 'é', maxFeeUgnot: '100000' } }, '220000', parseConfig(configJSON()))).toEqual({
      type: 'vm/MsgCall', value: { caller: owner, pkg_path: NOTES_REALM, func: 'CreateNote', send: '100000ugnot', max_deposit: '220000ugnot', args: ['AQEBAQEBAQEBAQEBAQEBAQ==', '3', 'Tm90ZQ==', 'w6k=', '', '', '100000', 'AgICAgICAgICAgICAgICAg=='] },
    })
  })
  it('retains title/body CAS distinctions and never sends funds on edits', () => {
    const action = { kind: 'commit' as const, revision: '9007199254740993', epoch: '7', body: '' }
    const message = publicNoteMessage({ caller: owner, noteId, operationId, action }, '1000')
    expect(message.value.args).toEqual(['AQEBAQEBAQEBAQEBAQEBAQ==', '9007199254740993', '7', '2', '', '', 'AgICAgICAgICAgICAgICAg=='])
    expect(message.value.send).toBe('')
  })
  it('rejects fee changes beyond cap, invalid Unicode/title and unsafe deposit', () => {
    const action = { kind: 'create' as const, mode: 3 as const, title: 'Note', body: '', maxFeeUgnot: '99999' }
    const op = { caller: owner, noteId, operationId, action }
    expect(() => publicNoteMessage(op, '0', parseConfig(configJSON()))).toThrow()
    for (const title of ['\u0085Note', 'Note\u0085', 'Note\u200b', 'a/b', '\ud800', 'é'.repeat(81)]) {
      expect(() => publicNoteMessage({ ...op, action: { ...action, title, maxFeeUgnot: '100000' } }, '0', parseConfig(configJSON()))).toThrow()
    }
    expect(() => publicNoteMessage({ ...op, action: { kind: 'delete', revision: '1' } }, '9223372036854775808')).toThrow()
  })
})
