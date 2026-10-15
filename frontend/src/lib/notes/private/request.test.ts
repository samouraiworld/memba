import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { bech32Encode } from '../../dao/realmAddress'
import { createDraftSession, createNotesStore } from '../drafts'
import type { NotesStore } from '../drafts'
import { createNotesIntents, validPrivateVerification } from '../intents'
import type { NotesReadClient } from '../chain/client'
import type { ChainNote } from '../chain/schema'
import { encode64 } from '../chain/schema'
import { NOTES_REALM } from '../chain/__fixtures__/deployment'
import type { NotesQuoteProvider } from '../chain/request'
import { notesRequestDigest } from '../chain/request'
import { identityFromSeed } from '../crypto/identity'
import { decodeManifest } from '../crypto/manifest'
import { prepareEncryptedEpoch } from './engine'
import { preparePrivateNoteRequest } from './request'
import type { PrivateRequestOptions } from './request'
import { recoverPrivateIntent } from './recovery'
import { readEncryptedNote } from './reader'
import type { NotesIdentityController } from '../identity/controller'

// Ported from the reviewed 10-09 request.test.ts (F07: no plaintext in durable intents), for create ("only me") on the
// deployment's realm. The fixture network is no release network: these tests open the private-notes gate themselves
// (gate.open), and close it to prove a flip between review and signature refuses before the wallet.
const wallet = vi.hoisted(() => ({ send: vi.fn(), fee: vi.fn() }))
const gate = vi.hoisted(() => ({ open: true }))
vi.mock('../../grc20', () => ({ MAX_GAS_WANTED: 500_000_000, doContractBroadcast: (...args: unknown[]) => wallet.send(...args), freshFeeForGasWanted: (...args: unknown[]) => wallet.fee(...args), assertFeeStillCovers: async (fee: number, fresh: () => Promise<number>) => { if (await fresh() > fee) throw new Error('fee changed') } }))
vi.mock('../config', async original => ({
  ...await original<typeof import('../config')>(),
  deploymentRealm: () => 'gno.land/r/samcrew/memba_notes_v1',
  privateNotesDeployment: (chainId: string) => gate.open && chainId === 'test-chain' ? { realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 } : null,
}))
const owner = bech32Encode('g', new Uint8Array(20).fill(1)), noteId = '11'.repeat(16), operationId = '22'.repeat(16)
const TITLE = 'Secret plan 🐱', BODY = 'Private body that must never reach storage'
const stores: NotesStore[] = []
function setup() {
  const indexedDB = new IDBFactory(), store = createNotesStore({ indexedDB }); stores.push(store)
  const session = createDraftSession(), intents = createNotesIntents(store), lifetime = new AbortController()
  const identity = identityFromSeed(new Uint8Array(32).fill(8))
  const registry = { address: owner, generation: '1', active: true, publicKey: identity.publicKey, operationId: '33'.repeat(16), height: '99' }
  const prepared = prepareEncryptedEpoch({ chainId: 'test-chain', realm: NOTES_REALM, noteId, epoch: 1, titleRevision: 1n, bodyRevision: 1n, mode: 0, owner, recipients: [{ key: registry, writer: true }], title: TITLE, body: BODY })
  const entry = decodeManifest(prepared.manifest, 1)[0]
  let current: ChainNote | null = null, enabled = true, live = true, height = '100'
  const client = {
    chainId: 'test-chain', realm: NOTES_REALM, assertCurrent: vi.fn(), note: vi.fn(async () => current), noteMetadata: vi.fn(async () => current), height: vi.fn(async () => height),
    config: vi.fn(async () => ({ realm: NOTES_REALM, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '100000', paused: false })), key: vi.fn(async () => ({ ...registry })),
    readersRaw: vi.fn(async () => [owner]), wrapRaw: vi.fn(async () => ({ address: owner, epoch: '1', writer: true, generation: '1', public_key_hash: encode64(entry.publicKeyHash), wrap: encode64(entry.wrap) })),
    epochMetadataRaw: vi.fn(async () => ({ items: [{ epoch: '1', commitment: encode64(prepared.commitment), revealed_key: '' }], next_cursor: '1' })),
  } as unknown as NotesReadClient
  const quote: NotesQuoteProvider = async input => ({ chainId: input.chainId, requestDigest: input.requestDigest, atHeight: input.height, expiresAtHeight: '110', expiresAtMs: Date.now() + 60000, source: 'simulation', estimatedDepositUgnot: '1784800', maxDepositUgnot: '2200000', gasWanted: 54_000_000, networkFeeUgnot: 64_800 })
  const options: PrivateRequestOptions = { client, operation: { chainId: client.chainId, caller: owner, noteId, operationId, action: { kind: 'create', prepared, maxFeeUgnot: '100000' } }, maxDepositUgnot: '2200000', draftLocalRevision: '5', session, intents, quote, privateSignal: lifetime.signal, isWriteEnabled: () => enabled, isPrivateSessionCurrent: () => live }
  const scope = { chainId: client.chainId, realm: NOTES_REALM, owner, noteId }
  const applied = (patch: Partial<ChainNote> = {}) => { current = { id: noteId, owner, pendingOwner: '', ownerGeneration: '1', mode: 0, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '1', title: prepared.title, body: prepared.body, commitment: prepared.commitment, deleted: false, listed: false, createdHeight: '101', operationId, actor: owner, height: '101', ...patch } }
  return { options, identity, registry, store, indexedDB, session, intents, lifetime, scope, applied, prepared, current: () => current, disable: () => { enabled = false }, lock: () => { live = false; lifetime.abort() }, height: (value: string) => { height = value } }
}
/** Every record in the device's Notes database, read raw (fake-indexeddb), as the text an attacker with the disk would see. */
async function rawRecords(indexedDB: IDBFactory): Promise<string> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('memba_notes_local_v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
  try {
    const all = await Promise.all(['drafts', 'intents'].map(name => new Promise<unknown[]>((resolve, reject) => { const r = database.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })))
    return JSON.stringify(all, (_key, value) => value instanceof Uint8Array ? Array.from(value) : value)
  } finally { database.close() }
}
const plaintextTraces = [TITLE, BODY, ...[TITLE, BODY].map(value => bytesToHex(sha256(new TextEncoder().encode(value)))), encode64(new TextEncoder().encode(BODY))]
beforeEach(() => {
  vi.clearAllMocks(); gate.open = true; wallet.fee.mockResolvedValue(60_000)
  wallet.send.mockImplementation(async (_msgs, _memo, options) => { await options.beforeSign(); return { hash: 'aa'.repeat(32) } })
})
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.close())) })

