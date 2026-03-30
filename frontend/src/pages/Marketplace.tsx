/**
 * Marketplace — AI Agent Marketplace page.
 *
 * Phase 4a: Browse, search, and connect AI agents for the Gno ecosystem.
 * Agents expose capabilities via MCP (Model Context Protocol).
 *
 * @module pages/Marketplace
 */

import { useState, useEffect, useMemo, useDeferredValue, useCallback } from "react"
import { ArrowRight } from "@phosphor-icons/react"
import {
    searchAgents,
    generateMcpConfig,
    AGENT_CATEGORIES,
    type AgentListing,
    type AgentCategory,
} from "../lib/agentRegistry"
import "./marketplace.css"

export default function Marketplace() {
    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const [category, setCategory] = useState<AgentCategory | "all">("all")
    const [selectedAgent, setSelectedAgent] = useState<AgentListing | null>(null)
    const [copied, setCopied] = useState(false)

    useEffect(() => { document.title = "AI Agent Marketplace — Memba" }, [])

    const agents = useMemo(() =>
        searchAgents(deferredSearch, category === "all" ? undefined : category),
        [deferredSearch, category],
    )

    const handleCopyConfig = useCallback(async (agent: AgentListing) => {
        const config = generateMcpConfig(agent)
        try {
            await navigator.clipboard.writeText(JSON.stringify(config, null, 2))
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch { /* clipboard not available */ }
    }, [])

    // ── Agent Detail Panel ────────────────────────────────────
    if (selectedAgent) {
        const config = generateMcpConfig(selectedAgent)
        return (
            <div className="mp-page animate-fade-in">
                <button className="mp-back" onClick={() => setSelectedAgent(null)}>
                    ← Back to Marketplace
                </button>

                <div className="mp-detail">
                    <div className="mp-detail__header">
                        <div className="mp-detail__icon">
                            {AGENT_CATEGORIES.find(c => c.key === selectedAgent.category)?.icon || "🤖"}
                        </div>
                        <div>
                            <h1 className="mp-detail__name">
                                {selectedAgent.name}
                                {selectedAgent.verified && <span className="mp-verified" title="Verified by Memba">✓</span>}
                            </h1>
                            <div className="mp-detail__meta">
                                <span>by {selectedAgent.creatorName || selectedAgent.creator}</span>
                                <span>v{selectedAgent.version}</span>
                                <span className="mp-pricing-badge" data-pricing={selectedAgent.pricing}>
                                    {selectedAgent.pricing === "free" ? "Free" : selectedAgent.pricing === "pay-per-use" ? `${selectedAgent.pricePerCall / 1000}k ugnot/call` : "Subscription"}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Stats row */}
                    <div className="mp-detail__stats">
                        <div className="mp-stat">
                            <span className="mp-stat__value">{selectedAgent.rating > 0 ? `${selectedAgent.rating.toFixed(1)}` : "—"}</span>
                            <span className="mp-stat__label">Rating</span>
                        </div>
                        <div className="mp-stat">
                            <span className="mp-stat__value">{selectedAgent.ratingCount}</span>
                            <span className="mp-stat__label">Reviews</span>
                        </div>
                        <div className="mp-stat">
                            <span className="mp-stat__value">{selectedAgent.totalCalls}</span>
                            <span className="mp-stat__label">Invocations</span>
                        </div>
                    </div>

                    {/* Description */}
                    <div className="mp-detail__section">
                        <h3>About</h3>
                        <pre className="mp-detail__desc">{selectedAgent.longDescription || selectedAgent.description}</pre>
                    </div>

                    {/* Capabilities */}
                    <div className="mp-detail__section">
                        <h3>Capabilities</h3>
                        <div className="mp-caps">
                            {selectedAgent.capabilities.map(c => (
                                <span key={c} className="mp-cap">{c}</span>
                            ))}
                        </div>
                    </div>

                    {/* MCP Config */}
                    <div className="mp-detail__section">
                        <h3>Connect Agent</h3>
                        <p className="mp-detail__hint">
                            Add this to your MCP client config (Claude Desktop, Cursor, etc.):
                        </p>
                        <div className="mp-config">
                            <pre className="mp-config__code">{JSON.stringify(config, null, 2)}</pre>
                            <button
                                className="mp-config__copy"
                                onClick={() => handleCopyConfig(selectedAgent)}
                            >
                                {copied ? "✓ Copied!" : "Copy Config"}
                            </button>
                        </div>
                    </div>

                    {/* Tags */}
                    <div className="mp-detail__tags">
                        {selectedAgent.tags.map(t => (
                            <span key={t} className="mp-tag">{t}</span>
                        ))}
                    </div>
                </div>
            </div>
        )
    }

    // ── Marketplace Grid ──────────────────────────────────────
    return (
        <div className="mp-page animate-fade-in">
            <div className="mp-header">
                <h1>🤖 AI Agent Marketplace</h1>
                <p>Discover and connect AI agents for the Gno ecosystem via MCP</p>
            </div>

            {/* Search */}
            <input
                type="text"
                placeholder="Search agents by name, capability, or tag..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="mp-search"
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
                {agents.length} agent{agents.length !== 1 ? "s" : ""} found
            </div>

            {/* Agent grid */}
            {agents.length === 0 ? (
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
                            onClick={() => setSelectedAgent(agent)}
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
                                {agent.rating > 0 && (
                                    <span className="mp-card__rating">
                                        ★ {agent.rating.toFixed(1)} ({agent.ratingCount})
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
