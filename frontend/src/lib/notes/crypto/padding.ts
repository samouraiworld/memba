import { NotesCryptoError, u32 } from './bytes'

export const MAX_BODY_BYTES = 131_072
export const MAX_TITLE_BYTES = 160
export const MAX_COMMENT_BYTES = 5_392

export function padmeLength(length: number): number {
  if (!Number.isSafeInteger(length) || length < 0 || length > 0xffffffff) throw new NotesCryptoError('format')
  if (length < 2) return length
  const exponent = Math.floor(Math.log2(length))
  const precision = Math.floor(Math.log2(exponent)) + 1
  const step = 2 ** Math.max(0, exponent - precision)
  return Math.ceil(length / step) * step
}
export function pad(plaintext: Uint8Array, limit: number): Uint8Array {
  if (plaintext.length > limit) throw new NotesCryptoError('format')
  const output = new Uint8Array(padmeLength(plaintext.length + 4))
  output.set(u32(plaintext.length)); output.set(plaintext, 4); return output
}
export function unpad(padded: Uint8Array, limit: number): Uint8Array {
  if (padded.length < 4) throw new NotesCryptoError('format')
  const length = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0)
  if (length > limit || length + 4 > padded.length || padmeLength(length + 4) !== padded.length || padded.subarray(length + 4).some(byte => byte !== 0)) throw new NotesCryptoError('format')
  return padded.slice(4, 4 + length)
}
