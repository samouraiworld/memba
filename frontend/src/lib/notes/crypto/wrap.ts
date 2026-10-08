import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ml_kem768_x25519 as xwing } from '@noble/post-quantum/hybrid.js'
import { isValidGnoAddressChecksum } from '../../dao/address'
import { concat, domain, equalBytes, NotesCryptoError, randomBytes, requireBytes, requireGeneration, text, u8, u32, u64 } from './bytes'
import { epochBytes } from './content'
import type { EpochContext } from './content'

export const WRAP_BYTES = 1_238
export interface ReaderContext extends EpochContext { reader: string; generation: bigint }
function metadata(pk: Uint8Array, c: ReaderContext): { context: Uint8Array; header: Uint8Array } {
  requireBytes(pk, 1216); requireGeneration(c.generation)
  if (!isValidGnoAddressChecksum(c.reader)) throw new NotesCryptoError('format')
  const hash = sha256(pk)
  return { context: concat(domain('wrap'), epochBytes(c), text(c.reader), u64(c.generation), hash), header: concat(u8(1), u8(1), u32(c.epoch), u64(c.generation), hash) }
}
export function wrapForReader(key: Uint8Array, pk: Uint8Array, c: ReaderContext): Uint8Array {
  requireBytes(key, 32)
  const { context, header } = metadata(pk, c), { sharedSecret, cipherText } = xwing.encapsulate(pk)
  const kek = hkdf(sha256, sharedSecret, domain('wrap-kek'), context, 32), nonce = randomBytes(24)
  try { return concat(header, cipherText, nonce, xchacha20poly1305(kek, nonce, concat(context, header, cipherText)).encrypt(key)) }
  finally { sharedSecret.fill(0); kek.fill(0) }
}
export function unwrapForReader(blob: Uint8Array, secretKey: Uint8Array, pk: Uint8Array, c: ReaderContext): Uint8Array {
  const { context, header } = metadata(pk, c)
  requireBytes(secretKey, 32)
  if (blob.length !== WRAP_BYTES || !equalBytes(blob.subarray(0, 46), header)) throw new NotesCryptoError('format')
  let shared: Uint8Array | undefined, kek: Uint8Array | undefined
  try {
    shared = xwing.decapsulate(blob.subarray(46, 1166), secretKey)
    kek = hkdf(sha256, shared, domain('wrap-kek'), context, 32)
    return xchacha20poly1305(kek, blob.subarray(1166, 1190), concat(context, header, blob.subarray(46, 1166))).decrypt(blob.subarray(1190))
  } catch { throw new NotesCryptoError('decrypt') }
  finally { shared?.fill(0); kek?.fill(0) }
}
