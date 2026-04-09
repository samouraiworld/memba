/**
 * WebhookCard — Display card for a single webhook configuration.
 *
 * Shows truncated URL, type icon (Discord/Slack), description, chain badge.
 * Edit/Delete actions with window.confirm() guard.
 *
 * @module components/alerts/WebhookCard
 */

import type { MonitoringWebhook, WebhookKind } from "../../lib/monitoringAuth"

interface Props {
    webhook: MonitoringWebhook
    kind: WebhookKind
    onEdit: (webhook: MonitoringWebhook) => void
    onDelete: (id: number) => void
    deleting?: boolean
}

const cardStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
}

const labelStyle: React.CSSProperties = {
    fontSize: 10, color: "var(--color-text-muted)",
    fontFamily: "JetBrains Mono, monospace",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
}

const urlStyle: React.CSSProperties = {
    fontSize: 11, color: "var(--color-text)",
    fontFamily: "JetBrains Mono, monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
}

const btnStyle: React.CSSProperties = {
    padding: "4px 10px", borderRadius: 6, border: "none",
    cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
    fontSize: 10, fontWeight: 600,
}

function truncateUrl(url: string, max = 45): string {
    if (url.length <= max) return url
    return url.slice(0, max) + "…"
}

export function WebhookCard({ webhook, kind, onEdit, onDelete, deleting }: Props) {
    const typeIcon = webhook.Type === "discord" ? "🔵" : "🟢"
    const typeLabel = webhook.Type === "discord" ? "Discord" : "Slack"

    const handleDelete = () => {
        if (!window.confirm(`Delete this ${kind} ${typeLabel} webhook?\n\n${truncateUrl(webhook.URL, 60)}`)) return
        onDelete(webhook.ID)
    }

    return (
        <div style={cardStyle}>
            {/* Header: type + description */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>{typeIcon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                    {webhook.Description || typeLabel}
                </span>
                {webhook.ChainID && (
                    <span style={{
                        fontSize: 9, padding: "2px 6px", borderRadius: 4,
                        background: "rgba(0,212,170,0.08)", color: "var(--color-primary)",
                        fontFamily: "JetBrains Mono, monospace",
                    }}>
                        {webhook.ChainID}
                    </span>
                )}
            </div>

            {/* URL */}
            <div>
                <div style={labelStyle}>Webhook URL</div>
                <div style={urlStyle} title={webhook.URL}>{truncateUrl(webhook.URL)}</div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                    onClick={() => onEdit(webhook)}
                    style={{ ...btnStyle, background: "rgba(0,212,170,0.08)", color: "var(--color-primary)" }}
                >
                    Edit
                </button>
                <button
                    onClick={handleDelete}
                    disabled={deleting}
                    style={{
                        ...btnStyle,
                        background: "rgba(255,59,48,0.08)", color: "var(--color-danger)",
                        opacity: deleting ? 0.5 : 1,
                    }}
                >
                    {deleting ? "…" : "Delete"}
                </button>
            </div>
        </div>
    )
}
