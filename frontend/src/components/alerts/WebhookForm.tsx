/**
 * WebhookForm — Form for creating/editing webhooks.
 *
 * Uses native form state (no form library — Memba convention).
 * Chain options come from gnomonitoring /info, not Memba's NETWORKS map:
 * they are different namespaces and the service is the authority on which
 * chain_id values it will accept.
 *
 * @module components/alerts/WebhookForm
 */

import { useEffect, useState } from "react"
import { GNO_MONITORING_CHAIN } from "../../lib/config"
import { fetchEnabledChains } from "../../lib/gnomonitoring"
import { chainOptionsFor, validateWebhookUrl } from "../../lib/webhookForm"
import type {
    MonitoringWebhook,
    MutationResult,
    WebhookInput,
    WebhookType,
} from "../../lib/monitoringAuth"

interface Props {
    /** If provided, form is in edit mode */
    initial?: MonitoringWebhook
    onSubmit: (data: WebhookInput) => Promise<MutationResult>
    onCancel?: () => void
    loading?: boolean
}

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
    const [chains, setChains] = useState<string[]>([])
    const [chainsLoading, setChainsLoading] = useState(true)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        let cancelled = false
        fetchEnabledChains().then(list => {
            if (cancelled) return
            setChains(list)
            setChainsLoading(false)
            // Preselect the chain Memba is pointed at, when the service offers
            // it — chain_id is required, so an empty default on create is just
            // a guaranteed validation error. CREATE ONLY: never invent a scope
            // for an existing webhook, or editing an unrelated field would
            // silently rescope a legacy row that has no chain.
            if (!initial) {
                setChainId(prev =>
                    prev || (list.includes(GNO_MONITORING_CHAIN) ? GNO_MONITORING_CHAIN : ""))
            }
        })
        return () => { cancelled = true }
        // Mount-once: the registry is fetched a single time per form instance.
        // `initial` is read only to decide the create-time preselect and must
        // not retrigger the fetch. Same convention as AlertsPage's loader.
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const validate = (): boolean => {
        const errs: Record<string, string> = {}
        const urlError = validateWebhookUrl(type, url)
        if (urlError) errs.url = urlError
        if (!description.trim()) errs.description = "Description is required"
        // The server rejects an empty chain_id outright; catch it here so the
        // user gets a field-level message instead of an opaque 400.
        if (!chainId) errs.chain = "Chain is required"
        setErrors(errs)
        return Object.keys(errs).length === 0
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitError(null)
        if (!validate()) return

        setSubmitting(true)
        const result = await onSubmit({
            ...(initial?.ID != null ? { ID: initial.ID } : {}),
            URL: url.trim(),
            Type: type,
            Description: description.trim(),
            ChainID: chainId,
        })
        setSubmitting(false)

        if (!result.ok) {
            setSubmitError(result.error || "Could not save the webhook")
            return
        }

        if (!initial) {
            // Reset form on successful create
            setUrl("")
            setDescription("")
            setErrors({})
        }
    }

    const isEdit = initial != null
    const chainOptions = chainOptionsFor(chains, chainId)

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
                <label style={labelStyle}>Chain</label>
                <select
                    id="webhook-chain"
                    value={chainId}
                    onChange={e => setChainId(e.target.value)}
                    style={{ ...inputStyle, cursor: "pointer" }}
                >
                    {!chainId && (
                        <option value="">
                            {chainsLoading ? "Loading chains…" : "Select a chain"}
                        </option>
                    )}
                    {chainOptions.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
                {errors.chain && <div style={errorStyle}>{errors.chain}</div>}
                {!chainsLoading && chains.length === 0 && (
                    <div style={errorStyle}>
                        Could not load available chains from the monitoring service.
                    </div>
                )}
            </div>

            {/* Server-side refusal */}
            {submitError && <div style={errorStyle}>{submitError}</div>}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                    type="submit"
                    disabled={submitting || loading}
                    style={{
                        ...btnStyle,
                        background: submitting ? "rgba(0,212,170,0.08)" : "var(--color-brand)",
                        color: submitting ? "var(--color-brand)" : "var(--color-text-contrast)",
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
