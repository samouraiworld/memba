import { useState, useEffect, useMemo } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { EmptyState } from "../ui/EmptyState"
import { SkeletonCard } from "../ui/LoadingSkeleton"
import { NFTMedia } from "../nft/NFTMedia"
import { VerifiedBadge } from "../nft/VerifiedBadge"
import { fetchVerifiedCollections, fetchRecentActivity, type HubCollection } from "../../lib/nftHub"
import { formatGnotCompact } from "../../lib/formatGnot"
import { relativeTime } from "../../lib/format"
import type { NFTActivityItem } from "../../lib/nftApi"
import "../../pages/unified-marketplace.css"

export default function NftLane() {
    const np = useNetworkPath()
    const navigate = useNavigate()
    const [params] = useSearchParams()

    const [collections, setCollections] = useState<HubCollection[]>([])
    const [activity, setActivity] = useState<NFTActivityItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const query = params.get("q") || ""
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
                try {
                    acts = await fetchRecentActivity(ids)
                } catch {
                    // Ignore activity fetch errors for now
                }
                if (!cancelled) {
                    setActivity(acts)
                }
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(err instanceof Error ? err.message : String(err))
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => { cancelled = true }
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

    if (loading) return (
        <div className="um-grid" data-testid="nft-loading" aria-busy="true" aria-label="Loading collections">
            {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
    )
    if (error) return <div className="k-card" style={{ color: "var(--color-error)", padding: "24px" }}>Failed to load collections: {error}</div>

    return (
        <div className="animate-fade-in">
            {/* Toolbar */}
            <div className="um-lane-header" style={{ flexWrap: "wrap", gap: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <h2 className="um-lane-title">Trending Collections</h2>
                    <span
                        data-testid="nft-count-badge"
                        aria-label={`${filteredCollections.length} collections`}
                        style={{
                            fontSize: "13px", fontWeight: 600, color: "var(--color-text-muted)",
                            background: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)",
                            borderRadius: "999px", padding: "2px 10px", lineHeight: 1.6,
                            fontVariantNumeric: "tabular-nums",
                        }}
                    >
                        {filteredCollections.length}
                    </span>
                </div>
                <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as "volume" | "floor" | "name")}
                        style={{
                            padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--color-border)",
                            background: "var(--color-bg-secondary)", color: "var(--color-text)"
                        }}
                    >
                        <option value="volume">Volume</option>
                        <option value="floor">Floor</option>
                        <option value="name">Name</option>
                    </select>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", color: "var(--color-text-muted)" }}>
                        <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />
                        Verified Only
                    </label>
                </div>
            </div>

            {/* Grid */}
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
                <div className="um-grid">
                    {filteredCollections.map((col) => (
                        <Link
                            key={col.id}
                            to={np(`nft/collection/${col.id}`)}
                            className="k-card"
                            style={{
                                display: "flex", flexDirection: "column", padding: 0, overflow: "hidden",
                                textDecoration: "none", transition: "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), border-color 0.3s",
                                border: "1px solid var(--color-border)",
                                borderRadius: "16px",
                                background: "var(--color-bg-secondary)"
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = "translateY(-6px)"
                                e.currentTarget.style.boxShadow = "var(--shadow-lg)"
                                e.currentTarget.style.borderColor = "var(--color-primary)"
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = "translateY(0)"
                                e.currentTarget.style.boxShadow = "none"
                                e.currentTarget.style.borderColor = "var(--color-border)"
                            }}
                        >
                            {/* Full-bleed banner */}
                            <div style={{ width: "100%", height: "200px", position: "relative", backgroundColor: "var(--color-bg-tertiary)" }}>
                                <NFTMedia uri="" alt={col.name} seed={col.id} />
                            </div>
                            
                            {/* Card Body */}
                            <div style={{ padding: "16px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                        <span style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text)" }}>{col.name}</span>
                                        <VerifiedBadge verified={col.verified} compact />
                                    </div>
                                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                                        Vol: {formatGnotCompact(col.volumeUgnot)}
                                    </span>
                                </div>
                                
                                <div style={{ display: "flex", gap: "24px", paddingTop: "12px", borderTop: "1px solid var(--color-border)" }}>
                                    <div>
                                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Floor Price</div>
                                        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text)" }}>
                                            {formatGnotCompact(col.floorUgnot)} GNOT
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Volume</div>
                                        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text)" }}>
                                            {formatGnotCompact(col.volumeUgnot)} GNOT
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}

            {/* Recent Activity */}
            {activity.length > 0 && (
                <div style={{ marginTop: "60px" }}>
                    <h2 className="um-lane-title" style={{ marginBottom: "24px" }}>Recent Activity</h2>
                    <div className="k-card" data-testid="nft-recent-activity" style={{ padding: 0, overflow: "hidden" }}>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                            {activity.map((item, i) => (
                                <div
                                    key={i}
                                    className="um-activity-row"
                                    style={{
                                        display: "flex", alignItems: "center", justifyContent: "space-between",
                                        padding: "16px 20px", textDecoration: "none", color: "var(--color-text)",
                                        borderBottom: i < activity.length - 1 ? "1px solid var(--color-border)" : "none",
                                        transition: "background 0.2s"
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--color-k-hover-surface)"}
                                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: "16px", minWidth: 0 }}>
                                        <div style={{ width: "48px", height: "48px", borderRadius: "8px", overflow: "hidden", flexShrink: 0, backgroundColor: "var(--color-bg-tertiary)" }}>
                                            <NFTMedia uri={""} alt={`NFT #${item.tokenId}`} seed={item.tokenId} />
                                        </div>
                                        <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                                            <div style={{ fontSize: "14px", fontWeight: 500 }}>
                                                {item.kind === "SALE" ? "Sold" : "Offer Accepted"} · NFT #{item.tokenId}
                                            </div>
                                            <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                                                {item.seller.slice(0,8)}... → {item.buyer.slice(0,8)}...
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-primary)" }}>
                                            {formatGnotCompact(item.priceUgnot)} GNOT
                                        </div>
                                        <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                                            {relativeTime(item.createdAt)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
