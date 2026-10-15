import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { bech32Encode } from '../../dao/realmAddress'
import type { AminoMsg } from '../../grc20'
import { createDraftSession, createNotesStore, type NotesStore } from '../drafts'
import { createNotesIntents } from '../intents'
import type { NotesReadClient } from '../chain/client'
import { blob, encode64, type ChainNote } from '../chain/schema'
import { NOTES_REALM } from '../chain/__fixtures__/deployment'
import type { NotesQuoteProvider } from '../chain/request'
import { identityFromSeed } from '../crypto/identity'
import { decodeManifest } from '../crypto/manifest'
import type { NotesIdentityController } from '../identity/controller'
import { prepareEncryptedEpoch } from './engine'
import { privateNoteMessage, type PrivateNoteOperation } from './messages'
import { privateNoteBudget, privateNoteQuote, PrivateStorageAboveCap } from './quote'
import { readEncryptedNote, readPrivateAccess, sealEncryptedChanges } from './reader'
import { preparePrivateNoteRequest, type PrivateRequestOptions } from './request'
import { parseEpochPage } from './schema'

// PR D2: editing a private note (Commit). Real X-Wing envelope and content AEAD throughout: the sealer creates revision 1,
// sealEncryptedChanges seals the edit, the realm applies it (fake chain), and the reader opens revision 2.
const wallet = vi.hoisted(() => ({ send: vi.fn(), fee: vi.fn(), price: vi.fn() }))
const gate = vi.hoisted(() => ({ open: true }))
vi.mock('../../grc20', () => ({ MAX_GAS_WANTED: 500_000_000, doContractBroadcast: (...args: unknown[]) => wallet.send(...args), freshFeeForGasWanted: (...args: unknown[]) => wallet.fee(...args), assertFeeStillCovers: async (fee: number, fresh: () => Promise<number>) => { if (await fresh() > fee) throw new Error('fee changed') } }))
vi.mock('../../dao/packageStatus', () => ({ abciQueryText: (...args: unknown[]) => wallet.price(...args) }))
vi.mock('../config', async original => ({
  ...await original<typeof import('../config')>(),
  deploymentRealm: () => 'gno.land/r/samcrew/memba_notes_v1',
  privateNotesDeployment: (chainId: string) => gate.open && chainId === 'test-chain' ? { realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 } : null,
}))
const owner = bech32Encode('g', new Uint8Array(20).fill(1)), reader = bech32Encode('g', new Uint8Array(20).fill(2)), noteId = '11'.repeat(16), commitId = '55'.repeat(16)
const TITLE = 'Garden plan', BODY = 'b'.repeat(1024), EDITED = 'Edited private body that must never reach storage 🌱'
const stores: NotesStore[] = []
function setup(body = BODY) {
  const indexedDB = new IDBFactory(), store = createNotesStore({ indexedDB }); stores.push(store)
  const session = createDraftSession(), intents = createNotesIntents(store), identity = identityFromSeed(new Uint8Array(32).fill(8))
  const registry = { address: owner, generation: '1', active: true, publicKey: identity.publicKey, operationId: '33'.repeat(16), height: '99' }
  const created = prepareEncryptedEpoch({ chainId: 'test-chain', realm: NOTES_REALM, noteId, epoch: 1, titleRevision: 1n, bodyRevision: 1n, mode: 0, owner, recipients: [{ key: registry, writer: true }], title: TITLE, body })
  const entry = decodeManifest(created.manifest, 1)[0]
  let note: ChainNote = { id: noteId, owner, pendingOwner: '', ownerGeneration: '1', mode: 0, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '1', title: created.title, body: created.body,
    commitment: created.commitment, deleted: false, listed: false, createdHeight: '101', operationId: '22'.repeat(16), actor: owner, height: '101' }
  let writer = true, phase = 'unlocked'
  const client = {
    chainId: 'test-chain', realm: NOTES_REALM, assertCurrent: vi.fn(), note: vi.fn(async () => note), noteMetadata: vi.fn(async () => note), height: vi.fn(async () => '110'), config: vi.fn(async () => ({ realm: NOTES_REALM, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '100000', paused: false })),
    key: vi.fn(async () => ({ ...registry })), readersRaw: vi.fn(async () => [owner]),
    wrapRaw: vi.fn(async (_id: string, _epoch: string, who: string) => who === owner ? { address: owner, epoch: '1', writer, generation: '1', public_key_hash: encode64(entry.publicKeyHash), wrap: encode64(entry.wrap) } : null),
    epochMetadataRaw: vi.fn(async () => ({ items: [{ epoch: '1', commitment: encode64(created.commitment), revealed_key: '' }], next_cursor: '1' })),
  } as unknown as NotesReadClient
  const controller = { getSnapshot: () => ({ phase, generation: '1' }), subscribe: () => () => {}, use: async (fn: (value: typeof identity) => unknown) => fn(identity) } as unknown as NotesIdentityController
  const lifetime = new AbortController(), access = { kind: 'identity' as const, owner, identity: controller }
  async function commit(edited = { title: TITLE, body: EDITED }) {
    const changes = await sealEncryptedChanges(client, note, edited, { access, signal: lifetime.signal })
    const previousManifest = await readPrivateAccess(client, note, lifetime.signal)
    const operation: PrivateNoteOperation = { chainId: 'test-chain', caller: owner, noteId, operationId: commitId, action: { kind: 'commit', ...changes, previousManifest } }
    const sizes = { title: note.title.length, body: note.body!.length }
    const budget = privateNoteBudget(privateNoteMessage(operation, NOTES_REALM, '0', { note, epoch: parseEpochPage(await client.epochMetadataRaw(noteId, '1'), '1') }), sizes)
    return { changes, operation, sizes, budget }
  }
  const quote: NotesQuoteProvider = async input => ({ chainId: input.chainId, requestDigest: input.requestDigest, atHeight: input.height, expiresAtHeight: '120', expiresAtMs: Date.now() + 60000, source: 'bounded-estimate', estimatedDepositUgnot: '160000', maxDepositUgnot: '200000', gasWanted: 63_000_000, networkFeeUgnot: 75_600 })
  const options = (operation: PrivateNoteOperation, live = () => true): PrivateRequestOptions => ({ client, operation, reviewed: { ...note }, maxDepositUgnot: '200000', draftLocalRevision: '3', session, intents, quote, privateSignal: lifetime.signal, isWriteEnabled: () => true, isPrivateSessionCurrent: live })
  return { client, store, indexedDB, intents, identity, controller, access, lifetime, commit, options, scope: { chainId: 'test-chain', realm: NOTES_REALM, owner, noteId },
    note: () => note, set: (next: Partial<ChainNote>) => { note = { ...note, ...next } }, readOnly: () => { writer = false }, lock: () => { phase = 'locked' } }
}
async function rawRecords(indexedDB: IDBFactory): Promise<string> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('memba_notes_local_v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
  try {
    const all = await Promise.all(['drafts', 'intents'].map(name => new Promise<unknown[]>((resolve, reject) => { const r = database.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })))
    return JSON.stringify(all, (_key, value) => value instanceof Uint8Array ? Array.from(value) : value)
  } finally { database.close() }
}
const bytes = (value: string) => new TextEncoder().encode(value)
const traces = (value: string) => [value, bytesToHex(sha256(bytes(value))), encode64(bytes(value)), Array.from(bytes(value).subarray(0, 24)).join(',')]
beforeEach(() => {
  vi.clearAllMocks(); gate.open = true; wallet.fee.mockImplementation(async (gas: number) => Math.ceil(gas * 1.2 / 1000)); wallet.price.mockResolvedValue('"100ugnot"')
  wallet.send.mockImplementation(async (_msgs, _memo, options) => { await options.beforeSign(); return { hash: 'aa'.repeat(32) } })
})
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.close())) })

