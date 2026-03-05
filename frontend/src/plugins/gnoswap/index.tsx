/**
 * GnoSwap Plugin — Entry point for DEX integration.
 *
 * Wraps SwapView with GnoSwap availability detection.
 * Registered in the plugin registry as "gnoswap".
 */

import { useState, useEffect } from "react"
import type { PluginProps } from "../types"
import { gnoswapAvailable } from "./queries"
import { GNO_RPC_URL, getGnoSwapPaths } from "../../lib/config"
import SwapView from "./SwapView"

export default function GnoSwapPlugin(props: PluginProps) {
    const paths = getGnoSwapPaths()
    const [available, setAvailable] = useState<boolean | null>(paths ? null : false)

    useEffect(() => {
        if (!paths) return
        gnoswapAvailable(GNO_RPC_URL, paths).then(setAvailable).catch(() => setAvailable(false))
    }, [paths])

    if (available === null) {
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0" }}>
                <div className="k-shimmer" style={{ height: 60, borderRadius: 8, background: "#111" }} />
            </div>
        )
    }

    if (!available) {
        return (
            <div
                id="gnoswap-not-available"
                style={{
                    padding: "24px 28px",
                    borderRadius: 12,
                    background: "rgba(245,166,35,0.03)",
                    border: "1px solid rgba(245,166,35,0.1)",
                    textAlign: "center",
                }}
            >
                <div style={{ fontSize: 28, marginBottom: 10 }}>🔄</div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: "0 0 6px" }}>
                    GnoSwap Not Available
                </h3>
                <p style={{
                    fontSize: 12, color: "#888", margin: 0,
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    GnoSwap is not deployed on the current chain.
                    Switch to a chain with GnoSwap contracts to access DEX features.
                </p>
            </div>
        )
    }

    return <SwapView {...props} />
}
