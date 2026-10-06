/**
 * MovedNotice — on the retired classic site only (lib/retiredSite), tells
 * visitors that Memba moved to memba.club before that host starts redirecting,
 * and what stays behind: whatever this browser saved for this address.
 * Dismissing it hides it for this tab's session; it returns on the next visit.
 *
 * @module components/ui/MovedNotice
 */
import { useState } from "react"
import { useLocation } from "react-router-dom"
import { isRetiredHost, NEW_ORIGIN } from "../../lib/retiredSite"

const DISMISSED_KEY = "memba_moved_notice_dismissed"

function dismissedThisSession(): boolean {
    try {
        return sessionStorage.getItem(DISMISSED_KEY) === "1"
    } catch {
        return false
    }
}

export function MovedNotice() {
    const { pathname, search, hash } = useLocation()
    const [dismissed, setDismissed] = useState(dismissedThisSession)
    if (dismissed || !isRetiredHost()) return null

    const dismiss = () => {
        try { sessionStorage.setItem(DISMISSED_KEY, "1") } catch { /* storage blocked: hidden until the next load */ }
        setDismissed(true)
    }

    return (
        <div
            role="status"
            data-testid="moved-notice"
            style={{
                background: "var(--realm-banner-bg, linear-gradient(135deg, rgba(33,150,243,0.15), rgba(63,81,181,0.12)))",
                border: "var(--realm-banner-border, 1px solid rgba(33,150,243,0.35))",
                borderRadius: "var(--radius-md, 10px)",
                padding: "12px 16px",
                margin: "0 0 16px 0",
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                fontSize: "0.875rem",
                color: "var(--text-primary, var(--color-text-primary))",
            }}
        >
            <div style={{ flex: 1, lineHeight: 1.5 }}>
                <strong>Memba has moved to memba.club.</strong> This address will soon send you there.{" "}
                <a href={`${NEW_ORIGIN}${pathname}${search}${hash}`} style={{ color: "inherit", fontWeight: 600, textDecoration: "underline" }}>Open this page on memba.club</a>
                <br />
                What this browser saved here stays here: saved DAOs, drafts and settings. Note what you need before you go.
                Your multisigs and their transactions are kept by Memba's server and are on memba.club too.
                You will connect your wallet and sign in again there.
            </div>
            <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss notice"
                style={{
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    fontSize: "1.1rem",
                    lineHeight: 1,
                    padding: "4px 8px",
                    minWidth: "32px",
                    minHeight: "32px",
                }}
            >
                ×
            </button>
        </div>
    )
}
