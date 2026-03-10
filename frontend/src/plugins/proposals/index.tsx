/**
 * Proposal Explorer Plugin — Full proposal management with search, filter, and sort.
 *
 * Replaces the v1.0 stub. Queries proposals on-chain and provides:
 * - Search by title or ID
 * - Status filter (All / Active / Passed / Rejected)
 * - Sort by date or votes
 * - Pagination (10 per page)
 *
 * v2.0.0-alpha.1 (Sprint B, Step 8)
 */

import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import type { PluginProps } from "../types"
import { GNO_RPC_URL } from "../../lib/config"
import { getDAOProposals, type DAOProposal } from "../../lib/dao"
import { encodeSlug } from "../../lib/daoSlug"
import { SkeletonCard } from "../../components/ui/LoadingSkeleton"

type StatusFilter = "all" | "open" | "passed" | "rejected"
type SortOrder = "newest" | "oldest" | "most-votes"

const PAGE_SIZE = 10

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
    open: { bg: "rgba(0,212,170,0.08)", text: "#00d4aa" },
    passed: { bg: "rgba(123,97,255,0.08)", text: "#7b61ff" },
    rejected: { bg: "rgba(239,68,68,0.08)", text: "#ef4444" },
    executed: { bg: "rgba(59,130,246,0.08)", text: "#3b82f6" },
}

