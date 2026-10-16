import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { bytesToHex } from '@noble/hashes/utils.js'
import { bech32Encode } from '../../dao/realmAddress'
import type { AminoMsg } from '../../grc20'
import { createDraftSession, createNotesStore } from '../drafts'
import { createNotesIntents } from '../intents'
import type { NotesReadClient } from '../chain/client'
import { commentIntentRealm } from '../chain/commentRequest'
import { encryptedCommentBudget, privateCommentBudget, privateCommentMessage, type PrivateCommentAction } from '../chain/privateCommentMessages'
import { preparePrivateCommentRequest, recoverPrivateCommentIntent } from '../chain/privateCommentRequest'
import { parsePrivateComment, readPrivateCommentPage, type PrivateComment } from '../chain/privateComments'
import { blob, encode64, NotesChainError, type ChainKey, type ChainNote } from '../chain/schema'
import { NOTES_REALM } from '../chain/__fixtures__/deployment'
import type { NotesQuoteProvider } from '../chain/request'
import { identityFromSeed, type NotesIdentity } from '../crypto/identity'
import { decodeManifest } from '../crypto/manifest'
import type { NotesIdentityController } from '../identity/controller'
import { openPrivateComments, privateCommentQuote, sealPrivateComment } from './comments'
import { prepareEncryptedEpoch } from './engine'
import { PrivateStorageAboveCap } from './quote'

// PR F: encrypted comments on a private note, with real X-Wing envelopes and content AEAD. The fake chain stores what the
// realm stores (comments.gno: commentJSON) and applies each signed message under the realm's rules; nothing is broadcast.
const wallet = vi.hoisted(() => ({ send: vi.fn(), fee: vi.fn(), price: vi.fn() }))
const gate = vi.hoisted(() => ({ open: true }))
vi.mock('../../grc20', () => ({ MAX_GAS_WANTED: 500_000_000, doContractBroadcast: (...args: unknown[]) => wallet.send(...args), freshFeeForGasWanted: (...args: unknown[]) => wallet.fee(...args), assertFeeStillCovers: async () => {} }))
vi.mock('../../dao/packageStatus', () => ({ abciQueryText: (...args: unknown[]) => wallet.price(...args) }))
vi.mock('../config', async original => ({
  ...await original<typeof import('../config')>(),
  deploymentRealm: () => NOTES_REALM,
  privateNotesDeployment: (chainId: string) => gate.open && chainId === 'test-chain' ? { realm: NOTES_REALM, version: 1 } : null,
}))
const who = (n: number) => bech32Encode('g', new Uint8Array(20).fill(n))
const A = who(1), B = who(2), C = who(3), D = who(4), noteId = '11'.repeat(16), SIGNAL = new AbortController().signal
let ids = 0
const nextId = () => (++ids).toString(16).padStart(32, '0')
const hex = (arg: string) => bytesToHex(blob(arg, 16))

