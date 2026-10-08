import { ByteReader, concat, equalBytes, NotesCryptoError, requireBytes, requireEpoch, requireGeneration, u8, u32, u64 } from './bytes'
import { WRAP_BYTES } from './wrap'

export interface Recipient { address: Uint8Array; writer: boolean; generation: bigint; publicKeyHash: Uint8Array; wrap: Uint8Array }
export const RECIPIENT_BYTES = 1_299
export const MAX_RECIPIENTS = 32
function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < 20; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}
/** Authenticates no ciphertext: this is the structural gate shared with the realm. */
export function decodeManifest(bytes: Uint8Array, expectedEpoch: number): Recipient[] {
  requireEpoch(expectedEpoch)
  if (bytes.length < 2 || bytes[0] !== 1 || bytes[1] < 1 || bytes[1] > MAX_RECIPIENTS || bytes.length !== 2 + bytes[1] * RECIPIENT_BYTES) throw new NotesCryptoError('format')
  const r = new ByteReader(bytes), output: Recipient[] = []
  r.u8(); const count = r.u8()
  for (let i = 0; i < count; i++) {
    const address = r.take(20), writer = r.u8(), generation = r.u64(), publicKeyHash = r.take(32), wrap = r.take(WRAP_BYTES)
    requireGeneration(generation)
    if (writer > 1 || (i > 0 && compare(output[i - 1].address, address) >= 0) || wrap[0] !== 1 || wrap[1] !== 1 || !equalBytes(wrap.subarray(2, 6), u32(expectedEpoch)) || !equalBytes(wrap.subarray(6, 14), u64(generation)) || !equalBytes(wrap.subarray(14, 46), publicKeyHash)) throw new NotesCryptoError('format')
    output.push({ address, writer: writer === 1, generation, publicKeyHash, wrap })
  }
  r.done(); return output
}
export function encodeManifest(entries: readonly Recipient[], epoch: number): Uint8Array {
  if (entries.length < 1 || entries.length > MAX_RECIPIENTS) throw new NotesCryptoError('format')
  const sorted = [...entries].map(e => {
    requireBytes(e.address, 20); requireBytes(e.publicKeyHash, 32); requireBytes(e.wrap, WRAP_BYTES)
    if (typeof e.writer !== 'boolean') throw new NotesCryptoError('format')
    return e
  }).sort((a, b) => compare(a.address, b.address))
  const bytes = concat(u8(1), u8(sorted.length), ...sorted.map(e => concat(e.address, u8(e.writer ? 1 : 0), u64(e.generation), e.publicKeyHash, e.wrap)))
  decodeManifest(bytes, epoch); return bytes
}
