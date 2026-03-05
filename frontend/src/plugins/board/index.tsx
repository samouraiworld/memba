/**
 * Board Plugin — Entry point for the DAO discussion board.
 *
 * Wraps BoardView with board existence detection.
 * Registered in the plugin registry as "board".
 */

import { useState, useEffect } from "react"
import type { PluginProps } from "../types"
import { boardExists } from "./parser"
import { GNO_RPC_URL } from "../../lib/config"
import BoardView from "./BoardView"

export default function BoardPlugin(props: PluginProps) {
    const boardPath = `${props.realmPath}_board`
    const [exists, setExists] = useState<boolean | null>(null)

    useEffect(() => {
        boardExists(GNO_RPC_URL, boardPath).then(setExists).catch(() => setExists(false))
    }, [boardPath])

    if (exists === null) {
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0" }}>
                <div className="k-shimmer" style={{ height: 60, borderRadius: 8, background: "#111" }} />
            </div>
        )
    }

    if (!exists) {
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
                <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: "0 0 6px" }}>
                    No Board Deployed
                </h3>
                <p style={{
                    fontSize: 12, color: "#888", margin: 0,
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    This DAO doesn&apos;t have a discussion board yet.
                    Board can be deployed alongside a DAO from the Create DAO wizard.
                </p>
            </div>
        )
    }

    return <BoardView {...props} />
}
