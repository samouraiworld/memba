/**
 * ChainMetricsBanner — Live chain metrics for the Directory page.
 *
 * Shows block height, validator count, avg block time, and chain ID.
 * Polls every 30s with Page Visibility API pause.
 *
 * Phase 3a — Directory "Gnoweb Explorer Hub".
 *
 * @module components/directory/ChainMetricsBanner
 */

import { useState, useEffect, useRef } from "react"
import { getNetworkStats } from "../../lib/validators"
import { GNO_RPC_URL, GNO_CHAIN_ID } from "../../lib/config"

interface ChainMetrics {
    blockHeight: number
    validatorCount: number
    avgBlockTime: number
    chainId: string
}

const POLL_INTERVAL = 30_000

export function ChainMetricsBanner() {
    const [metrics, setMetrics] = useState<ChainMetrics | null>(null)
    const [error, setError] = useState(false)
    const [lastChecked, setLastChecked] = useState<Date | null>(null)
    const retryRef = useRef<(() => void) | null>(null)

    useEffect(() => {
        let mounted = true
        let inFlight = false
        let refreshOnSettle = false
        let controller: AbortController | null = null
        const fetchMetrics = async (queueIfBusy = false) => {
            if (!mounted || document.visibilityState !== "visible") return
            if (inFlight) {
                if (queueIfBusy) refreshOnSettle = true
                return
            }
            inFlight = true
            const requestController = new AbortController()
            controller = requestController
            try {
                const stats = await getNetworkStats(GNO_RPC_URL, undefined, requestController.signal)
                if (!mounted) return
                setMetrics({
                    blockHeight: stats.blockHeight,
                    validatorCount: stats.totalValidators,
                    avgBlockTime: stats.avgBlockTime,
                    chainId: stats.chainId || GNO_CHAIN_ID,
                })
                setLastChecked(new Date())
                setError(false)
            } catch {
                if (mounted && !requestController.signal.aborted) setError(true)
            } finally {
                inFlight = false
                controller = null
                if (refreshOnSettle) {
                    refreshOnSettle = false
                    void fetchMetrics()
                }
            }
        }

        const handleVisibility = () => {
            if (document.visibilityState === "visible") void fetchMetrics(true)
        }
        retryRef.current = () => { void fetchMetrics(true) }
        document.addEventListener("visibilitychange", handleVisibility)
        void fetchMetrics()
        const interval = setInterval(() => { void fetchMetrics() }, POLL_INTERVAL)
        return () => {
            mounted = false
            controller?.abort()
            retryRef.current = null
            clearInterval(interval)
            document.removeEventListener("visibilitychange", handleVisibility)
        }
    }, [])

    return (
        <div className="chain-metrics-banner" aria-label="Chain metrics">
            {metrics ? (
                <>
                    <div className="chain-metric">
                        <span className="chain-metric__label">Block</span>
                        <span className="chain-metric__value">{metrics.blockHeight.toLocaleString()}</span>
                    </div>
                    <div className="chain-metric__sep" />
                    <div className="chain-metric">
                        <span className="chain-metric__label">Validators</span>
                        <span className="chain-metric__value">{metrics.validatorCount}</span>
                    </div>
                    <div className="chain-metric__sep" />
                    <div className="chain-metric">
                        <span className="chain-metric__label">Avg Block</span>
                        <span className="chain-metric__value">{metrics.avgBlockTime > 0 ? `${metrics.avgBlockTime.toFixed(1)}s` : "—"}</span>
                    </div>
                    <div className="chain-metric__sep" />
                    <div className="chain-metric">
                        <span className="chain-metric__label">Chain</span>
                        <span className="chain-metric__value">{metrics.chainId}</span>
                    </div>
                    {!error && <span className="chain-metric__live" title="Latest check succeeded — refreshes every 30s" />}
                </>
            ) : !error ? (
                <div className="k-shimmer" style={{ height: 16, width: 200, borderRadius: 4 }} />
            ) : null}
            {error && (
                <span className="chain-metric__label" role="status">
                    {lastChecked ? `Stale · last checked ${lastChecked.toISOString().slice(11, 16)} UTC. Refresh failed.` : "Chain metrics unavailable."}
                    {" "}<button type="button" className="dir-gnoweb-link" onClick={() => retryRef.current?.()}>Retry</button>
                </span>
            )}
        </div>
    )
}
