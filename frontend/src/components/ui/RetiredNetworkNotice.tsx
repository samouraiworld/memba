/**
 * RetiredNetworkNotice — one-time, dismissible notice shown after
 * RetiredNetworkRedirect moved a `/<retired>/…` link onto its successor
 * network ("The Pearl testnet has been retired — you're now on gno.land
 * mainnet.").
 *
 * Shown once per redirect: the redirect hands the retired key over in router
 * state, the notice captures it on mount and then REPLACES the history entry
 * with a state-free copy. Router state lives in `history.state`, which a reload
 * restores — without the replace, reloading the page would show the notice
 * again. The notice stays on the page it landed on and never follows the user
 * elsewhere, and once dismissed it never returns for that retired network.
 * Storage is best-effort: when it is blocked the notice still renders and
 * dismisses for the session, it just cannot remember the dismissal.
 *
 * @module components/ui/RetiredNetworkNotice
 */
import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
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
    const navigate = useNavigate()
    const { pathname, search, hash } = location
    const incoming = (location.state as Partial<RetiredNetworkState> | null)?.retiredNetwork
    // The shell (and this notice with it) mounts fresh on every redirect —
    // NetworkGate renders the redirect instead of the shell for a retired key —
    // so the handed-over key is captured once, at mount.
    const [captured] = useState(() => incoming ? { key: incoming, pathname } : null)
    const [dismissedNow, setDismissedNow] = useState<string | null>(null)

    // Consume the router state: replace this entry with a state-free copy so a
    // reload (history.state survives it) or Back/Forward does not re-show it.
    useEffect(() => {
        if (incoming) navigate({ pathname, search, hash }, { replace: true, state: null })
    }, [incoming, navigate, pathname, search, hash])

    const retiredKey = incoming ?? (captured && captured.pathname === pathname ? captured.key : undefined)
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
