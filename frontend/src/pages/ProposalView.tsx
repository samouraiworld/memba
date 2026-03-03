import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useParams, useNavigate, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { GNO_RPC_URL, BECH32_PREFIX } from "../lib/config"
import {
    getProposalDetail,
    getProposalVotes,
    getDAOMembers,
    getDAOConfig,
    buildVoteMsg,
    buildExecuteMsg,
    type DAOProposal,
    type VoteRecord,
} from "../lib/dao"
import { doContractBroadcast } from "../lib/grc20"
import { clearVoteCache } from "../lib/dao/voteScanner"
import { decodeSlug } from "../lib/daoSlug"
import { resolveOnChainUsername } from "../lib/profile"
import type { LayoutContext } from "../types/layout"

export function ProposalView() {
    const { slug, id } = useParams<{ slug: string; id: string }>()
    const navigate = useNavigate()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const realmPath = slug ? decodeSlug(slug) : ""

    const [proposal, setProposal] = useState<DAOProposal | null>(null)
    const [voteRecords, setVoteRecords] = useState<VoteRecord[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [isMember, setIsMember] = useState<boolean | null>(null) // null = checking
    const [isArchived, setIsArchived] = useState(false)
    const [myUsername, setMyUsername] = useState<string | null>(null)
    const [memberCount, setMemberCount] = useState(0)


    const proposalId = parseInt(id || "0", 10)

    const loadProposal = useCallback(async (silent = false) => {
        if (!proposalId || !realmPath) return
        if (!silent) setLoading(true)
        setError(null)
        try {
            const [p, votes] = await Promise.all([
                getProposalDetail(GNO_RPC_URL, realmPath, proposalId),
                getProposalVotes(GNO_RPC_URL, realmPath, proposalId),
            ])
            setProposal(p)
            setVoteRecords(votes)

            // Check archive status (nonblocking)
            getDAOConfig(GNO_RPC_URL, realmPath).then((cfg) => {
                if (cfg?.isArchived) setIsArchived(true)
            }).catch(() => { /* ignore */ })

        } catch (err) {
            if (!silent) {
                setError(err instanceof Error ? err.message : "Failed to load proposal")
                setLoading(false)
            }
        } finally {
            if (!silent) setLoading(false)
        }
    }, [proposalId, realmPath])

    useEffect(() => { loadProposal() }, [loadProposal])

    // Auto-refresh every 30s for active proposals
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
    useEffect(() => {
        // Only poll if proposal is active (open)
        if (proposal?.status !== "open") {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
            return
        }
        pollRef.current = setInterval(() => loadProposal(true), 30_000)
        return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }, [proposal?.status, loadProposal])

    // Check if connected wallet is a DAO member
    // Must pass memberstorePath for tier-based DAOs like GovDAO (fix: #v5.6.0)
    useEffect(() => {
        if (!adena.address || !realmPath) { setIsMember(null); return }
        getDAOConfig(GNO_RPC_URL, realmPath)
            .then((cfg) => {
                setIsArchived(cfg?.isArchived || false)
                setMemberCount(cfg?.memberCount || 0)
                return getDAOMembers(GNO_RPC_URL, realmPath, cfg?.memberstorePath)
            })
            .then((members) => {
                const found = members.some((m) => m.address === adena.address)
                setIsMember(found)
                if (members.length > 0 && memberCount === 0) setMemberCount(members.length)
            })
            .catch(() => setIsMember(null)) // on error, don't block — let user try
    }, [adena.address, realmPath])

    // Resolve user's @username for hasVoted matching
    useEffect(() => {
        if (!adena.address) return
        resolveOnChainUsername(adena.address)
            .then(u => setMyUsername(u || null))
            .catch(() => { })
    }, [adena.address])

    // Derive hasVoted + userVote from vote records
    const { hasVoted, userVote } = useMemo(() => {
        if (!voteRecords.length || !adena.address) return { hasVoted: false, userVote: "" }
        const addr = adena.address.toLowerCase()
        const uname = myUsername?.toLowerCase() || ""
        const unameNoAt = uname.replace(/^@/, "")
        for (const record of voteRecords) {
            for (const v of record.yesVoters) {
                const vl = v.username.toLowerCase()
                if (vl === uname || vl === `@${unameNoAt}` || vl.includes(addr.slice(0, 10))) {
                    return { hasVoted: true, userVote: "YES" }
                }
            }
            for (const v of record.noVoters) {
                const vl = v.username.toLowerCase()
                if (vl === uname || vl === `@${unameNoAt}` || vl.includes(addr.slice(0, 10))) {
                    return { hasVoted: true, userVote: "NO" }
                }
            }
        }
        return { hasVoted: false, userVote: "" }
    }, [voteRecords, adena.address, myUsername])

    const handleVote = async (vote: "YES" | "NO" | "ABSTAIN") => {
        if (!auth.isAuthenticated || !adena.address) {
            setError("Connect your wallet to vote")
            return
        }
        setActionLoading(true)
        setError(null)
        setSuccess(null)
        try {
            const msg = buildVoteMsg(adena.address, realmPath, proposalId, vote)
            await doContractBroadcast([msg], `Vote ${vote} on Proposal #${proposalId}`)
            clearVoteCache() // Invalidate notification dot cache immediately
            setSuccess(`Voted ${vote} on Proposal #${proposalId}`)
            await loadProposal()
        } catch (err) {
            const raw = err instanceof Error ? err.message : "Failed to vote"
            // Make "member not found" error user-friendly
            if (raw.toLowerCase().includes("member not found") || raw.toLowerCase().includes("not a member")) {
                setError("Your connected wallet is not a member of this DAO. Please switch to the correct wallet in Adena.")
            } else {
                setError(raw)
            }
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
            const msg = buildExecuteMsg(adena.address, realmPath, proposalId)
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
                    onClick={() => navigate(`/dao/${slug}`)}
                    aria-label="Back to DAO"
                    id="proposal-notfound-back-btn"
                    style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginTop: 16, fontFamily: "JetBrains Mono, monospace" }}
                >
                    ← Back to DAO
                </button>
            </div>
        )
    }

    const statusColors: Record<string, { bg: string; color: string; label: string }> = {
        open: { bg: "rgba(0,212,170,0.08)", color: "#00d4aa", label: "ACTIVE" },
        passed: { bg: "rgba(76,175,80,0.08)", color: "#4caf50", label: "PASSED" },
        rejected: { bg: "rgba(244,67,54,0.08)", color: "#f44336", label: "REJECTED" },
        executed: { bg: "rgba(33,150,243,0.08)", color: "#2196f3", label: "EXECUTED" },
    }
    const sc = statusColors[proposal.status] || statusColors.open
    const isLive = proposal.status === "open"

    const totalYesVoters = voteRecords.reduce((sum, r) => sum + r.yesVoters.length, 0)
    const totalNoVoters = voteRecords.reduce((sum, r) => sum + r.noVoters.length, 0)

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Nav */}
            <button
                onClick={() => navigate(`/dao/${slug}`)}
                aria-label="Back to DAO"
                id="proposal-back-btn"
                style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", textAlign: "left" }}
            >
                ← Back to DAO
            </button>

            {/* Header */}
            <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
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
                    {proposal.status === "passed" && (
                        <span style={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace", color: "#888" }}>
                            ⚡ Awaiting execution
                        </span>
                    )}
                    {isLive && (
                        <span style={{
                            padding: "3px 8px", borderRadius: 4, fontSize: 9,
                            fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                            background: "rgba(0,212,170,0.06)", color: "#00d4aa",
                            display: "flex", alignItems: "center", gap: 4,
                        }}>
                            <span className="animate-glow" style={{ width: 6, height: 6, borderRadius: "50%", background: "#00d4aa", display: "inline-block" }} />
                            LIVE
                        </span>
                    )}
                    {proposal.tiers.length > 0 && (
                        <div style={{ display: "flex", gap: 3 }}>
                            {proposal.tiers.map((t) => (
                                <span key={t} style={{
                                    padding: "2px 6px", borderRadius: 3, fontSize: 9,
                                    fontFamily: "JetBrains Mono, monospace", fontWeight: 500,
                                    background: "rgba(255,255,255,0.04)", color: "#888",
                                }}>
                                    {t}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
                    {proposal.title}
                </h2>
            </div>

            {/* Author Card */}
            {proposal.author && (
                <div className="k-card" style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: "50%",
                        background: "rgba(0,212,170,0.08)", border: "1px solid rgba(0,212,170,0.15)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, fontFamily: "JetBrains Mono, monospace", color: "#00d4aa",
                    }}>
                        {proposal.author.charAt(0) === "@" ? proposal.author.charAt(1).toUpperCase() : "?"}
                    </div>
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0" }}>
                            {proposal.authorProfile ? (
                                <a href={proposal.authorProfile} target="_blank" rel="noopener noreferrer"
                                    style={{ color: "#00d4aa", textDecoration: "none" }}
                                >
                                    {proposal.author}
                                </a>
                            ) : proposal.author}
                        </div>
                        <div style={{ fontSize: 10, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>
                            Proposer
                        </div>
                    </div>
                    {proposal.proposer && proposal.proposer.startsWith(BECH32_PREFIX) && (
                        <div style={{ marginLeft: "auto" }}>
                            <CopyableAddress address={proposal.proposer} />
                        </div>
                    )}
                </div>
            )}

            {/* Description */}
            {proposal.description && (
                <div className="k-card" style={{ padding: 20 }}>
                    <p style={{ color: "#ccc", fontSize: 14, lineHeight: 1.7, fontFamily: "JetBrains Mono, monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" }}>
                        {proposal.description}
                    </p>
                </div>
            )}

            {/* Vote Summary */}
            <div className="k-card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 16 }}>
                    Voting Results
                </h3>

                {/* Vote summary bar — always show if we have any vote data */}
                {(() => {
                    // Use proposal parsed data first, fall back to voter counts from voteRecords
                    const totalVotes = proposal.yesVotes + proposal.noVotes + proposal.abstainVotes
                    const totalVoterCount = totalYesVoters + totalNoVoters
                    const yesPct = proposal.yesPercent
                        || (totalVotes > 0 ? Math.round((proposal.yesVotes / totalVotes) * 100) : 0)
                        || (totalVoterCount > 0 ? Math.round((totalYesVoters / totalVoterCount) * 100) : 0)
                    const noPct = proposal.noPercent
                        || (totalVotes > 0 ? Math.round((proposal.noVotes / totalVotes) * 100) : 0)
                        || (totalVoterCount > 0 ? Math.round((totalNoVoters / totalVoterCount) * 100) : 0)
                    const abstainPct = totalVotes > 0 ? Math.round((proposal.abstainVotes / totalVotes) * 100) : 0
                    if (yesPct === 0 && noPct === 0 && totalVotes === 0 && totalVoterCount === 0) return null
                    return (
                        <div style={{ marginBottom: 16 }}>
                            {/* Percentage labels */}
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "JetBrains Mono, monospace", marginBottom: 6 }}>
                                <div style={{ display: "flex", gap: 14 }}>
                                    <span style={{ color: "#4caf50", fontWeight: 600 }}>✓ {yesPct}% Yes</span>
                                    <span style={{ color: "#f44336", fontWeight: 600 }}>✗ {noPct}% No</span>
                                    {abstainPct > 0 && <span style={{ color: "#888" }}>○ {abstainPct}% Abstain</span>}
                                </div>
                                <span style={{ color: "#555" }}>
                                    {totalYesVoters + totalNoVoters}{memberCount > 0 ? ` of ${memberCount}` : ""} voted{memberCount > 0 ? ` (${Math.round(((totalYesVoters + totalNoVoters) / memberCount) * 100)}%)` : ""}
                                </span>
                            </div>
                            {/* Visual bar */}
                            <div style={{ height: 8, background: "#1a1a1a", borderRadius: 4, overflow: "hidden", display: "flex" }}>
                                <div style={{ width: `${yesPct}%`, background: "linear-gradient(90deg, #4caf50, #4caf5088)", transition: "width 0.4s" }} />
                                <div style={{ width: `${noPct}%`, background: "linear-gradient(90deg, #f44336, #f4433688)", transition: "width 0.4s" }} />
                                {abstainPct > 0 && <div style={{ width: `${abstainPct}%`, background: "linear-gradient(90deg, #888, #88888888)", transition: "width 0.4s" }} />}
                            </div>
                        </div>
                    )
                })()}

                {/* Detailed vote counts */}
                {(proposal.yesVotes > 0 || proposal.noVotes > 0) && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
                        <VoteStat label="Yes" count={proposal.yesVotes} color="#4caf50" icon="✓" />
                        <VoteStat label="No" count={proposal.noVotes} color="#f44336" icon="✗" />
                        <VoteStat label="Abstain" count={proposal.abstainVotes} color="#888" icon="○" />
                    </div>
                )}

                {/* Voter count summary */}
                {(totalYesVoters > 0 || totalNoVoters > 0) && (
                    <div style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#666" }}>
                        {totalYesVoters + totalNoVoters} total voters ({totalYesVoters} yes, {totalNoVoters} no)
                    </div>
                )}
            </div>

            {/* Tier-Grouped Vote Breakdown */}
            {voteRecords.length > 0 && (
                <div className="k-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 16 }}>
                        Vote Breakdown by Tier
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        {voteRecords.map((record) => (
                            <TierVoteBlock key={record.tier} record={record} />
                        ))}
                    </div>
                </div>
            )}

            {/* Success message */}
            {success && (
                <div style={{ padding: "12px 16px", background: "rgba(0,212,170,0.08)", borderRadius: 8, border: "1px solid rgba(0,212,170,0.2)", color: "#00d4aa", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                    ✓ {success}
                </div>
            )}

            {/* Actions */}
            {auth.isAuthenticated && !isArchived && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {proposal.status === "open" && (
                        <>
                            {/* Membership warning */}
                            {isMember === false && (
                                <div style={{
                                    padding: "12px 16px", borderRadius: 8,
                                    background: "rgba(245,166,35,0.06)", border: "1px solid rgba(245,166,35,0.15)",
                                    fontSize: 12, color: "#f5a623", fontFamily: "JetBrains Mono, monospace",
                                    marginBottom: 8,
                                }}>
                                    ⚠ Your wallet ({adena.address?.slice(0, 10)}...{adena.address?.slice(-4)}) is not a member of this DAO. Switch wallets in Adena to vote.
                                </div>
                            )}
                            {hasVoted ? (
                                <div style={{
                                    padding: "14px 16px", borderRadius: 8,
                                    background: userVote === "YES" ? "rgba(76,175,80,0.08)" : "rgba(244,67,54,0.08)",
                                    border: `1px solid ${userVote === "YES" ? "rgba(76,175,80,0.2)" : "rgba(244,67,54,0.2)"}`,
                                    fontSize: 13, fontFamily: "JetBrains Mono, monospace",
                                    color: userVote === "YES" ? "#4caf50" : "#f44336",
                                    fontWeight: 600,
                                }}>
                                    ✓ You voted {userVote} on this proposal
                                </div>
                            ) : (
                                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                    <button className="k-btn-primary" onClick={() => handleVote("YES")} disabled={actionLoading || isMember === false} style={{ flex: 1, minWidth: 120, background: "#4caf50", opacity: actionLoading || isMember === false ? 0.5 : 1 }}>
                                        {actionLoading ? "..." : "✓ Vote Yes"}
                                    </button>
                                    <button className="k-btn-primary" onClick={() => handleVote("NO")} disabled={actionLoading || isMember === false} style={{ flex: 1, minWidth: 120, background: "#f44336", opacity: actionLoading || isMember === false ? 0.5 : 1 }}>
                                        {actionLoading ? "..." : "✗ Vote No"}
                                    </button>
                                    <button className="k-btn-secondary" onClick={() => handleVote("ABSTAIN")} disabled={actionLoading || isMember === false} style={{ flex: 1, minWidth: 120, opacity: actionLoading || isMember === false ? 0.5 : 1 }}>
                                        {actionLoading ? "..." : "○ Abstain"}
                                    </button>
                                </div>
                            )}
                        </>
                    )}

                    {proposal.status === "passed" && isMember && (
                        <button className="k-btn-primary" onClick={handleExecute} disabled={actionLoading} style={{ width: "100%", background: "#2196f3", opacity: actionLoading ? 0.5 : 1 }}>
                            {actionLoading ? "Executing..." : "⚡ Execute Proposal"}
                        </button>
                    )}

                    {proposal.status === "passed" && isMember === false && (
                        <div style={{
                            padding: "12px 16px", borderRadius: 8,
                            background: "rgba(245,166,35,0.06)", border: "1px solid rgba(245,166,35,0.15)",
                            fontSize: 12, color: "#f5a623", fontFamily: "JetBrains Mono, monospace",
                        }}>
                            ⚠ Only DAO members can execute passed proposals.
                        </div>
                    )}
                </div>
            )}

            {/* Archived info */}
            {auth.isAuthenticated && isArchived && (
                <div style={{
                    padding: "12px 18px", borderRadius: 10,
                    background: "rgba(245,166,35,0.05)",
                    border: "1px solid rgba(245,166,35,0.15)",
                    display: "flex", alignItems: "center", gap: 10,
                }}>
                    <span style={{ fontSize: 16 }}>📦</span>
                    <div style={{ fontSize: 12, color: "#f5a623", fontFamily: "JetBrains Mono, monospace" }}>
                        This DAO is archived — voting and execution are disabled
                    </div>
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

function VoteStat({ label, count, color, icon }: { label: string; count: number; color: string; icon: string }) {
    return (
        <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color }}>
                {icon} {count}
            </div>
            <div style={{ fontSize: 10, color: "#666", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>
                {label}
            </div>
        </div>
    )
}

const tierColors: Record<string, string> = { T1: "#00d4aa", T2: "#2196f3", T3: "#f5a623" }

function TierVoteBlock({ record }: { record: VoteRecord }) {
    const color = tierColors[record.tier] || "#888"
    return (
        <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 12, color, fontFamily: "JetBrains Mono, monospace" }}>
                    {record.tier}
                </span>
                <span style={{ fontSize: 10, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>
                    VPPM {record.vppm}
                </span>
            </div>

            {/* YES voters */}
            {record.yesVoters.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: "#4caf50", fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>
                        YES ({record.yesVoters.length})
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {record.yesVoters.map((v) => (
                            <a
                                key={v.username}
                                href={v.profileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    padding: "2px 8px", borderRadius: 4, fontSize: 10,
                                    fontFamily: "JetBrains Mono, monospace",
                                    background: "rgba(76,175,80,0.08)", color: "#4caf50",
                                    textDecoration: "none", transition: "background 0.15s",
                                }}
                            >
                                {v.username}
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* NO voters */}
            {record.noVoters.length > 0 && (
                <div>
                    <span style={{ fontSize: 10, color: "#f44336", fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>
                        NO ({record.noVoters.length})
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {record.noVoters.map((v) => (
                            <a
                                key={v.username}
                                href={v.profileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    padding: "2px 8px", borderRadius: 4, fontSize: 10,
                                    fontFamily: "JetBrains Mono, monospace",
                                    background: "rgba(244,67,54,0.08)", color: "#f44336",
                                    textDecoration: "none",
                                }}
                            >
                                {v.username}
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {record.yesVoters.length === 0 && record.noVoters.length === 0 && (
                <div style={{ fontSize: 10, color: "#555", fontFamily: "JetBrains Mono, monospace" }}>
                    No votes from this tier
                </div>
            )}
        </div>
    )
}
