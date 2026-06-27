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
import { fetchOffersForToken, type TokenOffer } from "../lib/marketplace/v3Reads"
import { tradeEngineFor } from "../lib/tradeEngine"
import type { CollectionDetail } from "../lib/launchpad"
import type { NFTCollectionStats, NFTActivityItem } from "../lib/nftApi"

// Engine paths for v3 collections — resolved once at module level (pure).
const { collectionPath, marketPath } = tradeEngineFor("v3")

/**
 * Cap on the number of viewer-owned tokens we fan out offer reads for. Offers are
 * only actionable by an owner (accept), so we read them ONLY for the connected
 * viewer's holdings on this page — and bound that to keep RPC fan-out predictable
 * even for a whale who owns a large slice of a collection.
 */
const MAX_OFFER_TOKENS = 40

/** Per-token offers, keyed by tokenId. Empty when logged out (no one to accept). */
export type OfferMap = Map<string, TokenOffer[]>

export interface CollectionPublicResult {
    detail: CollectionDetail | null
    stats: NFTCollectionStats | null
    tokens: V3Token[]
    listings: V3ListingMap
    /** Offers on the viewer's OWNED tokens (so the owner can accept). Empty otherwise. */
    offers: OfferMap
    activity: NFTActivityItem[]
    loading: boolean
    error: string | null
    reload: () => void
}

export function useCollectionPublic(id: string, viewer = ""): CollectionPublicResult {
    const [detail, setDetail] = useState<CollectionDetail | null>(null)
    const [stats, setStats] = useState<NFTCollectionStats | null>(null)
    const [tokens, setTokens] = useState<V3Token[]>([])
    const [listings, setListings] = useState<V3ListingMap>(new Map())
    const [offers, setOffers] = useState<OfferMap>(new Map())
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
            setOffers(new Map())

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
                    // Windowed to DEFAULT_TOKEN_WINDOW to bound RPC fan-out (W0.3);
                    // true per-page enumeration + "load more" lands with the v3.1
                    // paginated getter in W1.2.
                    const toks = await fetchV3Tokens(id, supply, collectionPath)
                    if (!active) return
                    setTokens(toks)
                    await loadOffers(toks)
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

        // ── Offers: read ONLY the viewer's owned tokens (the accept actor) ────
        // Logged out → skip entirely (no one to accept). Resilient: any failed read
        // yields no offers for that token; the page degrades to "no offers", never errors.
        async function loadOffers(toks: V3Token[]) {
            if (!viewer) return
            const owned = toks.filter((t) => t.owner === viewer).slice(0, MAX_OFFER_TOKENS)
            if (owned.length === 0) return
            const results = await Promise.all(
                owned.map((t) =>
                    fetchOffersForToken(id, t.tokenId, marketPath)
                        .then((o) => [t.tokenId, o] as const)
                        .catch(() => [t.tokenId, [] as TokenOffer[]] as const),
                ),
            )
            if (!active) return
            setOffers(new Map(results.filter(([, o]) => o.length > 0)))
        }

        void load().finally(() => {
            if (active) setLoading(false)
        })

        return () => {
            active = false
        }
    }, [id, viewer, fetchEpoch])

    const reload = useCallback(() => {
        setFetchEpoch((n) => n + 1)
    }, [])

    return { detail, stats, tokens, listings, offers, activity, loading, error, reload }
}
