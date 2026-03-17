/**
 * ConnectSection — Gnockpit-style "CONNECT" card.
 * Shows: P2P seed address (click-to-copy) + genesis SHA256 (click-to-copy).
 * Source: /status → node_info.listen_addr + sync_info genesis fields.
 */

import { useState } from "react"
import type { NodeStatus } from "../../lib/validators"

interface ConnectSectionProps {
    nodeStatus: NodeStatus | null
}

function CopyRow({ label, value }: { label: string; value: string }) {
    const [copied, setCopied] = useState(false)

    const copy = () => {
        navigator.clipboard.writeText(value)
            .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
            .catch(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
    }

    return (
        <div className="cs-row" onClick={copy} title="Click to copy" role="button" tabIndex={0}
            onKeyDown={e => e.key === "Enter" && copy()}>
            <span className="cs-row__label">{label}</span>
            <span className="cs-row__value hk-mono">{value || "—"}</span>
            <span className="cs-row__copy">{copied ? "✓ copied" : "⎘"}</span>
        </div>
    )
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

    return (
        <div className="hk-card hk-connect">
            <div className="hk-card__title">
                <span className="hk-card__icon">🔗</span>
                CONNECT
            </div>
            <CopyRow label="seed" value={nodeStatus.listenAddr || "unknown"} />
            {/* Note: /status exposes latest_app_hash, not genesis file sha256.
                Genesis hash requires fetching /genesis which is expensive. */}
            <CopyRow label="app hash" value={nodeStatus.genesisHash || "unknown"} />
        </div>
    )
}
