import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { Bank, Archive, UsersThree, Vault } from "@phosphor-icons/react"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { GNO_RPC_URL, getExplorerBaseUrl, getUserRegistryPath } from "../lib/config"
import { derivePkgBech32Addr } from "../lib/dao/realmAddress"

import {
    getDAOConfig,
    getDAOMembers,
    getDAOProposals,
    getProposalDetail,
    getProposalVotes,
    type DAOConfig,
    type DAOMember,
    type DAOProposal,
} from "../lib/dao"
import { decodeSlug, encodeSlug } from "../lib/daoSlug"
import { resolveOnChainUsername } from "../lib/profile"
import { ProposalCard, MemberCard } from "../components/dao"
import { PowerDonut } from "../components/dao/TierPieChart"
import { getPlugins } from "../plugins"
import { DeployPluginModal } from "../components/dao/DeployPluginModal"
import { useJitsiContext } from "../contexts/JitsiContext"
import type { LayoutContext } from "../types/layout"

/** Tiny component that derives + displays the realm's bech32 address. */
function RealmAddressBadge({ realmPath }: { realmPath: string }) {
    const [addr, setAddr] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        derivePkgBech32Addr(realmPath).then(setAddr).catch(() => setAddr(null))
    }, [realmPath])

    if (!addr) return null

    const truncated = `${addr.slice(0, 8)}…${addr.slice(-6)}`

    return (
        <button
            title={`Realm address: ${addr}\nClick to copy`}
            onClick={(e) => {
                e.stopPropagation()
                try {
                    navigator.clipboard.writeText(addr).then(() => {
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                    }).catch(() => {
                        // Clipboard API failed — do not show copied
                    })
                } catch {
                    // Clipboard API not available (HTTP context)
                }
            }}
            className="k-realm-address"
        >
            {copied ? "✓ Copied!" : <>{truncated} <span style={{ opacity: 0.5, fontSize: 9 }}>📋</span></>}
        </button>
    )
}

