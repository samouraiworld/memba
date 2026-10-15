import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { bech32Encode } from '../../dao/realmAddress'
import type { AminoMsg } from '../../grc20'
import { createDraftSession, createNotesStore, type NotesStore } from '../drafts'
import { createNotesIntents } from '../intents'
import type { NotesReadClient } from '../chain/client'
import { blob, encode64, type ChainKey, type ChainNote } from '../chain/schema'
import { NOTES_REALM } from '../chain/__fixtures__/deployment'
import type { NotesQuoteProvider } from '../chain/request'
import { keyCommitment, openField } from '../crypto/content'
import { identityFromSeed, type NotesIdentity } from '../crypto/identity'
import { decodeManifest } from '../crypto/manifest'
import { unwrapForReader } from '../crypto/wrap'
import type { NotesIdentityController } from '../identity/controller'
import { noteContext, prepareEncryptedEpoch, recipientManifest, type EncryptedEpoch } from './engine'
import { privateNoteMessage, type PrivateNoteOperation } from './messages'
import { privateNoteBudget, type PrivateAccessBase, type PrivateCommitSizes } from './quote'
import { PrivateNoteNoAccess, readEncryptedNote, readPrivateAccess, sealAccessManifest, sealEncryptedChanges, sealRotation } from './reader'
import { recoverPrivateIntent } from './recovery'
import { preparePrivateNoteRequest } from './request'
import { parseEpochPage } from './schema'

// PR E: sharing a private note with readers (ApplyAccess) and removing one (Rotate), owner only. Real X-Wing envelopes
// and content AEAD throughout; the fake chain applies each signed message as the realm does (epochs.gno).
const wallet = vi.hoisted(() => ({ send: vi.fn(), fee: vi.fn(), price: vi.fn() }))
const gate = vi.hoisted(() => ({ open: true }))
vi.mock('../../grc20', () => ({ MAX_GAS_WANTED: 500_000_000, doContractBroadcast: (...args: unknown[]) => wallet.send(...args), freshFeeForGasWanted: (...args: unknown[]) => wallet.fee(...args), assertFeeStillCovers: async (fee: number, fresh: () => Promise<number>) => { if (await fresh() > fee) throw new Error('fee changed') } }))
vi.mock('../../dao/packageStatus', () => ({ abciQueryText: (...args: unknown[]) => wallet.price(...args) }))
vi.mock('../config', async original => ({
  ...await original<typeof import('../config')>(),
  deploymentRealm: () => 'gno.land/r/samcrew/memba_notes_v1',
  privateNotesDeployment: (chainId: string) => gate.open && chainId === 'test-chain' ? { realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 } : null,
}))
const who = (n: number) => bech32Encode('g', new Uint8Array(20).fill(n))
const A = who(1), B = who(2), C = who(3), D = who(4), noteId = '11'.repeat(16)
const TITLE = 'Shared recipe', BODY = 'Secret sauce: '.padEnd(2048, 's'), SIGNAL = new AbortController().signal
const stores: NotesStore[] = []
let ids = 0
const nextId = () => (++ids).toString(16).padStart(32, '0')

