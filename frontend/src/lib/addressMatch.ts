/**
 * Exact gno address comparison for identity checks.
 *
 * Deciding whether some rendered text refers to the connected user must never
 * use address prefixes or substrings: another account can share any number of
 * leading characters with the user's address.
 *
 * @module lib/addressMatch
 */

/** A full gno bech32 account address (lower- or upper-case). */
const FULL_ADDRESS_RE = /^g1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/i

/** Is `value` (trimmed) a complete gno bech32 account address? */
export function isFullGnoAddress(value: string | null | undefined): boolean {
    return FULL_ADDRESS_RE.test((value || "").trim())
}

/**
 * Are both values the same complete gno address (case-insensitive)?
 * Truncated, padded or otherwise malformed addresses never match.
 */
export function sameFullAddress(a: string | null | undefined, b: string | null | undefined): boolean {
    const x = (a || "").trim()
    const y = (b || "").trim()
    return FULL_ADDRESS_RE.test(x) && FULL_ADDRESS_RE.test(y) && x.toLowerCase() === y.toLowerCase()
}
