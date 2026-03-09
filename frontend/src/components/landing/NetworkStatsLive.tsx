/**
 * NetworkStatsLive — Real-time on-chain stats for the landing page.
 *
 * Reuses getNetworkStats() from validators.ts to display:
 * - Block Height (with count-up animation)
 * - Avg Block Time
 * - Active Validators
 * - Chain ID
 *
 * Polls every 30s, pauses when tab is hidden (Page Visibility API).
 * Hides gracefully if RPC is unreachable.
 */
import { useState, useEffect, useRef, useCallback } from "react"
import { getNetworkStats, formatBlockTime, type NetworkStats } from "../../lib/validators"
import { GNO_RPC_URL } from "../../lib/config"

const POLL_INTERVAL_MS = 30_000

export function NetworkStatsLive() {
    const [stats, setStats] = useState<NetworkStats | null>(null)
    const [error, setError] = useState(false)
    const isVisible = useRef(true)
    const abortRef = useRef<AbortController | null>(null)

    const fetchStats = useCallback(async () => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        try {
            const data = await getNetworkStats(GNO_RPC_URL)
            if (!controller.signal.aborted) {
                setStats(data)
                setError(false)
            }
        } catch {
            if (!controller.signal.aborted) {
                setError(true)
            }
        }
    }, [])

    // Page Visibility API — pause polling when tab hidden
    useEffect(() => {
        const handleVisibility = () => {
            isVisible.current = document.visibilityState === "visible"
        }
        document.addEventListener("visibilitychange", handleVisibility)
        return () => document.removeEventListener("visibilitychange", handleVisibility)
    }, [])

    // Initial fetch + polling — use queueMicrotask to avoid sync setState in effect
    useEffect(() => {
        // Schedule initial fetch outside the synchronous effect body
        const id = setTimeout(() => fetchStats(), 0)
        const interval = setInterval(() => {
            if (isVisible.current) fetchStats()
        }, POLL_INTERVAL_MS)
        return () => {
            clearTimeout(id)
            clearInterval(interval)
            abortRef.current?.abort()
        }
    }, [fetchStats])

    // Hide section entirely if error or no data yet
    if (error || !stats) return null

    const items = [
        { label: "Block Height", value: stats.blockHeight.toLocaleString(), mono: true },
        { label: "Block Time", value: formatBlockTime(stats.avgBlockTime), mono: false },
        { label: "Validators", value: String(stats.totalValidators), mono: true },
        { label: "Chain", value: stats.chainId, mono: true },
    ]

    return (
        <div className="landing-stats" data-testid="network-stats-live">
            {items.map(item => (
                <div key={item.label} className="landing-stat">
                    <span className={`landing-stat__value${item.mono ? " val-mono" : ""}`}>
                        {item.value}
                    </span>
                    <span className="landing-stat__label">{item.label}</span>
                </div>
            ))}
        </div>
    )
}