function setup(readers: number[] = []) {
  const indexedDB = new IDBFactory(), store = createNotesStore({ indexedDB }); stores.push(store)
  const session = createDraftSession(), intents = createNotesIntents(store)
  const identities = new Map<string, NotesIdentity>([A, B, C, D].map((address, i) => [address, identityFromSeed(new Uint8Array(32).fill(8 + i))]))
  const registry = new Map<string, ChainKey>([...identities].map(([address, identity]) => [address, { address, generation: '1', active: true, publicKey: identity.publicKey, operationId: '33'.repeat(16), height: '99' }]))
  const recipients = [{ key: registry.get(A)!, writer: true }, ...readers.map(n => ({ key: registry.get(who(n))!, writer: false }))]
  const created = prepareEncryptedEpoch({ chainId: 'test-chain', realm: NOTES_REALM, noteId, epoch: 1, titleRevision: 1n, bodyRevision: 1n, mode: readers.length ? 1 : 0, owner: A, recipients, title: TITLE, body: BODY })
  let height = 110
  let note: ChainNote = { id: noteId, owner: A, pendingOwner: '', ownerGeneration: '1', mode: created.mode, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '1', title: created.title, body: created.body,
    commitment: created.commitment, deleted: false, listed: false, createdHeight: '101', operationId: '22'.repeat(16), actor: A, height: '101' }
  const epochs = new Map<string, { commitment: Uint8Array; manifest: Uint8Array }>([['1', { commitment: created.commitment, manifest: created.manifest }]])
  const entries = (epoch = note.epoch) => decodeManifest(epochs.get(epoch)!.manifest, Number(epoch))
  const client = {
    chainId: 'test-chain', realm: NOTES_REALM, assertCurrent: vi.fn(), note: vi.fn(async () => note), noteMetadata: vi.fn(async () => note), height: vi.fn(async () => String(height)),
    config: vi.fn(async () => ({ realm: NOTES_REALM, admin: A, pendingAdmin: '', treasury: A, createFeeUgnot: '100000', paused: false })),
    key: vi.fn(async (address: string) => ({ ...(registry.get(address) ?? { address, generation: '0', active: false, publicKey: new Uint8Array(), operationId: '', height: '0' }) })),
    readersRaw: vi.fn(async () => entries().map(entry => bech32Encode('g', entry.address))),
    wrapRaw: vi.fn(async (_id: string, epoch: string, address: string) => {
      const entry = epochs.has(epoch) ? entries(epoch).find(e => bech32Encode('g', e.address) === address) : undefined
      return entry ? { address, epoch, writer: entry.writer, generation: String(entry.generation), public_key_hash: encode64(entry.publicKeyHash), wrap: encode64(entry.wrap) } : null
    }),
    epochMetadataRaw: vi.fn(async (_id: string, epoch: string) => ({ items: [{ epoch, commitment: encode64(epochs.get(epoch)!.commitment), revealed_key: '' }], next_cursor: epoch })),
  } as unknown as NotesReadClient
  const phases = new Map<string, string>()
  const controller = (address: string) => ({ getSnapshot: () => ({ phase: phases.get(address) ?? 'unlocked', generation: registry.get(address)?.generation }), subscribe: () => () => {},
    use: async (fn: (value: NotesIdentity) => unknown) => fn(identities.get(address)!) }) as unknown as NotesIdentityController
  const access = (address = A) => ({ access: { kind: 'identity' as const, owner: address, identity: controller(address) }, signal: SIGNAL })
  /** The realm applying a signed ApplyAccess or Rotate (epochs.gno mutateApplyAccess / mutateRotate). */
  function apply(message: AminoMsg) {
    const { func, args } = message.value, op = bytesToHex(blob(args[args.length - 1], 16))
    height++
    if (func === 'ApplyAccess') {
      epochs.get(note.epoch)!.manifest = blob(args[4], 41570)
      note = { ...note, mode: Number(args[3]) as 0 | 1, stateRevision: String(BigInt(note.stateRevision) + 1n), operationId: op, actor: A, height: String(height) }
    } else {
      const epoch = String(Number(note.epoch) + 1), commitment = blob(args[7], 32)
      epochs.set(epoch, { commitment, manifest: blob(args[6], 41570) })
      note = { ...note, mode: Number(args[3]) as 0 | 1, epoch, title: blob(args[4], 231), body: blob(args[5], 135223), commitment, titleRevision: String(BigInt(note.titleRevision) + 1n),
        bodyRevision: String(BigInt(note.bodyRevision) + 1n), stateRevision: String(BigInt(note.stateRevision) + 1n), operationId: op, actor: A, height: String(height) }
    }
  }
  const members = async () => decodeManifest(await readPrivateAccess(client, note, SIGNAL), Number(note.epoch)).map(entry => ({ key: registry.get(bech32Encode('g', entry.address))!, writer: entry.writer }))
  /** The owner's ApplyAccess adding `added` as readers, sealed with the real current epoch key. */
  async function share(...added: string[]): Promise<{ operation: PrivateNoteOperation; base: PrivateAccessBase }> {
    const previousManifest = await readPrivateAccess(client, note, SIGNAL), current = await members()
    const manifest = await sealAccessManifest(client, note, 1, [...current, ...added.map(address => ({ key: registry.get(address)!, writer: false }))], access())
    return { operation: { chainId: 'test-chain', caller: A, noteId, operationId: nextId(), action: { kind: 'access', mode: 1, manifest, previousManifest, acknowledgeEpochHistory: true } },
      base: { envelopes: current.length, writers: current.filter(entry => entry.writer).length } }
  }
  /** The owner's Rotate removing `removed`: a fresh key and the current text sealed again for the others. */
  async function revoke(...removed: string[]): Promise<{ operation: PrivateNoteOperation; base: PrivateCommitSizes }> {
    const previousManifest = await readPrivateAccess(client, note, SIGNAL), kept = (await members()).filter(entry => !removed.includes(entry.key.address))
    const prepared = await sealRotation(client, note, kept.length === 1 ? 0 : 1, kept, access())
    return { operation: { chainId: 'test-chain', caller: A, noteId, operationId: nextId(), action: { kind: 'rotate', prepared, previousManifest } }, base: { title: note.title.length, body: note.body!.length } }
  }
  const quote: NotesQuoteProvider = async input => ({ chainId: input.chainId, requestDigest: input.requestDigest, atHeight: input.height, expiresAtHeight: String(Number(input.height) + 20), expiresAtMs: Date.now() + 60000,
    source: 'bounded-estimate', estimatedDepositUgnot: '400000', maxDepositUgnot: '900000', gasWanted: 90_000_000, networkFeeUgnot: 108_000 })
  const options = (operation: PrivateNoteOperation, live = () => true) => ({ client, operation, reviewed: { ...note }, maxDepositUgnot: '900000', draftLocalRevision: '0', session, intents, quote,
    privateSignal: SIGNAL, isWriteEnabled: () => true, isPrivateSessionCurrent: live })
  /** Review, sign (wallet mock), the realm applies the exact signed message, then exact verification. */
  async function run(operation: PrivateNoteOperation) {
    const request = await preparePrivateNoteRequest(options(operation))
    await request.send(undefined, async () => {})
    apply(wallet.send.mock.calls.at(-1)![0][0])
    expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(true)
    return request
  }
  async function read(address: string) {
    const view = await readEncryptedNote(client, noteId, { access: access(address).access, signal: SIGNAL })
    try { return view.text() } finally { view.dispose() }
  }
  /** What `address` gets with ITS envelope of `epoch` (if any), tried on the note's current ciphertext. */
  function epochKey(address: string, epoch: string) {
    const entry = entries(epoch).find(e => bech32Encode('g', e.address) === address)
    if (!entry) return null
    const identity = identities.get(address)!
    return unwrapForReader(entry.wrap, identity.secretKey, identity.publicKey, { ...noteContext('test-chain', NOTES_REALM, { id: noteId, epoch }), reader: address, generation: entry.generation })
  }
  return { client, store, indexedDB, intents, registry, phases, access, apply, share, revoke, options, run, read, epochKey, entries, quote, scope: { chainId: 'test-chain', realm: NOTES_REALM, owner: A, noteId },
    note: () => note, set: (next: Partial<ChainNote>) => { note = { ...note, ...next } } }
}
const epochState = async (s: ReturnType<typeof setup>) => ({ note: s.note(), epoch: parseEpochPage(await s.client.epochMetadataRaw(noteId, s.note().epoch), s.note().epoch) })
async function rawRecords(indexedDB: IDBFactory): Promise<string> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('memba_notes_local_v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
  try {
    const all = await Promise.all(['drafts', 'intents'].map(name => new Promise<unknown[]>((resolve, reject) => { const r = database.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })))
    return JSON.stringify(all, (_key, value) => value instanceof Uint8Array ? Array.from(value) : value)
  } finally { database.close() }
}
const bytes = (value: string) => new TextEncoder().encode(value)
const traces = (value: string) => [value.slice(0, 40), bytesToHex(sha256(bytes(value))), encode64(bytes(value)).slice(0, 40), Array.from(bytes(value).subarray(0, 24)).join(',')]
beforeEach(() => {
  vi.clearAllMocks(); gate.open = true; wallet.fee.mockImplementation(async (gas: number) => Math.ceil(gas * 1.2 / 1000)); wallet.price.mockResolvedValue('"100ugnot"')
  wallet.send.mockImplementation(async (_msgs, _memo, options) => { await options.beforeSign(); return { hash: 'aa'.repeat(32) } })
})
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.close())) })

