/**
 * Dashboard — Authenticated user hub for multisig wallets, DAOs, and tokens.
 *
 * Decomposed in v2.0.0: UI sections extracted into components/dashboard/.
 * This file handles data fetching, state management, and composition.
 */
import { useEffect, useState, useCallback } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { api } from "../lib/api"
import { StatusBadge } from "../components/ui/StatusBadge"
import { getTxStatus } from "../components/ui/txStatus"
import { SkeletonRow } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import type { Multisig, Transaction } from "../gen/memba/v1/memba_pb"
import { ExecutionState } from "../gen/memba/v1/memba_pb"
import { GNO_RPC_URL, GNO_CHAIN_ID, GNO_BECH32_PREFIX } from "../lib/config"
import { exportTransactionsCSV, type ExportableTransaction } from "../lib/txExport"
import { queryRender } from "../lib/dao/shared"
import { fetchBackendProfile } from "../lib/profile"
import { useUnvotedProposals } from "../hooks/useUnvotedProposals"
import { buildVoteMsg, isGovDAO as checkIsGovDAO } from "../lib/dao"
import { doContractBroadcast } from "../lib/grc20"
import { clearVoteCache } from "../lib/dao/voteScanner"
import { logChainError } from "../lib/errorLog"
import { getSavedDAOs } from "../lib/daoSlug"
import type { LayoutContext } from "../types/layout"
import {
    DashboardIdentityCard,
    ActionRequiredStrip,
    QuickVoteWidget,
    DashboardFeatureCards,
} from "../components/dashboard"

