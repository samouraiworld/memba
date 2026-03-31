/**
 * formatGnot.ts — GNOT display formatting utilities.
 *
 * Sprint 8: Converts between ugnot (smallest unit) and human-readable GNOT.
 * 1 GNOT = 1,000,000 ugnot.
 */

import { UGNOT_PER_GNOT } from "./config"

/**
 * Format a ugnot amount as a human-readable GNOT string.
 *
 * @param ugnot - Amount in ugnot (smallest unit)
 * @param decimals - Decimal places to show (default 2)
 * @returns Formatted string, e.g. "1.50 GNOT"
 *
 * @example
 * formatGnot(1_500_000n) // "1.50 GNOT"
 * formatGnot(500_000n)   // "0.50 GNOT"
 * formatGnot(0n)         // "0.00 GNOT"
 * formatGnot(100n, 6)    // "0.000100 GNOT"
 */
export function formatGnot(ugnot: bigint | number, decimals: number = 2): string {
    const amount = typeof ugnot === "bigint" ? Number(ugnot) : ugnot
    const gnot = amount / UGNOT_PER_GNOT
    return `${gnot.toFixed(decimals)} GNOT`
}

/**
 * Format a ugnot amount as a compact GNOT string (no trailing zeros).
 *
 * @example
 * formatGnotCompact(1_000_000n) // "1 GNOT"
 * formatGnotCompact(1_500_000n) // "1.5 GNOT"
 * formatGnotCompact(100_000n)   // "0.1 GNOT"
 */
export function formatGnotCompact(ugnot: bigint | number): string {
    const amount = typeof ugnot === "bigint" ? Number(ugnot) : ugnot
    const gnot = amount / UGNOT_PER_GNOT
    // Remove trailing zeros but keep at least one decimal if fractional
    const formatted = gnot % 1 === 0 ? String(gnot) : gnot.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")
    return `${formatted} GNOT`
}

/**
 * Parse a GNOT string back to ugnot.
 *
 * @example
 * parseGnot("1.5")     // 1_500_000n
 * parseGnot("0.001")   // 1_000n
 * parseGnot("invalid") // null
 */
export function parseGnot(input: string): bigint | null {
    const cleaned = input.trim().replace(/\s*GNOT\s*$/i, "")
    const num = parseFloat(cleaned)
    if (isNaN(num) || num < 0) return null
    return BigInt(Math.round(num * UGNOT_PER_GNOT))
}