describe('quotes against the M0 keeper rows (private-small-ops-m0-2026-10-15, rows 4 and 5)', () => {
  it('ApplyAccess +1 reader: estimate covers 363,000 / 370,800 ugnot, cap ×1.2 rounded up to 0.1 GNOT, gas ≥ 1.5× 54.9 / 65.5 M', async () => {
    for (const [readers, measured, gas, budget] of [[[], 363_000, 54_900_000, { gasWanted: 90_000_000, estimatedDepositUgnot: '380000', suggestedCapUgnot: '500000' }],
      [[2], 370_800, 65_500_000, { gasWanted: 105_000_000, estimatedDepositUgnot: '380000', suggestedCapUgnot: '500000' }]] as const) {
      const s = setup([...readers]), { operation, base } = await s.share(C), quoted = privateNoteBudget(privateNoteMessage(operation, NOTES_REALM, '0', await epochState(s)), base)
      expect(quoted).toEqual(budget)
      expect(Number(quoted.estimatedDepositUgnot)).toBeGreaterThanOrEqual(measured); expect(quoted.gasWanted).toBeGreaterThanOrEqual(gas * 1.5)
    }
  })
  it('Rotate with a 2 KB body: 2 → 1 covers 267,000, 3 → 2 covers 403,100; gas ≥ 1.5× 48.1 / 57.7 M', async () => {
    for (const [readers, measured, gas, cap] of [[[2], 267_000, 48_100_000, '700000'], [[2, 3], 403_100, 57_700_000, '800000']] as const) {
      const s = setup([...readers]), { operation, base } = await s.revoke(B), quoted = privateNoteBudget(privateNoteMessage(operation, NOTES_REALM, '0', await epochState(s)), base)
      expect(Number(quoted.estimatedDepositUgnot)).toBeGreaterThanOrEqual(measured); expect(quoted.suggestedCapUgnot).toBe(cap)
      expect(quoted.gasWanted).toBeGreaterThanOrEqual(gas * 1.5); expect(quoted.gasWanted).toBeLessThanOrEqual(500_000_000)
    }
  })
  it('the 10-08 maxima stay covered: ApplyAccess 1 → 32 (11,652,800) and rotate32max (4,532,400), gas capped at 500 M', async () => {
    const key = (n: number) => { const identity = identityFromSeed(new Uint8Array(32).fill(40 + n)), address = bech32Encode('g', new Uint8Array(20).fill(40 + n))
      return { key: { address, generation: '1', active: true, publicKey: identity.publicKey, operationId: '33'.repeat(16), height: '9' }, writer: false } }
    const s = setup(), owner = { key: s.registry.get(A)!, writer: true }, readers = Array.from({ length: 31 }, (_, n) => key(n))
    const context = noteContext('test-chain', NOTES_REALM, { id: noteId, epoch: '1' }), manifest = recipientManifest(new Uint8Array(32).fill(1), context, 1, A, [owner, ...readers])
    const access = { chainId: 'test-chain', caller: A, noteId, operationId: nextId(), action: { kind: 'access' as const, mode: 1 as const, manifest, previousManifest: await readPrivateAccess(s.client, s.note(), SIGNAL), acknowledgeEpochHistory: true } }
    const applied = privateNoteBudget(privateNoteMessage(access, NOTES_REALM, '0', await epochState(s)), { envelopes: 1, writers: 1 })
    expect(Number(applied.estimatedDepositUgnot)).toBeGreaterThanOrEqual(11_652_800); expect(applied.gasWanted).toBe(500_000_000)
    const rotated = { args: ['', '1', '1', '1', encode64(s.note().title), encode64(s.note().body!), encode64(manifest), encode64(new Uint8Array(32).fill(2)), ''] }
    const rotation = privateNoteBudget({ type: 'vm/MsgCall', value: { caller: A, send: '', pkg_path: NOTES_REALM, func: 'Rotate', ...rotated, max_deposit: '0ugnot' } }, { title: s.note().title.length, body: s.note().body!.length })
    expect(Number(rotation.estimatedDepositUgnot)).toBeGreaterThanOrEqual(4_532_400); expect(rotation.gasWanted).toBe(500_000_000)
  })
  it('refuses to price an ApplyAccess without the current envelopes or a Rotate without the current sizes', async () => {
    const s = setup(), { operation } = await s.share(B), message = privateNoteMessage(operation, NOTES_REALM, '0', await epochState(s))
    expect(() => privateNoteBudget(message)).toThrow(); expect(() => privateNoteBudget(message, { title: 1, body: 1 })).toThrow()
    expect(() => privateNoteBudget(message, { envelopes: 3, writers: 1 })).toThrow()
    const t = setup([2]), rotation = privateNoteMessage((await t.revoke(B)).operation, NOTES_REALM, '0', await epochState(t))
    expect(() => privateNoteBudget(rotation, { envelopes: 2, writers: 1 })).toThrow()
  })
})

