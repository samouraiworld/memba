/**
 * CollectionPublic — redesigned collector-facing collection page.
 *
 * Route: /nft/collection/:creator/:slug  (id = "creator/slug")
 *
 * Wires together:
 *  - useCollectionPublic (T6) for all data
 *  - NFTMedia (T1) for token images
 *  - TradeModal (T3) for buy / list / offer actions (source="v3")
 *  - VerifiedBadge for collection trust signal
 *
 * Design decisions / omissions logged here:
 *  - Header media: uses first token's uri via NFTMedia, or placeholder if no tokens.
 *  - verified: CollectionDetail has no `verified` field — isCollectionVerified() is
 *    a separate async call. We skip it here (no extra fetch in this hook) and don't
 *    render VerifiedBadge to avoid a fabricated value.
 *  - ACCEPT: useCollectionPublic exposes no per-token offer data (buyer address),
 *    so the accept action is NOT wired. Noted per brief.
 *  - owners: NFTCollectionStats has no `owners` field — stats strip uses
 *    Floor / Volume / Listed / Supply only (4 stats, not 5).
 *
 * @module pages/CollectionPublic
 */

import { useState } from "react"
import { useParams, useOutletContext, Link } from "react-router-dom"
import { useNetworkPath } from "../hooks/useNetworkNav"
import { useCollectionPublic } from "./useCollectionPublic"
import { NFTMedia } from "../components/nft/NFTMedia"
import { TradeModal } from "../components/nft/TradeModal"
import { formatGnotCompact } from "../lib/formatGnot"
import { relativeTime } from "../lib/format"
import { listingKey } from "../lib/v3TokenGrid"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import { isNftEnabled, isNftMarketV3Valid } from "../lib/config"
import type { LayoutContext } from "../types/layout"
import "./marketplace-v2.css"

// ── Feature flags ─────────────────────────────────────────────────────

// Phase 3: re-enable when accept-offer is wired (hook needs per-token offer data)
const OFFERS_ENABLED = false

// ── Tab types ─────────────────────────────────────────────────────────

type Tab = "items" | "activity" | "about"

// ── TradeModal state ──────────────────────────────────────────────────

interface ModalState {
    action: "buy" | "list" | "offer"
    tokenId: string
    priceUgnot?: number
    seller?: string
}

// ── Component ─────────────────────────────────────────────────────────

/**
 * Feature gate (defense-in-depth) — this page renders live Buy/List actions on the
 * v3 engine (TradeModal source="v3" → memba_nft_market_v3), so it must gate on the
 * v3 market's validity (isNftMarketV3Valid), NOT the v2 predicate. The v3 path stays
 * out of REALM_ALLOWLIST until v3.1 is registered (Marketplace plan W1.2), so the
 * page stays correctly dark until then — closing the audit's top 🔴 (rendering live
 * trades against a realm the allowlist rejects). It also stays dark unless
 * VITE_ENABLE_NFT is flipped, even when reached by a direct URL.
 */
export function CollectionPublic() {
    if (!isNftEnabled() || !isNftMarketV3Valid()) {
        return (
            <ComingSoonGate
                title="NFT Marketplace"
                icon="🖼️"
                description="Discover, buy, and sell GRC721 NFTs on gno.land — with enforced creator royalties."
                features={[
                    "Browse verified collections + recent activity",
                    "Buy and list in one unified trade flow",
                    "Enforced on-chain royalties on every sale",
                    "Live floor + volume per collection",
                ]}
            />
        )
    }
    return <CollectionPublicContent />
}

