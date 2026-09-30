/**
 * Strict parsing for answers read from the NFT realms. A malformed answer
 * throws; nothing is coerced or defaulted, so a realm whose contract has moved
 * is reported as an error instead of being rendered as plausible data.
 *
 * @module lib/nft/parse
 */
import { isValidGnoAddressChecksum } from "../dao/address"

/** An object carrying exactly `keys`: a missing or an unknown key is a contract change. */
export function record<K extends string>(value: unknown, what: string, keys: readonly K[]): Record<K, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${what}`)
    if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error(`Invalid ${what} fields`)
    return value as Record<K, unknown>
}

export function list(value: unknown, what: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`Invalid ${what}`)
    return value
}

export function text(value: unknown, what: string): string {
    if (typeof value !== "string") throw new Error(`Invalid ${what}`)
    return value
}

export function bool(value: unknown, what: string): boolean {
    if (typeof value !== "boolean") throw new Error(`Invalid ${what}`)
    return value
}

const INT64_MAX = 2n ** 63n - 1n

/** An int64 arrives as a decimal string, so it never loses precision in JSON; none is negative here. */
export function decimal(value: unknown, what: string): bigint {
    if (typeof value !== "string" || !/^(0|[1-9]\d{0,18})$/.test(value) || BigInt(value) > INT64_MAX) throw new Error(`Invalid ${what}`)
    return BigInt(value)
}

/** The chain's one spelling of an address: lowercase bech32 with a valid checksum. */
export function address(value: unknown, what: string): string {
    if (!isValidGnoAddressChecksum(value)) throw new Error(`Invalid ${what}`)
    return value
}

export function oneOf<T extends string>(value: unknown, what: string, allowed: readonly T[]): T {
    if (!allowed.includes(value as T)) throw new Error(`Invalid ${what}`)
    return value as T
}
