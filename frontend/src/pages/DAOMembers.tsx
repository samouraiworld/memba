import { useState, useEffect, useCallback } from "react"
import { useParams, useOutletContext, Link } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { GNO_RPC_URL, getExplorerBaseUrl, getUserRegistryPath } from "../lib/config"
import { getDAOConfig, getDAOMembers, buildAssignRoleMsg, buildRemoveRoleMsg, type DAOConfig, type DAOMember, type TierInfo } from "../lib/dao"
import { doContractBroadcast } from "../lib/grc20"
import { decodeSlug, encodeSlug } from "../lib/daoSlug"
import type { LayoutContext } from "../types/layout"
import "./daomembers.css"

export function DAOMembers() {
    const navigate = useNetworkNav()
    const { slug } = useParams<{ slug: string }>()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const realmPath = slug ? decodeSlug(slug) : ""
    const encodedSlug = realmPath ? encodeSlug(realmPath) : (slug || "")

    const [config, setConfig] = useState<DAOConfig | null>(null)
    const [members, setMembers] = useState<DAOMember[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [tierFilter, setTierFilter] = useState<string>("all")
    const [roleFilter, setRoleFilter] = useState<string>("all")
    const [actionLoading, setActionLoading] = useState(false)
    const [actionSuccess, setActionSuccess] = useState<string | null>(null)

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
    const allRoles = Array.from(new Set(members.flatMap((m) => m.roles))).filter(Boolean)
    let filteredMembers = tierFilter === "all" ? members : members.filter((m) => m.tier === tierFilter)
    if (roleFilter !== "all") {
        filteredMembers = filteredMembers.filter((m) => m.roles.includes(roleFilter))
    }

    const currentUserMember = members.find((m) => m.address === adena.address)
    const isAdmin = currentUserMember?.roles.includes("admin") ?? false
    const availableRoles = ["admin", "dev", "finance", "ops", "member"]

    const handleAssignRole = async (target: string, role: string) => {
        if (!adena.address || !auth.isAuthenticated) { setError("Connect your wallet first"); return }
        setActionLoading(true); setError(null); setActionSuccess(null)
        try {
            const msg = buildAssignRoleMsg(adena.address, realmPath, target, role)
            await doContractBroadcast([msg], `Assign role ${role} to ${target.slice(0, 10)}...`)
            setActionSuccess(`Role "${role}" assigned to ${target.slice(0, 10)}...`)
            await loadMembers()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to assign role")
        } finally { setActionLoading(false) }
    }

    const handleRemoveRole = async (target: string, role: string) => {
        if (!adena.address || !auth.isAuthenticated) { setError("Connect your wallet first"); return }
        setActionLoading(true); setError(null); setActionSuccess(null)
        try {
            const msg = buildRemoveRoleMsg(adena.address, realmPath, target, role)
            await doContractBroadcast([msg], `Remove role ${role} from ${target.slice(0, 10)}...`)
            setActionSuccess(`Role "${role}" removed from ${target.slice(0, 10)}...`)
            await loadMembers()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to remove role")
        } finally { setActionLoading(false) }
    }

    if (loading) {
        return (
            <div className="animate-fade-in k-members">
                <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
        )
    }

    return (
        <div className="animate-fade-in k-members">
            <button id="members-back-btn" className="k-members__back" aria-label="Back to DAO" onClick={() => navigate(`/dao/${encodedSlug}`)}>
                ← Back to DAO
            </button>

            <div>
                <h2 className="k-members__title">👥 Members</h2>
                <p className="k-members__subtitle">{config?.name || "DAO"} — {members.length} members</p>
            </div>

            {/* Power Distribution */}
            {tiers.length > 0 && (
                <div className="k-card k-members__power-card">
                    <h3 className="k-members__power-title">Power Distribution</h3>
                    <div className="k-members__power-grid">
                        {tiers.map((t) => <TierSummaryCard key={t.tier} tier={t} totalPower={totalPower} />)}
                    </div>
                    <div className="k-members__power-bar">
                        {tiers.map((t) => {
                            const pct = totalPower > 0 ? (t.power / totalPower) * 100 : 0
                            const colors: Record<string, string> = { T1: "#00d4aa", T2: "#2196f3", T3: "#f5a623" }
                            return <div key={t.tier} style={{ width: `${pct}%`, background: colors[t.tier] || "#888", transition: "width 0.4s" }} />
                        })}
                    </div>
                </div>
            )}

            {/* Tier Filters */}
            {tiers.length > 0 && (
                <div className="k-members__filters">
                    <FilterButton label="All" count={members.length} active={tierFilter === "all"} onClick={() => setTierFilter("all")} color="#f0f0f0" />
                    {tiers.map((t) => {
                        const colors: Record<string, string> = { T1: "#00d4aa", T2: "#2196f3", T3: "#f5a623" }
                        return <FilterButton key={t.tier} label={t.tier} count={t.memberCount} active={tierFilter === t.tier} onClick={() => setTierFilter(t.tier)} color={colors[t.tier] || "#888"} />
                    })}
                </div>
            )}

            {/* Role Filters */}
            {allRoles.length > 0 && (
                <div className="k-members__filters">
                    <FilterButton label="All Roles" count={members.length} active={roleFilter === "all"} onClick={() => setRoleFilter("all")} color="#f0f0f0" />
                    {allRoles.map((role) => {
                        const count = members.filter((m) => m.roles.includes(role)).length
                        return <FilterButton key={role} label={role} count={count} active={roleFilter === role} onClick={() => setRoleFilter(role)} color={roleColors[role] || "#888"} />
                    })}
                </div>
            )}

            {/* Members List */}
            <div className="k-members__list">
                <div className="k-members__list-header">
                    <span>Address</span>
                    <span>Tier</span>
                    <span style={{ textAlign: "right" }}>Role</span>
                </div>

                {filteredMembers.length === 0 && (
                    <div className="k-dashed k-members__empty">
                        <p className="k-members__empty-text">No members found for this filter</p>
                    </div>
                )}

                {filteredMembers.map((m) => (
                    <MemberRow
                        key={m.address} member={m} isCurrentUser={m.address === adena.address}
                        isAdmin={isAdmin} availableRoles={availableRoles}
                        onAssignRole={handleAssignRole} onRemoveRole={handleRemoveRole} actionLoading={actionLoading}
                    />
                ))}
            </div>

            {actionSuccess && <div className="k-members__success">✓ {actionSuccess}</div>}
            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Components ────────────────────────────────────────────

const tierColors: Record<string, string> = { T1: "#00d4aa", T2: "#2196f3", T3: "#f5a623" }
const roleColors: Record<string, string> = { admin: "#f5a623", dev: "#00d4aa", finance: "#7b61ff", ops: "#3b82f6", member: "#888" }

function TierSummaryCard({ tier, totalPower }: { tier: TierInfo; totalPower: number }) {
    const color = tierColors[tier.tier] || "#888"
    const pct = totalPower > 0 ? Math.round((tier.power / totalPower) * 100) : 0
    return (
        <div className="k-members__tier-card">
            <div className="k-members__tier-header">
                <span className="k-members__tier-dot" style={{ background: color }} />
                <span className="k-members__tier-label" style={{ color }}>{tier.tier}</span>
            </div>
            <div className="k-members__tier-count">{tier.memberCount}</div>
            <div className="k-members__tier-power">{tier.power} power ({pct}%)</div>
        </div>
    )
}

function FilterButton({ label, count, active, onClick, color }: {
    label: string; count: number; active: boolean; onClick: () => void; color: string
}) {
    return (
        <button
            className="k-members__filter-btn"
            onClick={onClick}
            style={{
                background: active ? "rgba(255,255,255,0.06)" : "transparent",
                border: `1px solid ${active ? color + "44" : "#1a1a1a"}`,
                color: active ? color : "#888",
            }}
        >
            {label}<span className="k-members__filter-count">({count})</span>
        </button>
    )
}

function MemberRow({ member, isCurrentUser, isAdmin, availableRoles, onAssignRole, onRemoveRole, actionLoading }: {
    member: DAOMember; isCurrentUser: boolean; isAdmin: boolean;
    availableRoles: string[]; onAssignRole: (target: string, role: string) => void;
    onRemoveRole: (target: string, role: string) => void; actionLoading: boolean;
}) {
    const [showActions, setShowActions] = useState(false)
    const tierColor = tierColors[member.tier] || "#666"
    const unassignedRoles = availableRoles.filter((r) => !member.roles.includes(r))

    return (
        <div className="k-card k-members__row">
            <div className="k-members__row-grid">
                <div className="k-members__row-addr">
                    {member.username && (
                        <a href={`/u/${member.username.replace("@", "")}`} className="k-members__row-username">{member.username}</a>
                    )}
                    <CopyableAddress address={member.address} />
                    <Link to={`/profile/${member.address}`} title="View profile" className="k-members__row-profile">👤</Link>
                    {isCurrentUser && <span className="k-members__row-you">YOU</span>}
                    {isCurrentUser && !member.username && (
                        <a href={`${getExplorerBaseUrl()}/${getUserRegistryPath().replace("gno.land/", "")}`} target="_blank" rel="noopener noreferrer" className="k-members__row-register">
                            Register @username →
                        </a>
                    )}
                </div>

                {member.tier ? (
                    <span className="k-members__tier-badge" style={{ background: `${tierColor}15`, color: tierColor }}>{member.tier}</span>
                ) : <span />}

                <div className="k-members__roles">
                    {member.roles.map((role) => {
                        const color = roleColors[role] || "#888"
                        return (
                            <span key={role} className="k-members__role-badge" style={{ background: `${color}15`, color }}>
                                {role}
                                {isAdmin && !isCurrentUser && (
                                    <button className="k-members__role-remove" onClick={() => onRemoveRole(member.address, role)} disabled={actionLoading} title={`Remove ${role} role`} style={{ opacity: actionLoading ? 0.3 : 0.6 }}>
                                        ✕
                                    </button>
                                )}
                            </span>
                        )
                    })}
                    {isAdmin && !isCurrentUser && (
                        <button className="k-members__add-role-btn" onClick={() => setShowActions(!showActions)} title="Manage roles">+</button>
                    )}
                </div>
            </div>

            {showActions && isAdmin && !isCurrentUser && unassignedRoles.length > 0 && (
                <div className="k-members__assign-panel">
                    <span className="k-members__assign-label">Assign:</span>
                    {unassignedRoles.map((role) => (
                        <button
                            key={role}
                            className="k-members__assign-btn"
                            onClick={() => { onAssignRole(member.address, role); setShowActions(false) }}
                            disabled={actionLoading}
                            style={{ color: roleColors[role] || "#888", opacity: actionLoading ? 0.5 : 1 }}
                        >
                            + {role}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
