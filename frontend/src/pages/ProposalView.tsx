import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { useProposalDate } from "../hooks/useProposalDate"
import { formatRelativeTime } from "../lib/blockTime"
import { Archive } from "@phosphor-icons/react"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { GNO_RPC_URL, BECH32_PREFIX, getExplorerBaseUrl } from "../lib/config"
import {
    getProposalDetail,
    getProposalVotes,
    getDAOMembers,
    getDAOConfig,
    buildVoteMsg,
    buildExecuteMsg,
    isGovDAO,
    PROPOSAL_STATUS_COLORS,
    type DAOProposal,
    type VoteRecord,
} from "../lib/dao"
import { doContractBroadcast } from "../lib/grc20"
import { clearVoteCache } from "../lib/dao/voteScanner"
import { logChainError } from "../lib/errorLog"
import { AnalystReport } from "../components/dao/AnalystReport"
import { useDaoRoute } from "../hooks/useDaoRoute"
import { resolveOnChainUsername } from "../lib/profile"
import { TierVoteBlock } from "../components/proposal"
import { VotingInsights } from "../components/dao/TierPieChart"
import type { LayoutContext } from "../types/layout"
import "./proposalview.css"

export function ProposalView() {
    const { realmPath, encodedSlug, proposalId: routeProposalId } = useDaoRoute()
    const id = routeProposalId
    const navigate = useNetworkNav()
    const { auth, adena } = useOutletContext<LayoutContext>()
    const govDAO = isGovDAO(realmPath)

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
    const [thresholdPct, setThresholdPct] = useState(60)
    const [memberstorePath, setMemberstorePath] = useState("")


    const proposalId = parseInt(id || "", 10)
    // v3.2: Resolve proposal creation timestamp (hybrid: ISO → block estimation → tx-indexer)
    const { timestamp: proposalTimestamp } = useProposalDate(
        realmPath, proposalId, proposal?.createdAt, proposal?.createdAtBlock,
    )

    const loadProposal = useCallback(async (silent = false) => {
        if (isNaN(proposalId) || !realmPath) return
        if (!silent) setLoading(true)
        setError(null)
        try {
            const [p, votes] = await Promise.all([
                getProposalDetail(GNO_RPC_URL, realmPath, proposalId),
                getProposalVotes(GNO_RPC_URL, realmPath, proposalId),
            ])
            setProposal(p)
            setVoteRecords(votes)
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

    // Load DAO config (memberCount, threshold, archive) independently of wallet connection.
    // This ensures Voting Insights always has correct totalMembers — even for non-connected users.
    useEffect(() => {
        if (!realmPath) return
        getDAOConfig(GNO_RPC_URL, realmPath)
            .then((cfg) => {
                if (!cfg) return
                setIsArchived(cfg.isArchived)
                setMemberCount(cfg.memberCount)
                setMemberstorePath(cfg.memberstorePath || "")
                // Parse threshold: "60%" → 60
                const thr = parseInt(cfg.threshold || "60", 10)
                if (!isNaN(thr) && thr > 0) setThresholdPct(thr)
            })
            .catch(() => { /* non-blocking */ })
    }, [realmPath])

    // Check if connected wallet is a DAO member
    // Must pass memberstorePath for tier-based DAOs like GovDAO (fix: #v5.6.0)
    useEffect(() => {
        if (!adena.address || !realmPath) { setIsMember(null); return }
        getDAOMembers(GNO_RPC_URL, realmPath, memberstorePath || undefined)
            .then((members) => {
                const found = members.some((m) => m.address === adena.address)
                setIsMember(found)
                if (members.length > 0 && memberCount === 0) setMemberCount(members.length)
            })
            .catch(() => setIsMember(null)) // on error, don't block — let user try
    }, [adena.address, realmPath, memberstorePath, memberCount])

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
            for (const v of record.abstainVoters) {
                const vl = v.username.toLowerCase()
                if (vl === uname || vl === `@${unameNoAt}` || vl.includes(addr.slice(0, 10))) {
                    return { hasVoted: true, userVote: "ABSTAIN" }
                }
            }
        }
        return { hasVoted: false, userVote: "" }
    }, [voteRecords, adena.address, myUsername])

    // v6 UX-04: Confirmation dialog before irreversible on-chain vote
    const [pendingVote, setPendingVote] = useState<"YES" | "NO" | "ABSTAIN" | null>(null)

    const confirmVote = (vote: "YES" | "NO" | "ABSTAIN") => {
        setPendingVote(vote)
    }

    const cancelVote = () => {
        setPendingVote(null)
    }

    const handleVote = async (vote: "YES" | "NO" | "ABSTAIN") => {
        setPendingVote(null)
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
            logChainError(`proposal:vote:${realmPath}#${proposalId}`, err, "critical", adena.address)
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
            // With ExecuteOrRejectProposal (gno#5261), the tx succeeds but the
            // proposal may be rejected if execution errored. Reload to get final status.
            setSuccess(`Proposal #${proposalId} processed — reloading status...`)
            await loadProposal()
        } catch (err) {
            logChainError(`proposal:execute:${realmPath}#${proposalId}`, err, "critical", adena.address)
            setError(err instanceof Error ? err.message : "Failed to execute")
        } finally {
            setActionLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="animate-fade-in proposal-skeleton-col">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
            </div>
        )
    }

    if (!proposal) {
        return (
            <div className="animate-fade-in proposal-notfound">
                <p>Proposal #{proposalId} not found</p>
                <button
                    onClick={() => navigate(`/dao/${encodedSlug}`)}
                    aria-label="Back to DAO"
                    id="proposal-notfound-back-btn"
                    className="proposal-notfound-back"
                >
                    ← Back to DAO
                </button>
            </div>
        )
    }

    const sc = PROPOSAL_STATUS_COLORS[proposal.status] || PROPOSAL_STATUS_COLORS.open
    const isLive = proposal.status === "open"


    return (
        <div className="animate-fade-in proposal-container">
            {/* Breadcrumb navigation */}
            <div className="proposal-breadcrumb">
                <button
                    onClick={() => navigate("/dao")}
                    className="proposal-breadcrumb-btn"
                >
                    DAO
                </button>
                <span className="proposal-breadcrumb-sep">›</span>
                <button
                    onClick={() => navigate(`/dao/${encodedSlug}`)}
                    aria-label="Back to DAO"
                    id="proposal-back-btn"
                    className="proposal-breadcrumb-btn proposal-breadcrumb-btn--active"
                >
                    {(() => { const name = realmPath.split("/").pop() || "DAO"; return name.charAt(0).toUpperCase() + name.slice(1) })()}
                </button>
                <span className="proposal-breadcrumb-sep">›</span>
                <span className="proposal-breadcrumb-current">Proposal #{proposal?.id ?? proposalId}</span>
            </div>

            {/* Header */}
            <div>
                <div className="proposal-meta-row">
                    <span className="proposal-id-label">
                        Proposal #{proposal.id}
                    </span>
                    <a
                        href={`${getExplorerBaseUrl()}/r/${realmPath.replace("gno.land/r/", "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View source on gno.land"
                        className="proposal-source-link"
                    >
                        &lt;/&gt;
                    </a>
                    <span
                        className="proposal-status-badge"
                        style={{ background: sc.bg, color: sc.color }}
                    >
                        {sc.label}
                    </span>
                    {proposal.status === "passed" && (
                        <span className="proposal-awaiting-hint">
                            ⚡ Awaiting execution
                        </span>
                    )}
                    {isLive && (
                        <span className="proposal-live-badge">
                            <span className="animate-glow proposal-live-dot" />
                            LIVE
                        </span>
                    )}
                    {proposal.tiers.length > 0 && (
                        <div className="proposal-tier-badges">
                            {proposal.tiers.map((t) => (
                                <span key={t} className="proposal-tier-badge">
                                    {t}
                                </span>
                            ))}
                        </div>
                    )}
                    {/* v2.13: Category badge */}
                    {proposal.category && (
                        <span className="proposal-category-badge">
                            {proposal.category}
                        </span>
                    )}
                </div>
                <h2 className="proposal-title">
                    {proposal.title}
                </h2>
            </div>

            {/* Author Card */}
            {proposal.author && (
                <div className="k-card proposal-author-card">
                    <div className="proposal-author-avatar">
                        {proposal.author.charAt(0) === "@" ? proposal.author.charAt(1).toUpperCase() : "?"}
                    </div>
                    <div>
                        <div className="proposal-author-name">
                            {proposal.authorProfile ? (
                                <a href={proposal.authorProfile} target="_blank" rel="noopener noreferrer"
                                    className="proposal-author-link"
                                >
                                    {proposal.author}
                                </a>
                            ) : proposal.author}
                        </div>
                        <div className="proposal-author-role">
                            Proposer
                        </div>
                    </div>
                    {proposal.proposer && proposal.proposer.startsWith(BECH32_PREFIX) && (
                        <div className="proposal-author-address">
                            <CopyableAddress address={proposal.proposer} />
                        </div>
                    )}
                </div>
            )}

            {/* v3.2: Proposal Date Metadata */}
            {proposalTimestamp && (
                <div className="k-card proposal-date-card">
                    <div className="proposal-date-item">
                        <span className="proposal-date-item__icon">📅</span>
                        <span className="proposal-date-item__label">
                            {proposalTimestamp.label}
                        </span>
                    </div>
                    <div className="proposal-date-item">
                        <span className="proposal-date-item__icon">⏱️</span>
                        <span className="proposal-date-item__label proposal-date-item__label--secondary">
                            {formatRelativeTime(proposalTimestamp.date)}
                        </span>
                    </div>
                    {proposalTimestamp.block && (
                        <span className="proposal-date-block">
                            block #{proposalTimestamp.block.toLocaleString()}
                        </span>
                    )}
                    {!proposalTimestamp.exact && (
                        <span className="proposal-date-estimated">estimated</span>
                    )}
                </div>
            )}

            {/* Description */}
            {proposal.description && (
                <div className="k-card proposal-desc-card">
                    <p className="proposal-desc-text">
                        {proposal.description}
                    </p>
                </div>
            )}

            {/* AI Analyst Consensus — only render when proposal is loaded */}
            {proposal && (proposal.description || proposal.title) && (
                <AnalystReport
                    realmPath={realmPath}
                    proposalId={proposalId}
                    proposalData={proposal.description || proposal.title}
                    daoContext={`DAO: ${realmPath}, Proposal #${proposalId}: ${proposal.title}`}
                />
            )}

            {/* v2.13: Proposal Action Metadata */}
            {(proposal.actionType || proposal.actionBody || proposal.executorRealm) && (
                <div className="k-card proposal-action-card">
                    <h3 className="proposal-action-title">
                        📦 Proposal Action
                        {proposal.actionType && (
                            <span className="proposal-action-type-badge">
                                {proposal.actionType}
                            </span>
                        )}
                    </h3>
                    {proposal.executorRealm && (
                        <div className="proposal-executor-label">
                            Executor realm:{" "}
                            <a
                                href={`${getExplorerBaseUrl()}/r/${proposal.executorRealm.replace("gno.land/r/", "")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="proposal-executor-link"
                            >
                                {proposal.executorRealm}
                            </a>
                        </div>
                    )}
                    {proposal.actionBody && (
                        <pre className="proposal-action-body">
                            {proposal.actionBody}
                        </pre>
                    )}
                </div>
            )}

            {/* Voting Insights — 3-layer card (Participation / Vote Split / Tier Breakdown) */}
            <VotingInsights
                yesVotes={proposal.yesVotes || voteRecords.reduce((s, r) => s + r.yesVoters.length, 0)}
                noVotes={proposal.noVotes || voteRecords.reduce((s, r) => s + r.noVoters.length, 0)}
                abstainVotes={proposal.abstainVotes || 0}
                totalMembers={memberCount}
                threshold={thresholdPct}
                voteRecords={voteRecords}
            />

            {/* Tier-Grouped Vote Breakdown */}
            {voteRecords.length > 0 && (
                <div className="k-card proposal-votes-card">
                    <h3 className="proposal-votes-title">
                        Vote Breakdown by Tier
                    </h3>
                    <div className="proposal-votes-list">
                        {voteRecords.map((record) => (
                            <TierVoteBlock key={record.tier} record={record} />
                        ))}
                    </div>
                </div>
            )}

            {/* Success message */}
            <div aria-live="polite">
            {success && (
                <div className="proposal-success-msg">
                    ✓ {success}
                </div>
            )}
            </div>

            {/* Actions */}
            {auth.isAuthenticated && !isArchived && (
                <div className="proposal-actions-col">
                    {proposal.status === "open" && (
                        <>
                            {/* Membership warning */}
                            {isMember === false && (
                                <div className="proposal-warning proposal-warning--mb">
                                    ⚠ Your wallet ({adena.address?.slice(0, 10)}...{adena.address?.slice(-4)}) is not a member of this DAO. Switch wallets in Adena to vote, or{" "}
                                    <button
                                        onClick={() => navigate(`/dao/${encodedSlug}/candidature`)}
                                        style={{ background: "none", border: "none", padding: 0, color: "var(--color-primary)", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", textDecoration: "underline" }}
                                    >
                                        apply to join this DAO
                                    </button>.
                                </div>
                            )}
                            {hasVoted ? (
                                <div className={`proposal-voted-indicator proposal-voted-indicator--${userVote.toLowerCase()}`}>
                                    ✓ You voted {userVote} on this proposal
                                </div>
                            ) : (
                                {/* v6 UX-04: Vote confirmation dialog */}
                                {pendingVote && (
                                    <div className="proposal-confirm-dialog" role="alertdialog" aria-label="Confirm vote" style={{ background: "var(--color-k-panel)", border: "1px solid var(--color-k-edge)", borderRadius: 10, padding: 20, marginBottom: 16, textAlign: "center" }}>
                                        <p style={{ marginBottom: 12, fontSize: 15 }}>
                                            Vote <strong>{pendingVote}</strong> on Proposal #{proposalId}?
                                        </p>
                                        <p style={{ color: "var(--color-k-dim)", fontSize: 13, marginBottom: 16 }}>
                                            This is an on-chain action that costs gas and cannot be undone.
                                        </p>
                                        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                                            <button className="k-btn-secondary" onClick={cancelVote} style={{ minWidth: 100 }}>Cancel</button>
                                            <button className="k-btn-primary" onClick={() => handleVote(pendingVote)} style={{ minWidth: 100, background: pendingVote === "YES" ? "#4caf50" : pendingVote === "NO" ? "#f44336" : "var(--color-k-accent)" }}>
                                                Confirm {pendingVote}
                                            </button>
                                        </div>
                                    </div>
                                )}
                                <div className="proposal-vote-btns">
                                    <button className="k-btn-primary" onClick={() => confirmVote("YES")} disabled={actionLoading || isMember === false || !!pendingVote} aria-label="Vote Yes on this proposal" style={{ flex: 1, minWidth: 120, background: "#4caf50", opacity: actionLoading || isMember === false ? 0.5 : 1 }}>
                                        {actionLoading ? "..." : "✓ Vote Yes"}
                                    </button>
                                    <button className="k-btn-primary" onClick={() => confirmVote("NO")} disabled={actionLoading || isMember === false || !!pendingVote} aria-label="Vote No on this proposal" style={{ flex: 1, minWidth: 120, background: "#f44336", opacity: actionLoading || isMember === false ? 0.5 : 1 }}>
                                        {actionLoading ? "..." : "✗ Vote No"}
                                    </button>
                                    {!govDAO && (
                                        <button className="k-btn-secondary" onClick={() => confirmVote("ABSTAIN")} disabled={actionLoading || isMember === false || !!pendingVote} aria-label="Abstain from voting on this proposal" style={{ flex: 1, minWidth: 120, opacity: actionLoading || isMember === false ? 0.5 : 1 }}>
                                            {actionLoading ? "..." : "○ Abstain"}
                                        </button>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {proposal.status === "passed" && isMember && (
                        <button className="k-btn-primary" onClick={handleExecute} disabled={actionLoading} aria-label={`Execute proposal ${proposalId}`} style={{ width: "100%", background: "#2196f3", opacity: actionLoading ? 0.5 : 1 }}>
                            {actionLoading ? "Executing..." : "⚡ Execute Proposal"}
                        </button>
                    )}

                    {proposal.status === "passed" && isMember === false && (
                        <div className="proposal-warning">
                            ⚠ Only DAO members can execute passed proposals.
                        </div>
                    )}
                </div>
            )}

            {/* Archived info */}
            {auth.isAuthenticated && isArchived && (
                <div className="proposal-archived-banner">
                    <span className="proposal-archived-icon"><Archive size={16} /></span>
                    <div className="proposal-archived-text">
                        This DAO is archived — voting and execution are disabled
                    </div>
                </div>
            )}

            {!auth.isAuthenticated && (
                <div className="k-dashed proposal-connect-cta">
                    <p>Connect your wallet to vote on proposals</p>
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} onRetry={() => { setError(null); loadProposal() }} />
        </div>
    )
}
