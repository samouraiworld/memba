import { useState, useEffect, useCallback } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { GNO_RPC_URL } from "../lib/config"
import {
    getDAOConfig,
    getDAOMembers,
    getDAOProposals,
    type DAOConfig,
    type DAOMember,
    type DAOProposal,
} from "../lib/dao"
import { decodeSlug, encodeSlug } from "../lib/daoSlug"
import type { LayoutContext } from "../types/layout"

export function DAOHome() {
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()
    const { auth } = useOutletContext<LayoutContext>()

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
            const [cfg, mems, props] = await Promise.all([
                getDAOConfig(GNO_RPC_URL, realmPath),
                getDAOMembers(GNO_RPC_URL, realmPath),
                getDAOProposals(GNO_RPC_URL, realmPath),
            ])
            setConfig(cfg)
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
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
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

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                <StatCard label="Members" value={String(members.length)} icon="👥" />
                <StatCard label="Active Proposals" value={String(activeProposals.length)} icon="📋" accent />
                <StatCard label="Total Proposals" value={String(proposals.length)} icon="📜" />
                <StatCard label="Threshold" value={config?.threshold || "—"} icon="📊" />
            </div>

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

            {/* Members */}
            <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f0f0f0" }}>
                        Members ({members.length})
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
                        <MemberCard key={m.address} member={m} />
                    ))}
                </div>
            </div>

            {/* Treasury Quick Link */}
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
        <div className="k-card" style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22 }}>{icon}</span>
            <div>
                <div style={{
                    fontSize: 20, fontWeight: 700,
                    color: accent ? "#00d4aa" : "#f0f0f0",
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    {value}
                </div>
                <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono, monospace" }}>
                    {label}
                </div>
            </div>
        </div>
    )
}

function ProposalCard({ proposal, onClick }: { proposal: DAOProposal; onClick: () => void }) {
    const statusColors: Record<string, { bg: string; color: string; label: string }> = {
        open: { bg: "rgba(0,212,170,0.08)", color: "#00d4aa", label: "OPEN" },
        passed: { bg: "rgba(76,175,80,0.08)", color: "#4caf50", label: "PASSED" },
        rejected: { bg: "rgba(244,67,54,0.08)", color: "#f44336", label: "REJECTED" },
        executed: { bg: "rgba(33,150,243,0.08)", color: "#2196f3", label: "EXECUTED" },
    }
    const sc = statusColors[proposal.status] || statusColors.open

    const totalVotes = proposal.yesVotes + proposal.noVotes + proposal.abstainVotes

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
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{
                            fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                            color: "#555", fontWeight: 500,
                        }}>
                            #{proposal.id}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>
                            {proposal.title}
                        </span>
                    </div>
                    {proposal.description && (
                        <p style={{
                            color: "#666", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                            marginTop: 4, maxWidth: 500,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                            {proposal.description}
                        </p>
                    )}
                </div>

                <span style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: 10,
                    fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                    background: sc.bg, color: sc.color,
                }}>
                    {sc.label}
                </span>
            </div>

            {/* Vote bar */}
            {totalVotes > 0 && (
                <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", gap: 12, fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#666", marginBottom: 4 }}>
                        <span>✓ {proposal.yesVotes}</span>
                        <span>✗ {proposal.noVotes}</span>
                        <span>○ {proposal.abstainVotes}</span>
                    </div>
                    <div style={{ height: 3, background: "#1a1a1a", borderRadius: 2, overflow: "hidden", display: "flex" }}>
                        <div style={{ width: `${(proposal.yesVotes / totalVotes) * 100}%`, background: "#4caf50", transition: "width 0.3s" }} />
                        <div style={{ width: `${(proposal.noVotes / totalVotes) * 100}%`, background: "#f44336", transition: "width 0.3s" }} />
                        <div style={{ width: `${(proposal.abstainVotes / totalVotes) * 100}%`, background: "#666", transition: "width 0.3s" }} />
                    </div>
                </div>
            )}
        </div>
    )
}

function MemberCard({ member }: { member: DAOMember }) {
    return (
        <div className="k-card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <CopyableAddress address={member.address} />
            {member.roles.length > 0 && (
                <div style={{ display: "flex", gap: 4 }}>
                    {member.roles.map((role) => (
                        <span key={role} style={{
                            padding: "2px 8px", borderRadius: 4, fontSize: 10,
                            fontFamily: "JetBrains Mono, monospace", fontWeight: 500,
                            background: role === "admin" ? "rgba(0,212,170,0.1)" : "rgba(255,255,255,0.04)",
                            color: role === "admin" ? "#00d4aa" : "#888",
                        }}>
                            {role}
                        </span>
                    ))}
                </div>
            )}
        </div>
    )
}
