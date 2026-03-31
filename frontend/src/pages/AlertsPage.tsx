/**
 * AlertsPage — Professional alerting configuration for GovDAO & Validators.
 *
 * Architecture:
 * - ClerkProvider is loaded via React.lazy() — ~45KB bundle isolated from main chunk (F1)
 * - AlertErrorBoundary wraps everything for crash isolation (F4)
 * - 3-section accordion layout matching Settings.tsx pattern (F8, F9)
 * - Uses export default for lazy import consistency (F13)
 *
 * @module pages/AlertsPage
 */

import { lazy, Suspense, useState, useEffect, useCallback } from "react"
import { Bell } from "@phosphor-icons/react"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"
import { AlertErrorBoundary } from "../components/alerts/AlertErrorBoundary"
import "./alerts.css"

// ── Lazy-load Clerk bundle (F1 — zero main bundle impact) ────
const ClerkAuthProvider = lazy(() => import("../components/auth/ClerkProvider"))

/** Route-level loader matching App.tsx pattern */
function PageLoader() {
    return <ConnectingLoader message="Loading alerts..." minHeight="30vh" />
}

// ── AlertsPage shell — error boundary + lazy Clerk ───────────
export default function AlertsPage() {
    return (
        <AlertErrorBoundary>
            <Suspense fallback={<PageLoader />}>
                <ClerkAuthProvider>
                    <AlertsContent />
                </ClerkAuthProvider>
            </Suspense>
        </AlertErrorBoundary>
    )
}

// ── Internal: auth-gated content ─────────────────────────────
// These imports are inside the lazy boundary (loaded with Clerk)
import { useClerkAuth } from "../hooks/useClerkAuth"
import { SignInButton } from "@clerk/clerk-react"
import { WebhookCard } from "../components/alerts/WebhookCard"
import { WebhookForm } from "../components/alerts/WebhookForm"
import { AlertContactForm } from "../components/alerts/AlertContactForm"
import { ReportScheduleForm } from "../components/alerts/ReportScheduleForm"
import { TelegramBotCards } from "../components/alerts/TelegramBotCards"
import * as api from "../lib/monitoringAuth"
import type { MonitoringWebhook, WebhookKind } from "../lib/monitoringAuth"