describe('adding a reader (ApplyAccess)', () => {
  it('round-trips with real crypto: the owner wraps the current epoch for B; B opens it, and the owner still does', async () => {
    const s = setup()
    await expect(s.read(B)).rejects.toBeInstanceOf(PrivateNoteNoAccess)
    const { operation } = await s.share(B), request = await s.run(operation)
    expect(request.title).toBe('Share private note')
    expect(request.warns.join(' ')).toContain('Their address becomes public on the network as a reader of this note.')
    expect(request.lines(undefined)).toContainEqual(['Adds', B])
    expect(s.note()).toMatchObject({ mode: 1, epoch: '1', stateRevision: '2', titleRevision: '1', bodyRevision: '1' })
    expect(await s.read(B)).toEqual({ title: TITLE, body: BODY }); expect(await s.read(A)).toEqual({ title: TITLE, body: BODY })
    await expect(s.read(C)).rejects.toBeInstanceOf(PrivateNoteNoAccess)
  })
  it('binds every envelope to its holder’s registry key (generation and public-key hash) and keeps every role', async () => {
    const s = setup([2]), { operation } = await s.share(C)
    const manifest = operation.action.kind === 'access' ? decodeManifest(operation.action.manifest, 1) : []
    expect(manifest.map(entry => [bech32Encode('g', entry.address), entry.writer, entry.generation])).toEqual([[A, true, 1n], [B, false, 1n], [C, false, 1n]])
    for (const entry of manifest) expect(bytesToHex(entry.publicKeyHash)).toBe(bytesToHex(sha256(s.registry.get(bech32Encode('g', entry.address))!.publicKey)))
    // C sets up again (generation 2) after the review: the envelope names a stale key, so nothing is signed.
    const request = await preparePrivateNoteRequest(s.options(operation))
    s.registry.set(C, { ...s.registry.get(C)!, generation: '2', publicKey: identityFromSeed(new Uint8Array(32).fill(77)).publicKey })
    const opened = vi.fn()
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); opened(); return { hash: 'aa'.repeat(32) } })
    await expect(request.send(undefined, async () => {})).rejects.toThrow('stale')
    expect(opened).not.toHaveBeenCalled()
    // A key turned off cannot be wrapped at all.
    const t = setup(); t.registry.set(B, { ...t.registry.get(B)!, active: false, publicKey: new Uint8Array() })
    await expect(t.share(B)).rejects.toThrow()
  })
  it('refuses what this version does not do: a non-owner, a new writer, dropping or downgrading anyone, a mode change', async () => {
    const s = setup([2]), state = await epochState(s), { operation } = await s.share(C)
    if (operation.action.kind !== 'access') throw new Error('access')
    const previous = operation.action.previousManifest, owner = { key: s.registry.get(A)!, writer: true }, reader = (address: string, writer = false) => ({ key: s.registry.get(address)!, writer })
    const key = new Uint8Array(32), context = noteContext('test-chain', NOTES_REALM, { id: noteId, epoch: '1' })
    const message = (manifest: Uint8Array, mode: 0 | 1 = 1, caller = A) => privateNoteMessage({ ...operation, caller, action: { kind: 'access', mode, manifest, previousManifest: previous, acknowledgeEpochHistory: true } }, NOTES_REALM, '0', state)
    expect(() => message(operation.action.kind === 'access' ? operation.action.manifest : previous, 1, B)).toThrow()
    expect(() => message(recipientManifest(key, context, 1, A, [owner, reader(B), reader(C, true)]))).toThrow()
    expect(() => message(recipientManifest(key, context, 1, A, [owner, reader(C)]))).toThrow()
    expect(() => message(recipientManifest(key, context, 1, A, [owner, reader(B), reader(C), reader(D)]).slice(0, 2 + 1299 * 2))).toThrow()
    expect(() => message(previous)).toThrow()
    expect(() => privateNoteMessage({ ...operation, action: { ...operation.action, acknowledgeEpochHistory: false } }, NOTES_REALM, '0', state)).toThrow()
    const t = setup([2, 3]), w = await t.share(D)
    if (w.operation.action.kind !== 'access') throw new Error('access')
    const tState = await epochState(t), wAction = w.operation.action
    expect(() => privateNoteMessage({ ...w.operation, action: { ...wAction, mode: 0 } }, NOTES_REALM, '0', tState)).toThrow()
    await expect(sealAccessManifest(s.client, s.note(), 1, [owner, reader(B), reader(D)], s.access(B))).rejects.toThrow()
  })
  it('a reader added in epoch N opens what that epoch holds (its earlier versions too, 10-09 rule), never an earlier epoch', async () => {
    const s = setup([2]), before = { title: s.note().title, body: s.note().body! }
    await s.run((await s.revoke(B)).operation)
    // Epoch 2: the owner edits (same epoch, revision 2), then shares with D.
    const epoch2 = { title: s.note().title, body: s.note().body! }
    const edit = await sealEncryptedChanges(s.client, s.note(), { title: TITLE, body: 'Edited in epoch 2' }, s.access())
    s.set({ body: edit.body, bodyRevision: '3', stateRevision: '3' })
    await s.run((await s.share(D)).operation)
    expect(await s.read(D)).toEqual({ title: TITLE, body: 'Edited in epoch 2' })
    const key2 = s.epochKey(D, '2')!, context = (epoch: string) => noteContext('test-chain', NOTES_REALM, { id: noteId, epoch })
    // The epoch-2 version before the edit (chain history) opens with D's epoch-2 key: ApplyAccess shares the whole epoch.
    expect(new TextDecoder().decode(openField(key2, { ...context('2'), field: 'body', fieldRevision: 2n }, epoch2.body))).toBe(BODY)
    // Epoch 1: D has no envelope, and the epoch-2 key neither matches epoch 1's commitment nor opens its ciphertext.
    expect(s.epochKey(D, '1')).toBeNull(); expect(await s.client.wrapRaw(noteId, '1', D)).toBeNull()
    expect(bytesToHex(keyCommitment(key2, context('1')))).not.toBe(bytesToHex(parseEpochPage(await s.client.epochMetadataRaw(noteId, '1'), '1').commitment))
    expect(() => openField(key2, { ...context('1'), field: 'body', fieldRevision: 1n }, before.body)).toThrow()
    expect(() => openField(key2, { ...context('2'), field: 'body', fieldRevision: 1n }, before.body)).toThrow()
  })
})