function setup(writers: string[] = []) {
  const store = createNotesStore({ indexedDB: new IDBFactory() }), intents = createNotesIntents(store), session = createDraftSession()
  const identities = new Map<string, NotesIdentity>([A, B, C, D].map((address, i) => [address, identityFromSeed(new Uint8Array(32).fill(20 + i))]))
  const registry = new Map<string, ChainKey>([...identities].map(([address, identity]) => [address, { address, generation: '1', active: true, publicKey: identity.publicKey, operationId: '33'.repeat(16), height: '9' }]))
  const epochs = new Map<string, { commitment: Uint8Array; manifest: Uint8Array }>()
  let note!: ChainNote, height = 100
  /** The note at `epoch` for `holders` (the owner A first): what create, ApplyAccess and Rotate leave on chain. */
  function epoch(n: number, holders: string[]) {
    const sealed = prepareEncryptedEpoch({ chainId: 'test-chain', realm: NOTES_REALM, noteId, epoch: n, titleRevision: BigInt(n), bodyRevision: BigInt(n), mode: holders.length > 1 ? 1 : 0, owner: A,
      recipients: holders.map(address => ({ key: registry.get(address)!, writer: address === A || writers.includes(address) })), title: 'Recipe', body: 'Rice, vinegar, nori.' })
    epochs.set(String(n), { commitment: sealed.commitment, manifest: sealed.manifest })
    note = { id: noteId, owner: A, pendingOwner: '', ownerGeneration: '1', mode: sealed.mode, stateRevision: String(n), titleRevision: String(n), bodyRevision: String(n), epoch: String(n), title: sealed.title, body: sealed.body,
      commitment: sealed.commitment, deleted: false, listed: false, createdHeight: '1', operationId: '22'.repeat(16), actor: A, height: String(height), bodyBytes: sealed.body.length }
  }
  const entries = (e = note.epoch) => decodeManifest(epochs.get(e)!.manifest, Number(e))
  const holders = () => entries().map(entry => bech32Encode('g', entry.address))
  const comments = new Map<string, Record<string, unknown>>()
  const client = {
    chainId: 'test-chain', realm: NOTES_REALM, assertCurrent: vi.fn(), noteMetadata: vi.fn(async () => note), height: vi.fn(async () => String(height)),
    config: vi.fn(async () => ({ realm: NOTES_REALM, admin: A, pendingAdmin: '', treasury: A, createFeeUgnot: '100000', paused: false })),
    readersRaw: vi.fn(async () => holders()),
    writersRaw: vi.fn(async () => entries().filter(entry => entry.writer).map(entry => bech32Encode('g', entry.address)).filter(address => address !== A)),
    wrapRaw: vi.fn(async (_id: string, e: string, address: string) => {
      const entry = epochs.has(e) ? entries(e).find(x => bech32Encode('g', x.address) === address) : undefined
      return entry ? { address, epoch: e, writer: entry.writer, generation: String(entry.generation), public_key_hash: encode64(entry.publicKeyHash), wrap: encode64(entry.wrap) } : null
    }),
    epochMetadataRaw: vi.fn(async (_id: string, e: string) => ({ items: [{ epoch: e, commitment: encode64(epochs.get(e)!.commitment), revealed_key: '' }], next_cursor: e })),
    getCommentRaw: vi.fn(async (_id: string, cid: string) => comments.get(cid) ?? null),
    commentsRaw: vi.fn(async () => ({ items: [...comments.values()], next_cursor: '' })),
    simulateRaw: vi.fn(async () => { throw new Error('offline') }),
  } as unknown as NotesReadClient
  const phases = new Map<string, string>()
  const identity = (address: string) => ({ getSnapshot: () => ({ phase: phases.get(address) ?? 'unlocked', generation: '1' }), subscribe: () => () => {},
    use: async (fn: (value: NotesIdentity) => unknown) => { if ((phases.get(address) ?? 'unlocked') !== 'unlocked') throw new Error('locked'); return fn(identities.get(address)!) } }) as unknown as NotesIdentityController
  const access = (address: string) => ({ owner: address, identity: identity(address), signal: SIGNAL })
  /** The realm applying a signed comment message (comments.gno: mayComment, validateCipher, requireWrite, owner or moderator, author). */
  function apply(message: AminoMsg) {
    const { func, args, caller } = message.value, cid = hex(args[1]), existing = comments.get(cid)
    height++
    const receipt = { op_id: hex(args.at(-1)!), actor: caller, height: String(height), revision: String(Number(existing?.revision ?? 0) + 1) }
    if (func === 'AddComment') {
      if (note.mode !== 1 || !holders().includes(caller)) throw new Error('notes: comments denied')
      if (args[3] !== note.epoch || args[5] !== '') throw new Error('notes: bad comment')
      parsePrivateComment({ id: cid, parent: hex(args[4]), author: caller, encrypted: true, body_revision: args[2], epoch: args[3], revision: '1', anchor_blob: '', body_blob: args[6], created_height: String(height), op_id: receipt.op_id, actor: caller, height: String(height), deleted: false, hidden: false, resolved: false })
      comments.set(cid, { id: cid, parent: hex(args[4]), author: caller, encrypted: true, body_revision: args[2], epoch: args[3], anchor_blob: '', body_blob: args[6], created_height: String(height), deleted: false, hidden: false, resolved: false, ...receipt })
    } else if (func === 'DeleteComment') {
      if (existing!.author !== caller) throw new Error('notes: comment author required')
      comments.set(cid, { ...existing, ...receipt, deleted: true, body_blob: '' })
    } else if (func === 'ResolveComment') {
      if (caller !== A && !entries().some(entry => bech32Encode('g', entry.address) === caller && entry.writer)) throw new Error('notes: writer required')
      comments.set(cid, { ...existing, ...receipt, resolved: args[3] === 'true' })
    } else {
      if (caller !== A) throw new Error('notes: owner required or moderator')
      comments.set(cid, { ...existing, ...receipt, hidden: args[3] === 'true' })
    }
  }
  const quote: NotesQuoteProvider = async input => ({ chainId: input.chainId, requestDigest: input.requestDigest, atHeight: input.height, expiresAtHeight: String(Number(input.height) + 20), expiresAtMs: Date.now() + 60000,
    source: 'bounded-estimate', estimatedDepositUgnot: privateCommentBudget(input.message).estimatedDepositUgnot, maxDepositUgnot: input.message.value.max_deposit.replace('ugnot', ''), gasWanted: 61_000_000, networkFeeUgnot: 73_200 })
  async function request(caller: string, commentId: string, action: PrivateCommentAction, withKey = action.kind === 'add') {
    const operation = { caller, noteId, commentId, operationId: nextId(), action }
    const cap = privateCommentBudget(privateCommentMessage(operation, '0', NOTES_REALM)).suggestedCapUgnot
    return preparePrivateCommentRequest({ client, operation, maxDepositUgnot: cap, session, intents, quote, isWriteEnabled: () => true, ...withKey ? { access: access(caller) } : {} })
  }
  /** Review, sign (wallet mock), the realm applies the exact signed message, then exact verification. */
  async function run(caller: string, commentId: string, action: PrivateCommentAction, withKey?: boolean) {
    const sheet = await request(caller, commentId, action, withKey)
    wallet.send.mockImplementationOnce(async (msgs: AminoMsg[], _memo: string, options: { beforeSign(): Promise<unknown> }) => { await options.beforeSign(); apply(msgs[0]); return { hash: 'AB'.repeat(32) } })
    await sheet.send(undefined, async () => {})
    expect(await sheet.verify!(undefined, 'AB'.repeat(32), undefined)).toBe(true)
    return sheet
  }
  /** `author` writes a comment under the note's current epoch: sealed with the real epoch key, then posted. */
  async function post(author: string, body: string, quote = '', parent = '') {
    const id = nextId(), meta = { id, author, parent, bodyRevision: note.bodyRevision, epoch: note.epoch }
    const ciphertext = await sealPrivateComment(client, note, meta, { body, quote, prefix: '', suffix: '' }, access(author))
    await run(author, id, { kind: 'add', bodyRevision: note.bodyRevision, epoch: note.epoch, parent: parent || undefined, ciphertext })
    return id
  }
  const page = async () => readPrivateCommentPage(client, noteId, '')
  const read = async (address: string) => openPrivateComments(client, noteId, await page(), access(address))
  return { client, store, intents, session, epoch, post, run, request, read, page, comments, phases, access, note: () => note }
}
beforeEach(() => {
  vi.clearAllMocks(); gate.open = true; wallet.price.mockResolvedValue('"100ugnot"'); wallet.fee.mockImplementation(async (gas: number) => Math.ceil(gas * 1.2 / 1000))
})

