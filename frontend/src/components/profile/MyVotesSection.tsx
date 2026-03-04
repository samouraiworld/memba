/**
 * MyVotesSection — cross-DAO vote history for the connected wallet.
 *
 * Merges gnolove governance votes with scanned DAO votes.
 * Extracted in v1.5.0 from ProfilePage.tsx.
 */
import { useState } from "react"
import { useMyVotes, type MyVoteEntry } from "../../hooks/useMyVotes"
import type { GovVote } from "../../lib/profile"

export function MyVotesSection({ address, gnoloveVotes }: { address: string; gnoloveVotes: GovVote[] }) {
    const { votes: crossDaoVotes, loading } = useMyVotes(address)
    const [filter, setFilter] = useState<"ALL" | "YES" | "NO">("ALL")

    // Merge: cross-DAO votes first, then gnolove votes (dedup by proposalId)
    const seenIds = new Set<string>()
    const allVotes: Array<MyVoteEntry | GovVote & { daoName?: string; daoSlug?: string; proposalStatus?: string }> = []

    for (const v of crossDaoVotes) {
        const key = String(v.proposalId)
        if (!seenIds.has(key)) {
            seenIds.add(key)
            allVotes.push(v)
        }
    }
    for (const v of gnoloveVotes) {
        const key = String(v.proposalId)
        if (!seenIds.has(key)) {
            seenIds.add(key)
            allVotes.push(v)
        }
    }

    const filtered = filter === "ALL" ? allVotes : allVotes.filter(v => v.vote === filter)
    const showFilters = allVotes.length >= 5

    if (loading) {
        return (
            <div className="k-card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 14 }}>
                    🗳️ My Votes
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[1, 2, 3].map(i => (
                        <div key={i} style={{ height: 40, borderRadius: 8, background: "linear-gradient(90deg, #1a1a1a 25%, #222 50%, #1a1a1a 75%)", backgroundSize: "400% 100%", animation: "skeleton-shimmer 1.5s ease-in-out infinite" }} />
                    ))}
                </div>
            </div>
        )
    }

    if (allVotes.length === 0) {
        return (
            <div className="k-dashed" style={{ background: "#0c0c0c", padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🗳️</div>
                <div style={{ fontSize: 13, color: "#888", fontFamily: "JetBrains Mono, monospace" }}>
                    No votes yet
                </div>
                <div style={{ fontSize: 11, color: "#555", fontFamily: "JetBrains Mono, monospace", marginTop: 4 }}>
                    Save DAOs from the DAO Hub to see your vote history
                </div>
            </div>
        )
    }

    return (
        <div className="k-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>
                    🗳️ My Votes ({allVotes.length})
                </h3>
                {showFilters && (
                    <div style={{ display: "flex", gap: 4 }}>
                        {(["ALL", "YES", "NO"] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                style={{
                                    padding: "3px 8px", borderRadius: 4, fontSize: 9, border: "1px solid",
                                    fontFamily: "JetBrains Mono, monospace", fontWeight: 600, cursor: "pointer",
                                    background: filter === f ? "rgba(0,212,170,0.08)" : "transparent",
                                    color: filter === f ? "#00d4aa" : "#555",
                                    borderColor: filter === f ? "rgba(0,212,170,0.2)" : "#222",
                                }}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.slice(0, 30).map((v, i) => {
                    const voteColor = v.vote === "YES" ? "#4caf50" : v.vote === "NO" ? "#f44336" : "#888"
                    const daoName = "daoName" in v ? v.daoName : undefined
                    const daoSlug = "daoSlug" in v ? v.daoSlug : undefined
                    return (
                        <div key={`${v.proposalId}-${i}`} className="k-card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                {daoName && (
                                    <span style={{ fontSize: 9, color: "#00d4aa", fontFamily: "JetBrains Mono, monospace", marginRight: 6, opacity: 0.7 }}>
                                        {daoName}
                                    </span>
                                )}
                                <span style={{ fontSize: 10, color: "#555", fontFamily: "JetBrains Mono, monospace" }}>
                                    #{v.proposalId}
                                </span>
                                <span style={{ fontSize: 12, color: "#ccc", marginLeft: 8 }}>
                                    {daoSlug ? (
                                        <a href={`/dao/${daoSlug}/${v.proposalId}`} style={{ color: "#ccc", textDecoration: "none" }}
                                            onMouseEnter={e => e.currentTarget.style.color = "#00d4aa"}
                                            onMouseLeave={e => e.currentTarget.style.color = "#ccc"}
                                        >
                                            {v.proposalTitle}
                                        </a>
                                    ) : v.proposalTitle}
                                </span>
                            </div>
                            <span style={{
                                padding: "2px 8px", borderRadius: 4, fontSize: 9, flexShrink: 0,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: `${voteColor}15`, color: voteColor,
                            }}>
                                {v.vote}
                            </span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
