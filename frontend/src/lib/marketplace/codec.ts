/**
 * codec.ts — validated decoding of realm reads (marketplace-v2 Phase 2.1).
 *
 * Replaces the audit's fragile "split + blind BigInt()" scraping (tokenOtcApi) with
 * zod-validated decoders that NEVER throw into render. A single malformed row is
 * dropped (partial list beats a crashed lane); catastrophic input returns ok([]) or
 * a typed error. Durable fix (machine-readable JSON reads) is documented as a realm
 * ask in the plan §10; until then these guards contain the fragility.
 *
 * @module lib/marketplace/codec
 */
import { z } from "zod"
import { ok, type Result } from "./result"

/** Decoded OTC listing (moved here so the codec owns the wire shape). */
export interface OtcListing {
    id: string
    seller: string
    symbol: string
    expectedUnitPrice: bigint
    amountAvailable: bigint
}

/** One OTC row after `split("|")`, before BigInt coercion. Digits-only numeric fields. */
const OtcRowSchema = z.object({
    id: z.string().min(1),
    seller: z.string().min(1),
    symbol: z.string().min(1),
    expectedUnitPrice: z.string().regex(/^\d+$/),
    amountAvailable: z.string().regex(/^\d+$/),
})

/** Generic zod decode → Result (never throws). */
export function decodeWith<T>(schema: z.ZodType<T>, value: unknown): Result<T> {
    const parsed = schema.safeParse(value)
    return parsed.success ? ok(parsed.data) : { ok: false, error: parsed.error.message }
}

/**
 * Decode the `GetListingsCSV()` payload: `"ID|Seller|Symbol|Price|Amount,ID2|..."`
 * (Amino-quoted). Malformed rows are skipped; the call never throws.
 */
export function decodeOtcCsv(raw: string): Result<OtcListing[]> {
    const clean = raw.replace(/^"|"$/g, "")
    if (!clean) return ok([])

    const listings: OtcListing[] = []
    for (const part of clean.split(",")) {
        if (!part) continue
        const [id, seller, symbol, expectedUnitPrice, amountAvailable] = part.split("|")
        const row = decodeWith(OtcRowSchema, { id, seller, symbol, expectedUnitPrice, amountAvailable })
        if (!row.ok) continue // drop malformed row, keep the rest
        listings.push({
            id: row.value.id,
            seller: row.value.seller,
            symbol: row.value.symbol,
            expectedUnitPrice: BigInt(row.value.expectedUnitPrice),
            amountAvailable: BigInt(row.value.amountAvailable),
        })
    }
    return ok(listings)
}
