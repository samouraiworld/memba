/**
 * Marketplace — AI Agent Marketplace page.
 *
 * Browse, search, register, and review AI agents on-chain.
 * Agents expose capabilities via MCP (Model Context Protocol).
 *
 * @module pages/Marketplace
 */

import { useState, useEffect, useMemo, useDeferredValue, useCallback } from "react"
import { useOutletContext } from "react-router-dom"
import { ArrowRight } from "@phosphor-icons/react"
import { Heart } from "@phosphor-icons/react"
import {
    fetchAgents,
    fetchAgentDetail,
    invalidateAgentCache,
    generateMcpConfig,
    toggleFavorite,
    getFavorites,
    getAgentStats,
    AGENT_CATEGORIES,
    type AgentListing,
    type AgentCategory,
    type AgentStats,
} from "../lib/agentRegistry"
import { buildRegisterAgentMsg, buildReviewAgentMsg } from "../lib/agentTemplate"
import { doContractBroadcast } from "../lib/grc20"
import { MEMBA_DAO } from "../lib/config"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import type { LayoutContext } from "../types/layout"
import "./marketplace.css"

const MARKETPLACE_ENABLED = import.meta.env.VITE_ENABLE_MARKETPLACE === "true"
const REGISTRY_PATH = MEMBA_DAO.agentRegistryPath

export default function Marketplace() {
    if (!MARKETPLACE_ENABLED) {
        return (
            <ComingSoonGate
                title="AI Agent Marketplace"
                icon="🤖"
                description="Discover and connect AI agents for the Gno ecosystem via MCP (Model Context Protocol)."
                features={[
                    "Browse and discover AI agents for the Gno ecosystem",
                    "Connect agents via MCP (Model Context Protocol)",
                    "Agent verification and community rating system",
                    "Pay-per-use and subscription pricing models",
                    "On-chain agent registry with DAO curation",
                ]}
            />
        )
    }

    return <MarketplaceContent />
}

