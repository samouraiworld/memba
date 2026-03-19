/**
 * WhatsNewToast — Bottom-right slide-in notification shown once per version.
 *
 * Shows returning users what changed in this version.
 * First-time visitors (no "memba_whats_new_seen" key) are skipped.
 * Dismissing stores APP_VERSION → never shown again for this version.
 *
 * @module components/ui/WhatsNewToast
 */

import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { APP_VERSION } from "../../lib/config"

const STORAGE_KEY = "memba_whats_new_seen"
const SHOW_DELAY_MS = 3000

/** Check if user is returning (has seen any previous version). */
function shouldShow(): boolean {
    try {
        const seen = localStorage.getItem(STORAGE_KEY)
        // First-time visitor: key doesn't exist → skip
        if (seen === null) return false
        // Returning user who hasn't seen this version → show
        return seen !== APP_VERSION
    } catch {
        return false
    }
}

function dismiss(): void {
    try {
        localStorage.setItem(STORAGE_KEY, APP_VERSION)
    } catch { /* quota */ }
}

/** Initialize the storage key for first-time visitors so the toast only shows on version bumps.
 *  This runs at module load time — safe because Layout imports this module eagerly. */
function initWhatsNewKey(): void {
    try {
        if (localStorage.getItem(STORAGE_KEY) === null) {
            localStorage.setItem(STORAGE_KEY, APP_VERSION)
        }
    } catch { /* SSR */ }
}

// Seed on module load
initWhatsNewKey()

export function WhatsNewToast() {
    const navigate = useNavigate()
    const [visible, setVisible] = useState(false)
    const [exiting, setExiting] = useState(false)

    useEffect(() => {
        if (!shouldShow()) return
        const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS)
        return () => clearTimeout(timer)
    }, [])

    // Escape key dismisses
    useEffect(() => {
        if (!visible) return
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") handleDismiss()
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible])

    const handleDismiss = useCallback(() => {
        setExiting(true)
        setTimeout(() => {
            dismiss()
            setVisible(false)
        }, 200)
    }, [])

    if (!visible) return null

    return (
        <>
            {/* Backdrop — click outside to dismiss */}
            <div
                onClick={handleDismiss}
                style={{
                    position: "fixed", inset: 0, zIndex: 999,
                    background: "rgba(0,0,0,0.2)",
                }}
            />

            {/* Toast */}
            <div
                role="dialog"
                aria-label="What's new in Memba"
                style={{
                    position: "fixed",
                    bottom: 24, right: 24,
                    zIndex: 1000,
                    width: "min(380px, calc(100vw - 32px))",
                    background: "rgba(18,18,22,0.95)",
                    backdropFilter: "blur(16px)",
                    border: "1px solid rgba(0,212,170,0.15)",
                    borderRadius: 16,
                    padding: "24px 20px 20px",
                    fontFamily: "JetBrains Mono, monospace",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03)",
                    animation: exiting
                        ? "membaToastOut 200ms ease-in forwards"
                        : "membaToastIn 300ms ease-out",
                }}
            >
                {/* Close button */}
                <button
                    onClick={handleDismiss}
                    aria-label="Close"
                    style={{
                        position: "absolute", top: 12, right: 14,
                        background: "none", border: "none", color: "#555",
                        cursor: "pointer", fontSize: 16, padding: 4,
                        lineHeight: 1,
                    }}
                >
                    ✕
                </button>

                {/* Header */}
                <div style={{ fontSize: 15, fontWeight: 700, color: "#f0f0f0", marginBottom: 16 }}>
                    🚀 What's New
                </div>

                {/* Network entries */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                    <NetworkItem
                        color="#00d4aa"
                        title="Testnet 12 — Now the default"
                        desc="Experiment, deploy, hack freely."
                    />
                    <NetworkItem
                        color="#8b5cf6"
                        title="Betanet (gnoland1) — Now available"
                        desc="First persistent chain. Select it in the network dropdown."
                    />
                    <NetworkItem
                        color="#2dd4bf"
                        title="Test11 — Active (40 validators)"
                        desc="Community-maintained testnet, fully supported."
                    />
                </div>

                {/* Links */}
                <div style={{ fontSize: 10, color: "#666", marginBottom: 14, display: "flex", gap: 12 }}>
                    <span
                        onClick={() => { handleDismiss(); navigate("/settings") }}
                        style={{ color: "#888", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}
                    >
                        Settings ⚙
                    </span>
                    <span
                        onClick={() => { handleDismiss(); navigate("/changelogs") }}
                        style={{ color: "#888", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}
                    >
                        Full changelog →
                    </span>
                </div>

                {/* Dismiss button */}
                <button
                    onClick={handleDismiss}
                    autoFocus
                    style={{
                        width: "100%",
                        padding: "10px 0",
                        borderRadius: 10,
                        border: "1px solid rgba(0,212,170,0.2)",
                        background: "rgba(0,212,170,0.08)",
                        color: "#00d4aa",
                        cursor: "pointer",
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: 12, fontWeight: 600,
                        transition: "background 0.15s",
                    }}
                    onMouseOver={e => (e.currentTarget.style.background = "rgba(0,212,170,0.15)")}
                    onMouseOut={e => (e.currentTarget.style.background = "rgba(0,212,170,0.08)")}
                >
                    Got it ✓
                </button>
            </div>

            {/* Animations */}
            <style>{`
                @keyframes membaToastIn {
                    from { opacity: 0; transform: translateY(20px) scale(0.97); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }
                @keyframes membaToastOut {
                    from { opacity: 1; transform: translateY(0) scale(1); }
                    to   { opacity: 0; transform: translateY(12px) scale(0.97); }
                }
                @media (prefers-reduced-motion: reduce) {
                    @keyframes membaToastIn { from { opacity: 0; } to { opacity: 1; } }
                    @keyframes membaToastOut { from { opacity: 1; } to { opacity: 0; } }
                }
                @media (max-width: 640px) {
                    [role="dialog"][aria-label="What's new in Memba"] {
                        bottom: 0 !important;
                        right: 0 !important;
                        width: 100% !important;
                        border-radius: 16px 16px 0 0 !important;
                    }
                }
            `}</style>
        </>
    )
}

function NetworkItem({ color, title, desc }: { color: string; title: string; desc: string }) {
    return (
        <div style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            borderLeft: `3px solid ${color}`,
        }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#e0e0e0", marginBottom: 2 }}>
                ▸ {title}
            </div>
            <div style={{ fontSize: 10, color: "#777", lineHeight: 1.4 }}>
                {desc}
            </div>
        </div>
    )
}