export function DAOHome() {
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()
    const { auth, adena } = useOutletContext<LayoutContext>()
    const { session, joinRoom } = useJitsiContext()

    const realmPath = slug ? decodeSlug(slug) : ""
    // Always re-encode to tilde format — fixes 404 when user enters via %2F URL
    const encodedSlug = realmPath ? encodeSlug(realmPath) : (slug || "")

    const [config, setConfig] = useState<DAOConfig | null>(null)
    const [members, setMembers] = useState<DAOMember[]>([])
    const [proposals, setProposals] = useState<DAOProposal[]>([])
    // Progressive loading: each section has its own loading state
    const [configLoading, setConfigLoading] = useState(true)
    const [membersLoading, setMembersLoading] = useState(true)
    const [proposalsLoading, setProposalsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // Vote enrichment: track which proposals have been enriched and which the user voted on
    const [votedIds, setVotedIds] = useState<Set<number>>(new Set())
    const [enrichedIds, setEnrichedIds] = useState<Set<number>>(new Set())
    const [voteFilter, setVoteFilter] = useState<"all" | "needs" | "voted">("all")
    const [showHistory, setShowHistory] = useState(false)
    const usernameRef = useRef<string | null>(null)
    const [showDeployModal, setShowDeployModal] = useState(false)

    const loadData = useCallback(async () => {
        if (!realmPath) return
        setEnrichedIds(new Set())
        setVotedIds(new Set())
        setConfigLoading(true)
        setMembersLoading(true)
        setProposalsLoading(true)
        setError(null)
        try {
            // Phase 1: config loads first → header renders immediately
            const cfg = await getDAOConfig(GNO_RPC_URL, realmPath)
            setConfig(cfg)
            setConfigLoading(false)

            // Phase 2: members + proposals load independently
            getDAOMembers(GNO_RPC_URL, realmPath, cfg?.memberstorePath)
                .then(setMembers)
                .catch((err) => setError(err instanceof Error ? err.message : "Failed to load members"))
                .finally(() => setMembersLoading(false))

            getDAOProposals(GNO_RPC_URL, realmPath)
                .then(setProposals)
                .catch((err) => setError(err instanceof Error ? err.message : "Failed to load proposals"))
                .finally(() => setProposalsLoading(false))
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load DAO data")
            setConfigLoading(false)
            setMembersLoading(false)
            setProposalsLoading(false)
        }
    }, [realmPath])

    useEffect(() => { loadData() }, [loadData])


    // Persist last visited DAO slug for plugin sidebar routing (B2)
    useEffect(() => {
        if (encodedSlug) {
            localStorage.setItem("memba_last_dao_slug", encodedSlug)
            window.dispatchEvent(new Event("memba:daoVisited"))
        }
    }, [encodedSlug])

    // Phase 3: Vote enrichment — always loads vote data (public), checks user vote when wallet connected
    useEffect(() => {
        if (proposalsLoading || proposals.length === 0) return
        // Resolve username once for hasVoted matching (only when connected)
        if (adena.address && !usernameRef.current) {
            resolveOnChainUsername(adena.address)
                .then(u => { usernameRef.current = u || null })
                .catch(() => { })
        }
        // Enrich active + passed proposals with vote data
        const enrichable = proposals.filter(p => p.status === "open" || p.status === "passed")
        // Limit to 10 concurrent fetches
        enrichable.slice(0, 10).forEach(p => {
            if (enrichedIds.has(p.id)) return
            setEnrichedIds(prev => new Set([...prev, p.id]))
            // Fetch vote details + voter lists in parallel
            Promise.all([
                getProposalDetail(GNO_RPC_URL, realmPath, p.id).catch(() => null),
                getProposalVotes(GNO_RPC_URL, realmPath, p.id).catch(() => []),
            ]).then(([detail, votes]) => {
                // Compute voter counts from vote records (always reliable)
                const yesCount = votes.reduce((s, v) => s + v.yesVoters.length, 0)
                const noCount = votes.reduce((s, v) => s + v.noVoters.length, 0)
                const totalCount = yesCount + noCount

                // Use detail data if parsing succeeded, otherwise compute from voter counts
                const yesPercent = detail?.yesPercent || (totalCount > 0 ? Math.round((yesCount / totalCount) * 100) : 0)
                const noPercent = detail?.noPercent || (totalCount > 0 ? Math.round((noCount / totalCount) * 100) : 0)
                const yesVotes = detail?.yesVotes || yesCount
                const noVotes = detail?.noVotes || noCount

                // Enrich proposal with vote data (public — visible to all visitors)
                setProposals(prev => prev.map(pp => pp.id === p.id ? {
                    ...pp,
                    yesPercent,
                    noPercent,
                    yesVotes,
                    noVotes,
                    abstainVotes: detail?.abstainVotes || 0,
                    totalVoters: totalCount || detail?.totalVoters || 0,
                } : pp))

                // Check if current user has voted (only when wallet connected)
                if (adena.address && votes.length > 0) {
                    const addr = adena.address.toLowerCase()
                    const uname = usernameRef.current?.toLowerCase() || ""
                    const allVoters = votes.flatMap(v => [
                        ...v.yesVoters.map(ve => ve.username.toLowerCase()),
                        ...v.noVoters.map(ve => ve.username.toLowerCase()),
                        ...v.abstainVoters.map(ve => ve.username.toLowerCase()),
                    ])
                    const voted = allVoters.some(v =>
                        v === uname || v === `@${uname.replace(/^@/, "")}` || v.includes(addr.slice(0, 10))
                    )
                    if (voted) {
                        setVotedIds(prev => new Set([...prev, p.id]))
                    }
                }
            })
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [proposalsLoading, proposals.length, adena.address, realmPath])

    // v2.13: Merge passed proposals into active list — "⚡ EXECUTE" badge shown inline by ProposalCard
    const activeProposals = proposals.filter((p) => p.status === "open" || p.status === "passed")
    const awaitingExecution = proposals.filter((p) => p.status === "passed")
    const completedProposals = proposals.filter((p) => p.status !== "open" && p.status !== "passed")
    // Non-voters: % of members who never voted — uses ALL proposals with actual vote data
    const proposalsWithVotes = proposals.filter(p => (p.yesVotes + p.noVotes + p.abstainVotes) > 0)
    const memberCount = config?.memberCount || members.length
    // Use the max participation across any single proposal (high-water mark)
    const maxVoterParticipation = proposalsWithVotes.length > 0
        ? Math.max(...proposalsWithVotes.map(p => p.yesVotes + p.noVotes + p.abstainVotes))
        : 0
    const nonVoterCount = memberCount > 0 ? Math.max(0, memberCount - maxVoterParticipation) : 0
    const nonVoterPercent = memberCount > 0 ? Math.round((nonVoterCount / memberCount) * 100) : 0

    // Check if current user is a member
    const currentMember = members.find((m) => m.address === adena.address)
    const totalPower = config?.tierDistribution?.reduce((sum, t) => sum + t.power, 0) || 0

    // ── DAO Health Score ──────────────────────────────────────────
    const healthScore = useMemo(() => {
        if (!config || proposals.length === 0) return null
        // Factor 1: Voter participation (0-40 pts) — higher is better
        const participationPts = proposalsWithVotes.length > 0
            ? Math.round((1 - nonVoterPercent / 100) * 40)
            : 0
        // Factor 2: Execution backlog (0-30 pts) — fewer pending = better
        const execBacklog = awaitingExecution.length
        const execPts = execBacklog === 0 ? 30 : execBacklog <= 2 ? 20 : execBacklog <= 5 ? 10 : 0
        // Factor 3: Activity (0-30 pts) — more proposals = more active
        const activityPts = proposals.length >= 10 ? 30 : proposals.length >= 5 ? 20 : proposals.length >= 2 ? 10 : 5
        const total = participationPts + execPts + activityPts
        const grade = total >= 80 ? "A" : total >= 60 ? "B" : total >= 40 ? "C" : "D"
        const color = grade === "A" ? "#00d4aa" : grade === "B" ? "#4dc9f6" : grade === "C" ? "#f7b731" : "#e74c3c"
        return { grade, total, color, participationPts, execPts, activityPts }
    }, [proposals.length, proposalsWithVotes.length, nonVoterPercent, awaitingExecution.length, config])

    useEffect(() => {
        if (!realmPath) navigate("/dao")
    }, [realmPath, navigate])

    if (!realmPath) {
        return (
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <SkeletonCard />
            </div>
        )
    }

    if (configLoading) {
        return (
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
            </div>
        )
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* ─── DAO Overview Card (single card: identity + stats) ─── */}
            <div className="k-card" style={{ padding: "16px 20px" }}>
                {/* Breadcrumb */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <button
                        id="dao-back-btn"
                        aria-label="Back to DAO list"
                        onClick={() => navigate("/dao")}
                        style={{ color: "#555", fontSize: 11, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", padding: 0 }}
                        onMouseEnter={e => e.currentTarget.style.color = "#00d4aa"}
                        onMouseLeave={e => e.currentTarget.style.color = "#555"}
                    >
                        DAOs
                    </button>
                    <span style={{ color: "#333", fontSize: 10 }}>›</span>
                    <span style={{ color: "#888", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
                        {config?.name || "DAO"}
                    </span>
                </div>

                {/* Title + membership pill */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <Bank size={20} style={{ color: '#888' }} /> {config?.name || "DAO Governance"}
                        {config?.isArchived && (
                            <span style={{
                                padding: "2px 8px", borderRadius: 4, fontSize: 9,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(245,166,35,0.1)", color: "#f5a623",
                            }}>
                                <Archive size={12} /> ARCHIVED
                            </span>
                        )}
                    </h2>
                    {auth.isAuthenticated && currentMember && (
                        <div
                            title={`Your role: ${currentMember.tier || "Member"} — Voting power: ${currentMember.votingPower || "1"}`}
                            style={{
                                display: "flex", alignItems: "center", gap: 6,
                                padding: "4px 10px", borderRadius: 6,
                                background: "rgba(0,212,170,0.06)",
                                flexShrink: 0,
                            }}>
                            <span style={{ color: "#00d4aa", fontSize: 11 }}>✓</span>
                            <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#00d4aa", fontWeight: 600 }}>
                                {currentMember.tier || ""}
                                {currentMember.votingPower ? ` · Power ${currentMember.votingPower}` : ""}
                            </span>
                        </div>
                    )}
                    {auth.isAuthenticated && !currentMember && (
                        <span style={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace", color: "#555", padding: "4px 8px" }}>Guest</span>
                    )}
                </div>

                {/* Realm path · </> (left)    address (right) */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 5, flexWrap: "wrap", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ color: "#444", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}>
                            {realmPath}
                        </span>
                        <a
                            href={`${getExplorerBaseUrl()}/r/${realmPath.replace("gno.land/r/", "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View source on gno.land"
                            style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#444", textDecoration: "none", transition: "color 0.15s", padding: "0 3px" }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = "#00d4aa")}
                            onMouseLeave={(e) => (e.currentTarget.style.color = "#444")}
                            onClick={(e) => e.stopPropagation()}
                        >
                            &lt;/&gt;
                        </a>
                    </div>
                    <RealmAddressBadge realmPath={realmPath} />
                </div>

                {/* Description */}
                {(config?.description || realmPath === "gno.land/r/gov/dao") && (
                    <p style={{ color: "#666", fontSize: 11, fontFamily: "JetBrains Mono, monospace", lineHeight: 1.6, margin: "8px 0 0" }}>
                        {config?.description || "Gno chain governance — proposals and membership management."}
                    </p>
                )}

                {/* Archive warning */}
                {config?.isArchived && (
                    <div style={{
                        marginTop: 8, padding: "6px 10px", borderRadius: 4,
                        background: "rgba(245,166,35,0.05)",
                        fontSize: 10, color: "#f5a623", fontFamily: "JetBrains Mono, monospace",
                    }}>
                        ⚠️ Archived — no new proposals or votes.
                    </div>
                )}

                {/* Username CTA */}
                {auth.isAuthenticated && currentMember && !currentMember.username && (
                    <div style={{
                        marginTop: 8, padding: "6px 10px", borderRadius: 4,
                        background: "rgba(0,212,170,0.03)", border: "1px dashed rgba(0,212,170,0.08)",
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                        flexWrap: "wrap",
                    }}>
                        <span style={{ fontSize: 10, color: "#00d4aa", fontFamily: "JetBrains Mono, monospace" }}>
                            🏷️ Register @username to be recognized across DAOs
                        </span>
                        <a
                            href={`${getExplorerBaseUrl()}/${getUserRegistryPath().replace("gno.land/", "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="k-btn-primary"
                            style={{ fontSize: 9, padding: "3px 8px", textDecoration: "none", flexShrink: 0 }}
                        >
                            Register →
                        </a>
                    </div>
                )}

                {/* ── Divider ── */}
                <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "12px 0 10px" }} />

                {/* v2.12: 2-column layout — stats left, channel sidebar right */}
                <div className="dao-card-columns">
                    {/* Left: Donut + Stats (2-row grid) */}
                    <div className="dao-card-columns__left">
                        {config?.tierDistribution && config.tierDistribution.length > 0 && totalPower > 0 && (
                            <PowerDonut
                                tiers={config.tierDistribution}
                                totalPower={totalPower}
                                size={80}
                            />
                        )}
                        <div className="k-stat-grid k-stat-grid--compact">
                            {[
                                { icon: "👥", value: String(memberCount), label: "Members", tip: `${memberCount} members across ${config?.tierDistribution?.length || 1} tier(s). Click to scroll to members list.`, action: "members" },
                                { icon: "📋", value: String(activeProposals.length), label: "Active", accent: true, tip: `${activeProposals.length} open proposal(s) currently awaiting votes from DAO members. Click to scroll.`, action: "proposals" },
                                { icon: "⚡", value: String(awaitingExecution.length), label: "Execute", accent: awaitingExecution.length > 0, tip: `${awaitingExecution.length} proposal(s) have passed voting and are ready to be executed on-chain. Click to scroll.`, action: "execute" },
                                { icon: "📜", value: String(proposals.length), label: "Proposals", tip: `${proposals.length} total proposals submitted to this DAO (${activeProposals.length} active, ${awaitingExecution.length} passed, ${completedProposals.length} completed). Click to scroll.`, action: "proposals" },
                                { icon: "🫥", value: nonVoterPercent > 0 ? `${nonVoterPercent}%` : "—", label: "Non-Voters", tip: `~${nonVoterCount} of ${memberCount} members have never voted. Based on best turnout (${maxVoterParticipation} voters) across ${proposalsWithVotes.length} proposal(s) with votes.` },
                                ...(totalPower > 0 ? [{ icon: "⚡", value: String(totalPower), label: "Power", tip: `Combined voting power across all ${config?.tierDistribution?.length || 1} tier(s). Voting power determines each member's influence when casting votes on proposals.` }] : []),
                                ...(healthScore ? [{ icon: healthScore.grade, value: `${healthScore.total}`, label: "Health", healthColor: healthScore.color, tip: `DAO Health Score: ${healthScore.grade} (${healthScore.total}/100)\n• Participation: ${healthScore.participationPts}/40 pts\n• Execution backlog: ${healthScore.execPts}/30 pts\n• Activity: ${healthScore.activityPts}/30 pts` }] : []),
                            ].map(s => (
                                <button
                                    key={s.label}
                                    title={(s as { tip?: string }).tip}
                                    className={`k-stat-card k-stat-card--clickable${(s as { accent?: boolean }).accent ? " k-stat-accent" : ""}`}
                                    onClick={() => {
                                        const action = (s as { action?: string }).action
                                        if (action === "members") {
                                            document.getElementById("dao-members-section")?.scrollIntoView({ behavior: "smooth" })
                                        } else if (action === "proposals" || action === "execute") {
                                            document.getElementById("dao-proposals-section")?.scrollIntoView({ behavior: "smooth" })
                                        }
                                    }}
                                >
                                    <span className="k-stat-card__icon" style={(s as { healthColor?: string }).healthColor ? { color: (s as { healthColor?: string }).healthColor } : undefined}>{s.icon}</span>
                                    <div>
                                        <div className="k-stat-card__value">{s.value}</div>
                                        <div className="k-stat-card__label">{s.label}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Right: Discord-style channel sidebar */}
                    <div className="dao-channels-sidebar">
                        <div className="dao-channels-sidebar__header">
                            {config?.name || "DAO"} Channels
                        </div>

                        {/* Text channels */}
                        <button
                            aria-label="Open Discussion Channels"
                            className="dao-channels-sidebar__item"
                            onClick={() => navigate(`/dao/${encodedSlug}/channels`)}
                        >
                            <span className="dao-channels-sidebar__icon">#</span>
                            <span>general</span>
                        </button>
                        <button
                            aria-label="Open Announcements"
                            className="dao-channels-sidebar__item"
                            onClick={() => navigate(`/dao/${encodedSlug}/channels`)}
                        >
                            <span className="dao-channels-sidebar__icon">#</span>
                            <span>announcements</span>
                        </button>

                        {/* Voice/Video rooms divider */}
                        <div className="dao-channels-sidebar__divider">
                            <span>🎙️ Voice Rooms</span>
                            {session && session.daoSlug === encodedSlug && (
                                <span className="dao-channels-sidebar__live-dot" />
                            )}
                        </div>

                        {/* Public Room — always visible */}
                        <button
                            aria-label="Join Public Room"
                            className={`dao-channels-sidebar__item dao-channels-sidebar__item--voice${session?.daoSlug === encodedSlug && session?.channelName === "public-room" ? " active" : ""}`}
                            onClick={() => adena.address ? joinRoom({
                                daoSlug: encodedSlug || "",
                                channelName: "public-room",
                                mode: "voice",
                                label: "Public Room",
                                description: "Open voice room — anyone with a connected wallet can join.",
                            }) : undefined}
                            disabled={!adena.address}
                        >
                            <span className="dao-channels-sidebar__icon">🔊</span>
                            <span>Public Room</span>
                        </button>

                        {/* Members Room — private, shown to members */}
                        {currentMember && (
                            <button
                                aria-label="Join Members Room"
                                className={`dao-channels-sidebar__item dao-channels-sidebar__item--voice dao-channels-sidebar__item--private${session?.daoSlug === encodedSlug && session?.channelName === "members-room" ? " active" : ""}`}
                                onClick={() => joinRoom({
                                    daoSlug: encodedSlug || "",
                                    channelName: "members-room",
                                    mode: "voice",
                                    label: "Members Room",
                                    description: "Private voice room for DAO members.",
                                })}
                            >
                                <span className="dao-channels-sidebar__icon">🔒</span>
                                <span>Members Room</span>
                            </button>
                        )}

                        {/* Hint for non-connected */}
                        {!adena.address && (
                            <div className="dao-channels-sidebar__hint">
                                Connect wallet to join
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* v2.13: Awaiting Execution section removed — passed proposals shown inline
               in Active Proposals with ⚡ EXECUTE badge on ProposalCard */}

            {/* Active Proposals (now includes "passed" proposals with inline ⚡ EXECUTE badge) */}
            <div id="dao-proposals-section">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f0f0f0" }}>Active Proposals</h3>
                    {auth.isAuthenticated && !config?.isArchived && (
                        <button
                            className="k-btn-primary"
                            onClick={() => navigate(`/dao/${encodedSlug}/propose`)}
                            style={{ fontSize: 12, padding: "8px 16px" }}
                        >
                            + New Proposal
                        </button>
                    )}
                </div>

                {/* Filter tabs (only for members with active proposals) */}
                {auth.isAuthenticated && currentMember && activeProposals.length > 0 && (
                    <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                        {(["all", "needs", "voted"] as const).map(f => {
                            const count = f === "all" ? activeProposals.length
                                // v2.13 fix: "needs" should only count OPEN proposals (passed can't be voted on)
                                : f === "needs" ? activeProposals.filter(p => p.status === "open" && !votedIds.has(p.id)).length
                                    : activeProposals.filter(p => votedIds.has(p.id)).length
                            const labels = { all: "All", needs: "Needs My Vote", voted: "Voted" }
                            return (
                                <button
                                    key={f}
                                    onClick={() => setVoteFilter(f)}
                                    style={{
                                        padding: "5px 12px", borderRadius: 6, fontSize: 11,
                                        fontFamily: "JetBrains Mono, monospace", fontWeight: 500,
                                        border: "1px solid",
                                        borderColor: voteFilter === f ? "rgba(0,212,170,0.3)" : "#222",
                                        background: voteFilter === f ? "rgba(0,212,170,0.08)" : "transparent",
                                        color: voteFilter === f ? "#00d4aa" : "#666",
                                        cursor: "pointer", transition: "all 0.15s",
                                    }}
                                >
                                    {labels[f]} ({count})
                                </button>
                            )
                        })}
                    </div>
                )}

                {proposalsLoading ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                ) : activeProposals.length === 0 ? (
                    <div className="k-dashed" style={{ background: "#0c0c0c", padding: 28, textAlign: "center" }}>
                        <p style={{ color: "#555", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                            No active proposals
                        </p>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {activeProposals
                            .filter(p => {
                                // v2.13 fix: "needs" only includes OPEN proposals (passed can't be voted on)
                                if (voteFilter === "needs") return p.status === "open" && !votedIds.has(p.id)
                                if (voteFilter === "voted") return votedIds.has(p.id)
                                return true
                            })
                            .map((p) => (
                                <ProposalCard
                                    key={p.id}
                                    proposal={p}
                                    hasVoted={votedIds.has(p.id)}
                                    isMember={!!currentMember}
                                    enriched={enrichedIds.has(p.id)}
                                    totalMembers={memberCount}
                                    onClick={() => navigate(`/dao/${encodedSlug}/proposal/${p.id}`)}
                                />
                            ))}
                    </div>
                )}
            </div>


            {/* Proposal History (collapsible) */}
            {!proposalsLoading && completedProposals.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowHistory(!showHistory)}
                        style={{
                            display: "flex", alignItems: "center", gap: 8,
                            background: "none", border: "none", cursor: "pointer",
                            fontSize: 14, fontWeight: 600, color: "#888",
                            fontFamily: "JetBrains Mono, monospace",
                            padding: "8px 0", transition: "color 0.15s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#f0f0f0")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#888")}
                    >
                        <span style={{ fontSize: 10, transition: "transform 0.2s", display: "inline-block", transform: showHistory ? "rotate(90deg)" : "none" }}>▶</span>
                        Past Proposals ({completedProposals.length})
                    </button>
                    {showHistory && (
                        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                            {completedProposals.map((p) => (
                                <ProposalCard key={p.id} proposal={p} hasVoted={votedIds.has(p.id)} isMember={!!currentMember} enriched={true} totalMembers={config?.memberCount || members.length} onClick={() => navigate(`/dao/${encodedSlug}/proposal/${p.id}`)} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Members Preview */}
            <div id="dao-members-section">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>
                        <UsersThree size={16} style={{ display: 'inline' }} /> ({config?.memberCount || members.length})
                    </h3>
                    <button
                        onClick={() => navigate(`/dao/${encodedSlug}/members`)}
                        style={{
                            color: "#00d4aa", fontSize: 12, background: "none",
                            border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
                        }}
                    >
                        View All →
                    </button>
                </div>

                {membersLoading ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                        <SkeletonCard />
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                        {members.slice(0, 6).map((m) => (
                            <MemberCard key={m.address} member={m} isCurrentUser={m.address === adena.address} onProfileClick={(addr) => navigate(`/profile/${addr}`)} />
                        ))}
                    </div>
                )}
            </div>

            {/* Channels card removed — consolidated into overview quickbar + DAORooms (v2.12) */}

            {/* Treasury */}
            <div className="k-card" style={{ padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 22, display: 'flex' }}><Vault size={22} /></span>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>Treasury</div>
                        <div style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>View DAO assets and balances</div>
                    </div>
                </div>
                <button
                    onClick={() => navigate(`/dao/${encodedSlug}/treasury`)}
                    style={{ color: "#00d4aa", fontSize: 12, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace" }}
                >
                    Open →
                </button>
            </div>

            {/* Plugins */}
            {getPlugins().length > 0 && (
                <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f0f0f0", marginBottom: 16 }}>
                        🧩 Extensions
                    </h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                        {getPlugins().map(plugin => (
                            <div key={plugin.id} style={{ display: "flex", flexDirection: "column" }}>
                                <button
                                    id={`plugin-card-${plugin.id}`}
                                    onClick={() => navigate(`/dao/${encodedSlug}/plugin/${plugin.id}`)}
                                    className="k-card"
                                    style={{
                                        padding: "16px 20px", display: "flex", alignItems: "flex-start", gap: 14,
                                        cursor: "pointer", border: "1px solid #1a1a1a", textAlign: "left",
                                        width: "100%", height: "100%", minHeight: 80,
                                        transition: "border-color 0.15s, background 0.15s",
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,212,170,0.2)"; e.currentTarget.style.background = "rgba(0,212,170,0.02)" }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#1a1a1a"; e.currentTarget.style.background = "" }}
                                >
                                    <span style={{ fontSize: 22, marginTop: 2 }}>{plugin.icon}</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0" }}>{plugin.name}</span>
                                            <span style={{
                                                fontSize: 9, padding: "1px 6px", borderRadius: 3,
                                                background: "rgba(0,212,170,0.08)", color: "#00d4aa",
                                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                            }}>
                                                v{plugin.version}
                                            </span>
                                        </div>
                                        <div style={{
                                            fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace", marginTop: 3,
                                            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden",
                                        }}>
                                            {plugin.description}
                                        </div>
                                    </div>
                                    <span style={{ color: "#444", fontSize: 12, marginTop: 2 }}>→</span>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Deploy Plugin Modal */}
            {showDeployModal && (
                <DeployPluginModal
                    daoRealmPath={realmPath}
                    daoName={config?.name || realmPath.split("/").pop() || "DAO"}
                    callerAddress={adena.address || ""}
                    onClose={() => setShowDeployModal(false)}
                    onDeployed={() => { setShowDeployModal(false); loadData() }}
                />
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}
