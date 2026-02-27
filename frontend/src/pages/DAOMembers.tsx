import { useState, useEffect, useCallback } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { GNO_RPC_URL } from "../lib/config"
import { getDAOConfig, getDAOMembers, type DAOConfig, type DAOMember, type TierInfo } from "../lib/dao"
import { decodeSlug } from "../lib/daoSlug"
import type { LayoutContext } from "../types/layout"

export function DAOMembers() {
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()
    const { adena } = useOutletContext<LayoutContext>()

    const realmPath = slug ? decodeSlug(slug) : ""

    const [config, setConfig] = useState<DAOConfig | null>(null)
    const [members, setMembers] = useState<DAOMember[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [tierFilter, setTierFilter] = useState<string>("all")

    const loadMembers = useCallback(async () => {
        if (!realmPath) return
        setLoading(true)
        setError(null)
        try {
            const cfg = await getDAOConfig(GNO_RPC_URL, realmPath)
            setConfig(cfg)
            const mems = await getDAOMembers(GNO_RPC_URL, realmPath, cfg?.memberstorePath)
            setMembers(mems)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load members")
        } finally {
            setLoading(false)
        }
    }, [realmPath])

    useEffect(() => { loadMembers() }, [loadMembers])

    const tiers = config?.tierDistribution || []
    const totalPower = tiers.reduce((sum, t) => sum + t.power, 0)
    const filteredMembers = tierFilter === "all" ? members : members.filter((m) => m.tier === tierFilter)

    if (loading) {
        return (
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
        )
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Nav */}
            <button
                id="members-back-btn"
                aria-label="Back to DAO"
                onClick={() => navigate(`/dao/${slug}`)}
                style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", textAlign: "left" }}
            >
                ← Back to DAO
            </button>

            {/* Header */}
            <div>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
                    👥 Members
                </h2>
                <p style={{ color: "#888", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                    {config?.name || "DAO"} — {members.length} members
                </p>
            </div>

            {/* Power Distribution */}
            {tiers.length > 0 && (
                <div className="k-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0", marginBottom: 14 }}>
                        Power Distribution
                    </h3>

                    {/* Tier summary cards */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
                        {tiers.map((t) => (
                            <TierSummaryCard key={t.tier} tier={t} totalPower={totalPower} />
                        ))}
                    </div>

                    {/* Combined power bar */}
                    <div style={{ height: 8, background: "#1a1a1a", borderRadius: 4, overflow: "hidden", display: "flex" }}>
                        {tiers.map((t) => {
                            const pct = totalPower > 0 ? (t.power / totalPower) * 100 : 0
                            const colors: Record<string, string> = { T1: "#00d4aa", T2: "#2196f3", T3: "#f5a623" }
                            return (
                                <div
                                    key={t.tier}
                                    style={{ width: `${pct}%`, background: colors[t.tier] || "#888", transition: "width 0.4s" }}
                                />
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Tier Filters */}
            {tiers.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <FilterButton label="All" count={members.length} active={tierFilter === "all"} onClick={() => setTierFilter("all")} color="#f0f0f0" />
                    {tiers.map((t) => {
                        const colors: Record<string, string> = { T1: "#00d4aa", T2: "#2196f3", T3: "#f5a623" }
                        return (
                            <FilterButton
                                key={t.tier}
                                label={t.tier}
                                count={t.memberCount}
                                active={tierFilter === t.tier}
                                onClick={() => setTierFilter(t.tier)}
                                color={colors[t.tier] || "#888"}
                            />
                        )
                    })}
                </div>
            )}

            {/* Members List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {/* Header row */}
                <div style={{
                    display: "grid", gridTemplateColumns: "1fr auto auto",
                    padding: "6px 16px", fontSize: 9, color: "#555",
                    fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase",
                    letterSpacing: "0.05em",
                }}>
                    <span>Address</span>
                    <span>Tier</span>
                    <span style={{ textAlign: "right" }}>Role</span>
                </div>

                {filteredMembers.length === 0 && (
                    <div className="k-dashed" style={{ background: "#0c0c0c", padding: 28, textAlign: "center" }}>
                        <p style={{ color: "#555", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                            No members found for this filter
                        </p>
                    </div>
                )}

                {filteredMembers.map((m) => (
                    <MemberRow key={m.address} member={m} isCurrentUser={m.address === adena.address} />
                ))}
            </div>

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Components ────────────────────────────────────────────

const tierColors: Record<string, string> = { T1: "#00d4aa", T2: "#2196f3", T3: "#f5a623" }

function TierSummaryCard({ tier, totalPower }: { tier: TierInfo; totalPower: number }) {
    const color = tierColors[tier.tier] || "#888"
    const pct = totalPower > 0 ? Math.round((tier.power / totalPower) * 100) : 0

    return (
        <div style={{
            padding: "12px 14px", borderRadius: 8,
            background: "rgba(255,255,255,0.02)", border: "1px solid #1a1a1a",
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{
                    display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                    background: color,
                }} />
                <span style={{ fontWeight: 600, fontSize: 13, color }}>{tier.tier}</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color: "#f0f0f0" }}>
                {tier.memberCount}
            </div>
            <div style={{ fontSize: 10, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>
                {tier.power} power ({pct}%)
            </div>
        </div>
    )
}

function FilterButton({ label, count, active, onClick, color }: {
    label: string; count: number; active: boolean; onClick: () => void; color: string
}) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: "6px 12px", borderRadius: 6, fontSize: 11,
                fontFamily: "JetBrains Mono, monospace", fontWeight: 500,
                background: active ? "rgba(255,255,255,0.06)" : "transparent",
                border: `1px solid ${active ? color + "44" : "#1a1a1a"}`,
                color: active ? color : "#888",
                cursor: "pointer", transition: "all 0.15s",
            }}
        >
            {label}
            <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.7 }}>({count})</span>
        </button>
    )
}

function MemberRow({ member, isCurrentUser }: { member: DAOMember; isCurrentUser: boolean }) {
    const tierColor = tierColors[member.tier] || "#666"

    return (
        <div className="k-card" style={{
            display: "grid", gridTemplateColumns: "1fr auto auto",
            padding: "12px 16px", alignItems: "center", gap: 12,
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <CopyableAddress address={member.address} />
                {member.username && (
                    <a
                        href={`https://test11.testnets.gno.land/u/${member.username.replace("@", "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 10, color: "#00d4aa", fontFamily: "JetBrains Mono, monospace", textDecoration: "none" }}
                    >
                        {member.username}
                    </a>
                )}
                {isCurrentUser && (
                    <span style={{
                        padding: "1px 5px", borderRadius: 3, fontSize: 8,
                        fontFamily: "JetBrains Mono, monospace",
                        background: "rgba(0,212,170,0.1)", color: "#00d4aa",
                    }}>
                        YOU
                    </span>
                )}
            </div>

            {member.tier ? (
                <span style={{
                    padding: "3px 10px", borderRadius: 4, fontSize: 10,
                    fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                    background: `${tierColor}15`, color: tierColor,
                }}>
                    {member.tier}
                </span>
            ) : <span />}

            <div style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                {member.roles.map((role) => (
                    <span key={role} style={{
                        padding: "2px 6px", borderRadius: 3, fontSize: 9,
                        fontFamily: "JetBrains Mono, monospace",
                        background: role === "admin" ? "rgba(0,212,170,0.08)" : "rgba(255,255,255,0.03)",
                        color: role === "admin" ? "#00d4aa" : "#888",
                    }}>
                        {role}
                    </span>
                ))}
            </div>
        </div>
    )
}
