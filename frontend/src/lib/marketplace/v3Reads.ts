/**
 * v3Reads.ts — structured reads for the v3.1 NFT engine.
 *
 * v3.1 added `GetListingsPage` and `GetOffersForToken`, which return deterministic,
 * pipe-delimited records with FULL addresses — so the frontend reads listings/offers
 * structurally instead of scraping the truncating markdown `Render()` (the W0.2 hazard),
 * and can finally wire the offers loop (accept-offer needs an offers read that never
 * existed before v3.1).
 *
 * Record formats (one per line, from getters.gno):
 *   GetListingsPage   → collectionID|tokenID|seller|price|createdBlk
 *   GetOffersForToken → buyer|amount|createdBlk
 *
 * @module lib/marketplace/v3Reads
 */

import { queryEval } from "../dao/shared"
import { GNO_RPC_URL } from "../config"
import { NFT_MARKETPLACE_V3_PATH, MEMBA_MARKET_CONFIG_PATH, PLATFORM_FEE_BPS_V3 } from "../nftConfig"

/** Max fee bps the DAO can set (memba_market_config.MaxFeeBPS). Reject reads above it. */
const MAX_FEE_BPS = 500

export interface StructuredListing {
    collectionID: string
    tokenId: string
    /** FULL seller address — never the render's truncated value. */
    seller: string
    priceUgnot: number
    createdBlk: number
}

export interface TokenOffer {
    /** FULL buyer address — needed to wire AcceptOffer / ClaimExpiredOffer. */
    buyer: string
    amountUgnot: number
    createdBlk: number
}

/**
 * Unwrap a gno `vm/qeval` string return — `("<content>" string)` — to its content.
 * The getters return multi-line strings; depending on the encoder, embedded newlines
 * arrive either literally or as `\n`, so we normalise both. (The exact on-wire encoding
 * of a multi-line string return is confirmed against the live realm at go-live.)
 */
export function unwrapQevalString(raw: string): string {
    const m = raw.match(/^\(\s*"([\s\S]*)"\s+string\s*\)\s*$/)
    const inner = m ? m[1] : raw
    return inner.replace(/\\n/g, "\n").replace(/\\"/g, '"')
}

/** Parse GetListingsPage output → structured listings. Skips blank/short lines. */
export function parseListingsPage(decoded: string): StructuredListing[] {
    const out: StructuredListing[] = []
    for (const line of decoded.split("\n")) {
        const t = line.trim()
        if (!t) continue
        const p = t.split("|")
        if (p.length < 5) continue
        out.push({
            collectionID: p[0],
            tokenId: p[1],
            seller: p[2],
            priceUgnot: Number(p[3]) || 0,
            createdBlk: Number(p[4]) || 0,
        })
    }
    return out
}

/** Parse GetOffersForToken output → structured offers. Skips blank/short lines. */
export function parseOffersForToken(decoded: string): TokenOffer[] {
    const out: TokenOffer[] = []
    for (const line of decoded.split("\n")) {
        const t = line.trim()
        if (!t) continue
        const p = t.split("|")
        if (p.length < 3) continue
        out.push({
            buyer: p[0],
            amountUgnot: Number(p[1]) || 0,
            createdBlk: Number(p[2]) || 0,
        })
    }
    return out
}

/** Fetch a page of structured listings via `GetListingsPage(offset, limit)`. */
export async function fetchListingsPage(
    offset = 0,
    limit = 100,
    marketPath: string = NFT_MARKETPLACE_V3_PATH,
): Promise<StructuredListing[]> {
    const raw = await queryEval(GNO_RPC_URL, marketPath, `GetListingsPage(${offset}, ${limit})`)
    if (!raw) return []
    return parseListingsPage(unwrapQevalString(raw))
}

/** Parse a `GetFeeBPS` qeval return — `(200 int)` / `(50 int64)` — to a number, or null. */
export function parseFeeBps(raw: string | null): number | null {
    if (!raw) return null
    const m = raw.match(/\((\d+)\s+int(?:64)?\)/)
    return m ? Number(m[1]) : null
}

/**
 * Read the per-lane protocol fee (bps) from memba_market_config so the fee row mirrors
 * the on-chain rate. FAIL-SAFE: falls back to the engine default and ignores any
 * implausible value (>MaxFeeBPS) — the fee row must never be blank or absurd.
 */
export async function fetchLaneFeeBps(
    lane = "nft",
    configPath: string = MEMBA_MARKET_CONFIG_PATH,
): Promise<number> {
    try {
        const raw = await queryEval(GNO_RPC_URL, configPath, `GetFeeBPS(${JSON.stringify(lane)})`)
        const bps = parseFeeBps(raw)
        if (bps !== null && bps >= 0 && bps <= MAX_FEE_BPS) return bps
    } catch {
        /* config realm not live yet, or read failed — fall back */
    }
    return PLATFORM_FEE_BPS_V3
}

/** Fetch a token's active offers via `GetOffersForToken(collectionID, tokenId)`. */
export async function fetchOffersForToken(
    collectionID: string,
    tokenId: string,
    marketPath: string = NFT_MARKETPLACE_V3_PATH,
): Promise<TokenOffer[]> {
    const raw = await queryEval(
        GNO_RPC_URL,
        marketPath,
        `GetOffersForToken(${JSON.stringify(collectionID)}, ${JSON.stringify(tokenId)})`,
    )
    if (!raw) return []
    return parseOffersForToken(unwrapQevalString(raw))
}
