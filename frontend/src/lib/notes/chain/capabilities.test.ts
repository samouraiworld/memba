import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bech32Encode } from '../../dao/realmAddress'
import { NotesReadClient } from './client'
import { parsePublicCapabilities } from './capabilities'
import { readPublicContentWritePermission, readPublicWritePermission } from './publicPermissions'
import { NOTES_REALM, type ChainNote } from './schema'

const rpc = vi.hoisted(() => ({ query: vi.fn(), identity: vi.fn(), url: 'https://rpc.test' }))
vi.mock('../../config', () => ({ GNO_CHAIN_ID: 'test-chain' }))
vi.mock('../../rpcFallback', () => ({ getRpcUrlsInOrder: () => [rpc.url], resilientAbciQueryDetailed: (...args: unknown[]) => rpc.query(...args) }))
vi.mock('../../dao/chainIdentity', () => ({ assertRpcChain: (...args: unknown[]) => rpc.identity(...args) }))
const noteId = '01'.repeat(16), owner = bech32Encode('g', new Uint8Array(20).fill(1)), other = bech32Encode('g', new Uint8Array(20).fill(2))
const wire = () => ({ schema: 'memba-notes/public-capabilities/v1', id: noteId, state_revision: '9007199254740993', owner_generation: '2', mode: 4, deleted: false, allow_public_writes: true })
const note = (): ChainNote => ({ id: noteId, owner, pendingOwner: '', ownerGeneration: '2', stateRevision: '9007199254740993', mode: 4, deleted: false, epoch: '0', titleRevision: '1', bodyRevision: '1', title: new TextEncoder().encode('Sushi'), commitment: new Uint8Array(), listed: true, createdHeight: '1', operationId: '02'.repeat(16), actor: owner, height: '2' })
const response = (value: unknown) => ({ kind: 'ok', text: `(${JSON.stringify(JSON.stringify(value))} string)` })
function client(isCurrent = () => true) { return new NotesReadClient({ chainId: 'test-chain', deployment: { realm: NOTES_REALM, version: 1 }, rpcUrls: [rpc.url], isCurrent }) }
function permission(n = note(), enabled = true) {
  return { assertCurrent: vi.fn(), publicCapabilities: vi.fn(async () => parsePublicCapabilities({ ...wire(), state_revision: n.stateRevision, owner_generation: n.ownerGeneration, mode: n.mode, deleted: n.deleted, allow_public_writes: enabled })),
    noteMetadata: vi.fn(async (): Promise<ChainNote | null> => structuredClone(n)), writersRaw: vi.fn(async () => [] as string[]) }
}
beforeEach(() => { vi.clearAllMocks(); rpc.identity.mockResolvedValue(undefined); rpc.query.mockImplementation(async (_path, _data, verify) => { await verify(rpc.url); return response(wire()) }) })

describe('strict C1 capability codec and transport', () => {
  it('preserves exact uint64 values and null, with closed mode/deletion permissions', () => {
    expect(parsePublicCapabilities(wire())).toEqual({ id: noteId, stateRevision: '9007199254740993', ownerGeneration: '2', mode: 4, deleted: false, allowPublicWrites: true })
    expect(parsePublicCapabilities(null)).toBeNull()
    expect(parsePublicCapabilities({ ...wire(), mode: 3, allow_public_writes: false })?.allowPublicWrites).toBe(false)
    expect(parsePublicCapabilities({ ...wire(), deleted: true, allow_public_writes: false })?.deleted).toBe(true)
  })
  it.each([
    { schema: 'memba-notes/public-capabilities/v2' }, { extra: true }, { id: '00'.repeat(16) }, { id: 'FF'.repeat(16) },
    { state_revision: '0' }, { state_revision: '01' }, { state_revision: 1 }, { state_revision: '18446744073709551616' },
    { owner_generation: '0' }, { owner_generation: '01' }, { owner_generation: '9007199254740994' },
    { mode: 0 }, { mode: '4' }, { mode: 3 }, { deleted: true }, { deleted: 'false' }, { allow_public_writes: 'true' },
  ])('rejects malformed or impossible payload %j', patch => { expect(() => parsePublicCapabilities({ ...wire(), ...patch })).toThrow('format') })
  it('rejects missing/inherited fields and non-records', () => {
    for (const key of Object.keys(wire())) { const value: Record<string, unknown> = { ...wire() }; delete value[key]; expect(() => parsePublicCapabilities(value)).toThrow('format') }
    for (const value of [undefined, [], false, 'null', Object.create(wire())]) expect(() => parsePublicCapabilities(value)).toThrow('format')
  })
  it('uses the pinned endpoint/realm and binds the returned note ID', async () => {
    await expect(client().publicCapabilities(noteId)).resolves.toMatchObject({ id: noteId, allowPublicWrites: true })
    expect(rpc.query.mock.calls[0].slice(0, 2)).toEqual(['vm/qeval', `${NOTES_REALM}.PublicCapabilitiesJSON("${noteId}")`])
    expect(rpc.identity).toHaveBeenCalledWith(rpc.url, 'test-chain')
    rpc.query.mockResolvedValueOnce(response({ ...wire(), id: '03'.repeat(16) }))
    await expect(client().publicCapabilities(noteId)).rejects.toThrow('format')
    rpc.query.mockResolvedValueOnce(response(null)); await expect(client().publicCapabilities(noteId)).resolves.toBeNull()
    rpc.query.mockResolvedValueOnce({ kind: 'empty' }); await expect(client().publicCapabilities(noteId)).rejects.toThrow('unavailable')
    const calls = rpc.query.mock.calls.length
    await expect(client().publicCapabilities('");Attack()')).rejects.toThrow('format'); expect(rpc.query).toHaveBeenCalledTimes(calls)
  })
  it('refuses wrong endpoint chain and late responses after lifetime invalidation', async () => {
    rpc.identity.mockRejectedValueOnce(new Error('wrong chain')); await expect(client().publicCapabilities(noteId)).rejects.toThrow('wrong chain')
    let current = true
    rpc.query.mockImplementationOnce(async () => { current = false; return response(wire()) })
    await expect(client(() => current).publicCapabilities(noteId)).rejects.toThrow('session')
  })
})