describe('encrypted comments: posting and reading', () => {
  it('a reader posts under the current epoch; the owner and every reader read it; the message, quote input and receipt carry ciphertext only', async () => {
    const s = setup(); s.epoch(1, [A, B, C])
    const id = await s.post(B, 'Less vinegar, more rice', 'nori')
    const signed = JSON.stringify(wallet.send.mock.calls[0][0])
    expect(signed).not.toContain('vinegar'); expect(signed).not.toContain(encode64(new TextEncoder().encode('Less vinegar')))
    const [message] = wallet.send.mock.calls[0][0] as AminoMsg[]
    expect(message.value.func).toBe('AddComment'); expect(message.value.args[5]).toBe(''); expect(message.value.pkg_path).toBe(NOTES_REALM)
    for (const reader of [A, B, C]) expect((await s.read(reader)).get(id)).toEqual({ status: 'open', body: 'Less vinegar, more rice', quote: 'nori' })
    const receipts = JSON.stringify(await s.intents.list({ chainId: 'test-chain', realm: commentIntentRealm(NOTES_REALM, noteId), owner: B }))
    expect(receipts).toContain('ciphertextSha256'); expect(receipts).not.toContain('vinegar'); expect(receipts).not.toContain('nori')
  })
  it('co-writers and readers comment (realm: a Shared note’s readers); a note only its owner reads takes none, nor does someone without an envelope', async () => {
    const s = setup([B]); s.epoch(1, [A, B, C])
    await s.post(B, 'writer here'); await s.post(C, 'reader here'); await s.post(A, 'owner here')
    expect([...(await s.read(A)).values()].map(c => c.status === 'open' && c.body)).toEqual(['writer here', 'reader here', 'owner here'])
    await expect(s.post(D, 'outsider')).rejects.toMatchObject({ name: 'PrivateNoteNoAccess' })
    s.epoch(2, [A])
    await expect(s.post(A, 'only me')).rejects.toThrow()
  })
  it('the review shows what this exact ciphertext opens to, and refuses one that does not open for its operation', async () => {
    const s = setup(); s.epoch(1, [A, B])
    const id = nextId(), meta = { id, author: B, parent: '', bodyRevision: '1', epoch: '1' }
    const ciphertext = await sealPrivateComment(s.client, s.note(), meta, { body: 'Shown to sign', quote: '', prefix: '', suffix: '' }, s.access(B))
    const sheet = await s.request(B, id, { kind: 'add', bodyRevision: '1', epoch: '1', ciphertext })
    expect(sheet.lines(undefined)).toContainEqual(['Comment (sent encrypted)', 'Shown to sign']); expect(sheet.title).toBe('Post encrypted comment')
    // The same bytes under another comment id (moved): refused before any wallet.
    await expect(s.request(B, nextId(), { kind: 'add', bodyRevision: '1', epoch: '1', ciphertext })).rejects.toThrow()
  })
})

