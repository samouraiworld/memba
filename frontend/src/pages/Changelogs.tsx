/**
 * Changelogs — Memba + Gno ecosystem update log.
 *
 * W6.1: entries are PARSED FROM the repo-root CHANGELOG.md at build time
 * (lib/changelog.ts) — adding a CHANGELOG entry updates this page with zero
 * code changes. Curated pre-v6 history lives in lib/changelogLegacy.ts.
 *
 * @module pages/Changelogs
 */

import { useMemo, useState } from "react"
import { ClockCounterClockwise } from "@phosphor-icons/react"
import changelogRaw from "../../../CHANGELOG.md?raw"
import { parseChangelogMarkdown } from "../lib/changelog"
import type { ChangelogTag as Tag } from "../lib/changelog"
import { LEGACY_ENTRIES } from "../lib/changelogLegacy"

interface ChangelogEntry {
    date: string
    version?: string
    unreleased?: boolean
    title: string
    tags: Tag[]
    items: string[]
}

// ── Tag styling ──────────────────────────────────────────────

const TAG_COLORS: Record<Tag, string> = {
    memba: "var(--color-brand)",
    network: "var(--color-accent-purple-alt)",
    "gno-core": "var(--color-accent-gold)",
}

const TAG_LABELS: Record<Tag, string> = {
    memba: "Memba",
    network: "Network",
    "gno-core": "Gno Core",
}

// ── Component ────────────────────────────────────────────────

export function Changelogs() {
    const [filter, setFilter] = useState<Tag | "all">("all")

    // Parsed once per mount (pure function over a build-time string).
    const entries: ChangelogEntry[] = useMemo(
        () => [...parseChangelogMarkdown(changelogRaw), ...LEGACY_ENTRIES],
        [],
    )

    const filtered = filter === "all"
        ? entries
        : entries.filter(e => e.tags.includes(filter))

    // Group by date. Undated entries: the truly-unreleased block groups under
    // "In progress"; shipped-but-undated historical blocks group under their
    // own version label — never "In progress" (review finding).
    const groupKey = (e: ChangelogEntry) =>
        e.date || (e.unreleased ? "" : e.version || e.title)
    const grouped = new Map<string, ChangelogEntry[]>()
    for (const entry of filtered) {
        const key = groupKey(entry)
        const existing = grouped.get(key) || []
        existing.push(entry)
        grouped.set(key, existing)
    }

    return (
        <div id="changelogs-page" style={{ maxWidth: 680 }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <ClockCounterClockwise size={22} color="var(--color-brand)" />
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Changelogs</h2>
            </div>

            <p style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace", marginBottom: 20, lineHeight: 1.5 }}>
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
                                ? (tag === "all" ? "var(--color-surface-light)" : TAG_COLORS[tag as Tag])
                                : "var(--color-text-secondary)",
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
                        fontSize: 10, color: "var(--color-text-muted)", fontWeight: 600, letterSpacing: 1,
                        fontFamily: "JetBrains Mono, monospace",
                        paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.04)",
                        marginBottom: 12, textTransform: "uppercase",
                    }}>
                        {/^\d{4}-\d{2}-\d{2}$/.test(date)
                            ? new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                            : date === "" ? "In progress" : date}
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
                                        fontSize: 10, fontWeight: 700, color: "var(--color-primary)",
                                        background: "rgba(0,212,170,0.1)", padding: "2px 8px",
                                        borderRadius: 4, fontFamily: "JetBrains Mono, monospace",
                                    }}>
                                        {entry.version}
                                    </span>
                                )}
                                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
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
                                        fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.7,
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
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", fontFamily: "JetBrains Mono, monospace", textAlign: "center", padding: 40 }}>
                    No entries for this filter.
                </p>
            )}
        </div>
    )
}

export default Changelogs
