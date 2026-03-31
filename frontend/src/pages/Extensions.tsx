/**
 * Extensions Hub — Dedicated page listing all Memba extensions with status.
 *
 * Replaces the sidebar "Plugins" section with a central hub.
 * Shows active, coming soon, and future extensions with cards.
 */

import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { PuzzlePiece, ArrowRight, ChatCircleDots, ListChecks, ArrowsLeftRight, Trophy } from "@phosphor-icons/react"
import type { LayoutContext } from "../types/layout"

interface ExtensionCard {
    id: string
    name: string
    icon: React.ReactNode
    description: string
    status: "active" | "coming-soon" | "planned"
    route?: string
    statusLabel: string
}

const EXTENSIONS: ExtensionCard[] = [
    {
        id: "proposals",
        name: "Proposal Explorer",
        icon: <ListChecks size={28} weight="duotone" />,
        description: "Search, filter, and manage DAO governance proposals with tier voting, execution tracking, and timeline views.",
        status: "active",
        statusLabel: "Active",
        route: "proposals",
    },
    {
        id: "board",
        name: "Channels & Messaging",
        icon: <ChatCircleDots size={28} weight="duotone" />,
        description: "Discord-like text channels with threaded replies, role-based access, voice & video rooms via Jitsi Meet.",
        status: "active",
        statusLabel: "Active",
        route: "board",
    },
    {
        id: "gnoswap",
        name: "GnoSwap Integration",
        icon: <ArrowsLeftRight size={28} weight="duotone" />,
        description: "DEX integration — swap tokens, add liquidity, manage pools directly from your DAO treasury.",
        status: "coming-soon",
        statusLabel: "Coming Soon",
    },
    {
        id: "leaderboard",
        name: "Leaderboard",
        icon: <Trophy size={28} weight="duotone" />,
        description: "Member ranking by on-chain contributions, governance participation, and community engagement.",
        status: "coming-soon",
        statusLabel: "Coming Soon",
    },
]

const statusStyles: Record<string, { bg: string; color: string; border: string }> = {
    "active": { bg: "rgba(0,212,170,0.08)", color: "#00d4aa", border: "rgba(0,212,170,0.2)" },
    "coming-soon": { bg: "rgba(245,166,35,0.08)", color: "#f5a623", border: "rgba(245,166,35,0.2)" },
    "planned": { bg: "rgba(255,255,255,0.04)", color: "#666", border: "rgba(255,255,255,0.08)" },
}

export function Extensions() {
    const navigate = useNetworkNav()
    const { adena } = useOutletContext<LayoutContext>()

    const lastDAO = localStorage.getItem("memba_last_dao_slug")

    const handleOpen = (ext: ExtensionCard) => {
        if (ext.status !== "active" || !ext.route) return
        if (lastDAO) {
            navigate(`/dao/${lastDAO}/plugin/${ext.id}`)
        } else {
            navigate("/dao")
        }
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {/* Header */}
            <div>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 10 }}>
                    <PuzzlePiece size={24} weight="duotone" />
                    Extensions
                </h2>
                <p style={{ color: "#666", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                    Enhance your DAO with powerful extensions — activate them per-DAO
                </p>
            </div>

            {/* Stats bar */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#888" }}>
                    <span style={{ color: "#00d4aa", fontWeight: 600 }}>{EXTENSIONS.filter(e => e.status === "active").length}</span> active
                </div>
                <div style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#888" }}>
                    <span style={{ color: "#f5a623", fontWeight: 600 }}>{EXTENSIONS.filter(e => e.status === "coming-soon").length}</span> coming soon
                </div>
                <div style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#888" }}>
                    <span style={{ color: "#f0f0f0", fontWeight: 600 }}>{EXTENSIONS.length}</span> total
                </div>
            </div>

            {/* Extension Grid */}
            <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 16,
            }}>
                {EXTENSIONS.map(ext => {
                    const ss = statusStyles[ext.status]
                    return (
                        <div
                            key={ext.id}
                            className="k-card"
                            style={{
                                padding: 24,
                                display: "flex",
                                flexDirection: "column",
                                gap: 14,
                                cursor: ext.status === "active" ? "pointer" : "default",
                                transition: "all 0.2s",
                                opacity: ext.status === "active" ? 1 : 0.7,
                            }}
                            onClick={() => handleOpen(ext)}
                            onMouseEnter={e => { if (ext.status === "active") e.currentTarget.style.borderColor = "rgba(0,212,170,0.2)" }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = "" }}
                        >
                            {/* Icon + Status Row */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{
                                    width: 48, height: 48, borderRadius: 12,
                                    background: ss.bg,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    color: ss.color,
                                }}>
                                    {ext.icon}
                                </div>
                                <span style={{
                                    fontSize: 9, padding: "3px 8px", borderRadius: 4,
                                    background: ss.bg, color: ss.color,
                                    border: `1px solid ${ss.border}`,
                                    fontFamily: "JetBrains Mono, monospace",
                                    fontWeight: 600, letterSpacing: "0.05em",
                                    textTransform: "uppercase",
                                }}>
                                    {ext.statusLabel}
                                </span>
                            </div>

                            {/* Name */}
                            <div style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0" }}>
                                {ext.name}
                            </div>

                            {/* Description */}
                            <div style={{
                                fontSize: 12, color: "#888", lineHeight: 1.6,
                                fontFamily: "JetBrains Mono, monospace",
                                flex: 1,
                            }}>
                                {ext.description}
                            </div>

                            {/* Action */}
                            {ext.status === "active" ? (
                                <button
                                    className="k-btn-primary"
                                    style={{ fontSize: 11, padding: "8px 16px", alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6 }}
                                    onClick={e => { e.stopPropagation(); handleOpen(ext) }}
                                >
                                    Open <ArrowRight size={12} />
                                </button>
                            ) : (
                                <div style={{
                                    fontSize: 10, color: "#555",
                                    fontFamily: "JetBrains Mono, monospace",
                                    fontStyle: "italic",
                                }}>
                                    Available in a future update
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Note */}
            <div style={{
                padding: "14px 18px", borderRadius: 10,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
                fontSize: 11, color: "#555",
                fontFamily: "JetBrains Mono, monospace",
                lineHeight: 1.6,
            }}>
                💡 Extensions are per-DAO — they activate within a DAO's context.
                {!adena.address && " Connect your wallet and select a DAO to use extensions."}
                {adena.address && !lastDAO && " Visit a DAO first, then come back to open an extension."}
            </div>
        </div>
    )
}
