/** Canonical encodings for Notes v1. No implicit string concatenation in authenticated data. */
export class NotesCryptoError extends Error {
  constructor(readonly code: 'format' | 'decrypt' | 'identity' | 'signature' | 'busy' | 'wallet') {
    super(`Notes crypto: ${code}`)
    this.name = 'NotesCryptoError'
  }
}

export function requireBytes(value: Uint8Array, length: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== length) throw new NotesCryptoError('format')
  return value
}
export function concat(...values: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(values.reduce((n, v) => n + v.length, 0))
  let offset = 0
  for (const value of values) { output.set(value, offset); offset += value.length }
  return output
}
export function uint(value: number | bigint, size: 1 | 4 | 8): Uint8Array {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new NotesCryptoError('format')
  const n = BigInt(value)
  if (n < 0n || n >= (1n << BigInt(size * 8))) throw new NotesCryptoError('format')
  const output = new Uint8Array(size)
  let rest = n
  for (let i = size - 1; i >= 0; i--) { output[i] = Number(rest & 255n); rest >>= 8n }
  return output
}
export const u8 = (value: number): Uint8Array => uint(value, 1)
export const u32 = (value: number): Uint8Array => uint(value, 4)
export const u64 = (value: bigint): Uint8Array => uint(value, 8)
export const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value)
export const text = (value: string): Uint8Array => { const b = utf8(value); return concat(u32(b.length), b) }
export const domain = (label: string): Uint8Array => text(`memba-notes/v1/${label}`)
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}
export function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length))
}
export function asciiText(value: string, max: number): Uint8Array {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || !/^[a-zA-Z0-9._/-]+$/.test(value)) throw new NotesCryptoError('format')
  return text(value)
}
export interface NetworkContext { chainId: string; realm: string }
export function networkBytes(c: NetworkContext): Uint8Array {
  if (!/^gno\.land\/r\/[a-zA-Z0-9_]+(?:\/[a-zA-Z0-9_]+)*$/.test(c.realm)) throw new NotesCryptoError('format')
  return concat(asciiText(c.chainId, 64), asciiText(c.realm, 128))
}
export function requireEpoch(epoch: number): void {
  if (!Number.isInteger(epoch) || epoch < 1 || epoch > 0xffffffff) throw new NotesCryptoError('format')
}
export function requireGeneration(generation: bigint): void {
  if (typeof generation !== 'bigint' || generation < 1n || generation > 0xffffffffffffffffn) throw new NotesCryptoError('format')
}
export class ByteReader {
  private offset = 0
  constructor(private readonly bytes: Uint8Array) {}
  take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) throw new NotesCryptoError('format')
    const output = this.bytes.slice(this.offset, this.offset + length); this.offset += length; return output
  }
  u8(): number { return this.take(1)[0] }
  u32(): number { return new DataView(this.take(4).buffer).getUint32(0) }
  u64(): bigint { return new DataView(this.take(8).buffer).getBigUint64(0) }
  ascii(max: number): string {
    const length = this.u32()
    if (length < 1 || length > max) throw new NotesCryptoError('format')
    const bytes = this.take(length)
    if (bytes.some(byte => byte > 127)) throw new NotesCryptoError('format')
    const value = new TextDecoder().decode(bytes); asciiText(value, max); return value
  }
  done(): void { if (this.offset !== this.bytes.length) throw new NotesCryptoError('format') }
}
