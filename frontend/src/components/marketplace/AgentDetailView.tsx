/**
 * AgentDetailView — detail panel for a selected agent.
 *
 * Shows stats, capabilities, MCP config, review form, and tags.
 * Extracted from Marketplace.tsx for maintainability.
 */

import { useState, useEffect } from "react"
import { Heart } from "@phosphor-icons/react"
import {
    invalidateAgentCache,
    generateMcpConfig,
    getAgentStats,
    AGENT_CATEGORIES,
    type AgentListing,
    type AgentStats,
} from "../../lib/agentRegistry"
import { buildReviewAgentMsg } from "../../lib/agentTemplate"
import { doContractBroadcast } from "../../lib/grc20"
import { MEMBA_DAO } from "../../lib/config"
import type { LayoutContext } from "../../types/layout"
import { CreditSection } from "./CreditSection"

const REGISTRY_PATH = MEMBA_DAO.agentRegistryPath

export function AgentDetailView({
    agent, adena, auth, isFavorited, onToggleFavorite, onBack, onCopyConfig, copied, onError,
}: {
    agent: AgentListing
    adena: LayoutContext["adena"]
    auth: LayoutContext["auth"]
    isFavorited: boolean
    onToggleFavorite: (e: React.MouseEvent, id: string) => void
    onBack: () => void
    onCopyConfig: () => void
    copied: boolean
    onError: (msg: string) => void
}) {
    const config = generateMcpConfig(agent)
    const [reviewRating, setReviewRating] = useState(5)
    const [reviewComment, setReviewComment] = useState("")
    const [submittingReview, setSubmittingReview] = useState(false)
    const [reviewSuccess, setReviewSuccess] = useState(false)
    const [stats, setStats] = useState<AgentStats | null>(null)
    const isCreator = adena.address && agent.creator.startsWith(adena.address.slice(0, 10))

    // Load stats on mount
    useEffect(() => {
        getAgentStats(agent.id).then(setStats).catch(() => {})
    }, [agent.id])

    const handleSubmitReview = async () => {
        if (!adena.connected || !reviewComment.trim()) return
        setSubmittingReview(true)
        try {
            const msg = buildReviewAgentMsg(
                adena.address,
                REGISTRY_PATH,
                agent.id,
                reviewRating,
                reviewComment.trim(),
            )
            await doContractBroadcast([msg], "Agent Review")
            invalidateAgentCache()
            setReviewComment("")
            setReviewRating(5)
            setReviewSuccess(true)
            setTimeout(() => setReviewSuccess(false), 4000)
        } catch (err) {
            onError(err instanceof Error ? err.message : "Review submission failed")
        } finally {
            setSubmittingReview(false)
        }
    }

    return (
        <div className="mp-page animate-fade-in">
            <button className="mp-back" onClick={onBack}>
                ← Back to Marketplace
            </button>

            <div className="mp-detail">
                <div className="mp-detail__header">
                    <div className="mp-detail__icon">
                        {AGENT_CATEGORIES.find(c => c.key === agent.category)?.icon || "🤖"}
                    </div>
                    <div>
                        <h1 className="mp-detail__name">
                            {agent.name}
                            {agent.verified && <span className="mp-verified" title="Verified by Memba">✓</span>}
                        </h1>
                        <div className="mp-detail__meta">
                            <span>by {agent.creatorName || agent.creator}</span>
                            {agent.version && <span>v{agent.version}</span>}
                            <span className="mp-pricing-badge" data-pricing={agent.pricing}>
                                {agent.pricing === "free" ? "Free" : agent.pricing === "pay-per-use" ? `${agent.pricePerCall / 1000}k ugnot/call` : "Subscription"}
                            </span>
                        </div>
                    </div>
                    <div className="mp-detail__actions">
                        {isCreator && (
                            <span className="mp-detail__creator-badge">Your Agent</span>
                        )}
                        {auth.token && (
                            <button
                                className={`mp-detail__fav${isFavorited ? " active" : ""}`}
                                onClick={e => onToggleFavorite(e, agent.id)}
                                title={isFavorited ? "Remove from favorites" : "Add to favorites"}
                            >
                                <Heart size={20} weight={isFavorited ? "fill" : "regular"} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Stats row */}
                <div className="mp-detail__stats">
                    <div className="mp-stat">
                        <span className="mp-stat__value">{agent.rating > 0 ? `${agent.rating.toFixed(1)}` : "—"}</span>
                        <span className="mp-stat__label">Rating</span>
                    </div>
                    <div className="mp-stat">
                        <span className="mp-stat__value">{agent.ratingCount}</span>
                        <span className="mp-stat__label">Reviews</span>
                    </div>
                    <div className="mp-stat">
                        <span className="mp-stat__value">{agent.totalCalls}</span>
                        <span className="mp-stat__label">Invocations</span>
                    </div>
                    {stats && (
                        <>
                            <div className="mp-stat">
                                <span className="mp-stat__value">{stats.viewCount}</span>
                                <span className="mp-stat__label">Views</span>
                            </div>
                            <div className="mp-stat">
                                <span className="mp-stat__value">{stats.favoriteCount}</span>
                                <span className="mp-stat__label">Favorites</span>
                            </div>
                        </>
                    )}
                </div>

                {/* Description */}
                <div className="mp-detail__section">
                    <h3>About</h3>
                    <pre className="mp-detail__desc">{agent.longDescription || agent.description}</pre>
                </div>

                {/* Capabilities */}
                {agent.capabilities.length > 0 && (
                    <div className="mp-detail__section">
                        <h3>Capabilities</h3>
                        <div className="mp-caps">
                            {agent.capabilities.map(c => (
                                <span key={c} className="mp-cap">{c}</span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Credits (pay-per-use agents) */}
                {agent.pricing === "pay-per-use" && adena.connected && (
                    <CreditSection agentId={agent.id} address={adena.address} onError={onError} />
                )}

                {/* MCP Config */}
                {agent.mcpEndpoint && (
                    <div className="mp-detail__section">
                        <h3>Connect Agent</h3>
                        <p className="mp-detail__hint">
                            Add this to your MCP client config (Claude Desktop, Cursor, etc.):
                        </p>
                        <div className="mp-config">
                            <pre className="mp-config__code">{JSON.stringify(config, null, 2)}</pre>
                            <button
                                className="mp-config__copy"
                                onClick={onCopyConfig}
                            >
                                {copied ? "✓ Copied!" : "Copy Config"}
                            </button>
                        </div>
                    </div>
                )}

                {/* Review Form */}
                <div className="mp-detail__section">
                    <h3>Leave a Review</h3>
                    {!adena.connected ? (
                        <p className="mp-review-hint">Connect your wallet to leave a review.</p>
                    ) : (
                        <div className="mp-review-form">
                            <div className="mp-review-stars" role="radiogroup" aria-label="Rating">
                                {[1, 2, 3, 4, 5].map(star => (
                                    <button
                                        key={star}
                                        className={`mp-star${star <= reviewRating ? " active" : ""}`}
                                        onClick={() => setReviewRating(star)}
                                        onKeyDown={e => {
                                            if (e.key === "ArrowRight" && star < 5) setReviewRating(star + 1)
                                            if (e.key === "ArrowLeft" && star > 1) setReviewRating(star - 1)
                                        }}
                                        aria-label={`${star} star${star !== 1 ? "s" : ""}`}
                                        role="radio"
                                        aria-checked={star === reviewRating}
                                    >
                                        ★
                                    </button>
                                ))}
                            </div>
                            <textarea
                                className="mp-review-input"
                                placeholder="Share your experience with this agent..."
                                value={reviewComment}
                                onChange={e => setReviewComment(e.target.value)}
                                maxLength={500}
                                rows={3}
                            />
                            <div className="mp-review-actions">
                                {reviewSuccess && (
                                    <span className="mp-review-success">✓ Review submitted on-chain</span>
                                )}
                                <button
                                    className="mp-review-submit"
                                    disabled={!reviewComment.trim() || submittingReview}
                                    onClick={handleSubmitReview}
                                >
                                    {submittingReview ? "Submitting..." : "Submit Review"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Tags */}
                {agent.tags.length > 0 && (
                    <div className="mp-detail__tags">
                        {agent.tags.map(t => (
                            <span key={t} className="mp-tag">{t}</span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
