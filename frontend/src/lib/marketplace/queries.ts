/**
 * marketplace/queries.ts — ABCI query helpers for marketplace realms.
 *
 * Sprint 6: Provides functions to query marketplace listings, escrow
 * contracts, and service details from on-chain realms.
 */

import { queryRender } from "../dao/shared"
import type { MarketplaceListing, ListingType, ListingStatus } from "./types"

// ── Cache ────────────────────────────────────────────────────

const CACHE_TTL = 60_000 // 1 minute
const cache = new Map<string, { data: unknown; ts: number }>()

function getCached<T>(key: string): T | null {
    const entry = cache.get(key)
    if (!entry) return null
    if (Date.now() - entry.ts > CACHE_TTL) {
        cache.delete(key)
        return null
    }
    return entry.data as T
}

function setCache<T>(key: string, data: T): void {
    cache.set(key, { data, ts: Date.now() })
}

// ── Queries ──────────────────────────────────────────────────

/**
 * Fetch all marketplace listings from a marketplace realm.
 * Parses the Render("") output into MarketplaceListing[].
 *
 * @param rpcUrl - RPC endpoint
 * @param realmPath - Marketplace realm path (e.g., gno.land/r/samcrew/marketplace)
 */
export async function fetchListings(
    rpcUrl: string,
    realmPath: string,
): Promise<MarketplaceListing[]> {
    const cacheKey = `listings_${realmPath}`
    const cached = getCached<MarketplaceListing[]>(cacheKey)
    if (cached) return cached

    try {
        const raw = await queryRender(rpcUrl, realmPath, "")
        if (!raw) return []
        const listings = parseListings(raw)
        setCache(cacheKey, listings)
        return listings
    } catch {
        return []
    }
}

/**
 * Fetch a single listing by ID.
 */
export async function fetchListing(
    rpcUrl: string,
    realmPath: string,
    listingId: string,
): Promise<MarketplaceListing | null> {
    try {
        const raw = await queryRender(rpcUrl, realmPath, `listing/${listingId}`)
        if (!raw || raw.includes("404")) return null
        const listings = parseListings(raw)
        return listings[0] ?? null
    } catch {
        return null
    }
}

// ── Parsers ──────────────────────────────────────────────────

/**
 * Parse marketplace Render() output into listings.
 * Expected format: markdown table with | id | type | title | creator | status | price |
 */
export function parseListings(raw: string): MarketplaceListing[] {
    const listings: MarketplaceListing[] = []
    const lines = raw.split("\n").filter(
        l => l.startsWith("|") && !l.startsWith("| id") && !l.startsWith("|---"),
    )

    for (const line of lines) {
        const cols = line.split("|").map(c => c.trim()).filter(Boolean)
        if (cols.length >= 6) {
            listings.push({
                id: cols[0],
                type: (cols[1] as ListingType) || "service",
                title: cols[2],
                description: "",
                creator: cols[3],
                pricing: {
                    denom: "ugnot",
                    amount: BigInt(cols[5] || "0"),
                    feePercent: 2.5,
                    feeRecipient: "",
                },
                status: (cols[4] as ListingStatus) || "active",
                realmPath: "",
                metadata: {},
                createdAt: 0,
            })
        }
    }

    return listings
}
