/**
 * Dashboard — Authenticated user hub for multisig wallets, DAOs, and tokens.
 *
 * Decomposed in v2.0.0: UI sections extracted into components/dashboard/.
 * This file handles data fetching, state management, and composition.
 */
import { useNetworkNav } from "../hooks/useNetworkNav"
import { useEffect, useState, useCallback } from "react"
import { useOutletContext } from "react-router-dom"
import { LockKey, MagnifyingGlass } from "@phosphor-icons/react"
import { api } from "../lib/api"
import { StatusBadge } from "../components/ui/StatusBadge"
import { getTxStatus } from "../components/ui/txStatus"
import { SkeletonRow } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import type { Multisig, Transaction } from "../gen/memba/v1/memba_pb"
import { ExecutionState } from "../gen/memba/v1/memba_pb"
import { GNO_RPC_URL, GNO_CHAIN_ID, GNO_BECH32_PREFIX, getUserRegistryPath } from "../lib/config"
import { exportTransactionsCSV, type ExportableTransaction } from "../lib/txExport"
import { queryRender } from "../lib/dao/shared"
import { fetchBackendProfile } from "../lib/profile"
import { useUnvotedProposals } from "../hooks/useUnvotedProposals"
import { buildVoteMsg } from "../lib/dao"
import { doContractBroadcast } from "../lib/grc20"
import { clearVoteCache } from "../lib/dao/voteScanner"
import { logChainError } from "../lib/errorLog"
import { getSavedDAOsForOrg } from "../lib/daoSlug"
import { useOrg } from "../contexts/OrgContext"
import type { LayoutContext } from "../types/layout"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"
import { trackPageVisit, canApplyForMembership } from "../lib/quests"
import {
    DashboardIdentityCard,
    ActionRequiredStrip,
    QuickVoteWidget,
    DashboardFeatureCards,
    DashboardDAOList,
    FaucetCard,
    DashboardAssets,
} from "../components/dashboard"
import "./dashboard.css"

