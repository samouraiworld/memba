import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { NotesIdentity } from '../crypto/identity'
import { ByteReader, concat, domain, equalBytes, networkBytes, randomBytes, requireGeneration, text, u8, u32, u64 } from '../crypto/bytes'
import { pad, padmeLength, unpad } from '../crypto/padding'
import { wrapForReader, unwrapForReader } from '../crypto/wrap'
import type { DraftBase, NotesScope } from '../drafts'
import { address, check, decimal, id, publicText, realmPath } from '../chain/schema'
import { deploymentRealm } from '../config'
import { encodePrivateText } from './engine'

// Ported from the reviewed 10-09 localDraft.ts (2399ebef). Only the realm changed: the scope's realm must be the
// network's own deployment path (there is no default realm); the AAD and the wrap bind `<that realm>/local_drafts`.
export interface PrivateDraftText { title: string; body: string; mode: 0 | 1 | 2; base?: DraftBase }
const MAX_PLAIN = 131072 + 160 + 51
const HEADER_SIZE = 1 + 8 + 8 + 32 + 24
/** Unauthenticated routing hint only. Call openPrivateDraft before trusting any header value. */
export function parsePrivateDraftHeader(envelope: Uint8Array): { generation: bigint; revision: bigint; publicKeyHash: Uint8Array } {
    check(envelope instanceof Uint8Array && envelope.length >= HEADER_SIZE + 1238 + 20 && envelope.length <= HEADER_SIZE + 1238 + padmeLength(MAX_PLAIN + 4) + 16)
    const reader = new ByteReader(envelope); check(reader.u8() === 1)
    const generation = reader.u64(), revision = reader.u64(), publicKeyHash = reader.take(32)
    requireGeneration(generation); requireGeneration(revision)
    return { generation, revision, publicKeyHash }
}
function context(scope: NotesScope, revision: bigint, generation: bigint, publicKey: Uint8Array) {
    check(realmPath(scope.realm) === deploymentRealm(scope.chainId) && publicKey.length === 1216)
    address(scope.owner); requireGeneration(revision); requireGeneration(generation)
    const network = { chainId: scope.chainId, realm: `${scope.realm}/local_drafts` }, noteId = hexToBytes(id(scope.noteId)), hash = sha256(publicKey)
    return { wrap: { ...network, noteId, epoch: 1, reader: scope.owner, generation }, hash,
        aad: concat(domain('local-draft'), networkBytes(network), text(scope.owner), noteId, u64(revision), u64(generation), hash) }
}
function baseBytes(base?: DraftBase): Uint8Array {
    if (!base) return u8(0)
    const values = [base.stateRevision, base.epoch, base.ownerGeneration, base.titleRevision, base.bodyRevision]
    values.forEach(value => decimal(value, 64, true)); decimal(base.epoch, 32, true)
    check(BigInt(base.titleRevision) <= BigInt(base.stateRevision) && BigInt(base.bodyRevision) <= BigInt(base.stateRevision))
    return concat(u8(1), ...values.map(value => u64(BigInt(value))))
}
/** Every save uses a fresh data key. The complete baseline is authenticated and encrypted. */
export function sealPrivateDraft(scope: NotesScope, revision: bigint, generation: bigint, publicKey: Uint8Array, value: PrivateDraftText): Uint8Array {
    check(value.mode === 0 || value.mode === 1 || value.mode === 2)
    const c = context(scope, revision, generation, publicKey), key = randomBytes(32), nonce = randomBytes(24)
    let title: Uint8Array | undefined, body: Uint8Array | undefined, plain: Uint8Array | undefined, padded: Uint8Array | undefined
    try {
        title = encodePrivateText(value.title); check(title.length <= 160); body = encodePrivateText(value.body)
        plain = concat(u8(1), u8(value.mode), baseBytes(value.base), u32(title.length), title, u32(body.length), body)
        padded = pad(plain, MAX_PLAIN)
        const wrap = wrapForReader(key, publicKey, c.wrap)
        return concat(u8(1), u64(generation), u64(revision), c.hash, nonce, wrap, xchacha20poly1305(key, nonce, c.aad).encrypt(padded))
    } finally { key.fill(0); title?.fill(0); body?.fill(0); plain?.fill(0); padded?.fill(0) }
}
/** The caller supplies its independently stored scope and CAS revision; no envelope redirect is trusted. */
export function openPrivateDraft(scope: NotesScope, revision: bigint, generation: bigint, identity: NotesIdentity, envelope: Uint8Array): PrivateDraftText {
    check(envelope instanceof Uint8Array && envelope.length >= HEADER_SIZE + 1238 + 20 && envelope.length <= HEADER_SIZE + 1238 + padmeLength(MAX_PLAIN + 4) + 16)
    const c = context(scope, revision, generation, identity.publicKey), reader = new ByteReader(envelope)
    check(reader.u8() === 1 && reader.u64() === generation && reader.u64() === revision && equalBytes(reader.take(32), c.hash))
    const nonce = reader.take(24), wrap = reader.take(1238), ciphertext = reader.take(envelope.length - HEADER_SIZE - 1238); reader.done()
    const key = unwrapForReader(wrap, identity.secretKey, identity.publicKey, c.wrap)
    let padded: Uint8Array | undefined, plain: Uint8Array | undefined, title: Uint8Array | undefined, body: Uint8Array | undefined
    try {
        padded = xchacha20poly1305(key, nonce, c.aad).decrypt(ciphertext); plain = unpad(padded, MAX_PLAIN)
        const r = new ByteReader(plain); check(r.u8() === 1)
        const mode = r.u8(); check(mode === 0 || mode === 1 || mode === 2)
        const hasBase = r.u8(); check(hasBase === 0 || hasBase === 1)
        const base = hasBase ? { stateRevision: String(r.u64()), epoch: String(r.u64()), ownerGeneration: String(r.u64()), titleRevision: String(r.u64()), bodyRevision: String(r.u64()) } : undefined
        baseBytes(base)
        const titleLength = r.u32(); check(titleLength <= 160); title = r.take(titleLength)
        const bodyLength = r.u32(); check(bodyLength <= 131072); body = r.take(bodyLength); r.done()
        return { title: publicText(title), body: publicText(body), mode: mode as 0 | 1 | 2, ...(base ? { base } : {}) }
    } finally { key.fill(0); padded?.fill(0); plain?.fill(0); title?.fill(0); body?.fill(0) }
}
