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
    const isVisible = useRef(true)

    useEffect(() => {
        const handleVisibility = () => {
            isVisible.current = document.visibilityState === "visible"
        }
        document.addEventListener("visibilitychange", handleVisibility)
        return () => document.removeEventListener("visibilitychange", handleVisibility)
    }, [])

    useEffect(() => {
        let mounted = true
        const fetchMetrics = async () => {
            if (!isVisible.current) return
            try {
                const stats = await getNetworkStats(GNO_RPC_URL)
                if (!mounted) return
                setMetrics({
                    blockHeight: stats.blockHeight,
                    validatorCount: stats.totalValidators,
                    avgBlockTime: stats.avgBlockTime,
                    chainId: stats.chainId || GNO_CHAIN_ID,
                })
                setError(false)
            } catch {
                if (mounted) setError(true)
            }
        }

        fetchMetrics()
        const interval = setInterval(fetchMetrics, POLL_INTERVAL)
        return () => { mounted = false; clearInterval(interval) }
    }, [])

    if (error && !metrics) return null

    return (
        <div className="chain-metrics-banner">
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
                    <span className="chain-metric__live" title="Live — updates every 30s" />
                </>
            ) : (
                <div className="k-shimmer" style={{ height: 16, width: 200, borderRadius: 4 }} />
            )}
        </div>
    )
}
