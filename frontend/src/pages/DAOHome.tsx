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
import "./daohome.css"

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
            <div className="animate-fade-in dao-skeleton-col">
                <SkeletonCard />
            </div>
        )
    }

    if (configLoading) {
        return (
            <div className="animate-fade-in dao-skeleton-col">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
            </div>
        )
    }

    return (
        <div className="animate-fade-in dao-container">
            {/* ─── DAO Overview Card (single card: identity + stats) ─── */}
            <div className="k-card dao-overview-card">
                {/* Breadcrumb */}
                <div className="dao-breadcrumb">
                    <button
                        id="dao-back-btn"
                        aria-label="Back to DAO list"
                        onClick={() => navigate("/dao")}
                        className="dao-breadcrumb-btn"
                    >
                        DAOs
                    </button>
                    <span className="dao-breadcrumb-sep">›</span>
                    <span className="dao-breadcrumb-name">
                        {config?.name || "DAO"}
                    </span>
                </div>

                {/* Title + membership pill */}
                <div className="dao-title-row">
                    <h2 className="dao-title">
                        <Bank size={20} style={{ color: '#888' }} /> {config?.name || "DAO Governance"}
                        {config?.isArchived && (
                            <span className="dao-badge-archived">
                                <Archive size={12} /> ARCHIVED
                            </span>
                        )}
                    </h2>
                    {auth.isAuthenticated && currentMember && (
                        <div
                            title={`Your role: ${currentMember.tier || "Member"} — Voting power: ${currentMember.votingPower || "1"}`}
                            className="dao-member-pill"
                        >
                            <span className="dao-member-pill__check">✓</span>
                            <span className="dao-member-pill__text">
                                {currentMember.tier || ""}
                                {currentMember.votingPower ? ` · Power ${currentMember.votingPower}` : ""}
                            </span>
                        </div>
                    )}
                    {auth.isAuthenticated && !currentMember && (
                        <span className="dao-guest-badge">Guest</span>
                    )}
                </div>

                {/* Realm path · </> (left)    address (right) */}
                <div className="dao-path-row">
                    <div className="dao-path-left">
                        <span className="dao-path-text">
                            {realmPath}
                        </span>
                        <a
                            href={`${getExplorerBaseUrl()}/r/${realmPath.replace("gno.land/r/", "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View source on gno.land"
                            className="dao-path-source-link"
                            onClick={(e) => e.stopPropagation()}
                        >
                            &lt;/&gt;
                        </a>
                    </div>
                    <RealmAddressBadge realmPath={realmPath} />
                </div>

                {/* Description */}
                {(config?.description || realmPath === "gno.land/r/gov/dao") && (
                    <p className="dao-description">
                        {config?.description || "Gno chain governance — proposals and membership management."}
                    </p>
                )}

                {/* Archive warning */}
                {config?.isArchived && (
                    <div className="dao-archive-warning">
                        ⚠️ Archived — no new proposals or votes.
                    </div>
                )}

                {/* Username CTA */}
                {auth.isAuthenticated && currentMember && !currentMember.username && (
                    <div className="dao-username-cta">
                        <span className="dao-username-cta__text">
                            🏷️ Register @username to be recognized across DAOs
                        </span>
                        <a
                            href={`${getExplorerBaseUrl()}/${getUserRegistryPath().replace("gno.land/", "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="k-btn-primary dao-username-cta__link"
                        >
                            Register →
                        </a>
                    </div>
                )}

                {/* ── Divider ── */}
                <div className="dao-divider" />

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
                <div className="dao-section-header">
                    <h3 className="dao-section-title">Active Proposals</h3>
                    {auth.isAuthenticated && !config?.isArchived && (
                        <button
                            className="k-btn-primary dao-new-proposal-btn"
                            onClick={() => navigate(`/dao/${encodedSlug}/propose`)}
                        >
                            + New Proposal
                        </button>
                    )}
                </div>

                {/* Filter tabs (only for members with active proposals) */}
                {auth.isAuthenticated && currentMember && activeProposals.length > 0 && (
                    <div className="dao-filter-tabs">
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
                                    className={`dao-filter-tab${voteFilter === f ? " active" : ""}`}
                                >
                                    {labels[f]} ({count})
                                </button>
                            )
                        })}
                    </div>
                )}

                {proposalsLoading ? (
                    <div className="dao-list-col">
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                ) : activeProposals.length === 0 ? (
                    <div className="k-dashed dao-empty">
                        <p>No active proposals</p>
                    </div>
                ) : (
                    <div className="dao-list-col">
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
                        className="dao-history-toggle"
                    >
                        <span className={`dao-history-arrow${showHistory ? " open" : ""}`}>▶</span>
                        Past Proposals ({completedProposals.length})
                    </button>
                    {showHistory && (
                        <div className="animate-fade-in dao-list-col" style={{ marginTop: 8 }}>
                            {completedProposals.map((p) => (
                                <ProposalCard key={p.id} proposal={p} hasVoted={votedIds.has(p.id)} isMember={!!currentMember} enriched={true} totalMembers={config?.memberCount || members.length} onClick={() => navigate(`/dao/${encodedSlug}/proposal/${p.id}`)} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Members Preview */}
            <div id="dao-members-section">
                <div className="dao-section-header">
                    <h3 className="dao-section-title--sm">
                        <UsersThree size={16} style={{ display: 'inline' }} /> ({config?.memberCount || members.length})
                    </h3>
                    <button
                        onClick={() => navigate(`/dao/${encodedSlug}/members`)}
                        className="dao-view-all-btn"
                    >
                        View All →
                    </button>
                </div>

                {membersLoading ? (
                    <div className="dao-members-grid">
                        <SkeletonCard />
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                ) : (
                    <div className="dao-members-grid">
                        {members.slice(0, 6).map((m) => (
                            <MemberCard key={m.address} member={m} isCurrentUser={m.address === adena.address} onProfileClick={(addr) => navigate(`/profile/${addr}`)} />
                        ))}
                    </div>
                )}
            </div>

            {/* Channels card removed — consolidated into overview quickbar + DAORooms (v2.12) */}

            {/* Treasury */}
            <div className="k-card dao-treasury-card">
                <div className="dao-treasury-left">
                    <span className="dao-treasury-icon"><Vault size={22} /></span>
                    <div>
                        <div className="dao-treasury-title">Treasury</div>
                        <div className="dao-treasury-desc">View DAO assets and balances</div>
                    </div>
                </div>
                <button
                    onClick={() => navigate(`/dao/${encodedSlug}/treasury`)}
                    className="dao-treasury-open-btn"
                >
                    Open →
                </button>
            </div>

            {/* Plugins */}
            {getPlugins().length > 0 && (
                <div>
                    <h3 className="dao-extensions-title">
                        🧩 Extensions
                    </h3>
                    <div className="dao-extensions-grid">
                        {getPlugins().map(plugin => (
                            <div key={plugin.id} style={{ display: "flex", flexDirection: "column" }}>
                                <button
                                    id={`plugin-card-${plugin.id}`}
                                    onClick={() => navigate(`/dao/${encodedSlug}/plugin/${plugin.id}`)}
                                    className="k-card dao-plugin-card"
                                >
                                    <span className="dao-plugin-icon">{plugin.icon}</span>
                                    <div className="dao-plugin-body">
                                        <div className="dao-plugin-name-row">
                                            <span className="dao-plugin-name">{plugin.name}</span>
                                            <span className="dao-plugin-version">
                                                v{plugin.version}
                                            </span>
                                        </div>
                                        <div className="dao-plugin-desc">
                                            {plugin.description}
                                        </div>
                                    </div>
                                    <span className="dao-plugin-arrow">→</span>
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
