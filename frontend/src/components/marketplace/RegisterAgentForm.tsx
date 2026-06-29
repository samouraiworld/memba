/**
 * RegisterAgentForm — modal form for registering a new agent on-chain.
 *
 * Extracted from Marketplace.tsx for maintainability.
 */

import { useState, useEffect } from "react"
import {
    AGENT_CATEGORIES,
    type AgentCategory,
} from "../../lib/agentRegistry"
import { buildRegisterAgentMsg } from "../../lib/agentTemplate"
import { doContractBroadcast } from "../../lib/grc20"
import { MEMBA_DAO } from "../../lib/config"

const REGISTRY_PATH = MEMBA_DAO.agentRegistryPath

export function RegisterAgentForm({ address, onClose, onRegistered, onError }: {
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
