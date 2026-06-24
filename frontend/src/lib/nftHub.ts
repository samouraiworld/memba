/**
 * nftHub.ts — data-aggregation layer for the NFT discovery hub (/nft).
 *
 * Pure data module: no React, no JSX, no direct on-chain calls.
 * Composes existing reads from launchpadReads + nftApi.
 *
 * Breadth cap:
 *   fetchVerifiedCollections caps the list at MAX_COLLECTIONS (100 by default,
 *   overridable via the `limit` param).
 *   fetchRecentActivity caps per-collection items at DEFAULT_PER_COLLECTION (20),
 *   overridable via `perCollection`.
 *   Both caps are surfaced via console.info so callers know the scope.
 */

import { fetchCollectionList, isCollectionVerified } from "./launchpadReads"
import { fetchNFTCollection, fetchNFTActivity } from "./nftApi"
import type { NFTActivityItem } from "./nftApi"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HubCollection {
    id: string
    name: string
    creator: string
    slug: string
    verified: boolean
    floorUgnot: bigint
    volumeUgnot: bigint
}

// ---------------------------------------------------------------------------
// Internal constants (caps)
// ---------------------------------------------------------------------------

/** Default maximum number of collections to enrich + return. */
const MAX_COLLECTIONS = 100

/** Default per-collection activity item limit forwarded to fetchNFTActivity. */
const DEFAULT_PER_COLLECTION = 20

// ---------------------------------------------------------------------------
// fetchVerifiedCollections
// ---------------------------------------------------------------------------

/**
 * Return all collections (up to `limit`) enriched with:
 *   - `verified` — whether the collection carries the curated verified badge
 *   - `floorUgnot` / `volumeUgnot` — from market stats (0n when unavailable)
 *
 * Returns ALL collections (both verified and unverified) so the hub can
 * display the full catalogue and surface the verified flag as a filter/badge.
 *
 * Stat + verified checks are parallelised per collection via Promise.all.
 */
export async function fetchVerifiedCollections(limit = MAX_COLLECTIONS): Promise<HubCollection[]> {
    const all = await fetchCollectionList()
    const capped = all.slice(0, limit)

    if (all.length > limit) {
        console.info(`nftHub: fetchVerifiedCollections — returning ${limit} of ${all.length} collections (cap ${limit})`)
    }

    const enriched = await Promise.all(
        capped.map(async (col): Promise<HubCollection> => {
            try {
                // Parallelise the two independent fetches for each collection
                const [verified, stats] = await Promise.all([
                    isCollectionVerified(col.id),
                    fetchNFTCollection(col.id),
                ])

                return {
                    id: col.id,
                    name: col.name,
                    creator: col.creator,
                    slug: col.slug,
                    verified,
                    floorUgnot: stats?.floorPriceUgnot ?? 0n,
                    volumeUgnot: stats?.totalVolumeUgnot ?? 0n,
                }
            } catch {
                // One collection failing must not reject the entire batch
                return {
                    id: col.id,
                    name: col.name,
                    creator: col.creator,
                    slug: col.slug,
                    verified: false,
                    floorUgnot: 0n,
                    volumeUgnot: 0n,
                }
            }
        }),
    )

    return enriched
}

// ---------------------------------------------------------------------------
// fetchRecentActivity
// ---------------------------------------------------------------------------

/**
 * Aggregate recent activity across multiple collections.
 *
 * Fetches up to `perCollection` items per collection in parallel, merges all
 * results, and returns them sorted by `createdAt` descending (newest first).
 *
 * `createdAt` is an ISO 8601 string — lexical descending sort is correct for
 * zero-padded ISO timestamps. Parse to Date for safety against non-ISO values.
 */
export async function fetchRecentActivity(
    collectionIds: string[],
    perCollection = DEFAULT_PER_COLLECTION,
): Promise<NFTActivityItem[]> {
    if (collectionIds.length === 0) return []

    const perCollectionArrays = await Promise.all(
        collectionIds.map((id) => fetchNFTActivity(id, perCollection).catch(() => [])),
    )

    const merged = perCollectionArrays.flat()

    console.info(
        `nftHub: aggregated ${merged.length} activity items across ${collectionIds.length} collections (cap ${perCollection} items each)`,
    )

    // Sort by createdAt descending — parse to Date for robustness
    merged.sort((a, b) => {
        const ta = new Date(a.createdAt).getTime()
        const tb = new Date(b.createdAt).getTime()
        return tb - ta // descending
    })

    return merged
}
