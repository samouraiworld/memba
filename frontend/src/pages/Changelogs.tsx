/**
 * Changelogs — Memba + Gno ecosystem update log.
 *
 * W6.1: entries are PARSED FROM the repo-root CHANGELOG.md at build time
 * (lib/changelog.ts) — adding a CHANGELOG entry updates this page with zero
 * code changes. Curated pre-v6 history lives in lib/changelogLegacy.ts.
 *
 * @module pages/Changelogs
 */

import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ClockCounterClockwise } from "@phosphor-icons/react"
import {
    CHANGELOG_ENTRIES, CHANGELOG_FILTERS, CHANGELOG_LABELS, FULL_CHANGELOG_URL,
    filterChangelog, groupChangelog, type ChangelogFilter,
} from "../lib/changelogView"
import { useNetworkKey } from "../hooks/useNetworkNav"
import "./blog.css"
import "./changelogs.css"

export function Changelogs() {
    const [filter, setFilter] = useState<ChangelogFilter>("all")
    const nk = useNetworkKey()
    const headingRef = useRef<HTMLHeadingElement>(null)

    useEffect(() => {
        const previousTitle = document.title
        document.title = "Changelogs — Memba"
        headingRef.current?.focus()
        return () => {
            if (document.title === "Changelogs — Memba") document.title = previousTitle
        }
    }, [])

    const filtered = filterChangelog(CHANGELOG_ENTRIES, filter)

    return (
        <div id="changelogs-page" className="news-changelog-page">
            <nav className="news-section-nav" aria-label="News sections">
                <Link to={`/${nk}/blog`}>Blog</Link>
                <Link to={`/${nk}/changelogs`} aria-current="page">Changelogs</Link>
            </nav>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <ClockCounterClockwise size={22} color="var(--color-primary)" aria-hidden="true" />
                <h1 ref={headingRef} tabIndex={-1} className="news-changelog-title">Changelogs</h1>
            </div>

            <p style={{ fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)", marginBottom: 20, lineHeight: 1.5 }}>
                Memba releases and gno.land ecosystem updates.
            </p>

            <a className="news-changelog-full" href={FULL_CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
                Full changelog <span aria-hidden="true">↗</span>
            </a>

            {/* Filter tabs */}
            <div className="news-changelog-filters" role="group" aria-label="Filter changelogs">
                {CHANGELOG_FILTERS.map(tag => (
                    <button
                        key={tag}
                        type="button"
                        className={`news-changelog-filter news-changelog-filter--${tag}`}
                        aria-pressed={filter === tag}
                        onClick={() => setFilter(tag)}
                    >
                        {CHANGELOG_LABELS[tag]}
                    </button>
                ))}
            </div>

            {/* Entries */}
            {groupChangelog(filtered).map(({ key, label, entries }) => (
                <div key={key} style={{ marginBottom: 28 }}>
                    {/* Date separator */}
                    <div style={{
                        fontSize: "var(--pro-caption, 10px)", color: "var(--color-text-muted)", fontWeight: 600, letterSpacing: 1,
                        fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                        paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.04)",
                        marginBottom: 12, textTransform: "uppercase",
                    }}>
                        {label}
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
                                        fontSize: "var(--pro-caption, 10px)", fontWeight: 700, color: "var(--color-k-accent-text, var(--color-text))",
                                        background: "rgba(0,212,170,0.1)", padding: "2px 8px",
                                        borderRadius: 4, fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                                    }}>
                                        {entry.version}
                                    </span>
                                )}
                                <span style={{ fontSize: "var(--pro-small, 13px)", fontWeight: 600, color: "var(--color-text)" }}>
                                    {entry.title}
                                </span>
                                {entry.tags.map(tag => (
                                    <span key={tag} className={`news-changelog-tag news-changelog-tag--${tag}`}>
                                        {CHANGELOG_LABELS[tag]}
                                    </span>
                                ))}
                            </div>

                            {/* Items */}
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                                {entry.items.map((item, j) => (
                                    <li key={j} className="news-changelog-item" style={{
                                        fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)", lineHeight: 1.6,
                                        fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
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
                <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-muted)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)", textAlign: "center", padding: 40 }}>
                    No entries for this filter.
                </p>
            )}
        </div>
    )
}

export default Changelogs