describe('encrypted comments: binding, epochs and revocation', () => {
  it('a ciphertext opens only for its own note, epoch, comment id, author, parent and body revision (network and realm are in the same AEAD context)', async () => {
    const s = setup(); s.epoch(1, [A, B])
    const id = await s.post(B, 'Bound')
    const [original] = await s.page()
    const moved: PrivateComment[] = [{ ...original, id: nextId() }, { ...original, author: A }, { ...original, parent: nextId() }, { ...original, bodyRevision: '2' }]
    for (const variant of moved) expect((await openPrivateComments(s.client, noteId, [variant], s.access(A))).get(variant.id)).toEqual({ status: 'unavailable' })
    // Another note: its envelopes and AEAD context name that note, so the same bytes do not open there.
    expect((await openPrivateComments(s.client, '22'.repeat(16), [original], s.access(A))).get(id)?.status).not.toBe('open')
  })
  it('a comment cannot be moved to another epoch: its header names the epoch (realm check) and its AEAD binds it', async () => {
    const s = setup(); s.epoch(1, [A, B])
    await s.post(B, 'Epoch one'); const [comment] = await s.page()
    expect(() => privateCommentMessage({ caller: B, noteId, commentId: nextId(), operationId: nextId(), action: { kind: 'add', bodyRevision: '1', epoch: '2', ciphertext: comment.ciphertext } }, '0', NOTES_REALM)).toThrow()
    s.epoch(2, [A, B])
    expect((await openPrivateComments(s.client, noteId, [{ ...comment, epoch: '2' }], s.access(A))).get(comment.id)).toEqual({ status: 'unavailable' })
  })
  it('a reader removed by a Rotate keeps the comments of the epochs they held, and cannot open one posted after their removal', async () => {
    const s = setup(); s.epoch(1, [A, B, C])
    const before = await s.post(B, 'Before the removal')
    s.epoch(2, [A, B]) // the owner removed C: a new key, no envelope for C
    const after = await s.post(B, 'After the removal')
    const forC = await s.read(C), forA = await s.read(A)
    expect(forC.get(before)).toEqual({ status: 'open', body: 'Before the removal', quote: '' }); expect(forC.get(after)).toEqual({ status: 'no-key' })
    expect(forA.get(after)).toMatchObject({ status: 'open', body: 'After the removal' }); expect(forA.get(before)).toMatchObject({ status: 'open' })
    // And C can no longer post (refused before any wallet: no envelope of the current epoch).
    await expect(s.post(C, 'Still here?')).rejects.toMatchObject({ name: 'PrivateNoteNoAccess' }); expect(wallet.send).toHaveBeenCalledTimes(2)
  })
  it('a locked key opens nothing and seals nothing', async () => {
    const s = setup(); s.epoch(1, [A, B]); await s.post(B, 'Kept closed')
    s.phases.set(A, 'locked')
    await expect(s.read(A)).rejects.toMatchObject({ code: 'session' })
    await expect(sealPrivateComment(s.client, s.note(), { id: nextId(), author: A, parent: '', bodyRevision: '1', epoch: '1' }, { body: 'x', quote: '', prefix: '', suffix: '' }, s.access(A))).rejects.toMatchObject({ code: 'session' })
  })
})

