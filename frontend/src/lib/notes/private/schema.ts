import { address, blob, check, decimal, record } from '../chain/schema'
import { equalBytes, u32, u64 } from '../crypto/bytes'

export interface PrivateEpoch { epoch: string; commitment: Uint8Array; revealedKey: Uint8Array }
export interface PrivateWrap { address: string; epoch: string; writer: boolean; generation: string; publicKeyHash: Uint8Array; wrap: Uint8Array }
export function parseEpochPage(value: unknown, expectedEpoch: string): PrivateEpoch {
  decimal(expectedEpoch, 32, true)
  const page = record(value, ['items', 'next_cursor'])
  check(Array.isArray(page.items) && page.items.length === 1 && decimal(page.next_cursor, 32) === expectedEpoch)
  const v = record(page.items[0], ['epoch', 'commitment', 'revealed_key'])
  const epoch = decimal(v.epoch, 32, true), commitment = blob(v.commitment, 32), revealedKey = blob(v.revealed_key, 32)
  check(epoch === expectedEpoch && commitment.length === 32 && (revealedKey.length === 0 || revealedKey.length === 32))
  return { epoch, commitment, revealedKey }
}
export function parseWrap(value: unknown, expectedEpoch: string, expectedAddress: string): PrivateWrap {
  const v = record(value, ['address', 'epoch', 'writer', 'generation', 'public_key_hash', 'wrap'])
  const result = { address: address(v.address), epoch: decimal(v.epoch, 32, true), writer: v.writer as boolean,
    generation: decimal(v.generation, 64, true), publicKeyHash: blob(v.public_key_hash, 32), wrap: blob(v.wrap, 1238) }
  check(result.address === address(expectedAddress) && result.epoch === decimal(expectedEpoch, 32, true) && typeof v.writer === 'boolean'
    && result.publicKeyHash.length === 32 && result.wrap.length === 1238 && result.wrap[0] === 1 && result.wrap[1] === 1
    && equalBytes(result.wrap.subarray(2, 6), u32(Number(result.epoch))) && equalBytes(result.wrap.subarray(6, 14), u64(BigInt(result.generation)))
    && equalBytes(result.wrap.subarray(14, 46), result.publicKeyHash))
  return result
}
export function parseReaders(value: unknown): string[] {
  check(Array.isArray(value) && value.length >= 1 && value.length <= 32)
  const readers = value.map(who => address(who)); check(new Set(readers).size === readers.length); return readers
}