describe('removing a reader (Rotate)', () => {
  it('B gets no key for the new epoch; C (remaining) and the owner open it; B keeps only the old epoch', async () => {
    const s = setup([2, 3]), oldBody = s.note().body!
    expect(await s.read(B)).toEqual({ title: TITLE, body: BODY })
    const { operation } = await s.revoke(B), request = await s.run(operation)
    expect(request.title).toBe('Remove a reader'); expect(request.lines(undefined)).toContainEqual(['Removes', B])
    expect(request.warns.join(' ')).toContain('keep what they already read; new versions are hidden from them')
    expect(s.note()).toMatchObject({ mode: 1, epoch: '2', stateRevision: '2', titleRevision: '2', bodyRevision: '2' })
    expect(s.entries('2').map(entry => bech32Encode('g', entry.address))).toEqual([A, C])
    // No envelope, so no key, for B in epoch 2.
    expect(s.epochKey(B, '2')).toBeNull(); expect(await s.client.wrapRaw(noteId, '2', B)).toBeNull()
    await expect(s.read(B)).rejects.toMatchObject({ reason: 'none' })
    // B's epoch-1 key (what they already had) opens the old ciphertext only, never the new one.
    const old = s.epochKey(B, '1')!, context = (epoch: string) => noteContext('test-chain', NOTES_REALM, { id: noteId, epoch })
    expect(new TextDecoder().decode(openField(old, { ...context('1'), field: 'body', fieldRevision: 1n }, oldBody))).toBe(BODY)
    expect(() => openField(old, { ...context('2'), field: 'body', fieldRevision: 2n }, s.note().body!)).toThrow()
    expect(bytesToHex(keyCommitment(old, context('2')))).not.toBe(bytesToHex(s.note().commitment))
    expect(await s.read(C)).toEqual({ title: TITLE, body: BODY }); expect(await s.read(A)).toEqual({ title: TITLE, body: BODY })
  })
  it('removing the last reader makes the note Private (only me) again', async () => {
    const s = setup([2])
    await s.run((await s.revoke(B)).operation)
    expect(s.note()).toMatchObject({ mode: 0, epoch: '2' }); expect(s.entries().length).toBe(1)
    expect(await s.read(A)).toEqual({ title: TITLE, body: BODY })
  })
  it('refuses a rotation that adds someone, changes a role, reuses the commitment, or skips an epoch', async () => {
    const s = setup([2]), state = await epochState(s), { operation } = await s.revoke(B)
    if (operation.action.kind !== 'rotate') throw new Error('rotate')
    const previousManifest = operation.action.previousManifest
    const reseal = (recipients: { key: ChainKey; writer: boolean }[], patch: Partial<EncryptedEpoch> = {}) => privateNoteMessage({ ...operation, action: { kind: 'rotate', previousManifest,
      prepared: { ...prepareEncryptedEpoch({ chainId: 'test-chain', realm: NOTES_REALM, noteId, epoch: 2, titleRevision: 2n, bodyRevision: 2n, mode: 1, owner: A, recipients, title: TITLE, body: BODY }), ...patch } } }, NOTES_REALM, '0', state)
    const owner = { key: s.registry.get(A)!, writer: true }
    expect(() => reseal([owner, { key: s.registry.get(C)!, writer: false }])).toThrow()
    expect(() => reseal([owner, { key: s.registry.get(B)!, writer: true }])).toThrow()
    expect(() => reseal([owner, { key: s.registry.get(B)!, writer: false }])).toThrow()
    expect(() => reseal([owner], { commitment: s.note().commitment })).toThrow()
    expect(() => reseal([owner], { epoch: 3 })).toThrow()
    expect(() => privateNoteMessage({ ...operation, caller: B }, NOTES_REALM, '0', state)).toThrow()
    await expect(sealRotation(s.client, s.note(), 0, [{ key: s.registry.get(B)!, writer: true }], s.access(B))).rejects.toThrow()
  })
})