function MarketplaceContent() {
    const { adena, auth } = useOutletContext<LayoutContext>()

    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const [category, setCategory] = useState<AgentCategory | "all">("all")
    const [selectedAgent, setSelectedAgent] = useState<AgentListing | null>(null)
    const [copied, setCopied] = useState(false)
    const [showRegister, setShowRegister] = useState(false)
    const [allAgents, setAllAgents] = useState<AgentListing[]>([])
    const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const loadAgents = useCallback(() => {
        setLoading(true)
        setError(null)
        fetchAgents()
            .then(result => { setAllAgents(result); setLoading(false) })
            .catch(() => setLoading(false))
    }, [])

    // Load agents from chain on mount + load favorites if authenticated
    useEffect(() => {
        document.title = "AI Agent Marketplace — Memba"
        loadAgents() // eslint-disable-line react-hooks/set-state-in-effect
    }, [loadAgents])

    useEffect(() => {
        if (!auth.token) return
        getFavorites(auth.token).then(ids => setFavoriteIds(new Set(ids))).catch(() => {})
    }, [auth.token])

    const agents = useMemo(() => {
        let results = allAgents
        if (category !== "all") {
            results = results.filter(a => a.category === category)
        }
        if (deferredSearch) {
            const q = deferredSearch.toLowerCase()
            results = results.filter(a =>
                a.name.toLowerCase().includes(q) ||
                a.description.toLowerCase().includes(q) ||
                a.tags.some(t => t.includes(q)) ||
                a.capabilities.some(c => c.toLowerCase().includes(q)),
            )
        }
        return results
    }, [allAgents, deferredSearch, category])

    const handleSelectAgent = useCallback(async (agent: AgentListing) => {
        setSelectedAgent(agent)
        // Fetch full detail from chain
        try {
            const detail = await fetchAgentDetail(agent.id)
            if (detail) {
                setSelectedAgent(detail)
            }
        } catch { /* use the listing data we already have */ }
    }, [])

    const handleCopyConfig = useCallback(async (agent: AgentListing) => {
        const config = generateMcpConfig(agent)
        try {
            await navigator.clipboard.writeText(JSON.stringify(config, null, 2))
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch { /* clipboard not available */ }
    }, [])

    const handleAgentRegistered = useCallback(async () => {
        setShowRegister(false)
        invalidateAgentCache()
        setLoading(true)
        const result = await fetchAgents().catch(() => [] as AgentListing[])
        setAllAgents(result)
        setLoading(false)
    }, [])

    const handleToggleFavorite = useCallback(async (e: React.MouseEvent, agentId: string) => {
        e.stopPropagation()
        if (!auth.token) return
        try {
            const nowFavorited = await toggleFavorite(auth.token, agentId)
            setFavoriteIds(prev => {
                const next = new Set(prev)
                if (nowFavorited) next.add(agentId)
                else next.delete(agentId)
                return next
            })
        } catch { /* ignore */ }
    }, [auth.token])

    // ── Agent Detail Panel ────────────────────────────────────
    if (selectedAgent) {
        return (
            <AgentDetailView
                agent={selectedAgent}
                adena={adena}
                auth={auth}
                isFavorited={favoriteIds.has(selectedAgent.id)}
                onToggleFavorite={handleToggleFavorite}
                onBack={() => setSelectedAgent(null)}
                onCopyConfig={() => handleCopyConfig(selectedAgent)}
                copied={copied}
                onError={setError}
            />
        )
    }

    // ── Marketplace Grid ──────────────────────────────────────
    return (
        <div className="mp-page animate-fade-in">
            <ErrorToast message={error} onDismiss={() => setError(null)} onRetry={loadAgents} />

            <div className="mp-header">
                <div>
                    <h1>🤖 AI Agent Marketplace</h1>
                    <p>Discover and connect AI agents for the Gno ecosystem via MCP</p>
                </div>
                {adena.connected && (
                    <button
                        className="mp-register-btn"
                        onClick={() => setShowRegister(true)}
                    >
                        + Register Agent
                    </button>
                )}
            </div>

            {/* Register Agent Modal */}
            {showRegister && (
                <RegisterAgentForm
                    address={adena.address}
                    onClose={() => setShowRegister(false)}
                    onRegistered={handleAgentRegistered}
                    onError={setError}
                />
            )}

            {/* Search */}
            <input
                type="text"
                placeholder="Search agents by name, capability, or tag..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="mp-search"
                aria-label="Search agents"
            />

            {/* Category filters */}
            <div className="mp-categories">
                <button
                    className="mp-cat-pill"
                    data-active={category === "all"}
                    onClick={() => setCategory("all")}
                >
                    All
                </button>
                {AGENT_CATEGORIES.map(c => (
                    <button
                        key={c.key}
                        className="mp-cat-pill"
                        data-active={category === c.key}
                        onClick={() => setCategory(c.key)}
                    >
                        {c.icon} {c.label}
                    </button>
                ))}
            </div>

            {/* Results count */}
            <div className="mp-count">
                {loading ? "Loading agents..." : `${agents.length} agent${agents.length !== 1 ? "s" : ""} found`}
            </div>

            {/* Agent grid */}
            {loading ? (
                <div className="mp-grid">
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : agents.length === 0 ? (
                <div className="mp-empty">
                    <span className="mp-empty__icon">🤖</span>
                    <p>No agents found{search ? ` matching "${search}"` : " in this category"}</p>
                </div>
            ) : (
                <div className="mp-grid">
                    {agents.map(agent => (
                        <button
                            key={agent.id}
                            className="mp-card"
                            onClick={() => handleSelectAgent(agent)}
                        >
                            <div className="mp-card__top">
                                <span className="mp-card__icon">
                                    {AGENT_CATEGORIES.find(c => c.key === agent.category)?.icon || "🤖"}
                                </span>
                                <div className="mp-card__header">
                                    <div className="mp-card__name">
                                        {agent.name}
                                        {agent.verified && <span className="mp-verified" title="Verified">✓</span>}
                                    </div>
                                    <div className="mp-card__creator">
                                        by {agent.creatorName || agent.creator.slice(0, 10) + "..."}
                                    </div>
                                </div>
                            </div>
                            <p className="mp-card__desc">{agent.description}</p>
                            <div className="mp-card__footer">
                                <span className="mp-pricing-badge" data-pricing={agent.pricing}>
                                    {agent.pricing === "free" ? "Free" : agent.pricing === "pay-per-use" ? "Pay-per-use" : "Subscription"}
                                </span>
                                {(agent.category === "governance" || agent.category === "security") && (
                                    <span className="mp-ai-badge" title="AI-powered agent">AI</span>
                                )}
                                {agent.rating > 0 && (
                                    <span className="mp-card__rating">
                                        ★ {agent.rating.toFixed(1)} ({agent.ratingCount})
                                    </span>
                                )}
                                {auth.token && (
                                    <span
                                        className={`mp-card__fav${favoriteIds.has(agent.id) ? " active" : ""}`}
                                        onClick={e => handleToggleFavorite(e, agent.id)}
                                        title={favoriteIds.has(agent.id) ? "Remove from favorites" : "Add to favorites"}
                                    >
                                        <Heart size={14} weight={favoriteIds.has(agent.id) ? "fill" : "regular"} />
                                    </span>
                                )}
                                <ArrowRight size={14} className="mp-card__arrow" />
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// ── Agent Detail View ───────────────────────────────────────

function AgentDetailView({
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

// ── Register Agent Form ──────────────────────────────────────

function RegisterAgentForm({ address, onClose, onRegistered, onError }: {
    address: string
    onClose: () => void
    onRegistered: () => void
    onError: (msg: string) => void
}) {
    // Close on Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        document.addEventListener("keydown", handleKey)
        return () => document.removeEventListener("keydown", handleKey)
    }, [onClose])

    const [submitting, setSubmitting] = useState(false)
    const [form, setForm] = useState({
        id: "",
        name: "",
        description: "",
        category: "custom" as AgentCategory,
        capabilities: "",
        endpoint: "",
        transport: "stdio" as "stdio" | "sse" | "streamable-http",
        pricing: "free" as "free" | "pay-per-use" | "subscription",
        pricePerCall: 0,
        version: "1.0.0",
    })

    const update = (field: string, value: string | number) => {
        setForm(prev => ({ ...prev, [field]: value }))
    }

    const idFromName = (name: string) =>
        name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

    const handleRegister = async () => {
        if (!form.name.trim() || !form.description.trim() || !form.endpoint.trim()) return
        setSubmitting(true)
        try {
            const msg = buildRegisterAgentMsg(
                address,
                REGISTRY_PATH,
                form.id || idFromName(form.name),
                form.name.trim(),
                form.description.trim(),
                form.category,
                form.capabilities,
                form.endpoint.trim(),
                form.transport,
                form.pricing,
                form.version,
                form.pricePerCall,
            )
            await doContractBroadcast([msg], "Register Agent")
            onRegistered()
        } catch (err) {
            onError(err instanceof Error ? err.message : "Agent registration failed")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="mp-register-overlay" onClick={onClose}>
            <div className="mp-register-modal" onClick={e => e.stopPropagation()}>
                <div className="mp-register-header">
                    <h2>Register Agent</h2>
                    <button className="mp-register-close" onClick={onClose}>×</button>
                </div>

                <div className="mp-register-form">
                    <label className="mp-field">
                        <span>Agent Name *</span>
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => { update("name", e.target.value); update("id", idFromName(e.target.value)) }}
                            placeholder="My Agent"
                            maxLength={100}
                        />
                    </label>

                    <label className="mp-field">
                        <span>ID</span>
                        <input type="text" value={form.id} onChange={e => update("id", e.target.value)} placeholder="my-agent" maxLength={50} />
                    </label>

                    <label className="mp-field">
                        <span>Description *</span>
                        <textarea
                            value={form.description}
                            onChange={e => update("description", e.target.value)}
                            placeholder="What does this agent do?"
                            maxLength={1000}
                            rows={3}
                        />
                    </label>

                    <label className="mp-field">
                        <span>Category</span>
                        <select value={form.category} onChange={e => update("category", e.target.value)}>
                            {AGENT_CATEGORIES.map(c => (
                                <option key={c.key} value={c.key}>{c.icon} {c.label}</option>
                            ))}
                        </select>
                    </label>

                    <label className="mp-field">
                        <span>Capabilities (comma-separated)</span>
                        <input
                            type="text"
                            value={form.capabilities}
                            onChange={e => update("capabilities", e.target.value)}
                            placeholder="Query data, Analyze proposals, Generate reports"
                        />
                    </label>

                    <label className="mp-field">
                        <span>MCP Endpoint *</span>
                        <input
                            type="text"
                            value={form.endpoint}
                            onChange={e => update("endpoint", e.target.value)}
                            placeholder="node /path/to/server.js or https://..."
                        />
                    </label>

                    <div className="mp-field-row">
                        <label className="mp-field">
                            <span>Transport</span>
                            <select value={form.transport} onChange={e => update("transport", e.target.value)}>
                                <option value="stdio">stdio</option>
                                <option value="sse">SSE</option>
                                <option value="streamable-http">Streamable HTTP</option>
                            </select>
                        </label>

                        <label className="mp-field">
                            <span>Pricing</span>
                            <select value={form.pricing} onChange={e => update("pricing", e.target.value)}>
                                <option value="free">Free</option>
                                <option value="pay-per-use">Pay-per-use</option>
                                <option value="subscription">Subscription</option>
                            </select>
                        </label>

                        <label className="mp-field">
                            <span>Version</span>
                            <input type="text" value={form.version} onChange={e => update("version", e.target.value)} placeholder="1.0.0" />
                        </label>
                    </div>

                    {form.pricing === "pay-per-use" && (
                        <label className="mp-field">
                            <span>Price per call (ugnot)</span>
                            <input type="number" value={form.pricePerCall} onChange={e => update("pricePerCall", parseInt(e.target.value, 10) || 0)} min={0} />
                        </label>
                    )}

                    <div className="mp-register-actions">
                        <button className="mp-register-cancel" onClick={onClose} disabled={submitting}>Cancel</button>
                        <button
                            className="mp-register-submit"
                            disabled={!form.name.trim() || !form.description.trim() || !form.endpoint.trim() || submitting}
                            onClick={handleRegister}
                        >
                            {submitting ? "Registering..." : "Register Agent"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
