import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { isValidGnoAddressChecksum } from '../../dao/address'
import { concat, domain, equalBytes, networkBytes, NotesCryptoError, randomBytes, requireBytes, requireEpoch, requireGeneration, text, u8, u32, u64 } from './bytes'
import type { NetworkContext } from './bytes'
import { MAX_BODY_BYTES, MAX_COMMENT_BYTES, MAX_TITLE_BYTES, pad, padmeLength, unpad } from './padding'

export interface EpochContext extends NetworkContext { noteId: Uint8Array; epoch: number }
interface FieldBase extends EpochContext { fieldRevision: bigint }
export type FieldContext = (FieldBase & { field: 'body' | 'title' }) | (FieldBase & {
  field: 'comment'; commentId: Uint8Array; author: string; parentId: Uint8Array; bodyRevision: bigint
})
const FIELD_IDS = { title: 1, body: 2, comment: 3 } as const
const LIMITS = { title: MAX_TITLE_BYTES, body: MAX_BODY_BYTES, comment: MAX_COMMENT_BYTES } as const

export function epochBytes(c: EpochContext): Uint8Array {
  requireEpoch(c.epoch)
  return concat(networkBytes(c), requireBytes(c.noteId, 16), u32(c.epoch))
}
function header(c: FieldContext): Uint8Array {
  requireGeneration(c.fieldRevision)
  if (!(c.field in FIELD_IDS)) throw new NotesCryptoError('format')
  return concat(u8(1), u8(1), u32(c.epoch), u8(FIELD_IDS[c.field]), u64(c.fieldRevision))
}
function aad(c: FieldContext, h: Uint8Array): Uint8Array {
  let data = concat(domain('content'), epochBytes(c), u8(FIELD_IDS[c.field]), u64(c.fieldRevision))
  if (c.field === 'comment') {
    if (!isValidGnoAddressChecksum(c.author)) throw new NotesCryptoError('format')
    requireGeneration(c.bodyRevision)
    data = concat(data, requireBytes(c.commentId, 16), text(c.author), requireBytes(c.parentId, 16), u64(c.bodyRevision))
  }
  return concat(data, h)
}
export function keyCommitment(key: Uint8Array, c: EpochContext): Uint8Array {
  return sha256(concat(domain('epoch-commitment'), epochBytes(c), requireBytes(key, 32)))
}
function subkey(key: Uint8Array, field: FieldContext['field']): Uint8Array {
  return hkdf(sha256, requireBytes(key, 32), domain('subkey'), text(field), 32)
}
/** Fresh random nonce on every write, including a title-only rename. */
export function sealField(key: Uint8Array, c: FieldContext, plaintext: Uint8Array): Uint8Array {
  const h = header(c), context = aad(c, h), nonce = randomBytes(24), derived = subkey(key, c.field)
  const padded = pad(plaintext, LIMITS[c.field])
  try { return concat(h, nonce, xchacha20poly1305(derived, nonce, context).encrypt(padded)) }
  finally { derived.fill(0); padded.fill(0) }
}
export function openField(key: Uint8Array, c: FieldContext, blob: Uint8Array): Uint8Array {
  const h = header(c), context = aad(c, h)
  if (blob.length < 59 || blob.length > padmeLength(LIMITS[c.field] + 4) + 55 || !equalBytes(blob.subarray(0, 15), h)) throw new NotesCryptoError('format')
  const derived = subkey(key, c.field)
  let padded: Uint8Array | undefined
  try {
    padded = xchacha20poly1305(derived, blob.subarray(15, 39), context).decrypt(blob.subarray(39))
    return unpad(padded, LIMITS[c.field])
  } catch { throw new NotesCryptoError('decrypt') }
  finally { derived.fill(0); padded?.fill(0) }
}