export default function ProposalsPlugin({ realmPath, slug }: PluginProps) {
    const navigate = useNavigate()
    const [proposals, setProposals] = useState<DAOProposal[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Filters
    const [search, setSearch] = useState("")
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
    const [sort, setSort] = useState<SortOrder>("newest")
    const [page, setPage] = useState(0)

    const loadProposals = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await getDAOProposals(GNO_RPC_URL, realmPath)
            setProposals(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load proposals")
        } finally {
            setLoading(false)
        }
    }, [realmPath])

    useEffect(() => { loadProposals() }, [loadProposals])

    // Reset page when filters change
    useEffect(() => { setPage(0) }, [search, statusFilter, sort])

    // Filter & sort
    const filtered = proposals
        .filter(p => {
            if (statusFilter !== "all" && p.status !== statusFilter) return false
            if (search) {
                const q = search.toLowerCase()
                return p.title.toLowerCase().includes(q) || String(p.id).includes(q)
            }
            return true
        })
        .sort((a, b) => {
            if (sort === "newest") return b.id - a.id
            if (sort === "oldest") return a.id - b.id
            // most-votes
            return (b.yesVotes + b.noVotes) - (a.yesVotes + a.noVotes)
        })

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
    const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

    const statusCounts = {
        all: proposals.length,
        open: proposals.filter(p => p.status === "open").length,
        passed: proposals.filter(p => p.status === "passed").length,
        rejected: proposals.filter(p => p.status === "rejected" || p.status !== "open" && p.status !== "passed").length,
    }

    /** Export filtered proposals as downloadable file. */
    const exportData = useCallback((format: "csv" | "json") => {
        if (filtered.length === 0) return
        const timestamp = new Date().toISOString().slice(0, 10)
        const filename = `proposals-${realmPath.split("/").pop()}-${timestamp}.${format}`

        let content: string
        let mime: string

        if (format === "json") {
            const exportRows = filtered.map(p => ({
                id: p.id,
                title: p.title,
                status: p.status,
                author: p.author || "",
                yesVotes: p.yesVotes,
                noVotes: p.noVotes,
                abstainVotes: p.abstainVotes,
                yesPercent: p.yesPercent,
                noPercent: p.noPercent,
            }))
            content = JSON.stringify(exportRows, null, 2)
            mime = "application/json"
        } else {
            const headers = ["ID", "Title", "Status", "Author", "Yes Votes", "No Votes", "Abstain", "Yes %", "No %"]
            const rows = filtered.map(p => [
                p.id,
                `"${p.title.replace(/"/g, '""')}"`,
                p.status,
                p.author || "",
                p.yesVotes,
                p.noVotes,
                p.abstainVotes,
                p.yesPercent,
                p.noPercent,
            ].join(","))
            content = [headers.join(","), ...rows].join("\n")
            mime = "text/csv"
        }

        const blob = new Blob([content], { type: mime })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }, [filtered, realmPath])

    const encodedSlug = slug || encodeSlug(realmPath)

    return (
        <div id="plugin-proposals" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>📋</span>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>
                        Proposal Explorer
                    </h3>
                    <span style={{
                        fontSize: 9, padding: "2px 8px", borderRadius: 4,
                        background: "rgba(0,212,170,0.08)", color: "#00d4aa",
                        fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                    }}>
                        v2.0.0
                    </span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                    <button
                        className="k-btn-secondary"
                        style={{ fontSize: 10, padding: "5px 10px" }}
                        onClick={() => exportData("csv")}
                        disabled={filtered.length === 0}
                        title="Export filtered proposals as CSV"
                    >
                        ↓ CSV
                    </button>
                    <button
                        className="k-btn-secondary"
                        style={{ fontSize: 10, padding: "5px 10px" }}
                        onClick={() => exportData("json")}
                        disabled={filtered.length === 0}
                        title="Export filtered proposals as JSON"
                    >
                        ↓ JSON
                    </button>
                    <button
                        className="k-btn-primary"
                        style={{ fontSize: 11, padding: "6px 14px" }}
                        onClick={() => navigate(`/dao/${encodedSlug}/propose`)}
                    >
                        + New Proposal
                    </button>
                </div>
            </div>

            {/* Search + Sort */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                    type="text"
                    placeholder="Search by title or ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{
                        flex: 1, minWidth: 200, padding: "8px 14px",
                        borderRadius: 8, border: "1px solid #1a1a1a",
                        background: "#0d0d0d", color: "#f0f0f0",
                        fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                        outline: "none", transition: "border-color 0.15s",
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = "rgba(0,212,170,0.3)"}
                    onBlur={e => e.currentTarget.style.borderColor = "#1a1a1a"}
                />
                <select
                    value={sort}
                    onChange={e => setSort(e.target.value as SortOrder)}
                    style={{
                        padding: "8px 12px", borderRadius: 8,
                        border: "1px solid #1a1a1a", background: "#0d0d0d",
                        color: "#888", fontSize: 11, fontFamily: "JetBrains Mono, monospace",
                        cursor: "pointer",
                    }}
                >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="most-votes">Most Votes</option>
                </select>
            </div>

            {/* Status Filter Tabs */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(["all", "open", "passed", "rejected"] as const).map(f => {
                    const labels: Record<StatusFilter, string> = { all: "All", open: "Active", passed: "Passed", rejected: "Rejected" }
                    return (
                        <button
                            key={f}
                            onClick={() => setStatusFilter(f)}
                            style={{
                                padding: "5px 12px", borderRadius: 6, fontSize: 11,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 500,
                                border: "1px solid",
                                borderColor: statusFilter === f ? "rgba(0,212,170,0.3)" : "#222",
                                background: statusFilter === f ? "rgba(0,212,170,0.08)" : "transparent",
                                color: statusFilter === f ? "#00d4aa" : "#666",
                                cursor: "pointer", transition: "all 0.15s",
                            }}
                        >
                            {labels[f]} ({statusCounts[f]})
                        </button>
                    )
                })}
            </div>

            {/* Proposal List */}
            {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : error ? (
                <div className="k-card" style={{ padding: 24, textAlign: "center" }}>
                    <p style={{ color: "#ef4444", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                        {error}
                    </p>
                    <button className="k-btn-secondary" onClick={loadProposals} style={{ fontSize: 11, marginTop: 8 }}>
                        Retry
                    </button>
                </div>
            ) : filtered.length === 0 ? (
                <div className="k-dashed" style={{ padding: 28, textAlign: "center" }}>
                    <p style={{ color: "#555", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        {search ? `No proposals matching "${search}"` : "No proposals found"}
                    </p>
                </div>
            ) : (
                <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {pageItems.map(p => {
                            const sc = STATUS_COLORS[p.status] || STATUS_COLORS.open
                            return (
                                <button
                                    key={p.id}
                                    className="k-card"
                                    onClick={() => navigate(`/dao/${encodedSlug}/proposal/${p.id}`)}
                                    style={{
                                        padding: "14px 18px", cursor: "pointer",
                                        display: "flex", alignItems: "center", gap: 14,
                                        textAlign: "left", width: "100%",
                                        border: "1px solid #1a1a1a",
                                        transition: "border-color 0.15s, background 0.15s",
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,212,170,0.2)"; e.currentTarget.style.background = "rgba(0,212,170,0.02)" }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#1a1a1a"; e.currentTarget.style.background = "" }}
                                >
                                    {/* ID badge */}
                                    <span style={{
                                        fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                                        color: "#555", fontWeight: 600, minWidth: 30,
                                    }}>
                                        #{p.id}
                                    </span>

                                    {/* Title + author */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            fontSize: 13, fontWeight: 500, color: "#f0f0f0",
                                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        }}>
                                            {p.title}
                                        </div>
                                        {p.author && (
                                            <div style={{
                                                fontSize: 10, color: "#555", fontFamily: "JetBrains Mono, monospace",
                                                marginTop: 2,
                                            }}>
                                                by {p.author}
                                            </div>
                                        )}
                                    </div>

                                    {/* Vote count */}
                                    {(p.yesVotes > 0 || p.noVotes > 0) && (
                                        <span style={{
                                            fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                                            color: "#666",
                                        }}>
                                            ✓{p.yesVotes} ✗{p.noVotes}
                                        </span>
                                    )}

                                    {/* Status badge */}
                                    <span style={{
                                        fontSize: 9, padding: "2px 8px", borderRadius: 4,
                                        background: sc.bg, color: sc.text,
                                        fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                        textTransform: "uppercase", whiteSpace: "nowrap",
                                    }}>
                                        {p.status}
                                    </span>

                                    <span style={{ color: "#333", fontSize: 12 }}>→</span>
                                </button>
                            )
                        })}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12 }}>
                            <button
                                className="k-btn-secondary"
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                                style={{ fontSize: 11, padding: "5px 12px", opacity: page === 0 ? 0.3 : 1 }}
                            >
                                ← Prev
                            </button>
                            <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#666" }}>
                                {page + 1} / {totalPages}
                            </span>
                            <button
                                className="k-btn-secondary"
                                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={page >= totalPages - 1}
                                style={{ fontSize: 11, padding: "5px 12px", opacity: page >= totalPages - 1 ? 0.3 : 1 }}
                            >
                                Next →
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* Stats footer */}
            <div style={{
                padding: "10px 14px", borderRadius: 8,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
                fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#444",
                display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap",
            }}>
                <span>{proposals.length} total</span>
                <span>{statusCounts.open} active</span>
                <span>{statusCounts.passed} passed</span>
                <span>{statusCounts.rejected} other</span>
            </div>
        </div>
    )
}