// ── Reusable section accordion (matches Settings.tsx) ────────
function Section({ title, icon, defaultOpen = false, children }: {
    title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode
}) {
    const [open, setOpen] = useState(defaultOpen)

    return (
        <div style={{
            borderRadius: 12,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            overflow: "hidden",
        }}>
            <button
                onClick={() => setOpen(!open)}
                style={{
                    width: "100%",
                    padding: "16px 20px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }}
            >
                <span style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", display: "flex", alignItems: "center", gap: 8 }}>
                    {icon} {title}
                </span>
                <span style={{ fontSize: 12, color: "#555", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>
                    ▼
                </span>
            </button>
            {open && (
                <div style={{
                    padding: "0 20px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    borderTop: "1px solid rgba(255,255,255,0.04)",
                }}>
                    {children}
                </div>
            )}
        </div>
    )
}

// ── Webhook sub-section ──────────────────────────────────────
function WebhookSection({ kind, label, token }: { kind: WebhookKind; label: string; token: () => Promise<string | null> }) {
    const [webhooks, setWebhooks] = useState<MonitoringWebhook[]>([])
    const [loading, setLoading] = useState(true)
    const [editing, setEditing] = useState<MonitoringWebhook | null>(null)
    const [showForm, setShowForm] = useState(false)
    const [deletingId, setDeletingId] = useState<number | null>(null)

    // Initial fetch
    useEffect(() => {
        let cancelled = false
        async function load() {
            const t = await token()
            if (!t || cancelled) return
            const data = await api.listWebhooks(t, kind)
            if (!cancelled) {
                setWebhooks(data)
                setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [token, kind])

    const refreshWebhooks = useCallback(async () => {
        const t = await token()
        if (!t) return
        const data = await api.listWebhooks(t, kind)
        setWebhooks(data)
    }, [token, kind])

    const handleCreate = async (data: Omit<MonitoringWebhook, "ID"> & { ID?: number }) => {
        const t = await token()
        if (!t) return false
        const ok = await api.createWebhook(t, kind, data)
        if (ok) {
            await refreshWebhooks()
            setShowForm(false)
        }
        return ok
    }

    const handleUpdate = async (data: Omit<MonitoringWebhook, "ID"> & { ID?: number }) => {
        const t = await token()
        if (!t || data.ID == null) return false
        const ok = await api.updateWebhook(t, kind, data as MonitoringWebhook)
        if (ok) {
            await refreshWebhooks()
            setEditing(null)
        }
        return ok
    }

    const handleDelete = async (id: number) => {
        const t = await token()
        if (!t) return
        setDeletingId(id)
        const ok = await api.deleteWebhook(t, kind, id)
        if (ok) await refreshWebhooks()
        setDeletingId(null)
    }

    return (
        <div style={{ paddingTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0" }}>{label}</div>
                {!showForm && !editing && (
                    <button
                        onClick={() => setShowForm(true)}
                        style={{
                            padding: "4px 10px", borderRadius: 6, border: "none",
                            cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
                            fontSize: 10, fontWeight: 600,
                            background: "rgba(0,212,170,0.08)", color: "#00d4aa",
                        }}
                    >
                        + Add
                    </button>
                )}
            </div>

            {/* Loading skeleton */}
            {loading && (
                <div className="alerts-webhook-grid">
                    <div className="alerts-skeleton" />
                    <div className="alerts-skeleton" />
                </div>
            )}

            {/* Webhook list */}
            {!loading && webhooks.length > 0 && (
                <div className="alerts-webhook-grid">
                    {webhooks.map(w => (
                        editing?.ID === w.ID ? (
                            <WebhookForm
                                key={w.ID}
                                initial={w}
                                onSubmit={handleUpdate}
                                onCancel={() => setEditing(null)}
                            />
                        ) : (
                            <WebhookCard
                                key={w.ID}
                                webhook={w}
                                kind={kind}
                                onEdit={setEditing}
                                onDelete={handleDelete}
                                deleting={deletingId === w.ID}
                            />
                        )
                    ))}
                </div>
            )}

            {/* Empty state */}
            {!loading && webhooks.length === 0 && !showForm && (
                <div style={{
                    padding: "16px 20px", borderRadius: 8,
                    background: "rgba(255,255,255,0.01)",
                    border: "1px dashed rgba(255,255,255,0.06)",
                    fontSize: 11, color: "#555",
                    fontFamily: "JetBrains Mono, monospace",
                    textAlign: "center",
                }}>
                    No {label.toLowerCase()} webhooks configured yet
                </div>
            )}

            {/* New webhook form */}
            {showForm && (
                <WebhookForm
                    onSubmit={handleCreate}
                    onCancel={() => setShowForm(false)}
                />
            )}
        </div>
    )
}

// ── Main content (requires auth) ─────────────────────────────
function AlertsContent() {
    const auth = useClerkAuth()
    const [contacts, setContacts] = useState<api.AlertContact[]>([])
    const [allWebhooks, setAllWebhooks] = useState<MonitoringWebhook[]>([])
    const [schedule, setSchedule] = useState<api.ReportSchedule | null>(null)
    const [loadingContacts, setLoadingContacts] = useState(false)

    // Fetch contacts + schedule on auth
    useEffect(() => {
        if (!auth.isSignedIn) return
        const load = async () => {
            const t = await auth.getToken()
            if (!t) return
            setLoadingContacts(true)
            const [c, s, wGov, wVal] = await Promise.all([
                api.listAlertContacts(t),
                api.getReportSchedule(t),
                api.listWebhooks(t, "govdao"),
                api.listWebhooks(t, "validator"),
            ])
            setContacts(c)
            setSchedule(s)
            setAllWebhooks([...wGov, ...wVal])
            setLoadingContacts(false)
        }
        load()
    }, [auth.isSignedIn]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Not signed in → Auth Gate ────────────────────────────
    if (!auth.isLoaded) return <PageLoader />

    if (!auth.isSignedIn) {
        return (
            <div className="alerts-page">
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f0f0f0", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    <Bell size={22} /> Alerts
                </h2>

                <div className="alerts-auth-gate">
                    <div className="alerts-auth-card">
                        <div style={{ fontSize: 48, marginBottom: 16 }}>🛡️</div>
                        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#f0f0f0", marginBottom: 8 }}>
                            Professional Blockchain Alerts
                        </h3>
                        <p style={{ fontSize: 12, color: "#888", marginBottom: 20, lineHeight: 1.6 }}>
                            Configure GovDAO & validator monitoring alerts.
                            Receive notifications on Discord, Slack, or Telegram.
                        </p>
                        <SignInButton mode="modal">
                            <button style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                height: 40, padding: "0 24px", borderRadius: 8,
                                background: "#00d4aa", color: "#000", fontSize: 13,
                                fontWeight: 600, border: "none", cursor: "pointer",
                                boxShadow: "0 0 24px rgba(0,212,170,0.2)",
                                fontFamily: "JetBrains Mono, monospace",
                            }}>
                                Sign in to configure alerts
                            </button>
                        </SignInButton>
                        <p style={{ fontSize: 10, color: "#555", marginTop: 12 }}>
                            ℹ️ Alerting auth is independent from your Gno wallet
                        </p>
                    </div>
                </div>

                {/* Telegram section is always visible */}
                <Section title="Telegram Bots" icon={<span>✈️</span>} defaultOpen>
                    <TelegramBotCards />
                </Section>
            </div>
        )
    }

    // ── Signed in → Full dashboard ───────────────────────────
    const refreshContacts = async () => {
        const t = await auth.getToken()
        if (!t) return
        const [c, wG, wV] = await Promise.all([
            api.listAlertContacts(t),
            api.listWebhooks(t, "govdao"),
            api.listWebhooks(t, "validator"),
        ])
        setContacts(c)
        setAllWebhooks([...wG, ...wV])
    }

    return (
        <div className="alerts-page">
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f0f0f0", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    <Bell size={22} /> Alerts
                </h2>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {auth.user && (
                        <span style={{ fontSize: 11, color: "#888", fontFamily: "JetBrains Mono, monospace" }}>
                            {auth.user.email || auth.user.fullName}
                        </span>
                    )}
                    <button
                        onClick={() => auth.signOut()}
                        style={{
                            padding: "4px 10px", borderRadius: 6, border: "none",
                            cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
                            fontSize: 10, fontWeight: 600,
                            background: "rgba(255,255,255,0.03)", color: "#888",
                        }}
                    >
                        Sign out
                    </button>
                </div>
            </div>

            {/* Section A: Telegram (easiest/instant setup — shown first) */}
            <Section title="Telegram Bots" icon={<span>✈️</span>} defaultOpen>
                <TelegramBotCards />
            </Section>

            {/* Section B: Webhooks */}
            <Section title="Webhooks" icon={<span>🔔</span>}>
                <WebhookSection kind="govdao" label="GovDAO" token={auth.getToken} />
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", margin: "8px 0" }} />
                <WebhookSection kind="validator" label="Validator" token={auth.getToken} />
            </Section>

            {/* Section C: Contacts & Schedule */}
            <Section title="Alert Contacts & Daily Report" icon={<span>👤</span>}>
                {loadingContacts ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
                        <div className="alerts-skeleton" style={{ height: 60 }} />
                        <div className="alerts-skeleton" style={{ height: 60 }} />
                    </div>
                ) : (
                    <>
                        <AlertContactForm
                            contacts={contacts}
                            webhooks={allWebhooks}
                            onAdd={async (data) => {
                                const t = await auth.getToken()
                                if (!t) return false
                                const ok = await api.createAlertContact(t, data)
                                if (ok) await refreshContacts()
                                return ok
                            }}
                            onUpdate={async (data) => {
                                const t = await auth.getToken()
                                if (!t) return false
                                const ok = await api.updateAlertContact(t, data)
                                if (ok) await refreshContacts()
                                return ok
                            }}
                            onDelete={async (id) => {
                                const t = await auth.getToken()
                                if (!t) return false
                                const ok = await api.deleteAlertContact(t, id)
                                if (ok) await refreshContacts()
                                return ok
                            }}
                        />
                        <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", margin: "8px 0" }} />
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0" }}>Daily Report</div>
                        <ReportScheduleForm
                            schedule={schedule}
                            onSave={async (h, m, tz) => {
                                const t = await auth.getToken()
                                if (!t) return false
                                const ok = await api.updateReportSchedule(t, h, m, tz)
                                if (ok) {
                                    const s = await api.getReportSchedule(t)
                                    setSchedule(s)
                                }
                                return ok
                            }}
                        />
                    </>
                )}
            </Section>
        </div>
    )
}