describe('private Commit quote against the M0 keeper rows (private-small-ops-m0-2026-10-15, rows 3)', () => {
  // [body before, body after, measured deposit, keeper gas]: same size 1 KB, 1 KB → 2 KB.
  it.each([[1024, 'c'.repeat(1024), 1_800, 21_500_000], [1024, 'c'.repeat(2048), 108_800, 21_600_000]])('a %i B body edited to %#: estimate covers the deposit, cap ≥ 1.2×, gas ≥ 2.9×', async (size, edited, measured, gas) => {
    const s = setup('b'.repeat(size)), { budget, changes } = await s.commit({ title: TITLE, body: edited })
    expect(changes.title).toBeUndefined(); expect(changes.body!.length - s.note().body!.length).toBe(edited.length === 2048 ? 1088 : 0)
    expect(Number(budget.estimatedDepositUgnot)).toBeGreaterThanOrEqual(measured); expect(Number(budget.suggestedCapUgnot)).toBeGreaterThanOrEqual(measured * 1.2)
    expect(Number(budget.suggestedCapUgnot) % 100_000).toBe(0); expect(budget.gasWanted).toBeGreaterThanOrEqual(gas * 2.9); expect(budget.gasWanted).toBeLessThanOrEqual(100_000_000)
  })
  it('names the figures: growth only (+500 B), cap × 1.2 rounded up to 0.1 GNOT, 60 M + 2,200 per byte', async () => {
    expect((await setup().commit({ title: TITLE, body: 'c'.repeat(1024) })).budget).toEqual({ gasWanted: 63_000_000, estimatedDepositUgnot: '50000', suggestedCapUgnot: '100000' })
    expect((await setup().commit({ title: TITLE, body: 'c'.repeat(2048) })).budget).toEqual({ gasWanted: 65_000_000, estimatedDepositUgnot: '158800', suggestedCapUgnot: '200000' })
    // Title and body rewritten at the same size (M0: 0), and a shrinking body: never below the 500 B margin.
    expect((await setup().commit({ title: 'Garden plaN', body: 'c'.repeat(1024) })).budget.estimatedDepositUgnot).toBe('50000')
    expect((await setup().commit({ title: TITLE, body: 'short' })).budget.estimatedDepositUgnot).toBe('50000')
  })
  it('refuses a Commit priced without the current sizes, or a malformed mask', async () => {
    const { operation } = await setup().commit(), s = setup(), message = privateNoteMessage(operation, NOTES_REALM, '0', { note: s.note(), epoch: parseEpochPage(await s.client.epochMetadataRaw(noteId, '1'), '1') })
    expect(() => privateNoteBudget(message)).toThrow()
    const masked: AminoMsg = structuredClone(message); masked.value.args[3] = '1'
    expect(() => privateNoteBudget(masked, { title: 99, body: 1143 })).toThrow()
  })
  it('simulates first, refuses a readable deposit above the cap, and falls back to the bound otherwise', async () => {
    const s = setup(), { operation, budget, sizes } = await s.commit({ title: TITLE, body: 'c'.repeat(2048) })
    const message = privateNoteMessage(operation, NOTES_REALM, budget.suggestedCapUgnot, { note: s.note(), epoch: parseEpochPage(await s.client.epochMetadataRaw(noteId, '1'), '1') })
    const input = { chainId: 'test-chain', message, requestDigest: 'aa'.repeat(32), height: '100' }
    const answer = (deposit: bigint) => { const v = (n: bigint) => { const o: number[] = []; for (; n > 127n; n >>= 7n) o.push(Number(n & 127n) | 128); o.push(Number(n)); return o }
      const f = (n: number, x: number[]) => [...v(BigInt(n << 3 | 2)), ...v(BigInt(x.length)), ...x], t = (x: string) => [...bytes(x)]
      return Uint8Array.from([...f(1, f(3, [...f(1, t('/tm.StorageDepositEvent')), ...f(2, [...v(8n), ...v(deposit * 2n), ...f(2, t(`${deposit * 100n}ugnot`))])])), ...v(24n), ...v(21_600_000n * 2n)]) }
    const quoted = (simulate: () => Promise<Uint8Array>) => privateNoteQuote({ ...s.client, simulateRaw: vi.fn(simulate) } as unknown as NotesReadClient, budget.suggestedCapUgnot, sizes)(input)
    expect(await quoted(async () => answer(1_088n))).toMatchObject({ source: 'simulation', estimatedDepositUgnot: '108800', maxDepositUgnot: '200000', gasWanted: 60_000_000 })
    await expect(quoted(async () => answer(2_001n))).rejects.toBeInstanceOf(PrivateStorageAboveCap)
    expect(await quoted(async () => { throw new Error('offline') })).toMatchObject({ source: 'bounded-estimate', estimatedDepositUgnot: '158800', gasWanted: 65_000_000 })
  })
})

