/**
 * useCollectionPublic — data hook for the redesigned public collection page.
 *
 * Loads everything a public collection page needs in a single hook:
 *  - `detail`   — on-chain collection metadata (admin, royalty, supply, phase, …)
 *  - `stats`    — indexer stats (floor, volume, owners, listed)  [graceful: null on failure]
 *  - `tokens`   — enumerated V3 tokens (enumerated up to detail.minted)
 *  - `listings` — Map<listingKey, { priceUgnot, seller }> for O(1) per-token lookup
 *  - `activity` — recent sale activity                           [graceful: [] on failure]
 *
 * Fetch ordering:
 *  1. Parallel first wave: detail + stats + listings + activity (no supply needed).
 *  2. After detail resolves (supply = detail.minted), fetch tokens.
 *
 * Robustness:
 *  - Only a failed `fetchCollectionDetail` sets `error` (core load).
 *  - Failed stats / activity are graceful (null / []) — they never set `error`.
 *  - `cancelled` flag prevents setState after unmount.
 *  - `reload()` increments a fetch epoch to re-run the effect.
 *
 * @module pages/useCollectionPublic
 */

import { useState, useEffect, useCallback } from "react"
import { fetchCollectionDetail } from "../lib/launchpadReads"
import { fetchNFTCollection, fetchNFTActivity } from "../lib/nftApi"
import { fetchV3Tokens, fetchV3Listings, type V3Token, type V3ListingMap } from "../lib/v3TokenGrid"
import { tradeEngineFor } from "../lib/tradeEngine"
import type { CollectionDetail } from "../lib/launchpad"
import type { NFTCollectionStats, NFTActivityItem } from "../lib/nftApi"

// Engine paths for v3 collections — resolved once at module level (pure).
const { collectionPath, marketPath } = tradeEngineFor("v3")

export interface CollectionPublicResult {
    detail: CollectionDetail | null
    stats: NFTCollectionStats | null
    tokens: V3Token[]
    listings: V3ListingMap
    activity: NFTActivityItem[]
    loading: boolean
    error: string | null
    reload: () => void
}

export function useCollectionPublic(id: string): CollectionPublicResult {
    const [detail, setDetail] = useState<CollectionDetail | null>(null)
    const [stats, setStats] = useState<NFTCollectionStats | null>(null)
    const [tokens, setTokens] = useState<V3Token[]>([])
    const [listings, setListings] = useState<V3ListingMap>(new Map())
    const [activity, setActivity] = useState<NFTActivityItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Incrementing this triggers a re-fetch without changing `id`.
    const [fetchEpoch, setFetchEpoch] = useState(0)

    useEffect(() => {
        let active = true

        async function load() {
            if (!active) return
            setLoading(true)
            setError(null)

            // ── First wave: parallel fetches that don't need supply ───────────
            // detail is core; stats/listings/activity are resilient.
            let resolvedDetail: CollectionDetail | null = null
            try {
                const [det, st, lst, act] = await Promise.all([
                    fetchCollectionDetail(id),
                    fetchNFTCollection(id).catch(() => null),
                    fetchV3Listings(id, marketPath).catch(() => new Map() as V3ListingMap),
                    fetchNFTActivity(id).catch(() => [] as NFTActivityItem[]),
                ])

                if (!active) return

                resolvedDetail = det
                setDetail(det)
                setStats(st)
                setListings(lst)
                setActivity(act)

                if (det === null) {
                    // Collection not found — treat as a core failure.
                    setError("Collection not found")
                    return
                }
            } catch (e: unknown) {
                if (!active) return
                // fetchCollectionDetail rejected — core failure.
                setDetail(null)
                setError(e instanceof Error ? e.message : String(e))
                return
            }

            // ── Second wave: token enumeration (needs supply) ─────────────────
            // supply = detail.minted (0-based count as CollectionDetail does)
            // (resolvedDetail is non-null here — the null case returned above; this
            //  guard satisfies tsc -b's cross-try/catch control-flow analysis.)
            if (!resolvedDetail) return
            const supply = resolvedDetail.minted
            if (supply > 0) {
                try {
                    const toks = await fetchV3Tokens(id, supply, collectionPath)
                    if (!active) return
                    setTokens(toks)
                } catch {
                    // Token enumeration failure is non-fatal; leave tokens as [].
                    if (!active) return
                    setTokens([])
                }
            } else {
                if (!active) return
                setTokens([])
            }
        }

        void load().finally(() => {
            if (active) setLoading(false)
        })

        return () => {
            active = false
        }
    }, [id, fetchEpoch])

    const reload = useCallback(() => {
        setFetchEpoch((n) => n + 1)
    }, [])

    return { detail, stats, tokens, listings, activity, loading, error, reload }
}
