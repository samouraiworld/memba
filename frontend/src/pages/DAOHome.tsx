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
import { ProposalCard, MemberCard } from "../components/dao"
import { PowerDonut } from "../components/dao/TierPieChart"
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
                display: "inline-flex", alignItems: "center", gap: 4,
                background: "none", border: "none",
                padding: 0, cursor: "pointer",
                fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#7b61ff",
                transition: "color 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.color = "#9b85ff"}
            onMouseLeave={e => e.currentTarget.style.color = "#7b61ff"}
        >
            {copied ? "✓ Copied!" : truncated}
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
                        🏛️ {config?.name || "DAO Governance"}
                        {config?.isArchived && (
                            <span style={{
                                padding: "2px 8px", borderRadius: 4, fontSize: 9,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(245,166,35,0.1)", color: "#f5a623",
                            }}>
                                📦 ARCHIVED
                            </span>
                        )}
                    </h2>
                    {auth.isAuthenticated && currentMember && (
                        <div style={{
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
                    <p style={{ color: "#666", fontSize: 11, fontFamily: "JetBrains Mono, monospace", lineHeight: 1.6, margin: "8px 0 0", maxWidth: 640 }}>
                        {config?.description || "Top-level governance DAO for the Gno chain. Chain-wide proposals and membership are managed here."}
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
                            href={`${getExplorerBaseUrl()}/r/gnoland/users/v1`}
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

                {/* Stats row: donut + pills */}
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                    {config?.tierDistribution && config.tierDistribution.length > 0 && totalPower > 0 && (
                        <PowerDonut
                            tiers={config.tierDistribution}
                            totalPower={totalPower}
                            size={80}
                        />
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: 1, justifyContent: "flex-end" }}>
                        {[
                            { icon: "👥", value: String(config?.memberCount || members.length), label: "Members" },
                            { icon: "📋", value: String(activeProposals.length), label: "Active", accent: true },
                            { icon: "📜", value: String(proposals.length), label: "Proposals" },
                            { icon: "🗳️", value: avgTurnout > 0 ? `${avgTurnout}%` : "—", label: "Turnout" },
                            ...(totalPower > 0 ? [{ icon: "⚡", value: String(totalPower), label: "Power" }] : []),
                        ].map(s => (
                            <div key={s.label} style={{
                                display: "flex", alignItems: "center", gap: 6,
                                padding: "5px 10px", borderRadius: 6,
                                background: (s as { accent?: boolean }).accent ? "rgba(0,212,170,0.06)" : "rgba(255,255,255,0.02)",
                            }}>
                                <span style={{ fontSize: 13 }}>{s.icon}</span>
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: (s as { accent?: boolean }).accent ? "#00d4aa" : "#f0f0f0", fontFamily: "JetBrains Mono, monospace" }}>
                                        {s.value}
                                    </div>
                                    <div style={{ fontSize: 9, color: "#555", fontFamily: "JetBrains Mono, monospace" }}>
                                        {s.label}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

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
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>
                        👥 ({config?.memberCount || members.length})
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