describe('private Commit signing flow', () => {
  it('round-trips with real crypto: the sealer writes revision 1, the edit is sealed here, the reader opens revision 2', async () => {
    const s = setup(), { operation, changes } = await s.commit(), request = await preparePrivateNoteRequest(s.options(operation))
    const [message] = request.prepare(undefined).msgs
    expect(message.value).toMatchObject({ func: 'Commit', pkg_path: NOTES_REALM, send: '', max_deposit: '200000ugnot' })
    expect(message.value.args.slice(1, 5)).toEqual(['1', '1', '2', '']); expect(blob(message.value.args[5], 135223)[14]).toBe(2)
    for (const trace of traces(EDITED)) expect(JSON.stringify(message)).not.toContain(trace)
    await request.send(undefined, async () => {})
    const disk = await rawRecords(s.indexedDB)
    for (const trace of [...traces(EDITED), ...traces(TITLE)]) expect(disk).not.toContain(trace)
    expect((await s.intents.get(s.scope, commitId))?.verification).toMatchObject({ kind: 'private-v1', titleRevision: '1', bodyRevision: '2', bodyBlobSha256: bytesToHex(sha256(changes.body!)) })
    s.set({ stateRevision: '2', bodyRevision: '2', body: changes.body, operationId: commitId, actor: owner, height: '111' })
    expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(true)
    expect((await s.intents.get(s.scope, commitId))?.phase).toBe('confirmed')
    const view = await readEncryptedNote(s.client, noteId, { access: s.access, signal: s.lifetime.signal })
    try { expect(view.note.stateRevision).toBe('2'); expect(view.text()).toEqual({ title: TITLE, body: EDITED }) } finally { view.dispose() }
  })
  it('seals nothing when the text is unchanged, and refuses a reader without write access or a locked key', async () => {
    const s = setup()
    expect(await sealEncryptedChanges(s.client, s.note(), { title: TITLE, body: BODY }, { access: s.access, signal: s.lifetime.signal })).toEqual({})
    const t = setup(); t.readOnly(); vi.mocked(t.client.readersRaw).mockResolvedValue([owner]); t.set({ owner: reader })
    await expect(sealEncryptedChanges(t.client, t.note(), { title: TITLE, body: EDITED }, { access: t.access, signal: t.lifetime.signal })).rejects.toThrow()
    const u = setup(); u.lock()
    await expect(sealEncryptedChanges(u.client, u.note(), { title: TITLE, body: EDITED }, { access: u.access, signal: u.lifetime.signal })).rejects.toThrow('session')
  })
  it('refuses a note that moved since the review, before anything is recorded or the wallet opens', async () => {
    const s = setup(), { operation } = await s.commit(), options = s.options(operation)
    s.set({ stateRevision: '2', bodyRevision: '2' })
    await expect(preparePrivateNoteRequest(options)).rejects.toThrow('stale')
    const t = setup(), late = await t.commit(), request = await preparePrivateNoteRequest(t.options(late.operation))
    t.set({ stateRevision: '2', titleRevision: '2' })
    const opened = vi.fn()
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); opened(); return { hash: 'aa'.repeat(32) } })
    await expect(request.send(undefined, async () => {})).rejects.toThrow('stale')
    expect(opened).not.toHaveBeenCalled(); expect((await t.intents.get(t.scope, commitId))?.phase).toBe('not-sent')
  })
  it('refuses before the wallet when the gate closes or the key locks after the review', async () => {
    const s = setup(), { operation } = await s.commit(), request = await preparePrivateNoteRequest(s.options(operation))
    gate.open = false
    await expect(request.send(undefined, async () => {})).rejects.toThrow('disabled')
    gate.open = true
    let live = true
    const t = setup(), late = await t.commit(), locked = await preparePrivateNoteRequest(t.options(late.operation, () => live))
    live = false
    await expect(locked.send(undefined, async () => {})).rejects.toThrow('session')
    expect(wallet.send).not.toHaveBeenCalled()
    expect(await s.intents.list(s.scope)).toEqual([]); expect(await t.intents.list(t.scope)).toEqual([])
  })
})
