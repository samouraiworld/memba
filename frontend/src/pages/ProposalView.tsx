import { useState, useEffect, useCallback } from "react"
import { useParams, useNavigate, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { GNO_RPC_URL, DAO_REALM_PATH } from "../lib/config"
import {
    getProposalDetail,
    buildVoteMsg,
    buildExecuteMsg,
    type DAOProposal,
} from "../lib/dao"
import { doContractBroadcast } from "../lib/grc20"
import type { LayoutContext } from "../types/layout"

export function ProposalView() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const [proposal, setProposal] = useState<DAOProposal | null>(null)
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    const proposalId = parseInt(id || "0", 10)

    const loadProposal = useCallback(async () => {
        if (!proposalId) return
        setLoading(true)
        setError(null)
        try {
            const p = await getProposalDetail(GNO_RPC_URL, DAO_REALM_PATH, proposalId)
            setProposal(p)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load proposal")
        } finally {
            setLoading(false)
        }
    }, [proposalId])

    useEffect(() => { loadProposal() }, [loadProposal])

    const handleVote = async (vote: "YES" | "NO" | "ABSTAIN") => {
        if (!auth.isAuthenticated || !adena.address) {
            setError("Connect your wallet to vote")
            return
        }

        setActionLoading(true)
        setError(null)
        setSuccess(null)

        try {
            const msg = buildVoteMsg(adena.address, DAO_REALM_PATH, proposalId, vote)
            await doContractBroadcast([msg], `Vote ${vote} on Proposal #${proposalId}`)
            setSuccess(`Voted ${vote} on Proposal #${proposalId}`)
            // Reload proposal to see updated votes
            await loadProposal()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to vote")
        } finally {
            setActionLoading(false)
        }
    }

    const handleExecute = async () => {
        if (!auth.isAuthenticated || !adena.address) {
            setError("Connect your wallet to execute")
            return
        }

        setActionLoading(true)
        setError(null)
        setSuccess(null)

        try {
            const msg = buildExecuteMsg(adena.address, DAO_REALM_PATH, proposalId)
            await doContractBroadcast([msg], `Execute Proposal #${proposalId}`)
            setSuccess(`Proposal #${proposalId} executed!`)
            await loadProposal()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to execute")
        } finally {
            setActionLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
            </div>
        )
    }

    if (!proposal) {
        return (
            <div className="animate-fade-in" style={{ textAlign: "center", padding: 48 }}>
                <p style={{ color: "#666", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                    Proposal #{proposalId} not found
                </p>
                <button
                    onClick={() => navigate("/dao")}
                    style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginTop: 16, fontFamily: "JetBrains Mono, monospace" }}
                >
                    ← Back to DAO
                </button>
            </div>
        )
    }

    const totalVotes = proposal.yesVotes + proposal.noVotes + proposal.abstainVotes
    const statusColors: Record<string, { bg: string; color: string; label: string }> = {
        open: { bg: "rgba(0,212,170,0.08)", color: "#00d4aa", label: "OPEN" },
        passed: { bg: "rgba(76,175,80,0.08)", color: "#4caf50", label: "PASSED" },
        rejected: { bg: "rgba(244,67,54,0.08)", color: "#f44336", label: "REJECTED" },
        executed: { bg: "rgba(33,150,243,0.08)", color: "#2196f3", label: "EXECUTED" },
    }
    const sc = statusColors[proposal.status] || statusColors.open

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {/* Nav */}
            <button
                onClick={() => navigate("/dao")}
                style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", textAlign: "left" }}
            >
                ← Back to DAO
            </button>

            {/* Header */}
            <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#555" }}>
                        Proposal #{proposal.id}
                    </span>
                    <span style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 10,
                        fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                        background: sc.bg, color: sc.color,
                    }}>
                        {sc.label}
                    </span>
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
                    {proposal.title}
                </h2>
                {proposal.proposer && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#666" }}>
                        <span>Proposed by</span>
                        <CopyableAddress address={proposal.proposer} />
                    </div>
                )}
            </div>

            {/* Description */}
            {proposal.description && (
                <div className="k-card" style={{ padding: 20 }}>
                    <p style={{ color: "#ccc", fontSize: 14, lineHeight: 1.7, fontFamily: "JetBrains Mono, monospace", whiteSpace: "pre-wrap" }}>
                        {proposal.description}
                    </p>
                </div>
            )}

            {/* Vote Tally */}
            <div className="k-card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 16 }}>
                    Votes {totalVotes > 0 && `(${totalVotes})`}
                </h3>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
                    <VoteStat label="Yes" count={proposal.yesVotes} total={totalVotes} color="#4caf50" icon="✓" />
                    <VoteStat label="No" count={proposal.noVotes} total={totalVotes} color="#f44336" icon="✗" />
                    <VoteStat label="Abstain" count={proposal.abstainVotes} total={totalVotes} color="#888" icon="○" />
                </div>

                {/* Progress bar */}
                {totalVotes > 0 && (
                    <div style={{ height: 6, background: "#1a1a1a", borderRadius: 3, overflow: "hidden", display: "flex" }}>
                        <div style={{ width: `${(proposal.yesVotes / totalVotes) * 100}%`, background: "#4caf50", transition: "width 0.3s" }} />
                        <div style={{ width: `${(proposal.noVotes / totalVotes) * 100}%`, background: "#f44336", transition: "width 0.3s" }} />
                        <div style={{ width: `${(proposal.abstainVotes / totalVotes) * 100}%`, background: "#666", transition: "width 0.3s" }} />
                    </div>
                )}
            </div>

            {/* Success message */}
            {success && (
                <div style={{ padding: "12px 16px", background: "rgba(0,212,170,0.08)", borderRadius: 8, border: "1px solid rgba(0,212,170,0.2)", color: "#00d4aa", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                    ✓ {success}
                </div>
            )}

            {/* Actions */}
            {auth.isAuthenticated && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {/* Vote buttons (only for open proposals) */}
                    {proposal.status === "open" && (
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <button
                                className="k-btn-primary"
                                onClick={() => handleVote("YES")}
                                disabled={actionLoading}
                                style={{ flex: 1, minWidth: 120, background: "#4caf50", opacity: actionLoading ? 0.5 : 1 }}
                            >
                                {actionLoading ? "..." : "✓ Vote Yes"}
                            </button>
                            <button
                                className="k-btn-primary"
                                onClick={() => handleVote("NO")}
                                disabled={actionLoading}
                                style={{ flex: 1, minWidth: 120, background: "#f44336", opacity: actionLoading ? 0.5 : 1 }}
                            >
                                {actionLoading ? "..." : "✗ Vote No"}
                            </button>
                            <button
                                className="k-btn-secondary"
                                onClick={() => handleVote("ABSTAIN")}
                                disabled={actionLoading}
                                style={{ flex: 1, minWidth: 120, opacity: actionLoading ? 0.5 : 1 }}
                            >
                                {actionLoading ? "..." : "○ Abstain"}
                            </button>
                        </div>
                    )}

                    {/* Execute button (only for passed proposals) */}
                    {proposal.status === "passed" && (
                        <button
                            className="k-btn-primary"
                            onClick={handleExecute}
                            disabled={actionLoading}
                            style={{ width: "100%", background: "#2196f3", opacity: actionLoading ? 0.5 : 1 }}
                        >
                            {actionLoading ? "Executing..." : "⚡ Execute Proposal"}
                        </button>
                    )}
                </div>
            )}

            {!auth.isAuthenticated && (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 28, textAlign: "center" }}>
                    <p style={{ color: "#555", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        Connect your wallet to vote on proposals
                    </p>
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Components ────────────────────────────────────────────

function VoteStat({ label, count, total, color, icon }: { label: string; count: number; total: number; color: string; icon: string }) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0
    return (
        <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color }}>
                {icon} {count}
            </div>
            <div style={{ fontSize: 10, color: "#666", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>
                {label} ({pct}%)
            </div>
        </div>
    )
}