export function Dashboard() {
    const navigate = useNavigate()
    const { balance, auth } = useOutletContext<LayoutContext>()
    const token = auth.token

    const [multisigs, setMultisigs] = useState<Multisig[]>([])
    const [pendingTxs, setPendingTxs] = useState<Transaction[]>([])
    const [recentTxs, setRecentTxs] = useState<Transaction[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [joiningAddr, setJoiningAddr] = useState<string | null>(null)
    // User identity (from on-chain profile)
    const [username, setUsername] = useState<string | null>(null)
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

    const joinedMultisigs = multisigs.filter(m => m.joined)
    const discoverableMultisigs = multisigs.filter(m => !m.joined)

    // Quick Vote: unvoted proposals from saved DAOs
    const userAddress = auth.isAuthenticated ? (auth as { address?: string }).address || null : null
    const { proposals: unvotedProposals, loading: unvotedLoading, refresh: refreshUnvoted } = useUnvotedProposals(userAddress)
    const [votingId, setVotingId] = useState<string | null>(null)
    const [votedIds, setVotedIds] = useState<Set<string>>(new Set())

    // Saved DAOs count for feature card
    const savedDAOsCount = auth.isAuthenticated ? getSavedDAOs().length : 0

    const fetchData = useCallback(async () => {
        if (!token || !auth.isAuthenticated) return
        setLoading(true)
        setError(null)
        try {
            const [msRes, pendRes, recentRes] = await Promise.all([
                api.multisigs({ authToken: token, limit: 50 }),
                api.transactions({ authToken: token, executionState: ExecutionState.PENDING, limit: 10 }),
                api.transactions({ authToken: token, limit: 10 }),
            ])
            setMultisigs(msRes.multisigs)
            setPendingTxs(pendRes.transactions)
            setRecentTxs(recentRes.transactions)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load data")
        } finally {
            setLoading(false)
        }
    }, [token, auth.isAuthenticated])

    useEffect(() => { fetchData() }, [fetchData])

    // Fetch on-chain username + avatar for the identity card
    useEffect(() => {
        if (!auth.isAuthenticated || !balance) return
        const addr = (auth as { address?: string }).address
        if (!addr) return
        queryRender(GNO_RPC_URL, "gno.land/r/gnoland/users/v1", addr)
            .then((data) => {
                if (!data) return
                const m = data.match(/# User - `([^`]+)`/)
                if (m) setUsername(`@${m[1]}`)
            })
            .catch(() => { /* silent */ })
        fetchBackendProfile(addr)
            .then((p) => { if (p?.avatarUrl) setAvatarUrl(p.avatarUrl) })
            .catch(() => { /* silent */ })
    }, [auth.isAuthenticated, balance, auth])

    // S1: Clear stale data when auth drops
    useEffect(() => {
        if (!auth.isAuthenticated) {
            setMultisigs([])
            setPendingTxs([])
            setRecentTxs([])
        }
    }, [auth.isAuthenticated])

    const formatDate = useCallback((dateStr: string) => {
        const d = new Date(dateStr)
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    }, [])

    const handleJoinMultisig = async (ms: Multisig) => {
        if (!token || !ms.pubkeyJson) return
        setJoiningAddr(ms.address)
        try {
            await api.createOrJoinMultisig({
                authToken: token,
                chainId: ms.chainId || GNO_CHAIN_ID,
                multisigPubkeyJson: ms.pubkeyJson,
                name: ms.name || "",
                bech32Prefix: GNO_BECH32_PREFIX,
            })
            fetchData() // refresh
        } catch (err) {
            logChainError("dashboard:joinMultisig", err, "error", userAddress || undefined)
            setError(err instanceof Error ? err.message : "Failed to join multisig")
        } finally {
            setJoiningAddr(null)
        }
    }

    // Quick Vote handler
    const handleQuickVote = async (realmPath: string, proposalId: number, vote: "YES" | "NO") => {
        if (!userAddress) return
        const key = `${realmPath}:${proposalId}`
        setVotingId(key)
        setError(null)
        try {
            const isGov = checkIsGovDAO(realmPath)
            const msg = buildVoteMsg(userAddress, realmPath, proposalId, vote)
            const fn = isGov ? "MustVoteOnProposalSimple" : "VoteOnProposal"
            await doContractBroadcast([msg], `Vote ${vote} on proposal #${proposalId} (${fn})`)
            setVotedIds(prev => new Set(prev).add(key))
            clearVoteCache()
            setTimeout(() => refreshUnvoted(), 2000)
        } catch (err) {
            logChainError(`dashboard:quickVote:${realmPath}#${proposalId}`, err, "critical", userAddress)
            setError(err instanceof Error ? err.message : "Vote failed")
        } finally {
            setVotingId(null)
        }
    }

    // Filter out voted proposals (optimistic UI)
    const visibleUnvotedProposals = unvotedProposals.filter(p => !votedIds.has(`${p.realmPath}:${p.proposalId}`))

    // Count unsigned pending TXs
    const unsignedPendingCount = pendingTxs.filter(tx =>
        !tx.signatures.some((s: { userAddress: string }) => s.userAddress === userAddress)
    ).length

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {/* ── User Identity Card ────────────────────────── */}
            {auth.isAuthenticated && (
                <DashboardIdentityCard
                    address={(auth as { address?: string }).address || ""}
                    username={username}
                    avatarUrl={avatarUrl}
                    balance={balance}
                    onAvatarError={() => setAvatarUrl(null)}
                />
            )}

            {/* ── Page header ──────────────────────── */}
            {auth.isAuthenticated && (
                <div>
                    <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Dashboard</h2>
                    <p style={{ color: "#999", fontSize: 14, marginTop: 4 }}>
                        Your hub for multisig wallets, DAOs, and tokens
                    </p>
                </div>
            )}

            {/* ── Authenticated Content ──────────── */}
            {auth.isAuthenticated && (
                <>
                    {/* Action Required Strip */}
                    {!loading && (
                        <ActionRequiredStrip
                            unvotedCount={visibleUnvotedProposals.length}
                            unsignedCount={unsignedPendingCount}
                            unvotedLoading={unvotedLoading}
                        />
                    )}

                    {/* Quick Vote Widget */}
                    <QuickVoteWidget
                        proposals={visibleUnvotedProposals}
                        votingId={votingId}
                        votedIds={votedIds}
                        onVote={handleQuickVote}
                    />

                    {/* Feature Cards Grid */}
                    <DashboardFeatureCards
                        joinedMultisigCount={joinedMultisigs.length}
                        firstMultisigAddress={joinedMultisigs[0]?.address || null}
                        savedDAOsCount={savedDAOsCount}
                    />
                </>
            )}

            {/* ── Discoverable Multisigs ─────────────── */}
            {auth.isAuthenticated && discoverableMultisigs.length > 0 && (
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                        <span style={{ fontSize: 14 }}>🔍</span>
                        <h3 style={{ fontSize: 16, fontWeight: 500 }}>Discovered Multisigs</h3>
                        <span className="k-label" style={{ marginLeft: "auto" }}>{discoverableMultisigs.length} found</span>
                    </div>
                    <p style={{ color: "#888", fontSize: 12, fontFamily: "JetBrains Mono, monospace", marginBottom: 12 }}>
                        These multisigs include your address as a member. Join to manage them.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                        {discoverableMultisigs.map(ms => (
                            <div key={ms.address} className="k-card" style={{ borderColor: "rgba(245,158,11,0.2)", display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontWeight: 600, fontSize: 14 }}>{ms.name || "Unnamed"}</span>
                                    <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#f59e0b", background: "rgba(245,158,11,0.1)", padding: "2px 6px", borderRadius: 4 }}>
                                        {ms.threshold}/{ms.membersCount}
                                    </span>
                                </div>
                                <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#666", wordBreak: "break-all" }}>
                                    <CopyableAddress address={ms.address} />
                                </span>
                                <button
                                    className="k-btn-primary"
                                    disabled={joiningAddr === ms.address}
                                    onClick={() => handleJoinMultisig(ms)}
                                    style={{ alignSelf: "flex-start", marginTop: 4, opacity: joiningAddr === ms.address ? 0.5 : 1 }}
                                >
                                    {joiningAddr === ms.address ? "Joining..." : "✓ Join Multisig"}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Your Multisigs ────────────────────────────────────── */}
            {auth.isAuthenticated && joinedMultisigs.length > 0 && (
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00d4aa" }} className="animate-glow" />
                        <h3 style={{ fontSize: 16, fontWeight: 500 }}>Your Multisigs</h3>
                        <span className="k-label" style={{ marginLeft: "auto" }}>{joinedMultisigs.length} active</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                        {joinedMultisigs.map(ms => (
                            <div
                                key={ms.address}
                                className="k-card"
                                onClick={() => navigate(`/multisig/${ms.address}`)}
                                style={{ cursor: "pointer", transition: "border-color 0.15s" }}
                                onMouseEnter={(e) => e.currentTarget.style.borderColor = "rgba(0,212,170,0.3)"}
                                onMouseLeave={(e) => e.currentTarget.style.borderColor = ""}
                            >
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                                    <span style={{ fontWeight: 600, fontSize: 14 }}>{ms.name || "Unnamed"}</span>
                                    <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#00d4aa", background: "rgba(0,212,170,0.08)", padding: "2px 6px", borderRadius: 4 }}>
                                        {ms.threshold}/{ms.membersCount}
                                    </span>
                                </div>
                                <CopyableAddress address={ms.address} />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Pending Transactions ───────────────────────────────── */}
            {auth.isAuthenticated && (
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00d4aa" }} className="animate-glow" />
                        <h3 style={{ fontSize: 16, fontWeight: 500 }}>Pending Transactions</h3>
                        <span className="k-label" style={{ marginLeft: "auto" }}>{pendingTxs.length} pending</span>
                    </div>
                    {loading ? (
                        <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                            <SkeletonRow />
                            <SkeletonRow />
                        </div>
                    ) : pendingTxs.length === 0 ? (
                        <div className="k-card" style={{ textAlign: "center", padding: 32 }}>
                            <p style={{ color: "#555", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                                No pending transactions
                            </p>
                        </div>
                    ) : (
                        <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                            {pendingTxs.map((tx) => {
                                const status = getTxStatus(tx.finalHash, tx.signatures.length, tx.threshold)
                                return (
                                    <div
                                        key={tx.id}
                                        onClick={() => navigate(`/tx/${tx.id}`)}
                                        className="k-activity-row"
                                        style={{
                                            display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto",
                                            padding: "14px 20px", borderBottom: "1px solid #1a1a1a",
                                            cursor: "pointer", transition: "background 0.15s",
                                            fontSize: 13, fontFamily: "JetBrains Mono, monospace",
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = "#0c0c0c"}
                                        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                    >
                                        <span style={{ color: "#f0f0f0", textTransform: "capitalize" }}>{tx.type || "send"}</span>
                                        <span className="k-activity-hide-mobile"><CopyableAddress address={tx.multisigAddress} full={false} /></span>
                                        <span><StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} /></span>
                                        <span style={{ color: "#555", fontSize: 11 }}>{formatDate(tx.createdAt)}</span>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ── Recent Activity ────────────────────────────────────────── */}
            {auth.isAuthenticated && (
                <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <h3 style={{ fontSize: 16, fontWeight: 500 }}>Recent Activity</h3>
                        {recentTxs.length > 0 && (
                            <button
                                onClick={() => {
                                    const exportable: ExportableTransaction[] = recentTxs.map((tx) => ({
                                        id: tx.id,
                                        createdAt: tx.createdAt,
                                        type: tx.type,
                                        multisigAddress: tx.multisigAddress,
                                        creatorAddress: tx.creatorAddress,
                                        memo: tx.memo,
                                        finalHash: tx.finalHash,
                                        threshold: tx.threshold,
                                        signatures: tx.signatures.map((s: { userAddress: string }) => ({ userAddress: s.userAddress })),
                                        msgsJson: tx.msgsJson,
                                    }))
                                    exportTransactionsCSV(exportable)
                                }}
                                style={{
                                    background: "rgba(0,212,170,0.06)", border: "1px solid rgba(0,212,170,0.15)",
                                    color: "#00d4aa", fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                                    padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                                }}
                            >
                                📥 Export CSV
                            </button>
                        )}
                    </div>
                    {loading ? (
                        <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                            <SkeletonRow />
                            <SkeletonRow />
                            <SkeletonRow />
                        </div>
                    ) : recentTxs.length === 0 ? (
                        <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                            <div className="k-activity-header" style={{
                                padding: "12px 20px", borderBottom: "1px solid #222",
                                display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto",
                                fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#555",
                                textTransform: "uppercase", letterSpacing: "0.05em",
                            }}>
                                <span>Type</span>
                                <span>Multisig</span>
                                <span>Status</span>
                                <span>Date</span>
                            </div>
                            <div style={{ padding: 32, textAlign: "center" }}>
                                <p style={{ color: "#555", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                                    No activity yet
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                            <div className="k-activity-header" style={{
                                padding: "12px 20px", borderBottom: "1px solid #222",
                                display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto",
                                fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#555",
                                textTransform: "uppercase", letterSpacing: "0.05em",
                            }}>
                                <span>Type</span>
                                <span>Multisig</span>
                                <span>Status</span>
                                <span>Date</span>
                            </div>
                            {recentTxs.map((tx) => {
                                const status = getTxStatus(tx.finalHash, tx.signatures.length, tx.threshold)
                                return (
                                    <div
                                        key={tx.id}
                                        onClick={() => navigate(`/tx/${tx.id}`)}
                                        className="k-activity-row"
                                        style={{
                                            display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto",
                                            padding: "14px 20px", borderBottom: "1px solid #1a1a1a",
                                            cursor: "pointer", transition: "background 0.15s",
                                            fontSize: 13, fontFamily: "JetBrains Mono, monospace",
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = "#0c0c0c"}
                                        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                    >
                                        <span style={{ color: "#f0f0f0", textTransform: "capitalize" }}>{tx.type || "send"}</span>
                                        <span><CopyableAddress address={tx.multisigAddress} full={false} /></span>
                                        <span>
                                            <StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} hash={tx.finalHash} />
                                        </span>
                                        <span style={{ color: "#555", fontSize: 11 }}>{formatDate(tx.createdAt)}</span>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}
