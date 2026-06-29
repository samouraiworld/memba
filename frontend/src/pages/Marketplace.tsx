/**
 * Marketplace — AI Agent Marketplace page.
 *
 * Browse, search, register, and review AI agents on-chain.
 * Agents expose capabilities via MCP (Model Context Protocol).
 *
 * Components extracted to components/marketplace/:
 * - AgentDetailView — agent detail panel with stats, MCP config, reviews
 * - RegisterAgentForm — modal form for on-chain agent registration
 * - CreditSection — credit deposit/refund for pay-per-use agents
 *
 * @module pages/Marketplace
 */

import { useState, useEffect, useMemo, useDeferredValue, useCallback } from "react"
import { useOutletContext, useParams, useNavigate } from "react-router-dom"
import { ArrowRight } from "@phosphor-icons/react"
import { Heart } from "@phosphor-icons/react"
import {
    fetchAgents,
    fetchAgentDetail,
    invalidateAgentCache,
    generateMcpConfig,
    toggleFavorite,
    getFavorites,
    AGENT_CATEGORIES,
    type AgentListing,
    type AgentCategory,
} from "../lib/agentRegistry"
import { MEMBA_DAO } from "../lib/config"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import { AgentDetailView } from "../components/marketplace/AgentDetailView"
import { RegisterAgentForm } from "../components/marketplace/RegisterAgentForm"
import type { LayoutContext } from "../types/layout"
import "./marketplace.css"

const MARKETPLACE_ENABLED = import.meta.env.VITE_ENABLE_MARKETPLACE === "true"

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
    const { agentId: agentIdParam } = useParams<{ agentId?: string }>()
    const navigate = useNavigate()

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
        // Update URL for deep-linking (without full page reload)
        navigate(`/marketplace/${agent.id}`, { replace: true })
        // Fetch full detail from chain
        try {
            const detail = await fetchAgentDetail(agent.id)
            if (detail) {
                setSelectedAgent(detail)
            }
        } catch { /* use the listing data we already have */ }
    }, [navigate])

    // Deep-link: auto-select agent from URL param
    useEffect(() => {
        if (!agentIdParam || allAgents.length === 0) return
        const agent = allAgents.find(a => a.id === agentIdParam)
        if (agent) {
            // Use queueMicrotask to avoid synchronous setState-in-effect lint rule
            queueMicrotask(() => handleSelectAgent(agent))
        } else {
            fetchAgentDetail(agentIdParam).then(detail => {
                if (detail) queueMicrotask(() => setSelectedAgent(detail))
            }).catch(() => {})
        }
    }, [agentIdParam, allAgents, handleSelectAgent])

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
                onBack={() => { setSelectedAgent(null); navigate("/marketplace", { replace: true }) }}
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
