import { describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { bech32Encode } from '../../dao/realmAddress'
import type { NotesReadClient } from '../chain/client'
import type { ChainNote } from '../chain/schema'
import { blob, decodeResponse, encode64 } from '../chain/schema'
import { NOTES_REALM } from '../chain/__fixtures__/deployment'
import { identityFromSeed } from '../crypto/identity'
import { decodeManifest } from '../crypto/manifest'
import { unwrapForReader } from '../crypto/wrap'
import type { NotesIdentityController } from '../identity/controller'
import { noteContext, OpenPrivateNote } from './engine'
import { PrivateNoteNoAccess, readEncryptedNote, readEncryptedTitles } from './reader'
import { parseEpochPage, parseReaders, parseWrap } from './schema'
import { prepareEncryptedEpoch as sealPrivateNote } from './engine'
import keeper from './__fixtures__/keeper-encrypted.json'
import sealed from './__fixtures__/sealed-note.json'

// Ported from the reviewed 10-09 private.test.ts (feat/notes-workspace-integration), reading only: real X-Wing, wraps and
// content AEAD, with the realm taken from the deployment instead of a fixed path.
const owner = bech32Encode('g', new Uint8Array(20).fill(1)), other = bech32Encode('g', new Uint8Array(20).fill(2))
const noteId = '01'.repeat(16), chainId = 'test-chain', realm = NOTES_REALM
function fixture(mode: 0 | 1 | 2 = 0) {
  const identity = identityFromSeed(new Uint8Array(32).fill(7))
  const registry = { address: owner, generation: '1', active: true, publicKey: identity.publicKey, operationId: '02'.repeat(16), height: '1' }
  const input = { chainId, realm, noteId, epoch: 1, titleRevision: 1n, bodyRevision: 1n, mode, owner, recipients: [{ key: registry, writer: true }], title: 'Secret 🐱', body: '# Body' }
  const encrypted = sealPrivateNote(input), recipient = decodeManifest(encrypted.manifest, 1)[0]
  const note: ChainNote = { id: noteId, owner, pendingOwner: '', ownerGeneration: '1', mode, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '1', title: encrypted.title, body: encrypted.body, commitment: encrypted.commitment, deleted: false, listed: false, createdHeight: '1', operationId: '02'.repeat(16), actor: owner, height: '1', bodyBytes: encrypted.body.length }
  const context = noteContext(chainId, realm, note)
  const key = unwrapForReader(recipient.wrap, identity.secretKey, identity.publicKey, { ...context, reader: owner, generation: 1n })
  let phase = 'unlocked', generation = '1'
  const listeners = new Set<() => void>()
  const controller = {
    getSnapshot: () => ({ phase, generation }),
    subscribe: (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb) },
    use: vi.fn(async (fn: (value: typeof identity) => unknown) => fn(identity)),
  } as unknown as NotesIdentityController
  const page = { items: [{ epoch: '1', commitment: encode64(note.commitment), revealed_key: '' }], next_cursor: '1' }
  const wrap: Record<string, unknown> | null = { address: owner, epoch: '1', writer: true, generation: '1', public_key_hash: encode64(sha256(identity.publicKey)), wrap: encode64(recipient.wrap) }
  const client = { chainId, realm, assertCurrent: vi.fn(), note: vi.fn(async () => note), noteMetadata: vi.fn(async () => note), epochMetadataRaw: vi.fn(async () => page), wrapRaw: vi.fn(async (): Promise<unknown> => wrap), readersRaw: vi.fn(async () => [owner]) } as unknown as NotesReadClient
  return { identity, registry, input, encrypted, recipient, note, key, context, controller, client, page, wrap,
    lock: () => { phase = 'locked'; listeners.forEach(fn => fn()) }, unlock: () => { phase = 'unlocked'; listeners.forEach(fn => fn()) }, listenerCount: () => listeners.size, generation: (value: string) => { generation = value },
    clear: () => { key.fill(0); identity.secretKey.fill(0) } }
}
const read = (f: ReturnType<typeof fixture>, signal: AbortSignal) => readEncryptedNote(f.client, noteId, { access: { kind: 'identity', owner, identity: f.controller }, signal })
describe('private epoch engine', () => {
  it('roundtrips actual XWing and content AEAD, and forgets the text on dispose', () => {
    const f = fixture(), view = new OpenPrivateNote(chainId, realm, f.note, f.key, false, () => true)
    try {
      expect(view.text()).toEqual({ title: 'Secret 🐱', body: '# Body' })
      view.dispose(); expect(() => view.text()).toThrow()
    } finally { view.dispose(); f.clear() }
  })
  it('detects a substituted network, realm or field revision', () => {
    const f = fixture()
    try {
      expect(() => new OpenPrivateNote('other-chain', realm, f.note, f.key, false, () => true)).toThrow()
      expect(() => new OpenPrivateNote(chainId, 'gno.land/r/samcrew/memba_notes_rc1', f.note, f.key, false, () => true)).toThrow()
      expect(() => new OpenPrivateNote(chainId, realm, { ...f.note, titleRevision: '2' }, f.key, false, () => true)).toThrow()
      expect(() => new OpenPrivateNote(chainId, realm, f.note, new Uint8Array(32), false, () => true)).toThrow()
    } finally { f.clear() }
  })
  it('opens the sealed fixture from its stored bytes, for the owner and for a reader', () => {
    const note: ChainNote = { id: sealed.noteId, owner: sealed.owner, pendingOwner: '', ownerGeneration: '1', mode: 1, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '1',
      title: blob(sealed.titleBase64, 231), body: blob(sealed.bodyBase64, 135223), commitment: blob(sealed.commitmentBase64, 32), deleted: false, listed: false, createdHeight: '1', operationId: '02'.repeat(16), actor: sealed.owner, height: '1' }
    const context = noteContext(sealed.chainId, sealed.realm, note)
    for (const [who, seed, wrap] of [[sealed.owner, sealed.ownerSeedHex, sealed.ownerWrapBase64], [sealed.reader, sealed.readerSeedHex, sealed.readerWrapBase64]]) {
      const identity = identityFromSeed(hexToBytes(seed))
      const key = unwrapForReader(blob(wrap, 1238), identity.secretKey, identity.publicKey, { ...context, reader: who, generation: 1n })
      const view = new OpenPrivateNote(sealed.chainId, sealed.realm, note, key, false, () => true)
      expect(view.text()).toEqual({ title: sealed.title, body: sealed.body }); view.dispose(); key.fill(0)
      // The reader's envelope does not open with the owner's key, and the other way round.
      const wrong = identityFromSeed(hexToBytes(seed === sealed.ownerSeedHex ? sealed.readerSeedHex : sealed.ownerSeedHex))
      expect(() => unwrapForReader(blob(wrap, 1238), wrong.secretKey, identity.publicKey, { ...context, reader: who, generation: 1n })).toThrow()
    }
  })
  it('re-seals the fixture context with the ported sealer: same headers, sizes and envelope bindings, and both open', () => {
    // sealed-note.json stays the cross-version vector: made by the 10-09 format, opened by today's reader, matched by today's sealer.
    const owner = identityFromSeed(hexToBytes(sealed.ownerSeedHex)), reader = identityFromSeed(hexToBytes(sealed.readerSeedHex))
    const keys = [[sealed.owner, owner], [sealed.reader, reader]] as const
    const fresh = sealPrivateNote({ chainId: sealed.chainId, realm: sealed.realm, noteId: sealed.noteId, epoch: 1, titleRevision: 1n, bodyRevision: 1n, mode: 1, owner: sealed.owner,
      recipients: keys.map(([address, identity], i) => ({ key: { address, generation: '1', active: true, publicKey: identity.publicKey, operationId: '02'.repeat(16), height: '1' }, writer: i === 0 })),
      title: sealed.title, body: sealed.body })
    for (const [value, golden] of [[fresh.title, blob(sealed.titleBase64, 231)], [fresh.body, blob(sealed.bodyBase64, 135223)]]) {
      expect(value.length).toBe(golden.length); expect(value.subarray(0, 15)).toEqual(golden.subarray(0, 15)); expect(value).not.toEqual(golden)
    }
    const entries = decodeManifest(fresh.manifest, 1)
    expect(entries.map(entry => [bech32Encode('g', entry.address), entry.generation, entry.writer])).toEqual([[sealed.owner, 1n, true], [sealed.reader, 1n, false]])
    for (const [i, golden] of [sealed.ownerWrapBase64, sealed.readerWrapBase64].entries()) expect(entries[i].wrap.subarray(0, 46)).toEqual(blob(golden, 1238).subarray(0, 46))
    const note: ChainNote = { id: sealed.noteId, owner: sealed.owner, pendingOwner: '', ownerGeneration: '1', mode: 1, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '1',
      title: fresh.title, body: fresh.body, commitment: fresh.commitment, deleted: false, listed: false, createdHeight: '1', operationId: '02'.repeat(16), actor: sealed.owner, height: '1' }
    const context = noteContext(sealed.chainId, sealed.realm, note)
    for (const [i, [who, identity]] of keys.entries()) {
      const key = unwrapForReader(entries[i].wrap, identity.secretKey, identity.publicKey, { ...context, reader: who, generation: 1n })
      const view = new OpenPrivateNote(sealed.chainId, sealed.realm, note, key, false, () => true)
      expect(view.text()).toEqual({ title: sealed.title, body: sealed.body }); view.dispose(); key.fill(0)
    }
    owner.secretKey.fill(0); reader.secretKey.fill(0)
  })
})
describe('private read lifetime', () => {
  it('uses the current identity and wipes the handle on lock and abort', async () => {
    const f = fixture(), abort = new AbortController()
    try {
      const view = await read(f, abort.signal)
      expect(view.text().body).toBe('# Body'); expect(f.controller.use).toHaveBeenCalledOnce()
      f.lock(); expect(() => view.text()).toThrow()
    } finally { abort.abort(); f.clear() }
    const g = fixture(), signal = new AbortController()
    try {
      const view = await read(g, signal.signal)
      signal.abort(); expect(() => view.text()).toThrow()
    } finally { signal.abort(); g.clear() }
  })
  it('reads a note shared with this account (mode 1) without any write capability', async () => {
    const f = fixture(1), abort = new AbortController()
    f.note.owner = other; f.wrap!.writer = false
    try {
      const view = await read(f, abort.signal)
      expect(view.text()).toEqual({ title: 'Secret 🐱', body: '# Body' }); expect(view.exposed).toBe(false)
      expect('sealChanges' in view).toBe(false); view.dispose()
    } finally { abort.abort(); f.clear() }
  })
  it('says no access, before any key use, when this account has no envelope or one for another key', async () => {
    const f = fixture(1), abort = new AbortController()
    try {
      vi.mocked(f.client.wrapRaw).mockResolvedValueOnce(null)
      await expect(read(f, abort.signal)).rejects.toMatchObject({ name: 'PrivateNoteNoAccess', reason: 'none' })
      f.generation('2')
      await expect(read(f, abort.signal)).rejects.toMatchObject({ reason: 'other-key' })
      expect(f.controller.use).not.toHaveBeenCalled(); f.generation('1')
      // Same generation, another public key (re-keyed outside Memba): refused inside the key use, nothing unwrapped.
      const stranger = identityFromSeed(new Uint8Array(32).fill(9))
      vi.mocked(f.controller.use).mockImplementationOnce(async fn => fn(stranger as never))
      await expect(read(f, abort.signal)).rejects.toBeInstanceOf(PrivateNoteNoAccess)
    } finally { abort.abort(); f.clear() }
  })
  it('rejects changed revisions, old identity generations, and a lock during unwrap', async () => {
    const f = fixture(), abort = new AbortController()
    try {
      vi.mocked(f.client.noteMetadata).mockResolvedValueOnce({ ...f.note, stateRevision: '2' })
      await expect(read(f, abort.signal)).rejects.toThrow('stale')
      f.generation('2'); await expect(read(f, abort.signal)).rejects.toThrow(); f.generation('1')
      vi.mocked(f.controller.use).mockImplementationOnce(async fn => { await fn(f.identity); f.lock(); throw new Error('locked') })
      await expect(read(f, abort.signal)).rejects.toThrow('locked')
    } finally { abort.abort(); f.clear() }
  })
  it('irreversibly invalidates an in-flight read when an identity locks then unlocks before RPC returns', async () => {
    const f = fixture(), abort = new AbortController()
    let resolve!: (note: ChainNote) => void
    vi.mocked(f.client.note).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    try {
      const pending = read(f, abort.signal)
      expect(f.listenerCount()).toBe(1)
      f.lock(); f.unlock(); resolve(f.note)
      await expect(pending).rejects.toThrow('session')
      expect(f.controller.use).not.toHaveBeenCalled(); expect(f.listenerCount()).toBe(0)
      const fresh = await read(f, abort.signal)
      expect(fresh.text().title).toBe('Secret 🐱'); fresh.dispose(); expect(f.listenerCount()).toBe(0)
    } finally { abort.abort(); f.clear() }
  })
  it('opens listed titles in one key use; what this key cannot open stays null', async () => {
    const f = fixture(1), abort = new AbortController()
    const second = { ...f.note, id: '02'.repeat(16) }, gone = { ...f.note, id: '03'.repeat(16) }
    vi.mocked(f.client.wrapRaw).mockImplementation(async (id: string) => id === gone.id ? null : f.wrap)
    try {
      const titles = await readEncryptedTitles(f.client, [f.note, second, gone], { owner, identity: f.controller, signal: abort.signal })
      // `second` reuses the first note's ciphertext under another ID: its binding fails, so it is not opened.
      expect([...titles]).toEqual([[noteId, 'Secret 🐱'], [second.id, null], [gone.id, null]])
      expect(f.controller.use).toHaveBeenCalledOnce()
      f.lock()
      await expect(readEncryptedTitles(f.client, [f.note], { owner, identity: f.controller, signal: abort.signal })).rejects.toThrow('session')
    } finally { abort.abort(); f.clear() }
  })
})
describe('bounded private getter schemas', () => {
  it('parses actual keeper wrap/readers and epoch metadata without manifest', () => {
    const wrap = decodeResponse(keeper.wrap) as { address: string }, parsed = parseWrap(wrap, '1', wrap.address)
    expect(parsed.wrap).toHaveLength(1238); expect(parseReaders(decodeResponse(keeper.readers))).toHaveLength(2)
    const raw = decodeResponse(keeper.epoch) as Record<string, unknown>
    const item = { epoch: raw.epoch, commitment: raw.commitment, revealed_key: raw.revealed_key }
    expect(parseEpochPage({ items: [item], next_cursor: '1' }, '1').commitment).toHaveLength(32)
    expect(() => parseEpochPage({ items: [raw], next_cursor: '1' }, '1')).toThrow()
    expect(() => parseWrap({ ...wrap, generation: '2' }, '1', wrap.address)).toThrow()
    expect(() => parseReaders([owner, owner])).toThrow()
  })
})
