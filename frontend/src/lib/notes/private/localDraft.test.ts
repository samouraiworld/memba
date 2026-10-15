import { afterAll, describe, expect, it, vi } from 'vitest'
import { bech32Encode } from '../../dao/realmAddress'
import { identityFromSeed } from '../crypto/identity'
import { NOTES_REALM } from '../chain/__fixtures__/deployment'
import type { NotesScope } from '../drafts'
import { openPrivateDraft, sealPrivateDraft, type PrivateDraftText } from './localDraft'
const owner = bech32Encode('g', new Uint8Array(20).fill(1)), other = bech32Encode('g', new Uint8Array(20).fill(2))
// Ported from the reviewed 10-09 localDraft.test.ts (2399ebef); the scope's realm must be its network's deployment path.
const scope: NotesScope = { chainId: 'gnoland-1', realm: NOTES_REALM, owner, noteId: 'ab'.repeat(16) }
const identity = identityFromSeed(new Uint8Array(32).fill(3)), wrongIdentity = identityFromSeed(new Uint8Array(32).fill(4))
const value: PrivateDraftText = { title: 'Private draft marker', body: 'Private body marker — αβγ', mode: 1, base: { stateRevision: '18446744073709551614', epoch: '4294967295', ownerGeneration: '18446744073709551613', titleRevision: '9007199254740993', bodyRevision: '9007199254740994' } }
const envelope = sealPrivateDraft(scope, 7n, 9n, identity.publicKey, value)
const open = (data = envelope) => openPrivateDraft(scope, 7n, 9n, identity, data)
afterAll(() => { identity.secretKey.fill(0); wrongIdentity.secretKey.fill(0) })
describe('local private draft authenticated binary envelope', () => {
  it('roundtrips complete baseline without plaintext or baseline strings in storage', () => {
    expect(open()).toEqual(value)
    const encoded = Buffer.from(envelope)
    for (const marker of [value.title, value.body, ...Object.values(value.base!)]) expect(encoded.includes(Buffer.from(marker))).toBe(false)
    expect(open().base).not.toBe(value.base)
  })
  it('uses fresh randomized encryption on repeated saves without mutating caller keys or ciphertext', () => {
    const before = identity.secretKey.slice(), original = envelope.slice()
    const second = sealPrivateDraft(scope, 7n, 9n, identity.publicKey, value)
    expect(second).not.toEqual(envelope); expect(open(second)).toEqual(value)
    expect(identity.secretKey).toEqual(before); expect(envelope).toEqual(original)
  })
  it.each([
    { chainId: 'test3' }, { chainId: 'onyx-1' }, { realm: `${NOTES_REALM}/other` }, { realm: 'gno.land/r/samcrew/memba_notes_rc1' }, { owner: other }, { noteId: 'cd'.repeat(16) },
  ])('rejects another partition %o', patch => {
    expect(() => openPrivateDraft({ ...scope, ...patch }, 7n, 9n, identity, envelope)).toThrow()
  })
  it('binds CAS, generation and actual identity keys independently', () => {
    expect(() => openPrivateDraft(scope, 8n, 9n, identity, envelope)).toThrow()
    expect(() => openPrivateDraft(scope, 7n, 10n, identity, envelope)).toThrow()
    expect(() => openPrivateDraft(scope, 7n, 9n, wrongIdentity, envelope)).toThrow()
    expect(() => openPrivateDraft(scope, 7n, 9n, { publicKey: identity.publicKey, secretKey: wrongIdentity.secretKey }, envelope)).toThrow()
  })
  it.each([0, 1, 9, 17, 49, 73, 119, 1239, 1311])('rejects tampering at header/nonce/wrap/cipher offset %i', offset => {
    const changed = envelope.slice(); changed[offset] ^= 1; expect(() => open(changed)).toThrow()
  })
  it('zeroes its fresh data-key buffer on success and validation failure', () => {
    const original = crypto.getRandomValues.bind(crypto), generated: Uint8Array[] = []
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => {
      const result = original(array); if (result instanceof Uint8Array) generated.push(result); return result
    })
    try {
      sealPrivateDraft(scope, 7n, 9n, identity.publicKey, value)
      expect(generated[0]).toHaveLength(32); expect(generated[0].every(byte => byte === 0)).toBe(true)
      generated.length = 0
      expect(() => sealPrivateDraft(scope, 7n, 9n, identity.publicKey, { ...value, body: '\ud800' })).toThrow()
      expect(generated[0]).toHaveLength(32); expect(generated[0].every(byte => byte === 0)).toBe(true)
    } finally { spy.mockRestore() }
  })
  it('rejects truncated, appended and oversized envelopes', () => {
    expect(() => open(envelope.slice(0, -1))).toThrow()
    const appended = new Uint8Array(envelope.length + 1); appended.set(envelope); expect(() => open(appended)).toThrow()
    expect(() => open(new Uint8Array(200000))).toThrow()
  })
  it('roundtrips the exact UTF-8 body/title maxima with and without a baseline', () => {
    for (const base of [undefined, value.base]) {
      const maximum: PrivateDraftText = { title: 'é'.repeat(80), body: '😀'.repeat(32768), mode: 2, ...(base ? { base } : {}) }
      const data = sealPrivateDraft(scope, 1n, 9n, identity.publicKey, maximum)
      expect(openPrivateDraft(scope, 1n, 9n, identity, data)).toEqual(maximum)
    }
  })
  it.each(['', ' title / in progress ', 'x'.repeat(160)])('preserves transient draft title %s before publication validation', title => {
    const draft = { ...value, title }; expect(open(sealPrivateDraft(scope, 7n, 9n, identity.publicKey, draft))).toEqual(draft)
  })
  it.each([{ titleRevision: '8' }, { bodyRevision: '8' }])('rejects impossible field revision above baseline state %o', patch => {
    expect(() => sealPrivateDraft(scope, 7n, 9n, identity.publicKey, { ...value, base: { stateRevision: '7', epoch: '1', ownerGeneration: '1', titleRevision: '1', bodyRevision: '1', ...patch } })).toThrow()
  })
  it.each([{ title: '😀'.repeat(41) }, { title: 'x'.repeat(161) }, { body: '😀'.repeat(32768) + 'a' }, { body: '\ud800' }])('rejects oversize/noncanonical UTF-8 inputs %o', patch => {
    expect(() => sealPrivateDraft(scope, 7n, 9n, identity.publicKey, { ...value, ...patch })).toThrow()
  })
  it('seals only for the network\'s own deployment realm (no default realm)', () => {
    expect(() => sealPrivateDraft({ ...scope, chainId: 'onyx-1' }, 7n, 9n, identity.publicKey, value)).toThrow()
    expect(() => sealPrivateDraft({ ...scope, realm: 'gno.land/r/samcrew/memba_notes_rc1' }, 7n, 9n, identity.publicKey, value)).toThrow()
    const onyx = { ...scope, chainId: 'onyx-1', realm: 'gno.land/r/samcrew/memba_notes_rc1' }
    expect(openPrivateDraft(onyx, 7n, 9n, identity, sealPrivateDraft(onyx, 7n, 9n, identity.publicKey, value))).toEqual(value)
  })
})