describe('private create signing flow', () => {
  it('stores a digest-only intention before the wallet, with no plaintext or plaintext hash on the device', async () => {
    const s = setup(), request = await preparePrivateNoteRequest(s.options)
    wallet.send.mockImplementationOnce(async (messages, _memo, options) => {
      const intent = await s.intents.get(s.scope, operationId)
      expect(intent?.phase).toBe('prepared'); expect(intent?.requestDigest).toBe(notesRequestDigest('test-chain', messages[0]))
      const disk = await rawRecords(s.indexedDB)
      for (const trace of plaintextTraces) expect(disk).not.toContain(trace)
      expect(JSON.stringify(messages)).not.toContain(TITLE); expect(JSON.stringify(messages)).not.toContain(encode64(new TextEncoder().encode(BODY)))
      expect(messages).toEqual(request.prepare(undefined).msgs); await options.beforeSign(); return { hash: 'aa'.repeat(32) }
    })
    await request.send(undefined, async () => () => true)
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('submitted')
    s.applied(); expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(true)
    const confirmed = (await s.intents.get(s.scope, operationId))!
    expect(confirmed.phase).toBe('confirmed'); expect(confirmed.verification).toMatchObject({ kind: 'private-v1', mode: 0, epoch: '1', owner, titleBlobSha256: bytesToHex(sha256(s.prepared.title)), bodyBlobSha256: bytesToHex(sha256(s.prepared.body)) })
    const disk = await rawRecords(s.indexedDB)
    for (const trace of plaintextTraces) expect(disk).not.toContain(trace)
    await expect(request.send(undefined, async () => {})).rejects.toThrow('stale')
  })
  it('builds the realm call for the deployment: CreateNote, mode 0, one envelope, the exact create fee and cap', async () => {
    const s = setup(), request = await preparePrivateNoteRequest(s.options), [message] = request.prepare(undefined).msgs
    expect(message.value).toMatchObject({ caller: owner, send: '100000ugnot', pkg_path: NOTES_REALM, func: 'CreateNote', max_deposit: '2200000ugnot' })
    expect(message.value.args.slice(1, 2)).toEqual(['0']); expect(message.value.args[6]).toBe('100000')
    expect(request.lines(undefined)).toEqual(expect.arrayContaining([['Who can read', 'Only you · your key, generation 1'], ['Simulated storage deposit', '1.7848 GNOT'], ['Maximum storage deposit', '2.2 GNOT'], ['Publication fee', '0.1 GNOT']]))
  })
  it('opens with the reader exactly what the ported sealer sent (sealer ↔ reader, real X-Wing and AEAD)', async () => {
    const s = setup(), request = await preparePrivateNoteRequest(s.options)
    await request.send(undefined, async () => {}); s.applied()
    const controller = { getSnapshot: () => ({ phase: 'unlocked', generation: '1' }), subscribe: () => () => {}, use: async (fn: (value: typeof s.identity) => unknown) => fn(s.identity) } as unknown as NotesIdentityController
    const abort = new AbortController(), view = await readEncryptedNote(s.options.client, noteId, { access: { kind: 'identity', owner, identity: controller }, signal: abort.signal })
    try { expect(view.text()).toEqual({ title: TITLE, body: BODY }) } finally { view.dispose(); abort.abort(); s.identity.secretKey.fill(0) }
  })
  it('refuses a paused realm, an existing note, a stale registry key, and a manifest for someone else', async () => {
    const paused = setup(), config = await paused.options.client.config()
    vi.mocked(paused.options.client.config).mockResolvedValue({ ...config, paused: true })
    await expect(preparePrivateNoteRequest(paused.options)).rejects.toThrow('stale')
    const exists = setup(); exists.applied(); await expect(preparePrivateNoteRequest(exists.options)).rejects.toThrow('stale')
    const rotated = setup(); vi.mocked(rotated.options.client.key).mockResolvedValue({ ...rotated.registry, generation: '2' })
    await expect(preparePrivateNoteRequest(rotated.options)).rejects.toThrow('stale')
    const other = setup(); other.options.operation.caller = bech32Encode('g', new Uint8Array(20).fill(2))
    await expect(preparePrivateNoteRequest(other.options)).rejects.toThrow()
    expect(wallet.send).not.toHaveBeenCalled()
  })
  it('rejects registry rotation after review, an altered receipt and a wrong envelope', async () => {
    const s = setup(), request = await preparePrivateNoteRequest(s.options)
    vi.mocked(s.options.client.key).mockResolvedValueOnce({ ...s.registry, generation: '2' }); await expect(request.recheck!(undefined)).rejects.toThrow('stale')
    await request.send(undefined, async () => {})
    s.applied({ height: '100' }); expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(false)
    s.applied({ body: new Uint8Array(59) }); expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(false)
    s.applied({ operationId: '44'.repeat(16) }); expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(false)
    s.applied(); vi.mocked(s.options.client.readersRaw).mockResolvedValue([])
    await expect(request.verify!(undefined, 'aa'.repeat(32), undefined)).rejects.toThrow()
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('submitted')
  })
  it('refuses storage failure, rollout disable, identity lock, and replaced account session before the wallet', async () => {
    const s = setup(), request = await preparePrivateNoteRequest(s.options)
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new DOMException('full', 'QuotaExceededError') })
    await expect(request.send(undefined, async () => {})).rejects.toThrow('storage')
    for (const reason of ['disable', 'lock', 'session']) {
      const t = setup(), r = await preparePrivateNoteRequest(t.options)
      if (reason === 'disable') t.disable(); else if (reason === 'lock') t.lock(); else t.session.invalidate()
      await expect(r.send(undefined, async () => {})).rejects.toThrow()
      expect(await t.intents.list(t.scope)).toEqual([])
    }
    expect(wallet.send).not.toHaveBeenCalled()
  })
  it('refuses before the wallet when the private-notes gate closes between review and signature', async () => {
    gate.open = false
    await expect(preparePrivateNoteRequest(setup().options)).rejects.toThrow('disabled')
    gate.open = true
    // Closed after the review: send refuses before anything is recorded.
    const s = setup(), request = await preparePrivateNoteRequest(s.options)
    gate.open = false
    await expect(request.send(undefined, async () => {})).rejects.toThrow('disabled')
    expect(() => request.prepare(undefined)).toThrow('disabled')
    expect(wallet.send).not.toHaveBeenCalled(); expect(await s.intents.list(s.scope)).toEqual([])
    // Closed while the OS sheet hands over (beforeSign): refused before the wallet opens; the receipt says not sent.
    gate.open = true
    const t = setup(), late = await preparePrivateNoteRequest(t.options), opened = vi.fn()
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); opened(); return { hash: 'aa'.repeat(32) } })
    await expect(late.send(undefined, async () => { gate.open = false })).rejects.toThrow('disabled')
    expect(opened).not.toHaveBeenCalled(); expect((await t.intents.get(t.scope, operationId))?.phase).toBe('not-sent')
    // Closed while the wallet is open: the final guard refuses the signature.
    gate.open = true
    const u = setup(), open = await preparePrivateNoteRequest(u.options)
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { const guard = await options.beforeSign(); gate.open = false; expect(guard()).toBe(false); throw new Error('refused') })
    await expect(open.send(undefined, async () => () => true)).rejects.toThrow('refused')
  })
  it('preserves unknown outcomes and blocks a second intention for the same note', async () => {
    const s = setup(), request = await preparePrivateNoteRequest(s.options)
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); throw new Error('cancelled') })
    await expect(request.send(undefined, async () => {})).rejects.toThrow('cancelled')
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('unknown')
    const duplicate = await preparePrivateNoteRequest({ ...s.options, operation: { ...s.options.operation, operationId: '44'.repeat(16) } })
    await expect(duplicate.send(undefined, async () => {})).rejects.toThrow('storage')
    expect(wallet.send).toHaveBeenCalledOnce()
  })
  it('checks fresh fees and rejects expiry at the final wallet guard', async () => {
    const s = setup(), request = await preparePrivateNoteRequest(s.options)
    wallet.fee.mockResolvedValueOnce(64_801)
    await expect(request.send(undefined, async () => {})).rejects.toThrow('fee changed')
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('not-sent')
    const t = setup(), r = await preparePrivateNoteRequest(t.options)
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => {
      const guard = await options.beforeSign(); vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000)
      expect(guard()).toBe(false); throw new Error('expired')
    })
    await expect(r.send(undefined, async () => () => true)).rejects.toThrow('expired')
  })
  it('refuses a quote above the reviewed cap, gas above the ceiling or for another request', async () => {
    for (const patch of [{ estimatedDepositUgnot: '2200001' }, { maxDepositUgnot: '3000000' }, { gasWanted: 500_000_001 }, { requestDigest: 'bb'.repeat(32) }]) {
      const s = setup(), quote = s.options.quote
      s.options.quote = async input => ({ ...await quote(input), ...patch })
      await expect(preparePrivateNoteRequest(s.options)).rejects.toThrow('format')
    }
    expect(wallet.send).not.toHaveBeenCalled()
  })
  it('recovers an unknown encrypted creation after reopening storage with no private identity', async () => {
    const s = setup(), request = await preparePrivateNoteRequest(s.options)
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); throw new Error('transport lost') })
    await expect(request.send(undefined, async () => {})).rejects.toThrow('transport lost')
    const before = (await s.intents.get(s.scope, operationId))!
    expect(before.verification?.kind).toBe('private-v1')
    expect(validPrivateVerification({ ...before.verification, plaintext: 'secret' })).toBe(false)
    s.session.invalidate(); s.lock(); await s.store.close()
    const reopened = createNotesStore({ indexedDB: s.indexedDB }); stores.push(reopened)
    const intents = createNotesIntents(reopened), session = createDraftSession()
    expect(await recoverPrivateIntent(s.options.client, intents, before, session)).toBe('unknown')
    s.applied({ operationId: '44'.repeat(16) }); expect(await recoverPrivateIntent(s.options.client, intents, before, session)).toBe('unknown')
    expect((await intents.get(s.scope, operationId))?.phase).toBe('unknown')
    s.applied(); expect(await recoverPrivateIntent(s.options.client, intents, before, session)).toBe('confirmed')
    expect((await intents.get(s.scope, operationId))?.phase).toBe('confirmed')
    expect(wallet.send).toHaveBeenCalledOnce()
  })
  it('ignores caller-mutated descriptors and keeps a session-invalidated recovery unknown', async () => {
    const s = setup(), request = await preparePrivateNoteRequest(s.options)
    await request.send(undefined, async () => {})
    const intent = (await s.intents.get(s.scope, operationId))!
    s.applied({ body: new Uint8Array(59) })
    const forged = structuredClone(intent)
    if (forged.verification?.kind === 'private-v1') forged.verification.bodyBlobSha256 = bytesToHex(sha256(s.current()!.body!))
    expect(await recoverPrivateIntent(s.options.client, s.intents, forged, s.session)).toBe('unknown')
    s.applied()
    vi.mocked(s.options.client.note).mockImplementationOnce(async () => { s.session.invalidate(); return s.current() })
    expect(await recoverPrivateIntent(s.options.client, s.intents, intent, s.session)).toBe('unknown')
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('submitted')
  })
  it('cleans and invalidates a dismissed review before any wallet or durable intent', async () => {
    const s = setup(), request = await preparePrivateNoteRequest(s.options)
    request.onDismissed?.()
    expect(() => request.prepare(undefined)).toThrow('session')
    await expect(request.send(undefined, async () => {})).rejects.toThrow('session')
    expect(wallet.send).not.toHaveBeenCalled(); expect(await s.intents.list(s.scope)).toEqual([])
  })
})
