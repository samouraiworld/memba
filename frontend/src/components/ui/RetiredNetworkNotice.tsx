/**
 * RetiredNetworkNotice — one-time, dismissible notice shown after
 * RetiredNetworkRedirect moved a `/<retired>/…` link onto its successor
 * network ("The Pearl testnet has been retired — you're now on gno.land
 * mainnet.").
 *
 * Shown only when the current history entry was reached through that redirect
 * (router state), and never again once dismissed for that retired network.
 * Storage is best-effort: when it is blocked the notice still renders and
 * dismisses for the session, it just cannot remember the dismissal.
 *
 * @module components/ui/RetiredNetworkNotice
 */
import { useState } from "react"
import { useLocation } from "react-router-dom"
import {
    retiredNetworkMessage,
    retiredNoticeStorageKey,
    type RetiredNetworkState,
} from "../../lib/retiredNetwork"

function isDismissed(retiredKey: string): boolean {
    try {
        return localStorage.getItem(retiredNoticeStorageKey(retiredKey)) === "1"
    } catch {
        return false
    }
}

function rememberDismissal(retiredKey: string): void {
    try {
        localStorage.setItem(retiredNoticeStorageKey(retiredKey), "1")
    } catch { /* storage blocked — dismissal lasts for this render only */ }
}

export function RetiredNetworkNotice() {
    const location = useLocation()
    const retiredKey = (location.state as Partial<RetiredNetworkState> | null)?.retiredNetwork
    const [dismissedNow, setDismissedNow] = useState<string | null>(null)

    if (!retiredKey || dismissedNow === retiredKey || isDismissed(retiredKey)) return null
    const message = retiredNetworkMessage(retiredKey)
    if (!message) return null

    const dismiss = () => {
        rememberDismissal(retiredKey)
        setDismissedNow(retiredKey)
    }

    return (
        <div
            role="status"
            data-testid="retired-network-notice"
            style={{
                background: "var(--realm-banner-bg, linear-gradient(135deg, rgba(33,150,243,0.15), rgba(63,81,181,0.12)))",
                border: "var(--realm-banner-border, 1px solid rgba(33,150,243,0.35))",
                borderRadius: "var(--radius-md, 10px)",
                padding: "12px 16px",
                margin: "0 0 16px 0",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                fontSize: "0.875rem",
                color: "var(--text-primary, var(--color-text-primary))",
            }}
        >
            <div style={{ flex: 1 }}>{message}</div>
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
