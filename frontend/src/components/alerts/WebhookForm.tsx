/**
 * WebhookForm — Form for creating/editing webhooks.
 *
 * Uses native form state (no form library — Memba convention).
 * HTTPS URL validation, type selector, optional chain selector.
 *
 * @module components/alerts/WebhookForm
 */

import { useState } from "react"
import { NETWORKS } from "../../lib/config"
import type { MonitoringWebhook, WebhookType } from "../../lib/monitoringAuth"

interface Props {
    /** If provided, form is in edit mode */
    initial?: MonitoringWebhook
    onSubmit: (data: Omit<MonitoringWebhook, "ID"> & { ID?: number }) => Promise<boolean>
    onCancel?: () => void
    loading?: boolean
}

const WEBHOOK_URL_REGEX = /^https:\/\/.+/

const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.3)", color: "var(--color-text)",
    fontFamily: "JetBrains Mono, monospace", fontSize: 12,
    boxSizing: "border-box",
}

const labelStyle: React.CSSProperties = {
    fontSize: 11, color: "var(--color-text-secondary)",
    fontFamily: "JetBrains Mono, monospace",
    display: "block", marginBottom: 4,
}

const errorStyle: React.CSSProperties = {
    fontSize: 10, color: "var(--color-danger)", marginTop: 2,
    fontFamily: "JetBrains Mono, monospace",
}

const btnStyle: React.CSSProperties = {
    padding: "8px 16px", borderRadius: 8, border: "none",
    cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
    fontSize: 12, fontWeight: 600,
}

export function WebhookForm({ initial, onSubmit, onCancel, loading }: Props) {
    const [url, setUrl] = useState(initial?.URL || "")
    const [type, setType] = useState<WebhookType>(initial?.Type || "discord")
    const [description, setDescription] = useState(initial?.Description || "")
    const [chainId, setChainId] = useState(initial?.ChainID || "")
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [submitting, setSubmitting] = useState(false)

    const validate = (): boolean => {
        const errs: Record<string, string> = {}
        if (!url.trim()) errs.url = "URL is required"
        else if (!WEBHOOK_URL_REGEX.test(url.trim())) errs.url = "Must be a valid HTTPS URL"
        if (!description.trim()) errs.description = "Description is required"
        setErrors(errs)
        return Object.keys(errs).length === 0
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!validate()) return

        setSubmitting(true)
        const success = await onSubmit({
            ...(initial?.ID != null ? { ID: initial.ID } : {}),
            URL: url.trim(),
            Type: type,
            Description: description.trim(),
            ChainID: chainId || null,
        })

        setSubmitting(false)
        if (success && !initial) {
            // Reset form on successful create
            setUrl("")
            setDescription("")
            setChainId("")
            setErrors({})
        }
    }

    const isEdit = initial != null

    return (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
            {/* URL */}
            <div>
                <label style={labelStyle}>Webhook URL</label>
                <input
                    id="webhook-url"
                    type="url"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://discord.com/api/webhooks/..."
                    style={inputStyle}
                />
                {errors.url && <div style={errorStyle}>{errors.url}</div>}
            </div>

            {/* Type */}
            <div>
                <label style={labelStyle}>Platform</label>
                <select
                    id="webhook-type"
                    value={type}
                    onChange={e => setType(e.target.value as WebhookType)}
                    style={{ ...inputStyle, cursor: "pointer" }}
                >
                    <option value="discord">🔵 Discord</option>
                    <option value="slack">🟢 Slack</option>
                </select>
            </div>

            {/* Description */}
            <div>
                <label style={labelStyle}>Description</label>
                <input
                    id="webhook-description"
                    type="text"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="e.g. Team alerts channel"
                    style={inputStyle}
                    maxLength={100}
                />
                {errors.description && <div style={errorStyle}>{errors.description}</div>}
            </div>

            {/* Chain selector */}
            <div>
                <label style={labelStyle}>Chain (optional — empty = all chains)</label>
                <select
                    id="webhook-chain"
                    value={chainId}
                    onChange={e => setChainId(e.target.value)}
                    style={{ ...inputStyle, cursor: "pointer" }}
                >
                    <option value="">All chains</option>
                    {Object.entries(NETWORKS).map(([key, net]) => (
                        <option key={key} value={net.chainId}>{net.label}</option>
                    ))}
                </select>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                    type="submit"
                    disabled={submitting || loading}
                    style={{
                        ...btnStyle,
                        background: submitting ? "rgba(0,212,170,0.08)" : "#00d4aa",
                        color: submitting ? "#00d4aa" : "#000",
                        opacity: submitting ? 0.7 : 1,
                    }}
                >
                    {submitting ? "Saving…" : isEdit ? "Update Webhook" : "Add Webhook"}
                </button>
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        style={{ ...btnStyle, background: "rgba(255,255,255,0.03)", color: "var(--color-text-secondary)" }}
                    >
                        Cancel
                    </button>
                )}
            </div>
        </form>
    )
}
