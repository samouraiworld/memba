import { describe, expect, it } from 'vitest'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ml_kem768_x25519 as xwing } from '@noble/post-quantum/hybrid.js'
import { bech32Encode } from '../../dao/realmAddress'
import { concat, domain, randomBytes, u8, u32, u64, utf8 } from './bytes'
import { keyCommitment, openField, sealField } from './content'
import type { FieldContext } from './content'
import { encodeComment, decodeComment } from './comment'
import { decodeManifest, encodeManifest } from './manifest'
import { pad, padmeLength, unpad } from './padding'
import { unwrapForReader, wrapForReader } from './wrap'
import xwingFixture from './__fixtures__/xwing-draft10.json'
import manifestFixture from './__fixtures__/manifest32.json'

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
const unhex = (value: string) => new Uint8Array(value.match(/.{2}/g)!.map(byte => parseInt(byte, 16)))
const key = new Uint8Array(32).fill(51)
const noteId = new Uint8Array(16).fill(7)
const base = { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', noteId, epoch: 2 }
const c: FieldContext = { ...base, field: 'body', fieldRevision: 1n }
const reader = bech32Encode('g', new Uint8Array(20).fill(1))

describe('Notes v1 primitive conformance', () => {
  it.each(xwingFixture.vectors)('matches complete draft-10 public vector seed $seed', v => {
    const keys = xwing.keygen(unhex(v.seed))
    expect(hex(keys.publicKey)).toBe(v.pk); expect(hex(keys.secretKey)).toBe(v.sk)
    const result = xwing.encapsulate(keys.publicKey, unhex(v.eseed))
    expect(hex(result.cipherText)).toBe(v.ct); expect(hex(result.sharedSecret)).toBe(v.ss)
    expect(hex(xwing.decapsulate(result.cipherText, keys.secretKey))).toBe(v.ss)
  })
  it('matches HKDF RFC5869 test case 1', () => {
    const derived = hkdf(sha256, new Uint8Array(22).fill(11), unhex('000102030405060708090a0b0c'), unhex('f0f1f2f3f4f5f6f7f8f9'), 42)
    expect(hex(derived)).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865')
  })
  it('matches XChaCha draft-03 A.3.1 ciphertext and tag', () => {
    const plaintext = utf8("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.")
    const cipher = xchacha20poly1305(unhex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f'), unhex('404142434445464748494a4b4c4d4e4f5051525354555657'), unhex('50515253c0c1c2c3c4c5c6c7'))
    expect(hex(cipher.encrypt(plaintext))).toBe('bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52ec0875924c1c7987947deafd8780acf49')
  })
  it('uses the final domain and rejects unsafe integers', () => {
    expect(new TextDecoder().decode(domain('content'))).toContain('memba-notes/v1/content')
    expect(() => u32(2 ** 32)).toThrow(); expect(() => u64(-1n)).toThrow()
    expect(() => u32(Number.MAX_SAFE_INTEGER + 1)).toThrow()
  })
})

describe('Canonical content and comment encryption', () => {
  it('pads and unpads boundary values canonically', () => {
    for (const n of [0, 1, 100, 160, 1000, 65536, 131071, 131072]) {
      const bytes = new Uint8Array(n).fill(17)
      expect(unpad(pad(bytes, 131072), 131072)).toEqual(bytes)
    }
    expect(padmeLength(131072 + 4)).toBe(135168)
    expect(() => pad(new Uint8Array(131073), 131072)).toThrow()
    expect(() => unpad(concat(u32(1), unhex('aabb')), 10)).toThrow()
    expect(() => unpad(u32(10), 10)).toThrow()
  })
  it('roundtrips the 128KiB body with fresh nonces and preserves caller buffers', () => {
    const bytes = utf8('🍣'.repeat(32768)), originalKey = key.slice(), first = sealField(key, c, bytes)
    expect(first.length).toBe(135223); expect(hex(openField(key, c, first))).toBe(hex(bytes))
    expect(first).not.toEqual(sealField(key, c, bytes)); expect(key).toEqual(originalKey)
    expect(bytes).toEqual(utf8('🍣'.repeat(32768)))
  })
  it('keeps title revision independent of body commits', () => {
    const title: FieldContext = { ...base, field: 'title', fieldRevision: 4n }
    const blob = sealField(key, title, utf8('é'.repeat(80)))
    expect(blob.length).toBe(231)
    sealField(key, { ...c, fieldRevision: 99n }, utf8('edited body'))
    expect(hex(openField(key, title, blob))).toBe(hex(utf8('é'.repeat(80))))
    expect(() => openField(key, { ...title, fieldRevision: 5n }, blob)).toThrow()
  })
  it('rejects replay across contexts and every envelope component', () => {
    const blob = sealField(key, c, utf8('sushi'))
    const replacements: Partial<FieldContext>[] = [{ chainId: 'onyx' }, { realm: base.realm + '2' }, { noteId: randomBytes(16) }, { epoch: 3 }, { field: 'title' }, { fieldRevision: 2n }]
    for (const change of replacements) expect(() => openField(key, { ...c, ...change } as FieldContext, blob)).toThrow()
    for (const offset of [0, 1, 2, 6, 7, 15, 39, blob.length - 1]) {
      const changed = blob.slice(); changed[offset] ^= 1
      expect(() => openField(key, c, changed)).toThrow()
    }
    expect(() => openField(key, c, blob.slice(0, -1))).toThrow()
    expect(() => openField(key, c, concat(blob, u8(0)))).toThrow()
  })
  it('authenticates all comment identifiers and encodes maximum Unicode without JSON expansion', () => {
    const comment: FieldContext = { ...base, field: 'comment', fieldRevision: 1n, commentId: randomBytes(16), author: reader, parentId: new Uint8Array(16), bodyRevision: 1n }
    const payload = { body: '🍣'.repeat(1000), quote: '🍣'.repeat(280), prefix: '🍣'.repeat(32), suffix: '🍣'.repeat(32) }
    const bytes = encodeComment(payload), encrypted = sealField(key, comment, bytes)
    expect(bytes.length).toBe(5392); expect(encrypted.length).toBe(5687)
    expect(decodeComment(openField(key, comment, encrypted))).toEqual(payload)
    for (const change of [{ commentId: randomBytes(16) }, { author: bech32Encode('g', randomBytes(20)) }, { parentId: randomBytes(16) }, { bodyRevision: 2n }]) expect(() => openField(key, { ...comment, ...change }, encrypted)).toThrow()
    expect(() => encodeComment({ ...payload, body: 'a'.repeat(1001) })).toThrow()
    expect(() => encodeComment({ ...payload, body: '\ud800' })).toThrow()
    expect(() => decodeComment(concat(bytes, u8(0)))).toThrow()
    expect(() => decodeComment(u32(0xffffffff))).toThrow()
  })
  it('binds an epoch commitment to its realm, note and epoch', () => {
    expect(keyCommitment(key, base)).toEqual(keyCommitment(key, base))
    for (const change of [{ epoch: 3 }, { noteId: randomBytes(16) }, { realm: base.realm + '2' }]) expect(keyCommitment(key, { ...base, ...change })).not.toEqual(keyCommitment(key, base))
  })
})

describe('Recipient wraps and canonical realm manifest', () => {
  it('roundtrips and rejects wrong keys, identities and envelope fields', () => {
    const identity = xwing.keygen(randomBytes(32)), wrong = xwing.keygen(randomBytes(32))
    const context = { ...base, reader, generation: 1n }
    const wrap = wrapForReader(key, identity.publicKey, context)
    expect(wrap.length).toBe(1238)
    expect(unwrapForReader(wrap, identity.secretKey, identity.publicKey, context)).toEqual(key)
    expect(() => unwrapForReader(wrap, wrong.secretKey, identity.publicKey, context)).toThrow()
    for (const change of [{ chainId: 'onyx' }, { realm: base.realm + '2' }, { noteId: randomBytes(16) }, { epoch: 3 }, { reader: bech32Encode('g', randomBytes(20)) }, { generation: 2n }]) expect(() => unwrapForReader(wrap, identity.secretKey, identity.publicKey, { ...context, ...change })).toThrow()
    for (const offset of [0, 1, 2, 6, 14, 46, 1166, 1190, 1237]) {
      const altered = wrap.slice(); altered[offset] ^= 1
      expect(() => unwrapForReader(altered, identity.secretKey, identity.publicKey, context)).toThrow()
    }
    expect(() => wrapForReader(key, identity.publicKey, { ...context, reader: 'g1invalid' })).toThrow()
  })
  it('agrees with the N0 Gno parser golden and rejects duplicate/truncated/trailing/generation/hash/suite/epoch/writer', () => {
    const bytes = Uint8Array.from(atob(manifestFixture.base64), c => c.charCodeAt(0))
    expect(bytes.length).toBe(41570); expect(hex(sha256(bytes))).toBe(manifestFixture.sha256)
    const entries = decodeManifest(bytes, 2)
    expect(entries).toHaveLength(32); expect(encodeManifest(entries.reverse(), 2)).toEqual(bytes)
    const duplicate = concat(bytes.slice(0, 1301), bytes.slice(2, 1301), bytes.slice(2600))
    for (const invalid of [duplicate, bytes.slice(0, -1), concat(bytes, u8(0))]) expect(() => decodeManifest(invalid, 2)).toThrow()
    for (const offset of [2 + 28, 2 + 29, 2 + 61 + 1, 2 + 61 + 5]) {
      const altered = bytes.slice(); altered[offset] ^= 1
      expect(() => decodeManifest(altered, 2)).toThrow()
    }
    const badWriter = bytes.slice(); badWriter[22] = 2
    expect(() => decodeManifest(badWriter, 2)).toThrow()
    expect(() => encodeManifest(Array(33).fill(entries[0]), 2)).toThrow()
    expect(() => encodeManifest([entries[0], entries[0]], 2)).toThrow()
    expect(() => encodeManifest([{ ...entries[0], generation: 0n }], 2)).toThrow()
  })
})
