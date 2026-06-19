/**
 * StatusStrip — thin brand/network heartbeat bar for the Control Room home.
 *
 * Displays: メンバー wordmark · chain label · live dot · block height · validators.
 * Data sourced from useNetwork() (chain label) and useNetworkPulse() (live stats).
 *
 * @module components/home/StatusStrip
 */

import { useNetwork } from "../../hooks/useNetwork"
import { useNetworkPulse } from "../../hooks/home/useNetworkPulse"
import "./home.css"

export function StatusStrip() {
    const { label } = useNetwork()
    const { blockHeight, totalValidators, loading } = useNetworkPulse()

    return (
        <div className="status-strip" data-testid="status-strip">
            <span className="status-strip__wordmark">メンバー</span>
            <span className="status-strip__sep" aria-hidden="true">·</span>
            <span className="status-strip__chain">{label}</span>
            <span
                className={`status-strip__dot${loading ? " status-strip__dot--syncing" : ""}`}
                aria-label={loading ? "syncing" : "live"}
                title={loading ? "syncing" : "live"}
            />
            {!loading && (
                <>
                    <span className="status-strip__stat" data-testid="status-block-height">
                        #{blockHeight.toLocaleString()}
                    </span>
                    <span className="status-strip__sep" aria-hidden="true">·</span>
                    <span className="status-strip__stat" data-testid="status-validators">
                        {totalValidators}v
                    </span>
                </>
            )}
        </div>
    )
}