export function Dashboard() {
    const navigate = useNetworkNav()
    const { balance, auth, isLoggingIn } = useOutletContext<LayoutContext>()
    const { activeOrgId } = useOrg()
    const token = auth.token

    // Redirect disconnected users to landing page (only after login state is resolved)
    useEffect(() => {
        if (!isLoggingIn && !auth.isAuthenticated) navigate("/", { replace: true })
    }, [auth.isAuthenticated, isLoggingIn, navigate])

    // Quest: page visit tracking
    useEffect(() => { trackPageVisit("dashboard") }, [])

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
    const userAddress = auth.isAuthenticated ? auth.address || null : null
    const { proposals: unvotedProposals, loading: unvotedLoading } = useUnvotedProposals(userAddress)
    const [votingId, setVotingId] = useState<string | null>(null)
    const [votedIds, setVotedIds] = useState<Set<string>>(new Set())

    // Saved DAOs count for feature card (org-scoped)
    const savedDAOsCount = auth.isAuthenticated ? getSavedDAOsForOrg(activeOrgId).length : 0

    // v3.2: Candidature eligibility banner (dismissible with localStorage)
    const CANDIDATURE_DISMISS_KEY = `memba_${userAddress}_candidature_banner_dismissed`
    const [candidatureBannerDismissed, setCandidatureBannerDismissed] = useState(() =>
        !!localStorage.getItem(CANDIDATURE_DISMISS_KEY)
    )
    const showCandidatureBanner = auth.isAuthenticated
        && canApplyForMembership()
        && !candidatureBannerDismissed

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
            const msg = err instanceof Error ? err.message : ""
            const isNetworkError = /failed to fetch|networkerror|econnrefused|err_network|timeout|aborted/i.test(msg)
            if (isNetworkError) {
                console.warn("[Dashboard] Backend API unreachable — multisig features unavailable:", msg)
            } else {
                setError(msg || "Failed to load data")
            }
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
        queryRender(GNO_RPC_URL, getUserRegistryPath(), addr)
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
            const msg = buildVoteMsg(userAddress, realmPath, proposalId, vote)
            await doContractBroadcast([msg], `Vote ${vote} on proposal #${proposalId}`)
            setVotedIds(prev => new Set(prev).add(key))
            clearVoteCache()
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

    // Show ConnectingLoader while wallet is syncing
    if (isLoggingIn) {
        return <ConnectingLoader />
    }

    return (
        <div className="animate-fade-in k-dashboard">

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

            {/* ── Assets Overview ────────────────────── */}
            {auth.isAuthenticated && (
                <DashboardAssets
                    address={(auth as { address?: string }).address || ""}
                    gnotBalance={balance}
                />
            )}

            {/* v3.2: Candidature Eligibility Banner (dismissible) */}
            {showCandidatureBanner && (
                <div
                    className="k-card"
                    style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "12px 16px",
                        borderColor: "rgba(0,212,170,0.15)",
                        background: "rgba(0,212,170,0.04)",
                    }}
                >
                    <span style={{ fontSize: 20 }}>🏛️</span>
                    <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0" }}>
                            You're eligible for Memba DAO!
                        </span>
                        <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>
                            Your quest XP qualifies you for membership.
                        </span>
                    </div>
                    <button
                        className="k-btn-primary"
                        style={{ fontSize: 11, padding: "6px 14px", whiteSpace: "nowrap" }}
                        onClick={() => navigate("/candidature")}
                    >
                        Apply Now →
                    </button>
                    <button
                        style={{
                            background: "none", border: "none", color: "#555",
                            cursor: "pointer", fontSize: 16, padding: "4px",
                        }}
                        aria-label="Dismiss"
                        onClick={() => {
                            localStorage.setItem(CANDIDATURE_DISMISS_KEY, "1")
                            setCandidatureBannerDismissed(true)
                        }}
                    >
                        ✕
                    </button>
                </div>
            )}
            {/* ── Faucet Onboarding Card ────────────── */}
            {auth.isAuthenticated && (
                <FaucetCard address={userAddress} />
            )}

            {/* ── Page header ──────────────────────── */}
            {auth.isAuthenticated && (
                <div>
                    <h2 className="k-dashboard__title">Dashboard</h2>
                    <p className="k-dashboard__subtitle">
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

                    {/* My DAOs */}
                    <DashboardDAOList savedDAOs={getSavedDAOsForOrg(activeOrgId)} userAddress={userAddress} />

                    {/* My Multisigs (always visible) */}
                    <div>
                        <div className="k-dashboard__section-header">
                            <span className="k-dashboard__section-header-icon"><LockKey size={16} /></span>
                            <h3 className="k-dashboard__section-title">My Multisigs</h3>
                            <span className="k-label k-dashboard__section-count">{joinedMultisigs.length} active</span>
                        </div>
                        {joinedMultisigs.length === 0 ? (
                            <div className="k-card k-dashboard__empty">
                                <p className="k-dashboard__empty-text">
                                    No multisig wallets yet
                                </p>
                                <div className="k-dashboard__empty-actions">
                                    <button className="k-btn-primary" onClick={() => navigate("/create")}>
                                        Create Multisig →
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="k-dashboard__ms-grid">
                                {joinedMultisigs.map(ms => (
                                    <div
                                        key={ms.address}
                                        className="k-card k-dashboard__ms-card"
                                        onClick={() => navigate(`/multisig/${ms.address}`)}
                                    >
                                        <div className="k-dashboard__ms-header">
                                            <span className="k-dashboard__ms-name">{ms.name || "Unnamed"}</span>
                                            <span className="k-dashboard__ms-threshold">
                                                {ms.threshold}/{ms.membersCount}
                                            </span>
                                        </div>
                                        <CopyableAddress address={ms.address} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

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
                    <div className="k-dashboard__section-header">
                        <span className="k-dashboard__section-header-icon"><MagnifyingGlass size={16} /></span>
                        <h3 className="k-dashboard__section-title">Discovered Multisigs</h3>
                        <span className="k-label k-dashboard__section-count">{discoverableMultisigs.length} found</span>
                    </div>
                    <p className="k-dashboard__disc-desc">
                        These multisigs include your address as a member. Join to manage them.
                    </p>
                    <div className="k-dashboard__ms-grid">
                        {discoverableMultisigs.map(ms => (
                            <div key={ms.address} className="k-card k-dashboard__disc-card">
                                <div className="k-dashboard__ms-header">
                                    <span className="k-dashboard__ms-name">{ms.name || "Unnamed"}</span>
                                    <span className="k-dashboard__disc-threshold">
                                        {ms.threshold}/{ms.membersCount}
                                    </span>
                                </div>
                                <span className="k-dashboard__disc-addr">
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

            {/* ── Pending Transactions ───────────────────────────────── */}
            {auth.isAuthenticated && (
                <div>
                    <div className="k-dashboard__section-header">
                        <span className="k-status-dot k-status-dot--ok animate-glow" />
                        <h3 className="k-dashboard__section-title">Pending Transactions</h3>
                        <span className="k-label k-dashboard__section-count">{pendingTxs.length} pending</span>
                    </div>
                    {loading ? (
                        <div className="k-card k-dashboard__table-card">
                            <SkeletonRow />
                            <SkeletonRow />
                        </div>
                    ) : pendingTxs.length === 0 ? (
                        <div className="k-card k-dashboard__empty">
                            <p className="k-dashboard__empty-text k-dashboard__empty-text--lg">
                                No pending transactions
                            </p>
                        </div>
                    ) : (
                        <div className="k-card k-dashboard__table-card">
                            {pendingTxs.map((tx) => {
                                const status = getTxStatus(tx.finalHash, tx.signatures.length, tx.threshold)
                                return (
                                    <div
                                        key={tx.id}
                                        className="k-activity-row k-dashboard__activity-row"
                                        onClick={() => navigate(`/tx/${tx.id}`)}
                                    >
                                        <span className="k-dashboard__activity-type">{tx.type || "send"}</span>
                                        <span className="k-activity-hide-mobile"><CopyableAddress address={tx.multisigAddress} full={false} /></span>
                                        <span><StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} /></span>
                                        <span className="k-dashboard__activity-date">{formatDate(tx.createdAt)}</span>
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
                    <div className="k-dashboard__recent-header">
                        <h3 className="k-dashboard__section-title">Recent Activity</h3>
                        {recentTxs.length > 0 && (
                            <button
                                className="k-dashboard__export-btn"
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
                            >
                                📥 Export CSV
                            </button>
                        )}
                    </div>
                    {loading ? (
                        <div className="k-card k-dashboard__table-card">
                            <SkeletonRow />
                            <SkeletonRow />
                            <SkeletonRow />
                        </div>
                    ) : recentTxs.length === 0 ? (
                        <div className="k-card k-dashboard__table-card">
                            <div className="k-dashboard__activity-header">
                                <span>Type</span>
                                <span>Multisig</span>
                                <span>Status</span>
                                <span>Date</span>
                            </div>
                            <div className="k-dashboard__empty">
                                <p className="k-dashboard__empty-text k-dashboard__empty-text--lg">
                                    No activity yet
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="k-card k-dashboard__table-card">
                            <div className="k-dashboard__activity-header">
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
                                        className="k-activity-row k-dashboard__activity-row"
                                        onClick={() => navigate(`/tx/${tx.id}`)}
                                    >
                                        <span className="k-dashboard__activity-type">{tx.type || "send"}</span>
                                        <span><CopyableAddress address={tx.multisigAddress} full={false} /></span>
                                        <span>
                                            <StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} hash={tx.finalHash} />
                                        </span>
                                        <span className="k-dashboard__activity-date">{formatDate(tx.createdAt)}</span>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} onRetry={() => { setError(null); fetchData() }} />
        </div>
    )
}
