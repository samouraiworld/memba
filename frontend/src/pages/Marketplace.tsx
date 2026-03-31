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
    const [showRegister, setShowRegister] = useState(false)
    const [reviewRating, setReviewRating] = useState(5)
    const [reviewComment, setReviewComment] = useState("")

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

                    {/* Review Form */}
                    <div className="mp-detail__section">
                        <h3>Leave a Review</h3>
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
                                <span className="mp-review-hint">
                                    Reviews are stored on-chain when registry is deployed
                                </span>
                                <button
                                    className="mp-review-submit"
                                    disabled={!reviewComment.trim()}
                                    onClick={() => {
                                        setReviewComment("")
                                        setReviewRating(5)
                                    }}
                                >
                                    Submit Review
                                </button>
                            </div>
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
                <div>
                    <h1>🤖 AI Agent Marketplace</h1>
                    <p>Discover and connect AI agents for the Gno ecosystem via MCP</p>
                </div>
                <button
                    className="mp-register-btn"
                    onClick={() => setShowRegister(true)}
                >
                    + Register Agent
                </button>
            </div>

            {/* Register Agent Modal */}
            {showRegister && (
                <RegisterAgentForm onClose={() => setShowRegister(false)} />
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

// ── Register Agent Form ──────────────────────────────────────

function RegisterAgentForm({ onClose }: { onClose: () => void }) {
    // Close on Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        document.addEventListener("keydown", handleKey)
        return () => document.removeEventListener("keydown", handleKey)
    }, [onClose])

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
                            <input type="number" value={form.pricePerCall} onChange={e => update("pricePerCall", parseInt(e.target.value) || 0)} min={0} />
                        </label>
                    )}

                    <div className="mp-register-actions">
                        <button className="mp-register-cancel" onClick={onClose}>Cancel</button>
                        <button
                            className="mp-register-submit"
                            disabled={!form.name.trim() || !form.description.trim() || !form.endpoint.trim()}
                            onClick={() => {
                                // In production: call buildRegisterAgentMsg + doContractBroadcast
                                alert(`Agent "${form.name}" ready for on-chain registration.\nDeploy the agent registry realm first, then register via MsgCall.`)
                                onClose()
                            }}
                        >
                            Register Agent
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
