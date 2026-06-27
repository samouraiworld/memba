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
import { fetchV3Tokens, fetchV3Listings, listingKey, type V3Token, type V3ListingMap } from "../lib/v3TokenGrid"
import { fetchOffersForToken, type TokenOffer } from "../lib/marketplace/v3Reads"
import { tradeEngineFor } from "../lib/tradeEngine"
import type { CollectionDetail } from "../lib/launchpad"
import type { NFTCollectionStats, NFTActivityItem } from "../lib/nftApi"

// Engine paths for v3 collections — resolved once at module level (pure).
const { collectionPath, marketPath } = tradeEngineFor("v3")

/**
 * Cap on the number of tokens we fan out offer reads for. We read offers for the
 * tokens "in play" — listed tokens (so a BUYER sees a best-offer badge) ∪ the
 * viewer's owned tokens (so the OWNER can accept) — and bound the union to keep RPC
 * fan-out predictable on a large collection. v3.1 has no bulk-offers getter (the
 * engine is deploy-frozen at #37), so this stays per-token via GetOffersForToken.
 */
const MAX_OFFER_TOKENS = 40

/** Per-token offers, keyed by tokenId, for listed + viewer-owned tokens. */
export type OfferMap = Map<string, TokenOffer[]>

export interface CollectionPublicResult {
    detail: CollectionDetail | null
    stats: NFTCollectionStats | null
    tokens: V3Token[]
    listings: V3ListingMap
    /** Offers on listed tokens (buyer best-offer badge) + viewer-owned tokens (owner accept). */
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
            let resolvedListings: V3ListingMap = new Map()
            try {
                const [det, st, lst, act] = await Promise.all([
                    fetchCollectionDetail(id),
                    fetchNFTCollection(id).catch(() => null),
                    fetchV3Listings(id, marketPath).catch(() => new Map() as V3ListingMap),
                    fetchNFTActivity(id).catch(() => [] as NFTActivityItem[]),
                ])

                if (!active) return

                resolvedDetail = det
                resolvedListings = lst
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
                    await loadOffers(toks, resolvedListings)
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

        // ── Offers: read the tokens "in play" — listed (buyer badge) ∪ owned (accept) ──
        // Resilient: any failed read yields no offers for that token; the page degrades
        // to "no offers", never errors. Bounded to MAX_OFFER_TOKENS.
        async function loadOffers(toks: V3Token[], lst: V3ListingMap) {
            const wanted = new Set<string>()
            for (const t of toks) {
                if (lst.has(listingKey(id, t.tokenId))) wanted.add(t.tokenId) // listed → buyer badge
                if (viewer && t.owner === viewer) wanted.add(t.tokenId) // owned → owner accept
            }
            const ids = [...wanted].slice(0, MAX_OFFER_TOKENS)
            if (ids.length === 0) return
            const results = await Promise.all(
                ids.map((tokenId) =>
                    fetchOffersForToken(id, tokenId, marketPath)
                        .then((o) => [tokenId, o] as const)
                        .catch(() => [tokenId, [] as TokenOffer[]] as const),
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
