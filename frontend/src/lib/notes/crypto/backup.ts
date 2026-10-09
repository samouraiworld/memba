import { argon2idAsync } from '@noble/hashes/argon2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { ByteReader, concat, domain, equalBytes, networkBytes, NotesCryptoError, randomBytes, requireBytes, requireGeneration, u8, u32, u64, utf8 } from './bytes'
import type { NetworkContext } from './bytes'
import { identityFromSeed, verifiedIdentity } from './identity'

export type BackupMode = 'standard' | 'vault'
export interface BackupBinding extends NetworkContext {
  mode: BackupMode; address: Uint8Array; generation: bigint; publicKeyHash: Uint8Array
}
interface BackupHeader extends BackupBinding { salt: Uint8Array }
export interface ParsedBackup { binding: BackupBinding; salt: Uint8Array; header: Uint8Array; nonce: Uint8Array; ciphertext: Uint8Array }
export const MAX_BACKUP_BYTES = 365
const MAGIC = utf8('MNKB')
let derivingRecovery = false

function encodeHeader(c: BackupHeader): Uint8Array {
  requireGeneration(c.generation)
  if (c.mode !== 'standard' && c.mode !== 'vault') throw new NotesCryptoError('format')
  const vault = c.mode === 'vault'
  return concat(MAGIC, u8(1), u8(1), u8(vault ? 2 : 1), u8(vault ? 2 : 1), u32(vault ? 65536 : 0), u32(vault ? 3 : 0), u8(vault ? 1 : 0), requireBytes(c.salt, 16), networkBytes(c), requireBytes(c.address, 20), u64(c.generation), requireBytes(c.publicKeyHash, 32))
}
export function parseBackup(record: Uint8Array): ParsedBackup {
  if (!(record instanceof Uint8Array) || record.length < 185 || record.length > MAX_BACKUP_BYTES) throw new NotesCryptoError('format')
  const bytes = record.slice(), r = new ByteReader(bytes)
  if (!equalBytes(r.take(4), MAGIC) || r.u8() !== 1 || r.u8() !== 1) throw new NotesCryptoError('format')
  const mode = r.u8(), kdf = r.u8(), memory = r.u32(), passes = r.u32(), lanes = r.u8()
  // Exact profiles, checked before any Argon2 allocation. Unknown versions do not fall back.
  if (!((mode === 1 && kdf === 1 && memory === 0 && passes === 0 && lanes === 0) || (mode === 2 && kdf === 2 && memory === 65536 && passes === 3 && lanes === 1))) throw new NotesCryptoError('format')
  const salt = r.take(16)
  const binding: BackupBinding = { mode: mode === 1 ? 'standard' : 'vault', chainId: r.ascii(64), realm: r.ascii(128), address: r.take(20), generation: r.u64(), publicKeyHash: r.take(32) }
  const header = encodeHeader({ ...binding, salt }), nonce = r.take(24), ciphertext = r.take(48)
  r.done()
  if (!equalBytes(header, bytes.subarray(0, header.length))) throw new NotesCryptoError('format')
  return { binding, salt, header, nonce, ciphertext }
}
function checkBinding(actual: BackupBinding, expected: BackupBinding): void {
  if (actual.mode !== expected.mode || actual.chainId !== expected.chainId || actual.realm !== expected.realm || actual.generation !== expected.generation || !equalBytes(actual.address, expected.address) || !equalBytes(actual.publicKeyHash, expected.publicKeyHash)) throw new NotesCryptoError('identity')
}
function snapshot(c: BackupBinding): BackupBinding {
  return { ...c, address: c.address.slice(), publicKeyHash: c.publicKeyHash.slice() }
}
async function derive(material: Uint8Array, c: BackupHeader): Promise<Uint8Array> {
  const header = encodeHeader(c), salt = c.salt.slice()
  const secret = requireBytes(material, c.mode === 'standard' ? 64 : 32).slice()
  if (c.mode === 'standard') {
    try { return hkdf(sha256, secret, salt, concat(domain('backup-record'), header), 32) }
    finally { secret.fill(0) }
  }
  if (derivingRecovery) { secret.fill(0); throw new NotesCryptoError('busy') }
  derivingRecovery = true
  let raw: Uint8Array | undefined
  try {
    raw = await argon2idAsync(secret, salt, { m: 65536, t: 3, p: 1, dkLen: 32 })
    return hkdf(sha256, raw, domain('backup-record'), header, 32)
  } finally { raw?.fill(0); secret.fill(0); derivingRecovery = false }
}
/** Standard material is verified r||lowS(s); Vault material is the decoded 256-bit recovery code. */
export async function sealBackup(seed: Uint8Array, material: Uint8Array, expected: BackupBinding): Promise<Uint8Array> {
  const c = { ...snapshot(expected), salt: randomBytes(16) }, header = encodeHeader(c)
  const seedCopy = requireBytes(seed, 32).slice()
  let kek: Uint8Array | undefined
  try {
    const identity = identityFromSeed(seedCopy)
    const matches = equalBytes(sha256(identity.publicKey), c.publicKeyHash)
    identity.secretKey.fill(0)
    if (!matches) throw new NotesCryptoError('identity')
    kek = await derive(material, c)
    const nonce = randomBytes(24)
    return concat(header, nonce, xchacha20poly1305(kek, nonce, concat(domain('backup-record'), header)).encrypt(seedCopy))
  } finally { seedCopy.fill(0); kek?.fill(0) }
}
export async function openBackup(record: Uint8Array, material: Uint8Array, expected: BackupBinding): Promise<Uint8Array> {
  const parsed = parseBackup(record), c = snapshot(expected)
  checkBinding(parsed.binding, c)
  const kek = await derive(material, { ...parsed.binding, salt: parsed.salt })
  try { return xchacha20poly1305(kek, parsed.nonce, concat(domain('backup-record'), parsed.header)).decrypt(parsed.ciphertext) }
  catch { throw new NotesCryptoError('decrypt') }
  finally { kek.fill(0) }
}
/** Fails closed against the requested registry generation; never creates or registers a replacement. */
export async function recoverIdentity(record: Uint8Array, material: Uint8Array, expected: BackupBinding, registeredPublicKey: Uint8Array): Promise<Uint8Array> {
  const pk = requireBytes(registeredPublicKey, 1216).slice()
  if (!equalBytes(sha256(pk), expected.publicKeyHash)) throw new NotesCryptoError('identity')
  const seed = await openBackup(record, material, expected)
  try {
    const identity = verifiedIdentity(seed, pk)
    identity.secretKey.fill(0)
    return seed
  } catch (error) { seed.fill(0); throw error }
}
