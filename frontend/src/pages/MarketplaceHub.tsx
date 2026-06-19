/**
 * MarketplaceHub — NFT discovery hub page (/nft).
 *
 * Collector-facing landing page. Replaces tabbed NFTGallery once routing
 * is wired (T9). Renders independently; route wiring is a later task.
 *
 * Data:
 *   fetchVerifiedCollections → grid of collection cards (with search filter)
 *   fetchRecentActivity      → recent sale/offer-accepted activity list
 *
 * Robust states: loading, error (.catch-based — never wedges on "Loading…"),
 * empty-collections, empty-activity.
 */

import { useState, useEffect, useMemo } from "react"
import { Link } from "react-router-dom"
import { fetchVerifiedCollections, fetchRecentActivity, HubCollection } from "../lib/nftHub"
import { NFTMedia } from "../components/nft/NFTMedia"
import { VerifiedBadge } from "../components/nft/VerifiedBadge"
import { formatGnotCompact } from "../lib/formatGnot"
import { relativeTime } from "../lib/format"
import { useNetworkPath } from "../hooks/useNetworkNav"
import type { NFTActivityItem } from "../lib/nftApi"
import "./marketplace-v2.css"

// ── Component ────────────────────────────────────────────────────────

export function MarketplaceHub() {
    const np = useNetworkPath()

    // ── Data state ──────────────────────────────────────────────────
    const [collections, setCollections] = useState<HubCollection[]>([])
    const [activity, setActivity] = useState<NFTActivityItem[]>([])
    const [activityError, setActivityError] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // ── Search state ────────────────────────────────────────────────
    const [query, setQuery] = useState("")

    // ── Load ────────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false

        fetchVerifiedCollections()
            .then(async (cols) => {
                if (cancelled) return
                setCollections(cols)

                // Load activity for all collections in parallel
                const ids = cols.map((c) => c.id)
                let acts: NFTActivityItem[] = []
                let actFailed = false
                try {
                    acts = await fetchRecentActivity(ids)
                } catch {
                    actFailed = true
                }
                if (!cancelled) {
                    setActivity(acts)
                    setActivityError(actFailed)
                }
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    const msg = err instanceof Error ? err.message : String(err)
                    setError(msg)
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [])

    // ── Client-side search filter ────────────────────────────────────
    const filteredCollections = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return collections
        return collections.filter((c) => c.name.toLowerCase().includes(q))
    }, [collections, query])

    // ── Render: loading ──────────────────────────────────────────────
    if (loading) {
        return (
            <div className="mhub">
                <p className="mhub-loading">Loading collections…</p>
            </div>
        )
    }

    // ── Render: error ────────────────────────────────────────────────
    if (error) {
        return (
            <div className="mhub">
                <div className="mhub-error" role="alert">
                    Failed to load collections: {error}
                </div>
            </div>
        )
    }

    return (
        <div className="mhub">
            {/* ── Header ─────────────────────────────────────────── */}
            <header className="mhub-header">
                <h1 className="mhub-title">NFT Marketplace</h1>
                <input
                    className="mhub-search"
                    type="search"
                    placeholder="Search collections…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search collections"
                />
                <Link
                    to={np("nft/create")}
                    className="mhub-launch-link"
                    aria-label="Launch a collection"
                >
                    Launch a collection
                </Link>
            </header>

            {/* ── Collections ─────────────────────────────────────── */}
            <section className="mhub-collections">
                <h2 className="mhub-section-title">Collections</h2>
                {filteredCollections.length === 0 ? (
                    <p className="mhub-empty">
                        {query.trim()
                            ? "No collections match your search."
                            : "No collections yet. Be the first to launch one."}
                    </p>
                ) : (
                    <div className="mhub-grid">
                        {filteredCollections.map((col) => (
                            <Link
                                key={col.id}
                                to={np(`nft/collection/${col.id}`)}
                                className="mhub-collection-card"
                            >
                                <div className="mhub-collection-card__thumb">
                                    <NFTMedia uri="" alt={col.name} />
                                </div>
                                <div className="mhub-collection-card__body">
                                    <div className="mhub-collection-card__name-row">
                                        <span className="mhub-collection-card__name">{col.name}</span>
                                        <VerifiedBadge verified={col.verified} compact />
                                    </div>
                                    <div className="mhub-collection-card__stats">
                                        Floor {formatGnotCompact(col.floorUgnot)} · Vol {formatGnotCompact(col.volumeUgnot)}
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </section>

            {/* ── Recent activity ─────────────────────────────────── */}
            <section className="mhub-activity">
                <h2 className="mhub-section-title">Recent activity</h2>
                {activityError ? (
                    <p className="mhub-activity-error">Activity unavailable.</p>
                ) : activity.length === 0 ? (
                    <p className="mhub-empty">No recent activity.</p>
                ) : (
                    <div className="mhub-activity-list">
                        {activity.map((item) => (
                            <div
                                key={String(item.saleNo)}
                                className="mhub-activity-row"
                            >
                                <div className="mhub-activity-row__thumb">
                                    {/* Activity items carry no image URI; NFTMedia renders its placeholder */}
                                    <NFTMedia uri="" alt={`Token #${item.tokenId}`} />
                                </div>
                                <div className="mhub-activity-row__info">
                                    <span className="mhub-activity-row__token">Token #{item.tokenId}</span>
                                    <span className="mhub-activity-row__kind">{item.kind}</span>
                                </div>
                                <span className="mhub-activity-row__price">
                                    {formatGnotCompact(item.priceUgnot)}
                                </span>
                                {item.createdAt && (
                                    <span className="mhub-activity-row__time">
                                        {relativeTime(item.createdAt)}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}
