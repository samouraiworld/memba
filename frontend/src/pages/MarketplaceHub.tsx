/**
 * MarketplaceHub — the unified marketplace front door (/nft, and the future
 * /marketplace shell).
 *
 * One front door over the live asset lanes. The lane registry (lib/marketplace/lanes)
 * decides which tabs render — a tab appears only when its lane is live (flag + realm
 * valid), so there are no dead "coming soon" tabs (panel C2). The active lane is
 * URL-state (?lane=…) so a lane view is shareable. v1 lights the NFT lane; Services
 * arrives in W2, Tokens/Agents later — each appears here when built.
 *
 * Data (NFT lane):
 *   fetchVerifiedCollections → grid of collection cards (with search filter)
 *   fetchRecentActivity      → recent sale/offer-accepted activity list
 */

import { useState, useEffect, useMemo } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { EmptyState } from "../components/ui/EmptyState"
import { fetchVerifiedCollections, fetchRecentActivity, type HubCollection } from "../lib/nftHub"
import { NFTMedia } from "../components/nft/NFTMedia"
import { VerifiedBadge } from "../components/nft/VerifiedBadge"
import { formatGnotCompact } from "../lib/formatGnot"
import { relativeTime } from "../lib/format"
import { useNetworkPath } from "../hooks/useNetworkNav"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import { getLiveLanes, type LaneDef } from "../lib/marketplace/lanes"
import type { AssetType } from "../lib/marketplace/types"
import type { NFTActivityItem } from "../lib/nftApi"
import { TokenLane } from "./TokenLane"
import "./marketplace-v2.css"

// ── Front door ───────────────────────────────────────────────────────

/**
 * The marketplace renders only its LIVE lanes. When none are live (the default
 * production state — NFT dark until v3.1 is registered, Services until W2), the whole
 * surface shows the gate, so live on-chain trade is never reachable while gated.
 */
export function MarketplaceHub() {
    const lanes = getLiveLanes()
    if (lanes.length === 0) {
        return (
            <ComingSoonGate
                title="Marketplace"
                icon="🖼️"
                description="Discover and trade NFTs, services, tokens, and agents on gno.land — one marketplace, enforced on-chain royalties, a DAO-set fee."
                features={[
                    "Buy, sell, and make offers on NFTs",
                    "Hire and get hired for services via milestone escrow",
                    "One front door, one fee, every asset lane",
                    "Verified collections + live activity",
                ]}
            />
        )
    }
    return <MarketplaceShell lanes={lanes} />
}

// ── Shell (tabs + URL-state) ─────────────────────────────────────────

function MarketplaceShell({ lanes }: { lanes: LaneDef[] }) {
    const np = useNetworkPath()
    const [params, setParams] = useSearchParams()

    const requested = params.get("lane") as AssetType | null
    const active = lanes.find((l) => l.assetType === requested) ?? lanes[0]

    const selectLane = (assetType: AssetType) => {
        setParams(
            (prev) => {
                prev.set("lane", assetType)
                return prev
            },
            { replace: true },
        )
    }

    return (
        <div className="mhub">
            <header className="mhub-header">
                <h1 className="mhub-title">Marketplace</h1>
                <Link to={np("nft/create")} className="mhub-launch-link" aria-label="Sell on the marketplace">
                    Sell
                </Link>
            </header>

            {lanes.length > 1 && (
                <nav className="mkt-lane-tabs" role="tablist" aria-label="Marketplace lanes">
                    {lanes.map((lane) => (
                        <button
                            key={lane.assetType}
                            role="tab"
                            type="button"
                            aria-selected={lane.assetType === active.assetType}
                            className={
                                "mkt-lane-tab" + (lane.assetType === active.assetType ? " mkt-lane-tab--active" : "")
                            }
                            onClick={() => selectLane(lane.assetType)}
                        >
                            {lane.label}
                        </button>
                    ))}
                </nav>
            )}

            <LaneContent assetType={active.assetType} />
        </div>
    )
}

/** Dispatch the active lane to its content. NFT is wired; other live lanes render a
 *  defensive placeholder until their content lands (so an early-flipped flag can't
 *  crash the shell). */
function LaneContent({ assetType }: { assetType: AssetType }) {
    if (assetType === "nft") return <NftLane />
    if (assetType === "token") return <TokenLane />
    return (
        <section className="mhub-collections">
            <p className="mhub-empty">This lane is coming in the next release.</p>
        </section>
    )
}

// ── NFT lane content ─────────────────────────────────────────────────