function CollectionPublicContent() {
    const { creator, slug } = useParams<{ creator: string; slug: string }>()
    const id = creator && slug ? `${creator}/${slug}` : ""
    const { adena } = useOutletContext<LayoutContext>()
    const me = adena?.address || ""
    const np = useNetworkPath()

    const { detail, stats, tokens, listings, activity, loading, error, reload } =
        useCollectionPublic(id)

    const [activeTab, setActiveTab] = useState<Tab>("items")
    const [modal, setModal] = useState<ModalState | null>(null)

    // ── Loading ─────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="cpub">
                <p className="mhub-loading">Loading collection…</p>
            </div>
        )
    }

    // ── Error ───────────────────────────────────────────────────────
    if (error || !detail) {
        return (
            <div className="cpub">
                <div className="mhub-error" role="alert">
                    {error ?? "Collection not found."}
                </div>
            </div>
        )
    }

    const isAdmin = me !== "" && me === detail.admin
    const firstTokenUri = tokens.length > 0 ? tokens[0].uri : ""

    const handleModalClose = () => setModal(null)
    const handleModalSuccess = () => {
        setModal(null)
        reload()
    }

    return (
        <div className="cpub">
            {/* ── Header ──────────────────────────────────────────── */}
            <header className="cpub-header">
                <div className="cpub-hero-media">
                    <NFTMedia uri={firstTokenUri} alt={detail.name} className="cpub-hero-media__img" />
                </div>
                <div className="cpub-header-body">
                    <h1 className="cpub-title">{detail.name}</h1>
                    <p className="cpub-creator">by {detail.creator}</p>
                    {isAdmin && (
                        <Link
                            to={np(`nft/studio/${id}`)}
                            className="cpub-studio-link"
                        >
                            Manage in Studio →
                        </Link>
                    )}
                </div>
            </header>

            {/* ── Stats strip ─────────────────────────────────────── */}
            <div className="cpub-stats">
                <div className="cpub-stat">
                    <span className="cpub-stat__label">Floor</span>
                    <span className="cpub-stat__value">
                        {stats ? formatGnotCompact(stats.floorPriceUgnot) : "—"}
                    </span>
                </div>
                <div className="cpub-stat">
                    <span className="cpub-stat__label">Volume</span>
                    <span className="cpub-stat__value">
                        {stats ? formatGnotCompact(stats.totalVolumeUgnot) : "—"}
                    </span>
                </div>
                <div className="cpub-stat">
                    <span className="cpub-stat__label">Listed</span>
                    <span className="cpub-stat__value">
                        {stats ? String(stats.activeListings) : "—"}
                    </span>
                </div>
                <div className="cpub-stat">
                    <span className="cpub-stat__label">Supply</span>
                    <span className="cpub-stat__value">
                        {stats ? String(stats.supply) : detail.minted}
                    </span>
                </div>
            </div>

            {/* ── Tabs ────────────────────────────────────────────── */}
            <div className="cpub-tabs" role="tablist">
                <button
                    role="tab"
                    aria-selected={activeTab === "items"}
                    className={`cpub-tab${activeTab === "items" ? " cpub-tab--active" : ""}`}
                    onClick={() => setActiveTab("items")}
                >
                    Items
                </button>
                <button
                    role="tab"
                    aria-selected={activeTab === "activity"}
                    className={`cpub-tab${activeTab === "activity" ? " cpub-tab--active" : ""}`}
                    onClick={() => setActiveTab("activity")}
                >
                    Activity
                </button>
                <button
                    role="tab"
                    aria-selected={activeTab === "about"}
                    className={`cpub-tab${activeTab === "about" ? " cpub-tab--active" : ""}`}
                    onClick={() => setActiveTab("about")}
                >
                    About
                </button>
            </div>

            {/* ── Tab panels ──────────────────────────────────────── */}

            {/* Items */}
            {activeTab === "items" && (
                <section className="cpub-panel">
                    {tokens.length === 0 ? (
                        <p className="mhub-empty">No tokens minted yet.</p>
                    ) : (
                        <div className="cpub-token-grid">
                            {tokens.map((token) => {
                                const lk = listingKey(id, token.tokenId)
                                const listing = listings.get(lk)
                                const isOwner = me !== "" && token.owner === me
                                const isListed = listing !== undefined

                                return (
                                    <div key={token.tokenId} className="cpub-token-card">
                                        <div className="cpub-token-card__media">
                                            <NFTMedia
                                                uri={token.uri}
                                                alt={`Token #${token.tokenId}`}
                                                className="cpub-token-card__img"
                                            />
                                        </div>
                                        <div className="cpub-token-card__body">
                                            <span className="cpub-token-card__id">
                                                #{token.tokenId}
                                            </span>
                                            {isListed ? (
                                                <span className="cpub-token-card__price">
                                                    {formatGnotCompact(listing!.priceUgnot)}
                                                </span>
                                            ) : (
                                                <span className="cpub-token-card__unlisted">
                                                    Not listed
                                                </span>
                                            )}
                                        </div>
                                        <div className="cpub-token-card__actions">
                                            {me === "" ? (
                                                <span className="cpub-wallet-hint">
                                                    Connect wallet
                                                </span>
                                            ) : isOwner && !isListed ? (
                                                <button
                                                    className="cpub-action-btn"
                                                    onClick={() =>
                                                        setModal({
                                                            action: "list",
                                                            tokenId: token.tokenId,
                                                        })
                                                    }
                                                >
                                                    List
                                                </button>
                                            ) : isListed && !isOwner ? (
                                                <button
                                                    className="cpub-action-btn"
                                                    onClick={() =>
                                                        setModal({
                                                            action: "buy",
                                                            tokenId: token.tokenId,
                                                            priceUgnot: listing!.priceUgnot,
                                                            seller: listing!.seller,
                                                        })
                                                    }
                                                >
                                                    Buy
                                                </button>
                                            ) : !isListed && !isOwner && OFFERS_ENABLED ? (
                                                <button
                                                    className="cpub-action-btn"
                                                    onClick={() =>
                                                        setModal({
                                                            action: "offer",
                                                            tokenId: token.tokenId,
                                                        })
                                                    }
                                                >
                                                    Make offer
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </section>
            )}

            {/* Activity */}
            {activeTab === "activity" && (
                <section className="cpub-panel">
                    {activity.length === 0 ? (
                        <p className="mhub-empty">No recent activity.</p>
                    ) : (
                        <div className="mhub-activity-list">
                            {activity.map((item) => (
                                <div
                                    key={String(item.saleNo)}
                                    className="mhub-activity-row"
                                >
                                    <div className="mhub-activity-row__thumb">
                                        <NFTMedia
                                            uri={tokens.find(t => t.tokenId === item.tokenId)?.uri ?? ""}
                                            alt={`Token #${item.tokenId}`}
                                        />
                                    </div>
                                    <div className="mhub-activity-row__info">
                                        <span className="mhub-activity-row__token">
                                            Token #{item.tokenId}
                                        </span>
                                        <span className="mhub-activity-row__kind">
                                            {item.kind}
                                        </span>
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
            )}

            {/* About */}
            {activeTab === "about" && (
                <section className="cpub-panel">
                    <dl className="cpub-about">
                        <div className="cpub-about-row">
                            <dt className="cpub-about-row__term">Creator</dt>
                            <dd className="cpub-about-row__def">
                                <code>{detail.creator}</code>
                            </dd>
                        </div>
                        <div className="cpub-about-row">
                            <dt className="cpub-about-row__term">Admin</dt>
                            <dd className="cpub-about-row__def">
                                <code>{detail.admin}</code>
                            </dd>
                        </div>
                        <div className="cpub-about-row">
                            <dt className="cpub-about-row__term">Royalty</dt>
                            <dd className="cpub-about-row__def">
                                {detail.royaltyBps / 100}%
                            </dd>
                        </div>
                        <div className="cpub-about-row">
                            <dt className="cpub-about-row__term">Supply</dt>
                            <dd className="cpub-about-row__def">
                                {detail.minted}
                                {detail.maxSupply > 0 ? ` / ${detail.maxSupply}` : " (unlimited)"}
                            </dd>
                        </div>
                    </dl>
                </section>
            )}

            {/* ── TradeModal ───────────────────────────────────────── */}
            {modal && me !== "" && (
                <TradeModal
                    action={modal.action}
                    source="v3"
                    collectionID={id}
                    tokenId={modal.tokenId}
                    priceUgnot={modal.priceUgnot}
                    seller={modal.seller}
                    royaltyBps={detail.royaltyBps}
                    callerAddress={me}
                    onClose={handleModalClose}
                    onSuccess={handleModalSuccess}
                />
            )}
        </div>
    )
}

export default CollectionPublic
