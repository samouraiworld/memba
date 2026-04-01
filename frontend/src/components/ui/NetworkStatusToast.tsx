/**
 * NetworkStatusToast — Shows network health status when degraded.
 *
 * Sprint 12: Polls active network /status, shows toast when slow/halted.
 * Dismissible per-session. Re-shows if status changes.
 */

import { useState, useEffect, useRef } from "react"
import { GNO_RPC_URL, GNO_CHAIN_ID } from "../../lib/config"
import { checkNetworkHealth, formatBlockAge, type NetworkHealth } from "../../lib/networkStatus"

const POLL_INTERVAL = 60_000 // 1 minute
const DISMISS_KEY = "memba_net_status_dismissed"

const STATUS_CONFIG: Record<NetworkHealth, { color: string; label: string; emoji: string } | null> = {
    healthy: null, // Don't show toast for healthy
    slow: { color: "#f5a623", label: "Slow", emoji: "⚠️" },
    halted: { color: "#f44336", label: "Halted", emoji: "🔴" },
    unreachable: { color: "#f44336", label: "Unreachable", emoji: "❌" },
}

export function NetworkStatusToast() {
    const [health, setHealth] = useState<NetworkHealth>("healthy")
    const [blockAge, setBlockAge] = useState(0)
    const [dismissed, setDismissed] = useState(() => {
        try { return sessionStorage.getItem(DISMISS_KEY) === GNO_CHAIN_ID } catch { return false }
    })
    const lastHealth = useRef<NetworkHealth>("healthy")

    useEffect(() => {
        let cancelled = false

        const poll = async () => {
            const result = await checkNetworkHealth(GNO_RPC_URL)
            if (cancelled) return
            setHealth(result.health)
            setBlockAge(result.blockAge)

            if (result.health !== lastHealth.current && result.health !== "healthy") {
                setDismissed(false)
                try { sessionStorage.removeItem(DISMISS_KEY) } catch { /* */ }
            }
            lastHealth.current = result.health
        }

        const timeout = setTimeout(poll, 0)
        const interval = setInterval(poll, POLL_INTERVAL)
        return () => { cancelled = true; clearTimeout(timeout); clearInterval(interval) }
    }, [])

    const dismiss = () => {
        setDismissed(true)
        try { sessionStorage.setItem(DISMISS_KEY, GNO_CHAIN_ID) } catch { /* */ }
    }

    const config = STATUS_CONFIG[health]
    if (!config || dismissed) return null

    return (
        <div
            className="net-status-toast"
            style={{ borderColor: `${config.color}30`, background: `${config.color}08` }}
            role="status"
            aria-live="polite"
        >
            <span className="net-status-toast__icon">{config.emoji}</span>
            <div className="net-status-toast__body">
                <span className="net-status-toast__label" style={{ color: config.color }}>
                    {GNO_CHAIN_ID}: {config.label}
                </span>
                <span className="net-status-toast__detail">
                    Last block: {formatBlockAge(blockAge)}
                </span>
            </div>
            <button className="net-status-toast__dismiss" onClick={dismiss}>×</button>
        </div>
    )
}
