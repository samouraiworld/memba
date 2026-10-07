/**
 * The little ABI reading the Safe checks need, by hand and strict: every
 * offset and length is bounds-checked and a malformed answer throws. No EVM
 * library, so these modules stay testable with plain fakes and out of the
 * eager bundle.
 *
 * @module lib/chain/evm/safe/abi
 */
import type { Hex } from "./known"

export class AbiError extends Error {}

const HEX = /^0x(?:[0-9a-fA-F]{2})*$/

/** The bytes of `data` after `0x`, lowercased; throws on anything but whole bytes of hex. */
export function body(data: string): string {
    if (!HEX.test(data)) throw new AbiError("not hex bytes")
    return data.slice(2).toLowerCase()
}

/** 32-byte word `i` of a hex body (no 0x). */
export function word(hex: string, i: number): string {
    const start = i * 64
    if (i < 0 || start + 64 > hex.length) throw new AbiError("read past the end")
    return hex.slice(start, start + 64)
}

export function wordToBigInt(w: string): bigint {
    return BigInt(`0x${w}`)
}

/** A word holding an address: the top 12 bytes must be zero. */
export function wordToAddress(w: string): Hex {
    if (!/^0{24}[0-9a-f]{40}$/.test(w)) throw new AbiError("not an address word")
    return `0x${w.slice(24)}`
}

/** A word used as a byte offset or a length, kept to a safe integer. */
export function wordToIndex(w: string): number {
    const n = wordToBigInt(w)
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new AbiError("offset too large")
    return Number(n)
}

function offsetWord(hex: string, headWord: number): number {
    const offset = wordToIndex(word(hex, headWord))
    if (offset % 32 !== 0) throw new AbiError("unaligned offset")
    return offset / 32
}

/** A dynamic `address[]` whose offset is in head word `headWord`. */
export function readAddressArray(hex: string, headWord: number): Hex[] {
    const at = offsetWord(hex, headWord)
    const length = wordToIndex(word(hex, at))
    if (at + 1 + length > hex.length / 64) throw new AbiError("array past the end")
    return Array.from({ length }, (_, i) => wordToAddress(word(hex, at + 1 + i)))
}

/** Dynamic `bytes` whose offset is in head word `headWord`, as a hex body. */
export function readBytes(hex: string, headWord: number): string {
    const at = offsetWord(hex, headWord)
    const length = wordToIndex(word(hex, at))
    const start = (at + 1) * 64
    if (start + length * 2 > hex.length) throw new AbiError("bytes past the end")
    return hex.slice(start, start + length * 2)
}

/** A dynamic `string` whose offset is in head word `headWord`; refuses invalid UTF-8. */
export function readString(hex: string, headWord: number): string {
    const raw = readBytes(hex, headWord)
    const bytes = new Uint8Array(raw.length / 2)
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16)
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
        throw new AbiError("not UTF-8")
    }
}

export function addressWord(address: string): string {
    return body(address).padStart(64, "0")
}

export function uintWord(n: bigint | number): string {
    return BigInt(n).toString(16).padStart(64, "0")
}

export const ZERO_ADDRESS: Hex = "0x0000000000000000000000000000000000000000"
