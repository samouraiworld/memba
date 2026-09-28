/**
 * ConnectSection — Gnockpit-style "CONNECT" card.
 * Shows: P2P seed address (click-to-copy) + genesis SHA256 (click-to-copy).
 * Source: /status → node_info.listen_addr + sync_info genesis fields.
 */

import { useEffect, useRef, useState } from "react"
import type { NodeStatus } from "../../lib/validators"
import { publicRpcLink } from "./nodeStateLinks"

interface ConnectSectionProps {
    nodeStatus: NodeStatus | null
}

function CopyRow({ label, value }: { label: string; value: string }) {
    const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle")
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => () => {
        if (resetTimer.current) clearTimeout(resetTimer.current)
    }, [])

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value)
            setCopyState("copied")
        } catch {
            setCopyState("failed")
        }
        if (resetTimer.current) clearTimeout(resetTimer.current)
        resetTimer.current = setTimeout(() => setCopyState("idle"), 1500)
    }

    return (
        <button
            type="button"
            className="cs-row"
            onClick={() => void copy()}
            aria-label={`${copyState === "copied" ? "Copied" : copyState === "failed" ? "Could not copy" : "Copy"} ${label}: ${value}`}
            aria-live="polite"
            style={{ width: "100%", minHeight: 44, border: 0, background: "transparent", color: "inherit", font: "inherit", textAlign: "left" }}
        >
            <span className="cs-row__label">{label}</span>
            <span className="cs-row__value hk-mono">{value || "—"}</span>
            <span className="cs-row__copy" aria-hidden="true">
                {copyState === "copied" ? "✓ copied" : copyState === "failed" ? "Copy failed" : "⎘"}
            </span>
        </button>
    )
}

function UnavailableRow({ label, reason }: { label: string; reason: string }) {
    return <div className="cs-row" aria-label={`${label}: ${reason}`} style={{ width: "100%", minHeight: 44 }}>
        <span className="cs-row__label">{label}</span>
        <span className="cs-row__value">{reason}</span>
    </div>
}

export function ConnectSection({ nodeStatus }: ConnectSectionProps) {
    if (!nodeStatus) {
        return (
            <div className="hk-card hk-connect">
                <div className="hk-card__title">
                    <span className="hk-card__icon">🔗</span>
                    CONNECT
                </div>
                <div className="hk-unavail">
                    <span className="hk-unavail__icon">⚠</span>
                    <span>Node status unavailable</span>
                </div>
            </div>
        )
    }

    // /status often advertises a bind address (0.0.0.0, ::, or LAN). Such an
    // address is not a public seed and must not be offered as connection data.
    const listenAddr = nodeStatus.listenAddr?.trim() ?? ""
    const publicListen = listenAddr ? publicRpcLink(listenAddr) : undefined
    const nodeId = nodeStatus.nodeId?.trim() ?? ""
    const seed = publicListen && nodeId && nodeId.toLowerCase() !== "unknown"
        ? `${nodeId}@${new URL(publicListen).host}` : null
    const appHash = nodeStatus.genesisHash?.trim()
    const usableHash = appHash && appHash.toLowerCase() !== "unknown" ? appHash : null

    return (
        <div className="hk-card hk-connect">
            <div className="hk-card__title">
                <span className="hk-card__icon">🔗</span>
                CONNECT
            </div>
            {seed
                ? <CopyRow label="P2P address" value={seed} />
                : <UnavailableRow label="P2P address" reason="Public dialable address not advertised" />}
            {/* Note: /status exposes latest_app_hash, not genesis file sha256.
                Genesis hash requires fetching /genesis which is expensive. */}
            {usableHash
                ? <CopyRow label="latest app hash" value={usableHash} />
                : <UnavailableRow label="latest app hash" reason="Unavailable" />}
        </div>
    )
}