describe('encrypted comments: delete, resolve, hide', () => {
  it('the author deletes a historical comment with the key locked (no key needed), and the receipt confirms it', async () => {
    const s = setup(); s.epoch(1, [A, B])
    const id = await s.post(B, 'To delete'); s.epoch(2, [A, B]); s.phases.set(B, 'locked')
    const sheet = await s.run(B, id, { kind: 'delete', revision: '1' }, false)
    expect(sheet.title).toBe('Delete encrypted comment')
    expect(sheet.lines(undefined).find(([label]) => label === 'Storage deposit')?.[1]).toMatch(/returned to you \(about 0\.6 GNOT for a comment of maximum length/)
    expect(s.comments.get(id)).toMatchObject({ deleted: true, body_blob: '' })
    const [intent] = await s.intents.list({ chainId: 'test-chain', realm: commentIntentRealm(NOTES_REALM, noteId), owner: B })
    expect(await recoverPrivateCommentIntent(s.client, s.intents, intent, s.session)).toBe('confirmed')
    await expect(s.request(A, id, { kind: 'delete', revision: '2' })).rejects.toMatchObject({ code: 'stale' })
  })
  it('the owner and a writer resolve; a reader cannot; only the owner hides, and the sheet names the exact target state', async () => {
    const s = setup([B]); s.epoch(1, [A, B, C])
    const id = await s.post(C, 'Thread')
    const resolve = await s.run(B, id, { kind: 'resolve', revision: '1', resolved: true }, false)
    expect(resolve.title).toBe('Resolve encrypted comment'); expect(resolve.lines(undefined)).toContainEqual(['Thread after confirmation', 'Resolved'])
    const reopen = await s.run(A, id, { kind: 'resolve', revision: '2', resolved: false }, false)
    expect(reopen.title).toBe('Reopen encrypted comment'); expect(reopen.prepare(undefined).msgs[0].value.args[3]).toBe('false')
    await expect(s.request(C, id, { kind: 'resolve', revision: '3', resolved: true }, false)).rejects.toMatchObject({ code: 'stale' })
    await expect(s.request(B, id, { kind: 'hide', revision: '3', hidden: true }, false)).rejects.toMatchObject({ code: 'stale' })
    const hide = await s.run(A, id, { kind: 'hide', revision: '3', hidden: true }, false)
    expect(hide.lines(undefined)).toContainEqual(['Visibility after confirmation', 'Hidden'])
    expect((await s.read(A)).get(id)).toBeUndefined() // a hidden comment is not opened
  })
})

describe('encrypted comments: the private-notes gate', () => {
  it('closed: nothing seals, opens or prepares, and no wallet opens', async () => {
    const s = setup(); s.epoch(1, [A, B]); const id = await s.post(B, 'Posted while open'); wallet.send.mockClear()
    gate.open = false
    await expect(s.read(A)).rejects.toMatchObject({ code: 'disabled' })
    await expect(s.post(B, 'Not now')).rejects.toBeInstanceOf(NotesChainError)
    await expect(s.request(B, id, { kind: 'delete', revision: '1' }, false)).rejects.toMatchObject({ code: 'disabled' })
    expect(wallet.send).not.toHaveBeenCalled()
  })
  it('closing while a review waits refuses it before the wallet', async () => {
    const s = setup(); s.epoch(1, [A, B]); const id = await s.post(B, 'Posted'); wallet.send.mockClear()
    const sheet = await s.request(B, id, { kind: 'delete', revision: '1' }, false)
    gate.open = false
    await expect(sheet.send(undefined, async () => {})).rejects.toMatchObject({ code: 'disabled' }); expect(wallet.send).not.toHaveBeenCalled()
  })
})

describe('encrypted comment quotes (M0)', () => {
  // private-small-ops-m0-2026-10-15 rows 7 (279 B: 1,000,000 first / 787,100 same author, 23.0-26.2 M gas) and the
  // 10-08 maxima (5,687 B: up to 1,545,900, 24.7 M; Hide +6,000, Resolve 0, Delete a refund, 13.6 M).
  it('bounded figures cover every measured row, with the 1.2x cap rounded up to 0.1 GNOT', () => {
    expect(encryptedCommentBudget(279)).toEqual({ gasWanted: 61_000_000, estimatedDepositUgnot: '1027900', suggestedCapUgnot: '1300000' })
    expect(encryptedCommentBudget(5687)).toEqual({ gasWanted: 73_000_000, estimatedDepositUgnot: '1568700', suggestedCapUgnot: '1900000' })
    expect(Number(encryptedCommentBudget(279).estimatedDepositUgnot)).toBeGreaterThanOrEqual(1_000_000)
    expect(Number(encryptedCommentBudget(5687).estimatedDepositUgnot)).toBeGreaterThanOrEqual(1_545_900)
    const action = (func: string, args: string[]): AminoMsg => ({ type: 'vm/MsgCall', value: { caller: A, send: '', pkg_path: NOTES_REALM, func, args, max_deposit: '0ugnot' } })
    expect(privateCommentBudget(action('DeleteComment', ['', '', '1', '']))).toEqual({ gasWanted: 60_000_000, estimatedDepositUgnot: '0', suggestedCapUgnot: '100000' })
    expect(privateCommentBudget(action('HideComment', ['', '', '1', 'true', '']))).toEqual({ gasWanted: 60_000_000, estimatedDepositUgnot: '50000', suggestedCapUgnot: '100000' })
  })
  it('a 200 B comment seals to the M0 ciphertext size (279 B)', async () => {
    const s = setup(); s.epoch(1, [A, B])
    const sealed = await sealPrivateComment(s.client, s.note(), { id: nextId(), author: B, parent: '', bodyRevision: '1', epoch: '1' }, { body: 'c'.repeat(200), quote: '', prefix: '', suffix: '' }, s.access(B))
    expect(sealed).toHaveLength(279)
  })
  it('simulation first: a simulated deposit is used (gas never below 60 M), one above the cap refuses, and a failed simulation falls back', async () => {
    const s = setup(); s.epoch(1, [A, B])
    const ciphertext = await sealPrivateComment(s.client, s.note(), { id: '0a'.repeat(16), author: B, parent: '', bodyRevision: '1', epoch: '1' }, { body: 'c'.repeat(200), quote: '', prefix: '', suffix: '' }, s.access(B))
    const message = privateCommentMessage({ caller: B, noteId, commentId: '0a'.repeat(16), operationId: '0b'.repeat(16), action: { kind: 'add', bodyRevision: '1', epoch: '1', ciphertext } }, '1300000', NOTES_REALM)
    const input = { chainId: 'test-chain', message, requestDigest: 'aa'.repeat(32), height: '10' }
    vi.mocked(s.client.simulateRaw).mockResolvedValueOnce(simulated(10_000n, 24_000_000n))
    expect(await privateCommentQuote(s.client, '1300000')(input)).toMatchObject({ source: 'simulation', estimatedDepositUgnot: '1000000', gasWanted: 60_000_000 })
    vi.mocked(s.client.simulateRaw).mockResolvedValueOnce(simulated(0n, 24_000_000n, 'not enough deposit to cover the storage usage: requires 1400000ugnot for 14000 bytes'))
    await expect(privateCommentQuote(s.client, '1300000')(input)).rejects.toBeInstanceOf(PrivateStorageAboveCap)
    expect(await privateCommentQuote(s.client, '1300000')(input)).toMatchObject({ source: 'bounded-estimate', estimatedDepositUgnot: '1027900', gasWanted: 61_000_000 })
  })
})

/** A minimal `sdk.Result`: one deposit event (bytes) and the gas used; or, with `error`, an error and its log. */
function simulated(bytes: bigint, gasUsed: bigint, error?: string): Uint8Array {
  const varint = (value: bigint) => { const out: number[] = []; for (; value > 127n; value >>= 7n) out.push(Number(value & 127n) | 128); out.push(Number(value)); return out }
  const field = (n: number, value: Uint8Array | number[]) => [...varint(BigInt(n << 3 | 2)), ...varint(BigInt(value.length)), ...value]
  const text = (value: string) => [...new TextEncoder().encode(value)]
  const base = error ? [...field(1, field(1, text('/abci.StringError'))), ...field(4, text(error))]
    : field(3, [...field(1, text('/tm.StorageDepositEvent')), ...field(2, [...varint(8n), ...varint(bytes * 2n), ...field(2, text(`${bytes * 100n}ugnot`)), ...field(3, text(NOTES_REALM))])])
  return Uint8Array.from([...field(1, base), ...varint(16n), ...varint(gasUsed * 4n), ...varint(24n), ...varint(gasUsed * 2n)])
}
