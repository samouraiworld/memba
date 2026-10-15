import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { bech32Encode } from '../../dao/realmAddress'
import type { AminoMsg } from '../../grc20'
import { createDraftSession, createNotesStore, type NotesStore } from '../drafts'
import { createNotesIntents } from '../intents'
import { accessVerification } from '../chain/accessRequest'
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
  /**
   * The realm applying a signed ApplyAccess, Rotate or Commit (epochs.gno mutateApplyAccess / mutateRotate, notes.gno
   * mutateCommit with acl.gno canWrite): owner-only access changes, no writer downgrade without a new epoch, and a Commit
   * only by the owner or a writer flag of the current manifest.
   */
  function apply(message: AminoMsg) {
    const { func, args, caller } = message.value, op = bytesToHex(blob(args[args.length - 1], 16))
    if (args[1] !== note.stateRevision) throw new Error('notes: stale revision')
    if (func !== 'Commit' && caller !== note.owner) throw new Error('notes: owner required')
    height++
    if (func === 'Commit') {
      if (caller !== note.owner && !entries().some(entry => bech32Encode('g', entry.address) === caller && entry.writer)) throw new Error('notes: writer required')
      if (args[2] !== note.epoch) throw new Error('notes: stale epoch')
      const mask = Number(args[3])
      note = { ...note, ...mask & 1 ? { title: blob(args[4], 231), titleRevision: String(BigInt(note.titleRevision) + 1n) } : {}, ...mask & 2 ? { body: blob(args[5], 135223), bodyRevision: String(BigInt(note.bodyRevision) + 1n) } : {},
        stateRevision: String(BigInt(note.stateRevision) + 1n), operationId: op, actor: caller, height: String(height) }
    } else if (func === 'ApplyAccess') {
      const next = decodeManifest(blob(args[4], 41570), Number(note.epoch))
      if (entries().some(old => old.writer && !next.some(entry => bech32Encode('g', entry.address) === bech32Encode('g', old.address) && entry.writer))) throw new Error('notes: writer removal requires rotation')
      epochs.get(note.epoch)!.manifest = blob(args[4], 41570)
      note = { ...note, mode: Number(args[3]) as 0 | 1, stateRevision: String(BigInt(note.stateRevision) + 1n), operationId: op, actor: caller, height: String(height) }
    } else {
      const epoch = String(Number(note.epoch) + 1), commitment = blob(args[7], 32)
      epochs.set(epoch, { commitment, manifest: blob(args[6], 41570) })
      note = { ...note, mode: Number(args[3]) as 0 | 1, epoch, title: blob(args[4], 231), body: blob(args[5], 135223), commitment, titleRevision: String(BigInt(note.titleRevision) + 1n),
        bodyRevision: String(BigInt(note.bodyRevision) + 1n), stateRevision: String(BigInt(note.stateRevision) + 1n), operationId: op, actor: caller, height: String(height) }
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
  /** The owner makes `address` (a current reader) a writer: ApplyAccess, same holders, its writer flag set. */
  async function promote(address: string): Promise<{ operation: PrivateNoteOperation; base: PrivateAccessBase }> {
    const previousManifest = await readPrivateAccess(client, note, SIGNAL), current = await members()
    const manifest = await sealAccessManifest(client, note, 1, current.map(entry => entry.key.address === address ? { ...entry, writer: true } : entry), access())
    return { operation: { chainId: 'test-chain', caller: A, noteId, operationId: nextId(), action: { kind: 'access', mode: 1, manifest, previousManifest, acknowledgeEpochHistory: true } },
      base: { envelopes: current.length, writers: current.filter(entry => entry.writer).length } }
  }
  /** The owner makes the writer `address` a reader again: Rotate keeping every holder, its writer flag cleared. */
  async function demote(address: string): Promise<{ operation: PrivateNoteOperation; base: PrivateCommitSizes }> {
    const previousManifest = await readPrivateAccess(client, note, SIGNAL), kept = (await members()).map(entry => entry.key.address === address ? { ...entry, writer: false } : entry)
    const prepared = await sealRotation(client, note, 1, kept, access())
    return { operation: { chainId: 'test-chain', caller: A, noteId, operationId: nextId(), action: { kind: 'rotate', prepared, previousManifest } }, base: { title: note.title.length, body: note.body!.length } }
  }
  /** `address` edits the body (owner or writer): only the changed field, sealed with the real current epoch key. */
  async function edit(address: string, body: string): Promise<PrivateNoteOperation> {
    const previousManifest = await readPrivateAccess(client, note, SIGNAL), changes = await sealEncryptedChanges(client, note, { title: TITLE, body }, access(address))
    return { chainId: 'test-chain', caller: address, noteId, operationId: nextId(), action: { kind: 'commit', ...changes, previousManifest } }
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
  return { client, store, indexedDB, intents, registry, phases, access, apply, share, revoke, promote, demote, edit, options, run, read, epochKey, entries, quote, scope: (owner = A) => ({ chainId: 'test-chain', realm: NOTES_REALM, owner, noteId }),
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
  it('two turned-off readers never block a removal: one Rotate drops them with the chosen reader, and the sheet names them apart', async () => {
    const s = setup([2, 3, 4]), previousManifest = await readPrivateAccess(s.client, s.note(), SIGNAL)
    for (const address of [B, C]) s.registry.set(address, { ...s.registry.get(address)!, active: false, publicKey: new Uint8Array() })
    // Keeping B or C is impossible (no active key to wrap for, and the realm validates every envelope).
    await expect(sealRotation(s.client, s.note(), 1, [{ key: s.registry.get(A)!, writer: true }, { key: s.registry.get(B)!, writer: false }], s.access())).rejects.toThrow()
    const prepared = await sealRotation(s.client, s.note(), 0, [{ key: s.registry.get(A)!, writer: true }], s.access())
    const request = await s.run({ chainId: 'test-chain', caller: A, noteId, operationId: nextId(), action: { kind: 'rotate', prepared, previousManifest } })
    expect(request.lines(undefined)).toContainEqual(['Removes', D])
    expect(request.lines(undefined)).toContainEqual(['Also removed because their private-notes key is turned off', [B, C].join(', ')])
    expect(s.note()).toMatchObject({ mode: 0, epoch: '2' }); expect(s.entries().map(entry => bech32Encode('g', entry.address))).toEqual([A])
    for (const address of [B, C, D]) await expect(s.read(address)).rejects.toBeInstanceOf(PrivateNoteNoAccess)
    expect(await s.read(A)).toEqual({ title: TITLE, body: BODY })
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
      expect(opened).not.toHaveBeenCalled(); expect((await s.intents.get(s.scope(), operation.operationId))?.phase).toBe('not-sent')
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
      const intent = (await s.intents.get(s.scope(), operation.operationId))!
      expect(intent.phase).toBe('unknown'); expect(await recoverPrivateIntent(s.client, s.intents, intent, createDraftSession())).toBe('unknown')
      s.apply(wallet.send.mock.calls.at(-1)![0][0])
      expect(await recoverPrivateIntent(s.client, s.intents, intent, createDraftSession())).toBe('confirmed')
    }
    const disk = await rawRecords(s.indexedDB)
    for (const trace of [...traces(BODY), ...traces(TITLE)]) expect(disk).not.toContain(trace)
    expect(s.note()).toMatchObject({ epoch: '2' }); expect(s.entries().map(entry => bech32Encode('g', entry.address))).toEqual([A, C])
  })
})

// E2: private co-writers. A writer is the writer flag of their envelope in the epoch manifest: set by ApplyAccess (same
// holders), cleared only by Rotate (the realm refuses a writer downgrade without a new epoch). AddWriter/RemoveWriter are
// public-note calls (acl.gno: "encrypted ACL requires atomic manifest").
describe('co-writers (E2)', () => {
  it('quotes against the keeper rows: reader → writer 42,600 / 49,800 ugnot, 56.9 / 57.1 M; writer → reader (Rotate, same holders) 589,800 / 583,800, 58.2 M', async () => {
    const s = setup([2]), promoted = await s.promote(B), up = privateNoteBudget(privateNoteMessage(promoted.operation, NOTES_REALM, '0', await epochState(s)), promoted.base)
    expect(up).toEqual({ gasWanted: 90_000_000, estimatedDepositUgnot: '60000', suggestedCapUgnot: '100000' })
    expect(Number(up.estimatedDepositUgnot)).toBeGreaterThanOrEqual(49_800); expect(up.gasWanted).toBeGreaterThanOrEqual(57_100_000 * 1.5)
    await s.run(promoted.operation)
    const demoted = await s.demote(B), down = privateNoteBudget(privateNoteMessage(demoted.operation, NOTES_REALM, '0', await epochState(s)), demoted.base)
    expect(Number(down.estimatedDepositUgnot)).toBeGreaterThanOrEqual(589_800); expect(down.suggestedCapUgnot).toBe('800000')
    expect(down.gasWanted).toBeGreaterThanOrEqual(58_200_000 * 1.5); expect(down.gasWanted).toBeLessThanOrEqual(500_000_000)
  })
  it('the owner makes reader B a writer (ApplyAccess, same epoch, every envelope bound to its holder’s registry key); B then edits with real crypto and the owner reads it', async () => {
    const s = setup([2, 3])
    await expect(s.edit(B, 'not yet')).rejects.toThrow()
    const { operation } = await s.promote(B), request = await s.run(operation)
    expect(request.title).toBe('Let a reader edit'); expect(request.lines(undefined)).toContainEqual(['Can edit from now on', B])
    expect(request.lines(undefined)).toContainEqual(['Who can edit', `You and ${B}`])
    expect(request.warns.join(' ')).toContain('Their address becomes public on the network as a writer of this note.')
    expect(request.warns.join(' ')).toContain('only you share it, remove readers, change who can edit or delete it')
    expect(request.prepare(undefined).msgs[0].value.func).toBe('ApplyAccess')
    expect(s.note()).toMatchObject({ mode: 1, epoch: '1', stateRevision: '2', titleRevision: '1', bodyRevision: '1' })
    expect(s.entries().map(entry => [bech32Encode('g', entry.address), entry.writer, entry.generation])).toEqual([[A, true, 1n], [B, true, 1n], [C, false, 1n]])
    for (const entry of s.entries()) expect(bytesToHex(entry.publicKeyHash)).toBe(bytesToHex(sha256(s.registry.get(bech32Encode('g', entry.address))!.publicKey)))
    // B's Commit: sealed with B's own envelope of the current epoch, signed by B (scope and actor B), applied by the realm.
    const commit = await s.edit(B, 'Edited by B'), signed = await s.run(commit)
    expect(signed.summary).toBe('Publish encrypted changes to a private note you can edit'); expect(signed.lines(undefined)).toContainEqual(['Owner', A])
    expect(signed.warns[0]).toContain('the owner’s address, your address as the one who changed it'); expect(signed.lines(undefined).find(([name]) => name === 'Public on the network')?.[1]).toMatch(/^Owner and writer addresses/)
    expect(s.note()).toMatchObject({ actor: B, stateRevision: '3', bodyRevision: '2', titleRevision: '1', epoch: '1' })
    expect((await s.intents.get(s.scope(B), commit.operationId))?.phase).toBe('confirmed')
    for (const reader of [A, B, C]) expect(await s.read(reader)).toEqual({ title: TITLE, body: 'Edited by B' })
  })
  it('a reader without the writer flag cannot commit: refused before any wallet (sealing and message) and by the realm', async () => {
    const s = setup([2]), state = await epochState(s)
    await expect(s.edit(B, 'by a reader')).rejects.toThrow()
    // A well-formed body ciphertext at the next revision (as B's real epoch key would seal it): the message builder still
    // refuses a Commit from a reader.
    const body = prepareEncryptedEpoch({ chainId: 'test-chain', realm: NOTES_REALM, noteId, epoch: 1, titleRevision: 1n, bodyRevision: 2n, mode: 1, owner: A, recipients: [{ key: s.registry.get(A)!, writer: true }], title: TITLE, body: 'x' }).body
    const previousManifest = await readPrivateAccess(s.client, s.note(), SIGNAL)
    const forged: PrivateNoteOperation = { chainId: 'test-chain', caller: B, noteId, operationId: nextId(), action: { kind: 'commit', body, previousManifest } }
    expect(() => privateNoteMessage(forged, NOTES_REALM, '0', state)).toThrow()
    await expect(preparePrivateNoteRequest(s.options(forged))).rejects.toThrow()
    expect(wallet.send).not.toHaveBeenCalled()
    // The realm (acl.gno canWrite) refuses it too.
    const message = privateNoteMessage({ ...forged, caller: A }, NOTES_REALM, '0', state)
    expect(() => s.apply({ ...message, value: { ...message.value, caller: B } })).toThrow('notes: writer required')
  })
  it('the owner makes writer B a reader again with a new epoch: B still reads, B can no longer commit, B’s request prepared before is refused before the wallet', async () => {
    const s = setup([2, 3])
    await s.run((await s.promote(B)).operation)
    const before = await preparePrivateNoteRequest(s.options(await s.edit(B, 'B, before demotion')))
    // The realm refuses a writer downgrade in place (ApplyAccess): the client never builds one.
    const current = await readPrivateAccess(s.client, s.note(), SIGNAL), epoch1 = await epochState(s)
    const inPlace = await sealAccessManifest(s.client, s.note(), 1, decodeManifest(current, 1).map(entry => ({ key: s.registry.get(bech32Encode('g', entry.address))!, writer: bech32Encode('g', entry.address) === A })), s.access())
    const downgrade: PrivateNoteOperation = { chainId: 'test-chain', caller: A, noteId, operationId: nextId(), action: { kind: 'access', mode: 1, manifest: inPlace, previousManifest: current, acknowledgeEpochHistory: true } }
    expect(() => privateNoteMessage(downgrade, NOTES_REALM, '0', epoch1)).toThrow()
    const raw = { type: 'vm/MsgCall', value: { caller: A, send: '', pkg_path: NOTES_REALM, func: 'ApplyAccess', args: [encode64(hexToBytes(noteId)), s.note().stateRevision, '1', '1', encode64(inPlace), encode64(hexToBytes(nextId()))], max_deposit: '0ugnot' } }
    expect(() => s.apply(raw as AminoMsg)).toThrow('notes: writer removal requires rotation')
    const { operation } = await s.demote(B), request = await s.run(operation)
    expect(request.title).toBe('Stop a writer editing'); expect(request.lines(undefined)).toContainEqual(['Can no longer edit', B])
    expect(request.lines(undefined).some(([name]) => name === 'Removes')).toBe(false)
    expect(request.warns.join(' ')).toContain('can still read this note but can no longer publish changes')
    expect(request.prepare(undefined).msgs[0].value.func).toBe('Rotate')
    expect(s.note()).toMatchObject({ mode: 1, epoch: '2', stateRevision: '3', titleRevision: '2', bodyRevision: '2' })
    // Every holder kept, each envelope for its current registry key; B's flag cleared; a fresh key.
    expect(s.entries('2').map(entry => [bech32Encode('g', entry.address), entry.writer])).toEqual([[A, true], [B, false], [C, false]])
    expect(bytesToHex(s.note().commitment)).not.toBe(bytesToHex(parseEpochPage(await s.client.epochMetadataRaw(noteId, '1'), '1').commitment))
    for (const reader of [A, B, C]) expect(await s.read(reader)).toEqual({ title: TITLE, body: BODY })
    // B's request prepared under epoch 1 as a writer: stale before any wallet opens; nothing sent.
    const opened = vi.fn()
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); opened(); return { hash: 'aa'.repeat(32) } })
    await expect(before.send(undefined, async () => {})).rejects.toThrow('stale'); expect(opened).not.toHaveBeenCalled()
    // A new edit by B is refused before any wallet (B's envelope is a reader's), and the realm refuses it.
    await expect(s.edit(B, 'B, after demotion')).rejects.toThrow()
    const owners = await s.edit(A, 'Owner edit'), message = privateNoteMessage(owners, NOTES_REALM, '0', await epochState(s))
    expect(() => s.apply({ ...message, value: { ...message.value, caller: B } })).toThrow('notes: writer required')
    await s.run(owners); expect(await s.read(B)).toEqual({ title: TITLE, body: 'Owner edit' })
  })
  it('a writer cannot do owner-only actions: share, change roles, remove, rotate or delete', async () => {
    const s = setup([2, 3]); await s.run((await s.promote(B)).operation)
    const state = await epochState(s), members = decodeManifest(await readPrivateAccess(s.client, s.note(), SIGNAL), 1).map(entry => ({ key: s.registry.get(bech32Encode('g', entry.address))!, writer: entry.writer }))
    // No owner key use for a writer: sealing an access change or a rotation is refused before anything is signed.
    await expect(sealAccessManifest(s.client, s.note(), 1, [...members, { key: s.registry.get(D)!, writer: false }], s.access(B))).rejects.toThrow()
    await expect(sealRotation(s.client, s.note(), 1, members.filter(entry => entry.key.address !== C), s.access(B))).rejects.toThrow()
    // Even with the owner's own sealed operations, the message builder refuses them from B, and so does the realm.
    for (const operation of [(await s.share(D)).operation, (await s.promote(C)).operation, (await s.revoke(C)).operation, (await s.demote(B)).operation]) {
      expect(() => privateNoteMessage({ ...operation, caller: B }, NOTES_REALM, '0', state)).toThrow()
      const message = privateNoteMessage(operation, NOTES_REALM, '0', state)
      expect(() => s.apply({ ...message, value: { ...message.value, caller: B } })).toThrow('notes: owner required')
    }
    // Delete (accessRequest): owner only.
    const deletion = { caller: B, noteId, operationId: nextId(), revision: s.note().stateRevision, ownerGeneration: '1', action: { kind: 'delete' as const } }
    expect(() => accessVerification(deletion, { note: s.note(), writers: [B] }, '1')).toThrow()
    expect(() => accessVerification({ ...deletion, caller: A }, { note: s.note(), writers: [B] }, '1')).not.toThrow()
  })
  it('message rules: one role change at a time, never with an addition, never the owner, a writer flag only on a current reader, and only a Rotate lowers it', async () => {
    const s = setup([2, 3]), state = await epochState(s), previous = await readPrivateAccess(s.client, s.note(), SIGNAL)
    const key = new Uint8Array(32), context = noteContext('test-chain', NOTES_REALM, { id: noteId, epoch: '1' }), r = (address: string, writer = false) => ({ key: s.registry.get(address)!, writer })
    const access = (list: { key: ChainKey; writer: boolean }[], caller = A, previousManifest = previous) => privateNoteMessage({ chainId: 'test-chain', caller, noteId, operationId: nextId(),
      action: { kind: 'access', mode: 1, manifest: recipientManifest(key, context, 1, A, list), previousManifest, acknowledgeEpochHistory: true } }, NOTES_REALM, '0', state)
    expect(access([r(A, true), r(B, true), r(C)]).value.func).toBe('ApplyAccess')
    expect(() => access([r(A, true), r(B, true), r(C, true)])).toThrow()
    expect(() => access([r(A, true), r(B, true), r(C), r(D)])).toThrow()
    expect(() => access([r(A, true), r(B), r(C), r(D, true)])).toThrow()
    expect(() => access([r(A, true), r(B), r(C)])).toThrow()
    expect(() => access([r(A, false), r(B, true), r(C)])).toThrow()
    expect(() => access([r(A, true), r(B, true), r(C)], B)).toThrow()
    const writers = recipientManifest(key, context, 1, A, [r(A, true), r(B, true), r(C, true)])
    expect(() => access([r(A, true), r(B), r(C, true)], A, writers)).toThrow()
    const rotate = (list: { key: ChainKey; writer: boolean }[], previousManifest = writers) => privateNoteMessage({ chainId: 'test-chain', caller: A, noteId, operationId: nextId(), action: { kind: 'rotate', previousManifest,
      prepared: prepareEncryptedEpoch({ chainId: 'test-chain', realm: NOTES_REALM, noteId, epoch: 2, titleRevision: 2n, bodyRevision: 2n, mode: 1, owner: A, recipients: list, title: TITLE, body: BODY }) } }, NOTES_REALM, '0', state)
    expect(rotate([r(A, true), r(B), r(C, true)]).value.func).toBe('Rotate')
    expect(rotate([r(A, true), r(B)]).value.func).toBe('Rotate')
    expect(() => rotate([r(A, true), r(B), r(C)])).toThrow()
    expect(() => rotate([r(A, true), r(B, true), r(C, true), r(D)])).toThrow()
    expect(() => rotate([r(A, true), r(B, true), r(C)], previous)).toThrow()
    expect(() => rotate([r(A, true), r(B, true), r(C, true)])).toThrow()
  })
  it('no plaintext in the message, the quote input, the receipt or the device store, for a role change and a writer’s edit; recovery confirms from the chain alone', async () => {
    const s = setup([2]), quoted = vi.fn(s.quote)
    for (const step of [async () => (await s.promote(B)).operation, () => s.edit(B, 'Edited by B'), async () => (await s.demote(B)).operation]) {
      const operation = await step(), request = await preparePrivateNoteRequest({ ...s.options(operation), quote: quoted })
      for (const trace of [...traces(BODY), ...traces(TITLE), ...traces('Edited by B')]) {
        expect(JSON.stringify(request.prepare(undefined).msgs)).not.toContain(trace)
        expect(JSON.stringify(quoted.mock.calls.at(-1))).not.toContain(trace)
      }
      wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); throw new Error('transport lost') })
      await expect(request.send(undefined, async () => {})).rejects.toThrow('transport lost')
      const intent = (await s.intents.get(s.scope(operation.caller), operation.operationId))!
      expect(intent.phase).toBe('unknown'); expect(await recoverPrivateIntent(s.client, s.intents, intent, createDraftSession())).toBe('unknown')
      s.apply(wallet.send.mock.calls.at(-1)![0][0])
      expect(await recoverPrivateIntent(s.client, s.intents, intent, createDraftSession())).toBe('confirmed')
    }
    const disk = await rawRecords(s.indexedDB)
    for (const trace of [...traces(BODY), ...traces(TITLE), ...traces('Edited by B')]) expect(disk).not.toContain(trace)
    expect(s.note()).toMatchObject({ epoch: '2', actor: A }); expect(s.entries().map(entry => [bech32Encode('g', entry.address), entry.writer])).toEqual([[A, true], [B, false]])
  })
})
