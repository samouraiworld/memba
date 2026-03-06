import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { GNO_RPC_URL, getExplorerBaseUrl } from "../lib/config"
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
import { StatCard, TierBar, ProposalCard, MemberCard } from "../components/dao"
import { getPlugins } from "../plugins"
import { DeployPluginModal } from "../components/dao/DeployPluginModal"
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
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                    })
                } catch {
                    // Clipboard API not available (HTTP context)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                }
            }}
            style={{
                display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4,
                background: "rgba(123,97,255,0.06)", border: "1px solid rgba(123,97,255,0.12)",
                borderRadius: 4, padding: "2px 8px", cursor: "pointer",
                fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#7b61ff",
                transition: "background 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(123,97,255,0.12)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(123,97,255,0.06)"}
        >
            🔑 {copied ? "Copied!" : truncated}
        </button>
    )
}

export function DAOHome() {
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const realmPath = slug ? decodeSlug(slug) : ""
    const encodedSlug = slug || encodeSlug(realmPath)

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

    // Phase 3: Vote enrichment — always loads vote data (public), checks user vote when wallet connected
    useEffect(() => {
        if (proposalsLoading || proposals.length === 0) return
        // Resolve username once for hasVoted matching (only when connected)
        if (adena.address && !usernameRef.current) {
            resolveOnChainUsername(adena.address)
                .then(u => { usernameRef.current = u || null })
                .catch(() => { })
        }
        const active = proposals.filter(p => p.status === "open")
        // Limit to 10 concurrent fetches
        active.slice(0, 10).forEach(p => {
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

    const activeProposals = proposals.filter((p) => p.status === "open")
    const completedProposals = proposals.filter((p) => p.status !== "open")

    // Voter Turnout: avg % of members who voted across completed proposals with data
    const turnoutData = completedProposals.filter(p => p.totalVoters > 0)
    const avgTurnout = turnoutData.length > 0 && (config?.memberCount || members.length) > 0
        ? Math.round(turnoutData.reduce((sum, p) => sum + (p.totalVoters / (config?.memberCount || members.length)) * 100, 0) / turnoutData.length)
        : 0

    // Check if current user is a member
    const currentMember = members.find((m) => m.address === adena.address)
    const totalPower = config?.tierDistribution?.reduce((sum, t) => sum + t.power, 0) || 0

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
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {/* Back nav */}
            <button
                id="dao-back-btn"
                aria-label="Back to DAO list"
                onClick={() => navigate("/dao")}
                style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", textAlign: "left" }}
            >
                ← Back to DAOs
            </button>

            {/* Header */}
            <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <h2 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>
                        🏛️ {config?.name || "DAO Governance"}
                    </h2>
                    {config?.isArchived && (
                        <span style={{
                            padding: "3px 10px", borderRadius: 6, fontSize: 10,
                            fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                            background: "rgba(245,166,35,0.1)", color: "#f5a623",
                        }}>
                            📦 ARCHIVED
                        </span>
                    )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                    <p style={{ color: "#555", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
                        {realmPath}
                    </p>
                    <a
                        href={`${getExplorerBaseUrl()}/r/${realmPath.replace("gno.land/r/", "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View source on gno.land"
                        style={{
                            fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                            color: "#444", textDecoration: "none", transition: "color 0.15s",
                            padding: "1px 5px", borderRadius: 3,
                            border: "1px solid #222",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#00d4aa")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#444")}
                        onClick={(e) => e.stopPropagation()}
                    >
                        &lt;/&gt;
                    </a>
                </div>
                {/* Derived realm address */}
                <RealmAddressBadge realmPath={realmPath} />
                {config?.description && (
                    <p style={{ color: "#888", fontSize: 13, marginTop: 6, fontFamily: "JetBrains Mono, monospace", maxWidth: 600 }}>
                        {config.description}
                    </p>
                )}
            </div>

            {/* Archive warning */}
            {config?.isArchived && (
                <div style={{
                    padding: "12px 18px", borderRadius: 10,
                    background: "rgba(245,166,35,0.05)",
                    border: "1px solid rgba(245,166,35,0.15)",
                    display: "flex", alignItems: "center", gap: 10,
                }}>
                    <span style={{ fontSize: 16 }}>⚠️</span>
                    <div style={{ fontSize: 12, color: "#f5a623", fontFamily: "JetBrains Mono, monospace" }}>
                        This DAO has been archived. No new proposals or votes are allowed.
                    </div>
                </div>
            )}

            {/* Your Status Banner */}
            {auth.isAuthenticated && (
                <div style={{
                    padding: "14px 18px", borderRadius: 10,
                    background: currentMember ? "rgba(0,212,170,0.05)" : "rgba(245,166,35,0.05)",
                    border: `1px solid ${currentMember ? "rgba(0,212,170,0.12)" : "rgba(245,166,35,0.12)"}`,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 16 }}>{currentMember ? "✓" : "⚠"}</span>
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: currentMember ? "#00d4aa" : "#f5a623" }}>
                                {currentMember ? "You are a DAO member" : "You are not a member"}
                            </div>
                            {currentMember?.tier && (
                                <div style={{ fontSize: 10, color: "#888", fontFamily: "JetBrains Mono, monospace", marginTop: 2 }}>
                                    Tier {currentMember.tier} • Voting Power {currentMember.votingPower || "—"}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Username CTA — shown when member has no @username */}
            {auth.isAuthenticated && currentMember && !currentMember.username && (
                <div style={{
                    padding: "12px 18px", borderRadius: 10,
                    background: "rgba(0,212,170,0.03)",
                    border: "1px dashed rgba(0,212,170,0.15)",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 16 }}>🏷️</span>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#00d4aa" }}>
                                Register your @username
                            </div>
                            <div style={{ fontSize: 10, color: "#666", fontFamily: "JetBrains Mono, monospace", marginTop: 1 }}>
                                Get a username to be recognized across DAOs
                            </div>
                        </div>
                    </div>
                    <a
                        href={`${getExplorerBaseUrl()}/r/gnoland/users/v1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="k-btn-primary"
                        style={{ fontSize: 11, padding: "6px 14px", textDecoration: "none" }}
                    >
                        Register →
                    </a>
                </div>
            )}
            {/* Stats Grid */}
            <div className="k-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                <StatCard label="Members" value={String(config?.memberCount || members.length)} icon="👥" />
                <StatCard label="Active" value={String(activeProposals.length)} icon="📋" accent />
                <StatCard label="Total Proposals" value={String(proposals.length)} icon="📜" />
                <StatCard label="Avg Turnout" value={avgTurnout > 0 ? `${avgTurnout}%` : "—"} icon="🗳️" />
                {totalPower > 0 && (
                    <StatCard label="Voting Power" value={String(totalPower)} icon="⚡" />
                )}
            </div>

            {/* Tier Distribution */}
            {config?.tierDistribution && config.tierDistribution.length > 0 && (
                <div className="k-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 16 }}>
                        Power Distribution
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {config.tierDistribution.map((t) => (
                            <TierBar key={t.tier} tier={t} totalPower={totalPower} />
                        ))}
                    </div>
                    <div style={{ marginTop: 14, fontSize: 10, color: "#555", fontFamily: "JetBrains Mono, monospace" }}>
                        {config.tierDistribution.reduce((sum, t) => sum + t.memberCount, 0)} total members across {config.tierDistribution.length} tiers
                    </div>
                </div>
            )}

            {/* Active Proposals */}
            <div>
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
                                : f === "needs" ? activeProposals.filter(p => !votedIds.has(p.id)).length
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
                                if (voteFilter === "needs") return !votedIds.has(p.id)
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
                                    totalMembers={config?.memberCount || members.length}
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
                        Proposal History ({completedProposals.length})
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
            <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f0f0f0" }}>
                        Members ({config?.memberCount || members.length})
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

            {/* Treasury */}
            <div className="k-card" style={{ padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 22 }}>💰</span>
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
                            <div key={plugin.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <button
                                    id={`plugin-card-${plugin.id}`}
                                    onClick={() => navigate(`/dao/${encodedSlug}/plugin/${plugin.id}`)}
                                    className="k-card"
                                    style={{
                                        padding: "16px 20px", display: "flex", alignItems: "center", gap: 14,
                                        cursor: "pointer", border: "1px solid #1a1a1a", textAlign: "left",
                                        width: "100%", transition: "border-color 0.15s, background 0.15s",
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,212,170,0.2)"; e.currentTarget.style.background = "rgba(0,212,170,0.02)" }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#1a1a1a"; e.currentTarget.style.background = "" }}
                                >
                                    <span style={{ fontSize: 22 }}>{plugin.icon}</span>
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
                                        <div style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace", marginTop: 3 }}>
                                            {plugin.description}
                                        </div>
                                    </div>
                                    <span style={{ color: "#444", fontSize: 12 }}>→</span>
                                </button>
                                {/* Deploy button for Board plugin — allows deploying to existing DAOs */}
                                {plugin.id === "board" && auth.isAuthenticated && (
                                    <button
                                        id={`deploy-plugin-${plugin.id}`}
                                        className="k-btn-secondary"
                                        style={{ fontSize: 10, padding: "4px 12px", height: 28, alignSelf: "flex-start" }}
                                        onClick={() => setShowDeployModal(true)}
                                    >
                                        ⚡ Deploy Board
                                    </button>
                                )}
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