describe('content-only public permission', () => {
  it('allows a third-party Sushi editor but not a Whitepaper editor or resolver', async () => {
    const n = note(), c = permission(n)
    await expect(readPublicContentWritePermission(c, n, other)).resolves.toBe(true)
    await expect(readPublicWritePermission(c, n, other)).resolves.toBe(false)
    c.publicCapabilities.mockResolvedValue({ ...parsePublicCapabilities(wire())!, allowPublicWrites: false })
    await expect(readPublicContentWritePermission(c, n, other)).resolves.toBe(false)
    await expect(readPublicContentWritePermission(c, n, owner)).resolves.toBe(true)
    expect(c.writersRaw).not.toHaveBeenCalled()
  })
  it('retains mode3 explicit ACL and requires capability even for owner', async () => {
    const n = { ...note(), mode: 3 as const }, c = permission(n, false); c.writersRaw.mockResolvedValue([other])
    await expect(readPublicContentWritePermission(c, n, other)).resolves.toBe(true)
    c.writersRaw.mockResolvedValue([]); await expect(readPublicContentWritePermission(c, n, other)).resolves.toBe(false)
    c.publicCapabilities.mockResolvedValue(null); await expect(readPublicContentWritePermission(c, n, owner)).resolves.toBe(false)
    c.publicCapabilities.mockRejectedValue(new Error('unavailable')); await expect(readPublicContentWritePermission(c, n, owner)).rejects.toThrow('unavailable')
  })
  it.each([{ id: '03'.repeat(16) }, { stateRevision: '9007199254740994' }, { ownerGeneration: '3' }, { mode: 3 as const }, { deleted: true }])('refuses capability mixed with another note state %j', async patch => {
    const n = note(), c = permission(n); c.publicCapabilities.mockResolvedValue({ ...parsePublicCapabilities(wire())!, ...patch })
    await expect(readPublicContentWritePermission(c, n, other)).rejects.toThrow('stale')
  })
  it.each([null, { ...note(), stateRevision: '9007199254740994' }, { ...note(), owner: other }, { ...note(), ownerGeneration: '3' }, { ...note(), epoch: '1' }, { ...note(), deleted: true }])('refuses a note changed during capability lookup', async final => {
    const n = note(), c = permission(n); c.noteMetadata.mockResolvedValue(final)
    await expect(readPublicContentWritePermission(c, n, other)).rejects.toThrow('stale')
  })
  it('refuses invalid callers, nonpublic/deleted notes and an invalidated permission session', async () => {
    const n = note(), c = permission(n)
    await expect(readPublicContentWritePermission(c, n, 'bad')).rejects.toThrow('format')
    await expect(readPublicContentWritePermission(c, { ...n, deleted: true }, owner)).resolves.toBe(false)
    await expect(readPublicContentWritePermission(c, { ...n, mode: 0 }, owner)).resolves.toBe(false)
    c.publicCapabilities.mockImplementation(async () => { c.assertCurrent.mockImplementation(() => { throw new Error('session') }); return parsePublicCapabilities(wire()) })
    await expect(readPublicContentWritePermission(c, n, other)).rejects.toThrow('session')
  })
})
