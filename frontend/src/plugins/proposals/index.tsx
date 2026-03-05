/**
 * Proposals Plugin — Placeholder stub for v2.0-α.
 *
 * Proves the plugin lazy-loading pipeline works end-to-end.
 * Will be replaced with real proposal management in a later feature.
 */

import type { PluginProps } from "../types"

export default function ProposalsPlugin({ realmPath }: PluginProps) {
    return (
        <div
            id="plugin-proposals"
            style={{
                padding: "24px 28px",
                borderRadius: 12,
                background: "rgba(0,212,170,0.03)",
                border: "1px solid rgba(0,212,170,0.1)",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 20 }}>📋</span>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>
                    Proposals Plugin
                </h3>
                <span style={{
                    fontSize: 9, padding: "2px 8px", borderRadius: 4,
                    background: "rgba(0,212,170,0.08)", color: "#00d4aa",
                    fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                }}>
                    v1.0.0
                </span>
            </div>
            <p style={{
                fontSize: 12, color: "#888",
                fontFamily: "JetBrains Mono, monospace",
                margin: 0,
            }}>
                Governance proposal management for <code style={{ color: "#666" }}>{realmPath}</code>.
                This plugin is loaded lazily and will be fully implemented in a later milestone.
            </p>
        </div>
    )
}
