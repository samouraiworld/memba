/**
 * Board/Channels Plugin — Entry point for DAO discussion channels.
 *
 * v2.1a: Detects both _channels (v2) and _board (v1) realm suffixes.
 * Wraps BoardView with realm existence detection.
 * Registered in the plugin registry as "board" (id unchanged for compat).
 */

import { useState, useEffect } from "react"
import type { PluginProps } from "../types"
import { detectChannelRealm } from "./parser"
import { GNO_RPC_URL } from "../../lib/config"
import BoardView from "./BoardView"

export default function BoardPlugin(props: PluginProps) {
    const [detectedPath, setDetectedPath] = useState<string | null | undefined>(undefined)

    useEffect(() => {
        detectChannelRealm(GNO_RPC_URL, props.realmPath)
            .then(setDetectedPath)
            .catch(() => setDetectedPath(null))
    }, [props.realmPath])

    // Loading
    if (detectedPath === undefined) {
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0" }}>
                <div className="k-shimmer" style={{ height: 60, borderRadius: 8, background: "#111" }} />
            </div>
        )
    }

    // No board/channels realm found
    if (detectedPath === null) {
        return (
            <div
                id="board-not-deployed"
                style={{
                    padding: "24px 28px",
                    borderRadius: 12,
                    background: "rgba(245,166,35,0.03)",
                    border: "1px solid rgba(245,166,35,0.1)",
                    textAlign: "center",
                }}
            >
                <div style={{ fontSize: 28, marginBottom: 10 }}>💬</div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: "0 0 6px" }}>
                    No Channels Deployed
                </h3>
                <p style={{
                    fontSize: 12, color: "#888", margin: 0,
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    This DAO doesn&apos;t have discussion channels yet.
                    Channels can be deployed alongside a DAO from the Create DAO wizard.
                </p>
            </div>
        )
    }

    // Pass detected realm path — could be _channels or _board
    return <BoardView {...props} boardPath={detectedPath} />
}
