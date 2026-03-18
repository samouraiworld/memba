/**
 * Changelogs — Memba + Gno ecosystem update log.
 *
 * Reverse-chronological entries with tags for filtering.
 * Hardcoded data — updated with each version bump.
 *
 * @module pages/Changelogs
 */

import { useState } from "react"
import { ClockCounterClockwise } from "@phosphor-icons/react"

// ── Types ────────────────────────────────────────────────────

type Tag = "memba" | "network" | "gno-core"

interface ChangelogEntry {
    date: string
    version?: string
    title: string
    tags: Tag[]
    items: string[]
}

// ── Data ─────────────────────────────────────────────────────

const ENTRIES: ChangelogEntry[] = [
    {
        date: "2026-03-18",
        version: "v2.14.0",
        title: "Testnet 12 Compatibility",
        tags: ["memba"],
        items: [
            "Testnet 12 is now the default network",
            "Auto-migration from test11 for existing users",
            "r/sys/users registry support (replaces r/gnoland/users/v1)",
            "Defensive username resolution for new Render formats",
            "Test12 added to trusted RPC domains and explorer URLs",
        ],
    },
    {
        date: "2026-03-18",
        title: "Testnet 12 Launch",
        tags: ["network", "gno-core"],
        items: [
            "New experimental testnet replacing test11",
            "Fresh genesis with new validator set",
            "r/sys/users replaces r/gnoland/users registry",
            "hCaptcha-based faucet at faucet.gno.land",
        ],
    },
    {
        date: "2026-03-14",
        title: "Betanet (gnoland1) Stable",
        tags: ["network"],
        items: [
            "First persistent Gno chain",
            "Production-grade — deploy with care",
            "Samourai Coop validators live: rpc.gnoland1.samourai.live",
        ],
    },
    {
        date: "2026-03-15",
        version: "v2.13.0",
        title: "Validators & Hacker Mode",
        tags: ["memba"],
        items: [
            "Validators dashboard with real-time consensus telemetry",
            "Hacker Mode with dual-RPC strategy",
            "Validator detail pages with uptime and participation metrics",
            "Sentry RPC integration for Samourai Coop nodes",
        ],
    },
    {
        date: "2026-03-12",
        version: "v2.12.0",
        title: "Extensions Hub & Plugin System",
        tags: ["memba"],
        items: [
            "Plugin registry with GnoSwap, Boards, Leaderboard",
            "Per-DAO plugin pages with dynamic routing",
            "Extensions Hub discovery page",
        ],
    },
    {
        date: "2026-03-10",
        version: "v2.11.0",
        title: "Creative Landing & DAO Channels",
        tags: ["memba"],
        items: [
            "Video showcase landing page with Remotion",
            "DAO Channels for threaded discussions",
            "Jitsi video calls with PiP overlay",
            "Feedback page for user input",
        ],
    },
    {
        date: "2026-03-08",
        version: "v2.6.0",
        title: "Hardening & OSS Preparation",
        tags: ["memba"],
        items: [
            "CSP security headers with strict domain allowlist",
            "RPC domain validation for all transactions",
            "Human-centric error translation layer",
            "Centralized gas configuration system",
            "754+ unit tests, 238+ E2E tests",
        ],
    },
]

// ── Tag styling ──────────────────────────────────────────────

const TAG_COLORS: Record<Tag, string> = {
    memba: "#00d4aa",
    network: "#8b5cf6",
    "gno-core": "#f59e0b",
}

const TAG_LABELS: Record<Tag, string> = {
    memba: "Memba",
    network: "Network",
    "gno-core": "Gno Core",
}

// ── Component ────────────────────────────────────────────────