function NftLane() {
    const np = useNetworkPath()
    const navigate = useNavigate()

    const [collections, setCollections] = useState<HubCollection[]>([])
    const [activity, setActivity] = useState<NFTActivityItem[]>([])
    const [activityError, setActivityError] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [query, setQuery] = useState("")
    const [sortBy, setSortBy] = useState<"volume" | "floor" | "name">("volume")
    const [verifiedOnly, setVerifiedOnly] = useState(false)

    useEffect(() => {
        let cancelled = false
        fetchVerifiedCollections()
            .then(async (cols) => {
                if (cancelled) return
                setCollections(cols)
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
                if (!cancelled) setError(err instanceof Error ? err.message : String(err))
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [])

    const filteredCollections = useMemo(() => {
        const q = query.trim().toLowerCase()
        let list = collections
        if (q) list = list.filter((c) => c.name.toLowerCase().includes(q))
        if (verifiedOnly) list = list.filter((c) => c.verified)
        const sorted = [...list]
        if (sortBy === "floor") sorted.sort((a, b) => (b.floorUgnot > a.floorUgnot ? 1 : b.floorUgnot < a.floorUgnot ? -1 : 0))
        else if (sortBy === "volume") sorted.sort((a, b) => (b.volumeUgnot > a.volumeUgnot ? 1 : b.volumeUgnot < a.volumeUgnot ? -1 : 0))
        else sorted.sort((a, b) => a.name.localeCompare(b.name))
        return sorted
    }, [collections, query, verifiedOnly, sortBy])

    if (loading) {
        return <p className="mhub-loading">Loading collections…</p>
    }
    if (error) {
        return (
            <div className="mhub-error" role="alert">
                Failed to load collections: {error}
            </div>
        )
    }

    return (
        <>
            <div className="mhub-lane-toolbar">
                <input
                    className="mhub-search"
                    type="search"
                    placeholder="Search collections…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search collections"
                />
                <select
                    className="mhub-sort"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "volume" | "floor" | "name")}
                    aria-label="Sort collections"
                >
                    <option value="volume">Volume</option>
                    <option value="floor">Floor</option>
                    <option value="name">Name</option>
                </select>
                <label className="mhub-verified-toggle">
                    <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />
                    Verified
                </label>
                <Link to={np("nft/create")} className="mhub-launch-link" aria-label="Launch a collection">
                    Launch a collection
                </Link>
            </div>

            <section className="mhub-collections">
                <h2 className="mhub-section-title">Collections</h2>
                {filteredCollections.length === 0 ? (
                    query.trim() ? (
                        <EmptyState icon="ti-search-off" title="No matches" body="No collections match your search." />
                    ) : (
                        <EmptyState
                            icon="ti-photo"
                            title="No collections yet"
                            body="Be the first to launch a collection on the marketplace."
                            action={{ label: "Launch a collection", onClick: () => navigate(np("nft/create")) }}
                        />
                    )
                ) : (
                    <div className="mhub-grid">
                        {filteredCollections.map((col) => (
                            <Link
                                key={col.id}
                                to={np(`nft/collection/${col.id}`)}
                                className="mhub-collection-card"
                            >
                                <div className="mhub-collection-card__thumb">
                                    <NFTMedia uri="" alt={col.name} seed={col.id} />
                                </div>
                                <div className="mhub-collection-card__body">
                                    <div className="mhub-collection-card__name-row">
                                        <span className="mhub-collection-card__name">{col.name}</span>
                                        <VerifiedBadge verified={col.verified} compact />
                                    </div>
                                    <div className="mhub-collection-card__stats">
                                        Floor {formatGnotCompact(col.floorUgnot)} · Vol{" "}
                                        {formatGnotCompact(col.volumeUgnot)}
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </section>

            <section className="mhub-activity">
                <h2 className="mhub-section-title">Recent activity</h2>
                {activityError ? (
                    <p className="mhub-activity-error">Activity unavailable.</p>
                ) : activity.length === 0 ? (
                    <p className="mhub-empty">No recent activity.</p>
                ) : (
                    <div className="mhub-activity-list">
                        {activity.map((item) => (
                            <div key={String(item.saleNo)} className="mhub-activity-row">
                                <div className="mhub-activity-row__thumb">
                                    <NFTMedia uri="" alt={`Token #${item.tokenId}`} seed={item.tokenId} />
                                </div>
                                <div className="mhub-activity-row__info">
                                    <span className="mhub-activity-row__token">Token #{item.tokenId}</span>
                                    <span className="mhub-activity-row__kind">{item.kind}</span>
                                </div>
                                <span className="mhub-activity-row__price">
                                    {formatGnotCompact(item.priceUgnot)}
                                </span>
                                {item.createdAt && (
                                    <span className="mhub-activity-row__time">{relativeTime(item.createdAt)}</span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </>
    )
}
