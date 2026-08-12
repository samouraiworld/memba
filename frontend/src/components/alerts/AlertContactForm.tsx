/**
 * AlertContactForm — Combined list + add/edit form for alert contacts.
 *
 * Alert contacts link a validator moniker to a Discord/Slack mention tag
 * so CRITICAL alerts can @mention the right person.
 *
 * @module components/alerts/AlertContactForm
 */

import { useState } from "react"
import type { AlertContact, MonitoringWebhook, MutationResult } from "../../lib/monitoringAuth"

interface Props {
    contacts: AlertContact[]
    webhooks: MonitoringWebhook[]
    onAdd: (data: Omit<AlertContact, "ID">) => Promise<MutationResult>
    onUpdate: (data: AlertContact) => Promise<MutationResult>
    onDelete: (id: number) => Promise<boolean>
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

const btnStyle: React.CSSProperties = {
    padding: "6px 12px", borderRadius: 6, border: "none",
    cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
    fontSize: 11, fontWeight: 600,
}

const errorStyle: React.CSSProperties = {
    fontSize: 11, color: "var(--color-danger)",
    fontFamily: "JetBrains Mono, monospace",
    padding: "8px 12px", borderRadius: 8,
    background: "rgba(255,59,48,0.06)",
    border: "1px solid rgba(255,59,48,0.15)",
}

const helpStyle: React.CSSProperties = {
    fontSize: 10, lineHeight: 1.5,
    color: "var(--color-text-muted)",
    fontFamily: "JetBrains Mono, monospace",
    marginTop: 6,
}

export function AlertContactForm({ contacts, webhooks, onAdd, onUpdate, onDelete }: Props) {
    const [editing, setEditing] = useState<AlertContact | null>(null)
    const [moniker, setMoniker] = useState("")
    const [nameContact, setNameContact] = useState("")
    const [mentionTag, setMentionTag] = useState("")
    const [webhookId, setWebhookId] = useState(webhooks[0]?.ID || 0)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const resetForm = () => {
        setEditing(null)
        setMoniker("")
        setNameContact("")
        setMentionTag("")
        setWebhookId(webhooks[0]?.ID || 0)
        setError(null)
    }

    const startEdit = (c: AlertContact) => {
        setEditing(c)
        setMoniker(c.Moniker)
        setNameContact(c.NameContact)
        setMentionTag(c.MentionTag)
        setWebhookId(c.IDwebhook)
        setError(null)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!moniker.trim() || !nameContact.trim()) return

        // A contact with no linked webhook is accepted by the server but can
        // never fire: SendAllValidatorAlerts matches mentions on
        // user_id + moniker + id_webhook, and id_webhook is never 0 there.
        if (!webhookId) {
            setError("Add a validator webhook first — a contact with no linked webhook never fires.")
            return
        }

        setSubmitting(true)
        setError(null)
        const data = {
            Moniker: moniker.trim(),
            NameContact: nameContact.trim(),
            MentionTag: mentionTag.trim(),
            IDwebhook: webhookId,
        }

        const result = editing
            ? await onUpdate({ ...data, ID: editing.ID })
            : await onAdd(data)

        setSubmitting(false)
        // Keep the typed values on refusal — the server's reasons are all
        // fixable in place (wrong webhook, blank field, non-numeric tag), and
        // wiping the form would force a full retype for each one.
        if (result.ok) resetForm()
        else setError(result.error || "Request failed")
    }

    const handleDelete = async (id: number) => {
        if (!window.confirm("Delete this alert contact?")) return
        await onDelete(id)
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
            {/* Existing contacts */}
            {contacts.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {contacts.map(c => (
                        <div key={c.ID} style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "10px 14px", borderRadius: 8,
                            background: "rgba(255,255,255,0.02)",
                            border: "1px solid rgba(255,255,255,0.04)",
                        }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>
                                    {c.NameContact}
                                </div>
                                <div style={{ fontSize: 10, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
                                    {c.Moniker} · {c.MentionTag || "no tag"}
                                </div>
                            </div>
                            <button onClick={() => startEdit(c)}
                                style={{ ...btnStyle, background: "rgba(0,212,170,0.08)", color: "var(--color-primary)" }}>
                                Edit
                            </button>
                            <button onClick={() => handleDelete(c.ID)}
                                style={{ ...btnStyle, background: "rgba(255,59,48,0.08)", color: "var(--color-danger)" }}>
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Add / Edit form */}
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>
                    {editing ? "Edit Contact" : "Add Contact"}
                </div>

                <div>
                    <label style={labelStyle}>Validator Moniker</label>
                    <input
                        id="contact-moniker"
                        value={moniker}
                        onChange={e => setMoniker(e.target.value)}
                        placeholder="e.g. validator-name"
                        style={inputStyle}
                    />
                </div>

                <div>
                    <label style={labelStyle}>Contact Name</label>
                    <input
                        id="contact-name"
                        value={nameContact}
                        onChange={e => setNameContact(e.target.value)}
                        placeholder="e.g. On-call Engineer"
                        style={inputStyle}
                    />
                </div>

                <div>
                    <label style={labelStyle}>Mention Tag (Discord/Slack ID)</label>
                    <input
                        id="contact-mention"
                        value={mentionTag}
                        onChange={e => setMentionTag(e.target.value)}
                        placeholder="e.g. 123456789012345678"
                        aria-describedby="contact-mention-help"
                        style={inputStyle}
                    />
                    <div id="contact-mention-help" style={helpStyle}>
                        The raw numeric user ID (a snowflake) — digits only. Not a username,
                        and not wrapped in <code>&lt;@…&gt;</code>; the alert adds that itself.
                        On Discord: User Settings → Advanced → Developer Mode, then right-click
                        the user → "Copy User ID". A non-numeric value is rejected by the server.
                        <br />
                        Mentions only fire on <strong>CRITICAL</strong> validator alerts — never
                        WARNING or RESOLVED — and only through the webhook picked in "Linked
                        Webhook". Telegram has no per-user mention syntax, so tags are not sent
                        there. An empty tag is valid: the alert still fires, it just doesn't ping.
                    </div>
                </div>

                {webhooks.length > 0 && (
                    <div>
                        <label style={labelStyle}>Linked Webhook</label>
                        <select
                            id="contact-webhook"
                            value={webhookId}
                            onChange={e => setWebhookId(Number(e.target.value))}
                            style={{ ...inputStyle, cursor: "pointer" }}
                        >
                            {webhooks.map(w => (
                                <option key={w.ID} value={w.ID}>
                                    {w.Type === "discord" ? "🔵" : "🟢"} {w.Description || w.URL.slice(0, 40)}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {error && <div style={errorStyle}>{error}</div>}

                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button
                        type="submit"
                        disabled={submitting}
                        style={{
                            ...btnStyle,
                            background: submitting ? "rgba(0,212,170,0.08)" : "var(--color-brand)",
                            color: submitting ? "var(--color-brand)" : "var(--color-text-contrast)",
                        }}
                    >
                        {submitting ? "…" : editing ? "Update" : "Add Contact"}
                    </button>
                    {editing && (
                        <button type="button" onClick={resetForm}
                            style={{ ...btnStyle, background: "rgba(255,255,255,0.03)", color: "var(--color-text-secondary)" }}>
                            Cancel
                        </button>
                    )}
                </div>
            </form>
        </div>
    )
}
