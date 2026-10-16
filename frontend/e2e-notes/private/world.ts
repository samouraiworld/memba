/**
 * DEV ONLY. The simulated onyx-1 state the private-notes acceptance runs against: fixed test accounts (secp256k1 keys
 * that exist only in this harness), their registered private-notes keys and Notes backups, and one shared private note.
 * Everything is sealed in the page with the production crypto (Argon2id, X-Wing wraps, content AEAD); nothing here
 * reaches a network. Never use these keys anywhere else.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { bech32Encode } from '../../src/lib/dao/realmAddress'
import { arbitrarySignBytes, unlockDocument } from '../../src/lib/notes/crypto/signer'
import { identityFromSeed } from '../../src/lib/notes/crypto/identity'
import { sealBackup } from '../../src/lib/notes/crypto/backup'
import { prepareEncryptedEpoch } from '../../src/lib/notes/private/engine'
import { decodeManifest } from '../../src/lib/notes/crypto/manifest'
import type { ChainKey, ChainNote } from '../../src/lib/notes/chain/schema'

export const CHAIN = 'onyx-1', REALM = 'gno.land/r/samcrew/memba_notes_rc1'
export const NOTE_ID = 'a1'.repeat(16)
/** Plaintext markers: the spec proves they never reach storage and leave the page on a lock. */
export const TITLE = 'Omakase plan PRIVATE_TITLE_7f3', BODY = 'Bluefin first, then **uni**. PRIVATE_BODY_7f3'

interface Account { secret: Uint8Array; publicKey: Uint8Array; address: string }
function account(fill: number): Account {
    const secret = new Uint8Array(32).fill(fill), publicKey = secp256k1.getPublicKey(secret, true)
    return { secret, publicKey, address: bech32Encode('g', ripemd160(sha256(publicKey))) }
}
/** A: owner, set up and holding the shared note. Fresh: no private-notes key yet. B: a reader. C: a member to share with. */
export const accounts = { owner: account(0x11), fresh: account(0x22), reader: account(0x33), newcomer: account(0x44) }
export type AccountName = keyof typeof accounts

/** What Adena's SignArbitrary returns for this account: a deterministic (RFC 6979) ADR-036 signature of the unlock text. */
export function signUnlock(who: Account, signer: string) {
    const document = unlockDocument({ chainId: CHAIN, signer })
    const signature = secp256k1.sign(arbitrarySignBytes(document), who.secret)
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
    return { status: 'success', code: 0, data: { signed: document, signature: { pubKey: { typeUrl: '/tm.PubKeySecp256k1', value: b64(who.publicKey) }, signature: b64(signature) } } }
}

const op = (n: number) => n.toString(16).padStart(2, '0').repeat(16)
const keys = new Map<string, ChainKey>(), backups = new Map<string, unknown>()
const encode64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
async function register(name: AccountName, withBackup: boolean): Promise<Uint8Array> {
    const who = accounts[name], seed = sha256(Uint8Array.from([...who.secret, 1])), identity = identityFromSeed(seed)
    identity.secretKey.fill(0)
    keys.set(who.address, { address: who.address, generation: '1', active: true, publicKey: identity.publicKey, operationId: op(1), height: '5' })
    if (withBackup) {
        // The Standard backup: sealed with exactly the material Memba derives from this account's unlock signature.
        const response = signUnlock(who, who.address), material = Uint8Array.from(atob(response.data.signature.signature), c => c.charCodeAt(0))
        const record = await sealBackup(seed, material, { mode: 'standard', chainId: CHAIN, realm: REALM, address: ripemd160(sha256(who.publicKey)), generation: 1n, publicKeyHash: sha256(identity.publicKey) })
        backups.set(who.address, { mode: 1, suite: 'xwing-v1', generation: '1', revision: '1', public_key_hash: encode64(sha256(identity.publicKey)), op_id: op(1), actor: who.address, height: '5', record: encode64(record) })
    }
    seed.fill(0)
    return identity.publicKey
}

export const world = { keys, backups, note: null as unknown as ChainNote, manifest: new Uint8Array() }
export async function buildWorld(): Promise<void> {
    await register('owner', true)
    await register('reader', true)
    await register('newcomer', false)
    const recipients = [{ key: keys.get(accounts.owner.address)!, writer: true }, { key: keys.get(accounts.reader.address)!, writer: false }]
    const sealed = prepareEncryptedEpoch({ chainId: CHAIN, realm: REALM, noteId: NOTE_ID, epoch: 1, titleRevision: 1n, bodyRevision: 1n, mode: 1, owner: accounts.owner.address, recipients, title: TITLE, body: BODY })
    world.manifest = sealed.manifest
    world.note = { id: NOTE_ID, owner: accounts.owner.address, pendingOwner: '', ownerGeneration: '1', mode: sealed.mode, stateRevision: '3', titleRevision: '1', bodyRevision: '1', epoch: '1',
        title: sealed.title, body: sealed.body, commitment: sealed.commitment, deleted: false, listed: false, createdHeight: '6', operationId: op(2), actor: accounts.owner.address, height: '9', bodyBytes: sealed.body.length }
}
export function wrapFor(who: string): unknown {
    const entry = decodeManifest(world.manifest, 1).find(e => bech32Encode('g', e.address) === who)
    return entry ? { address: who, epoch: '1', writer: entry.writer, generation: '1', public_key_hash: encode64(entry.publicKeyHash), wrap: encode64(entry.wrap) } : null
}
export function readers(): string[] { return decodeManifest(world.manifest, 1).map(e => bech32Encode('g', e.address)) }
export function writers(): string[] { return decodeManifest(world.manifest, 1).filter(e => e.writer).map(e => bech32Encode('g', e.address)).filter(who => who !== world.note.owner) }