describe('signing guards (both operations)', () => {
  it('a stale revision or changed readers are refused before the wallet; nothing is sent again', async () => {
    for (const change of ['revision', 'readers'] as const) {
      const s = setup([2]), { operation } = await s.revoke(B), request = await preparePrivateNoteRequest(s.options(operation))
      if (change === 'revision') s.set({ stateRevision: '2' })
      else s.apply(privateNoteMessage((await s.share(C)).operation, NOTES_REALM, '900000', await epochState(s)))
      const opened = vi.fn()
      wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); opened(); return { hash: 'aa'.repeat(32) } })
      await expect(request.send(undefined, async () => {})).rejects.toThrow('stale')
      expect(opened).not.toHaveBeenCalled(); expect((await s.intents.get(s.scope, operation.operationId))?.phase).toBe('not-sent')
    }
  })
  it('refuses before the wallet when the private-notes gate closes or the key locks', async () => {
    const s = setup(), { operation } = await s.share(B)
    gate.open = false
    await expect(preparePrivateNoteRequest(s.options(operation))).rejects.toThrow('disabled')
    gate.open = true
    const request = await preparePrivateNoteRequest(s.options(operation))
    gate.open = false
    await expect(request.send(undefined, async () => {})).rejects.toThrow('disabled')
    gate.open = true
    let live = true
    const t = setup([2]), late = await t.revoke(B), locked = await preparePrivateNoteRequest(t.options(late.operation, () => live))
    live = false
    await expect(locked.send(undefined, async () => {})).rejects.toThrow('session')
    expect(wallet.send).not.toHaveBeenCalled()
    t.phases.set(A, 'locked')
    await expect(t.revoke(B)).rejects.toThrow('session')
  })
  it('no plaintext in the message, the quote input, the receipt or the device store; recovery confirms from the chain alone', async () => {
    const s = setup([2]), quoted = vi.fn(s.quote)
    for (const step of [() => s.share(C), () => s.revoke(B)]) {
      const { operation } = await step(), request = await preparePrivateNoteRequest({ ...s.options(operation), quote: quoted })
      for (const trace of [...traces(BODY), ...traces(TITLE)]) {
        expect(JSON.stringify(request.prepare(undefined).msgs)).not.toContain(trace)
        expect(JSON.stringify(quoted.mock.calls.at(-1))).not.toContain(trace)
      }
      wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); throw new Error('transport lost') })
      await expect(request.send(undefined, async () => {})).rejects.toThrow('transport lost')
      const intent = (await s.intents.get(s.scope, operation.operationId))!
      expect(intent.phase).toBe('unknown'); expect(await recoverPrivateIntent(s.client, s.intents, intent, createDraftSession())).toBe('unknown')
      s.apply(wallet.send.mock.calls.at(-1)![0][0])
      expect(await recoverPrivateIntent(s.client, s.intents, intent, createDraftSession())).toBe('confirmed')
    }
    const disk = await rawRecords(s.indexedDB)
    for (const trace of [...traces(BODY), ...traces(TITLE)]) expect(disk).not.toContain(trace)
    expect(s.note()).toMatchObject({ epoch: '2' }); expect(s.entries().map(entry => bech32Encode('g', entry.address))).toEqual([A, C])
  })
})