export function Changelogs() {
    const [filter, setFilter] = useState<Tag | "all">("all")

    const filtered = filter === "all"
        ? ENTRIES
        : ENTRIES.filter(e => e.tags.includes(filter))

    // Group by date
    const grouped = new Map<string, ChangelogEntry[]>()
    for (const entry of filtered) {
        const existing = grouped.get(entry.date) || []
        existing.push(entry)
        grouped.set(entry.date, existing)
    }

    return (
        <div id="changelogs-page" style={{ maxWidth: 680 }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <ClockCounterClockwise size={22} color="#00d4aa" />
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f0f0f0", margin: 0 }}>Changelogs</h2>
            </div>

            <p style={{ fontSize: 11, color: "#777", fontFamily: "JetBrains Mono, monospace", marginBottom: 20, lineHeight: 1.5 }}>
                Memba releases and gno.land ecosystem updates.
            </p>

            {/* Filter tabs */}
            <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
                {(["all", "memba", "network", "gno-core"] as const).map(tag => (
                    <button
                        key={tag}
                        onClick={() => setFilter(tag)}
                        style={{
                            padding: "6px 14px",
                            borderRadius: 8,
                            border: `1px solid ${filter === tag ? (tag === "all" ? "rgba(255,255,255,0.15)" : TAG_COLORS[tag as Tag] + "44") : "rgba(255,255,255,0.06)"}`,
                            background: filter === tag
                                ? (tag === "all" ? "rgba(255,255,255,0.06)" : TAG_COLORS[tag as Tag] + "12")
                                : "rgba(255,255,255,0.02)",
                            color: filter === tag
                                ? (tag === "all" ? "#f0f0f0" : TAG_COLORS[tag as Tag])
                                : "#666",
                            cursor: "pointer",
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: 11, fontWeight: 500,
                            transition: "all 0.15s",
                        }}
                    >
                        {tag === "all" ? "All" : TAG_LABELS[tag as Tag]}
                    </button>
                ))}
            </div>

            {/* Entries */}
            {Array.from(grouped).map(([date, entries]) => (
                <div key={date} style={{ marginBottom: 28 }}>
                    {/* Date separator */}
                    <div style={{
                        fontSize: 10, color: "#555", fontWeight: 600, letterSpacing: 1,
                        fontFamily: "JetBrains Mono, monospace",
                        paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.04)",
                        marginBottom: 12, textTransform: "uppercase",
                    }}>
                        {new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </div>

                    {entries.map((entry, i) => (
                        <div key={i} style={{
                            padding: "14px 16px",
                            borderRadius: 12,
                            background: "rgba(255,255,255,0.02)",
                            border: "1px solid rgba(255,255,255,0.04)",
                            marginBottom: 8,
                        }}>
                            {/* Title + tags */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                                {entry.version && (
                                    <span style={{
                                        fontSize: 10, fontWeight: 700, color: "#00d4aa",
                                        background: "rgba(0,212,170,0.1)", padding: "2px 8px",
                                        borderRadius: 4, fontFamily: "JetBrains Mono, monospace",
                                    }}>
                                        {entry.version}
                                    </span>
                                )}
                                <span style={{ fontSize: 13, fontWeight: 600, color: "#e0e0e0" }}>
                                    {entry.title}
                                </span>
                                {entry.tags.map(tag => (
                                    <span key={tag} style={{
                                        fontSize: 9, color: TAG_COLORS[tag],
                                        background: TAG_COLORS[tag] + "12",
                                        padding: "2px 6px", borderRadius: 4,
                                        fontFamily: "JetBrains Mono, monospace",
                                    }}>
                                        {TAG_LABELS[tag]}
                                    </span>
                                ))}
                            </div>

                            {/* Items */}
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                                {entry.items.map((item, j) => (
                                    <li key={j} style={{
                                        fontSize: 11, color: "#888", lineHeight: 1.7,
                                        fontFamily: "JetBrains Mono, monospace",
                                    }}>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            ))}

            {filtered.length === 0 && (
                <p style={{ fontSize: 12, color: "#555", fontFamily: "JetBrains Mono, monospace", textAlign: "center", padding: 40 }}>
                    No entries for this filter.
                </p>
            )}
        </div>
    )
}

export default Changelogs
