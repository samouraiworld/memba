/**
 * Strict parsing for answers read from the NFT realms. A malformed answer
 * throws; nothing is coerced or defaulted, so a realm whose contract has moved
 * is reported as an error instead of being rendered as plausible data.
 *
 * @module lib/nft/parse
 */
import { isValidGnoAddressChecksum } from "../dao/address"

/** A SHA-256 digest, as the realms write one: 64 lowercase hex digits. */
export const HASH = /^[0-9a-f]{64}$/

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

export const INT64_MAX = 2n ** 63n - 1n

/** An int64 arrives as a decimal string, so it never loses precision in JSON; none is negative here. */
export function decimal(value: unknown, what: string): bigint {
    if (typeof value !== "string" || !/^(0|[1-9]\d{0,18})$/.test(value) || BigInt(value) > INT64_MAX) throw new Error(`Invalid ${what}`)
    return BigInt(value)
}

/** A fee or a rate the realm writes as "-1" while it is closed or not set: null, never a number. */
export function decimalOrUnset(value: unknown, what: string): bigint | null {
    return value === "-1" ? null : decimal(value, what)
}

/** Token numbers start at 1. */
export function tokenNumber(value: unknown): bigint {
    const number = decimal(value, "token number")
    if (number === 0n) throw new Error("Invalid token number")
    return number
}

/** The chain's one spelling of an address: lowercase bech32 with a valid checksum. */
export function address(value: unknown, what: string): string {
    if (!isValidGnoAddressChecksum(value)) throw new Error(`Invalid ${what}`)
    return value
}

/** An address the realm writes as "" while it is not set. */
export function optionalAddress(value: unknown, what: string): string {
    return value === "" ? "" : address(value, what)
}

/** A ledger sequence number: at most the 20 digits of a uint64. */
export function collectionId(value: unknown): string {
    if (typeof value !== "string" || !/^C[1-9]\d{0,19}$/.test(value)) throw new Error("Invalid collection ID")
    return value
}

/** "ugnot", or the registry key of a GRC20 token. */
export function currencyKey(value: unknown): string {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_./-]{1,100}$/.test(value)) throw new Error("Invalid currency")
    return value
}

export function oneOf<T extends string>(value: unknown, what: string, allowed: readonly T[]): T {
    if (!allowed.includes(value as T)) throw new Error(`Invalid ${what}`)
    return value as T
}
