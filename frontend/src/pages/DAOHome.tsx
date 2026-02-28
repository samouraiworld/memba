import { useState, useEffect, useCallback } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { GNO_RPC_URL, getExplorerBaseUrl } from "../lib/config"
import {
    getDAOConfig,
    getDAOMembers,
    getDAOProposals,
    type DAOConfig,
    type DAOMember,
    type DAOProposal,
    type TierInfo,
} from "../lib/dao"
import { decodeSlug, encodeSlug } from "../lib/daoSlug"
import type { LayoutContext } from "../types/layout"

export function DAOHome() {
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const realmPath = slug ? decodeSlug(slug) : ""
    const encodedSlug = slug || encodeSlug(realmPath)

    const [config, setConfig] = useState<DAOConfig | null>(null)
    const [members, setMembers] = useState<DAOMember[]>([])
    const [proposals, setProposals] = useState<DAOProposal[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const loadData = useCallback(async () => {
        if (!realmPath) return
        setLoading(true)
        setError(null)
        try {
            const cfg = await getDAOConfig(GNO_RPC_URL, realmPath)
            setConfig(cfg)
            const [mems, props] = await Promise.all([
                getDAOMembers(GNO_RPC_URL, realmPath, cfg?.memberstorePath),
                getDAOProposals(GNO_RPC_URL, realmPath),
            ])
            setMembers(mems)
            setProposals(props)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load DAO data")
        } finally {
            setLoading(false)
        }
    }, [realmPath])

    useEffect(() => { loadData() }, [loadData])

    const activeProposals = proposals.filter((p) => p.status === "open")
    const completedProposals = proposals.filter((p) => p.status !== "open")
    const acceptedCount = proposals.filter((p) => p.status === "passed" || p.status === "executed").length
    const acceptanceRate = proposals.length > 0 ? Math.round((acceptedCount / proposals.length) * 100) : 0

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

    if (loading) {
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
                <h2 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>
                    🏛️ {config?.name || "DAO Governance"}
                </h2>
                <p style={{ color: "#555", fontSize: 11, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                    {realmPath}
                </p>
                {config?.description && (
                    <p style={{ color: "#888", fontSize: 13, marginTop: 6, fontFamily: "JetBrains Mono, monospace", maxWidth: 600 }}>
                        {config.description}
                    </p>
                )}
            </div>

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

            {/* Stats Grid */}
            <div className="k-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                <StatCard label="Members" value={String(config?.memberCount || members.length)} icon="👥" />
                <StatCard label="Active" value={String(activeProposals.length)} icon="📋" accent />
                <StatCard label="Total Proposals" value={String(proposals.length)} icon="📜" />
                <StatCard label="Acceptance Rate" value={acceptanceRate > 0 ? `${acceptanceRate}%` : "—"} icon="✓" />
                {totalPower > 0 && (
                    <StatCard label="Total Power" value={String(totalPower)} icon="⚡" />
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
                    {auth.isAuthenticated && (
                        <button
                            className="k-btn-primary"
                            onClick={() => navigate(`/dao/${encodedSlug}/propose`)}
                            style={{ fontSize: 12, padding: "8px 16px" }}
                        >
                            + New Proposal
                        </button>
                    )}
                </div>

                {activeProposals.length === 0 ? (
                    <div className="k-dashed" style={{ background: "#0c0c0c", padding: 28, textAlign: "center" }}>
                        <p style={{ color: "#555", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                            No active proposals
                        </p>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {activeProposals.map((p) => (
                            <ProposalCard key={p.id} proposal={p} onClick={() => navigate(`/dao/${encodedSlug}/proposal/${p.id}`)} />
                        ))}
                    </div>
                )}
            </div>

            {/* Completed Proposals */}
            {completedProposals.length > 0 && (
                <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f0f0f0", marginBottom: 16 }}>
                        Completed ({completedProposals.length})
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {completedProposals.map((p) => (
                            <ProposalCard key={p.id} proposal={p} onClick={() => navigate(`/dao/${encodedSlug}/proposal/${p.id}`)} />
                        ))}
                    </div>
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

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                    {members.slice(0, 6).map((m) => (
                        <MemberCard key={m.address} member={m} isCurrentUser={m.address === adena.address} />
                    ))}
                </div>
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

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Components ────────────────────────────────────────────

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: string; accent?: boolean }) {
    return (
        <div className="k-card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>{icon}</span>
            <div>
                <div style={{
                    fontSize: 18, fontWeight: 700,
                    color: accent ? "#00d4aa" : "#f0f0f0",
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    {value}
                </div>
                <div style={{ fontSize: 9, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono, monospace" }}>
                    {label}
                </div>
            </div>
        </div>
    )
}

function TierBar({ tier, totalPower }: { tier: TierInfo; totalPower: number }) {
    const pct = totalPower > 0 ? Math.round((tier.power / totalPower) * 100) : 0
    const tierColors: Record<string, string> = {
        T1: "#00d4aa",
        T2: "#2196f3",
        T3: "#f5a623",
    }
    const color = tierColors[tier.tier] || "#888"

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "JetBrains Mono, monospace", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                        background: color,
                    }} />
                    <span style={{ color: "#ccc", fontWeight: 600 }}>{tier.tier}</span>
                    <span style={{ color: "#666" }}>• {tier.memberCount} members</span>
                </div>
                <span style={{ color }}>
                    {tier.power} power ({pct}%)
                </span>
            </div>
            <div style={{ height: 6, background: "#1a1a1a", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                    width: `${pct}%`, height: "100%",
                    background: `linear-gradient(90deg, ${color}, ${color}88)`,
                    borderRadius: 3, transition: "width 0.4s ease",
                }} />
            </div>
        </div>
    )
}

function ProposalCard({ proposal, onClick }: { proposal: DAOProposal; onClick: () => void }) {
    const statusColors: Record<string, { bg: string; color: string; label: string }> = {
        open: { bg: "rgba(0,212,170,0.08)", color: "#00d4aa", label: "ACTIVE" },
        passed: { bg: "rgba(76,175,80,0.08)", color: "#4caf50", label: "ACCEPTED" },
        rejected: { bg: "rgba(244,67,54,0.08)", color: "#f44336", label: "REJECTED" },
        executed: { bg: "rgba(33,150,243,0.08)", color: "#2196f3", label: "EXECUTED" },
    }
    const sc = statusColors[proposal.status] || statusColors.open

    return (
        <div
            className="k-card"
            onClick={onClick}
            style={{ padding: "16px 20px", cursor: "pointer", transition: "border-color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#333")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#555", fontWeight: 500 }}>
                            #{proposal.id}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>
                            {proposal.title}
                        </span>
                    </div>

                    {/* Author + Tiers row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                        {proposal.author && (
                            <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#00d4aa" }}>
                                {proposal.author}
                            </span>
                        )}
                        {proposal.tiers.length > 0 && (
                            <div style={{ display: "flex", gap: 3 }}>
                                {proposal.tiers.map((t) => (
                                    <span key={t} style={{
                                        padding: "1px 5px", borderRadius: 3, fontSize: 8,
                                        fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                        background: "rgba(255,255,255,0.04)", color: "#888",
                                    }}>
                                        {t}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <span style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: 10,
                    fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                    background: sc.bg, color: sc.color, whiteSpace: "nowrap",
                }}>
                    {sc.label}
                </span>
            </div>

            {/* Vote percentage bar */}
            {(proposal.yesPercent > 0 || proposal.noPercent > 0 || proposal.yesVotes > 0) && (
                <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", gap: 12, fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#666", marginBottom: 4 }}>
                        {proposal.yesPercent > 0 ? (
                            <>
                                <span style={{ color: "#4caf50" }}>✓ {proposal.yesPercent}%</span>
                                <span style={{ color: "#f44336" }}>✗ {proposal.noPercent}%</span>
                            </>
                        ) : (
                            <>
                                <span>✓ {proposal.yesVotes}</span>
                                <span>✗ {proposal.noVotes}</span>
                                {proposal.abstainVotes > 0 && <span>○ {proposal.abstainVotes}</span>}
                            </>
                        )}
                    </div>
                    <VoteBar
                        yesPercent={proposal.yesPercent || (proposal.yesVotes + proposal.noVotes > 0 ? (proposal.yesVotes / (proposal.yesVotes + proposal.noVotes)) * 100 : 0)}
                        noPercent={proposal.noPercent || (proposal.yesVotes + proposal.noVotes > 0 ? (proposal.noVotes / (proposal.yesVotes + proposal.noVotes)) * 100 : 0)}
                    />
                </div>
            )}
        </div>
    )
}

function VoteBar({ yesPercent, noPercent }: { yesPercent: number; noPercent: number }) {
    return (
        <div style={{ height: 4, background: "#1a1a1a", borderRadius: 2, overflow: "hidden", display: "flex" }}>
            <div style={{ width: `${yesPercent}%`, background: "#4caf50", transition: "width 0.3s" }} />
            <div style={{ width: `${noPercent}%`, background: "#f44336", transition: "width 0.3s" }} />
        </div>
    )
}

function MemberCard({ member, isCurrentUser }: { member: DAOMember; isCurrentUser: boolean }) {
    return (
        <div className="k-card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <CopyableAddress address={member.address} />
                {member.username && (
                    <a
                        href={`${getExplorerBaseUrl()}/u/${member.username.replace("@", "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 10, color: "#00d4aa", fontFamily: "JetBrains Mono, monospace", textDecoration: "none" }}
                    >
                        {member.username}
                    </a>
                )}
                {isCurrentUser && (
                    <span style={{
                        padding: "2px 6px", borderRadius: 4, fontSize: 9,
                        fontFamily: "JetBrains Mono, monospace",
                        background: "rgba(0,212,170,0.1)", color: "#00d4aa",
                    }}>
                        YOU
                    </span>
                )}
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {member.tier && (
                    <span style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 10,
                        fontFamily: "JetBrains Mono, monospace", fontWeight: 500, whiteSpace: "nowrap",
                        background: member.tier === "T1" ? "rgba(0,212,170,0.1)" : member.tier === "T2" ? "rgba(33,150,243,0.1)" : "rgba(245,166,35,0.1)",
                        color: member.tier === "T1" ? "#00d4aa" : member.tier === "T2" ? "#2196f3" : "#f5a623",
                    }}>
                        {member.tier}
                    </span>
                )}
                {member.roles.map((role) => {
                    const rc: Record<string, string> = { admin: "#f5a623", dev: "#00d4aa", finance: "#7b61ff", ops: "#3b82f6", member: "#888" }
                    const c = rc[role] || "#888"
                    return (
                        <span key={role} style={{
                            padding: "2px 8px", borderRadius: 4, fontSize: 10,
                            fontFamily: "JetBrains Mono, monospace", fontWeight: 500,
                            whiteSpace: "nowrap",
                            background: `${c}15`, color: c,
                        }}>
                            {role}
                        </span>
                    )
                })}
            </div>
        </div>
    )
}
