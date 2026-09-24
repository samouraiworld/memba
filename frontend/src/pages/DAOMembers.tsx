import { useState } from "react"
import { useOutletContext, Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useNetworkKey, useNetworkNav, useNetworkPath } from "../hooks/useNetworkNav"
import { useDaoKind } from "../hooks/useDaoKind"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { GNO_RPC_URL, getExplorerBaseUrl, getUserRegistryPath } from "../lib/config"
import { getDAOConfig, getDAOMembers, type DAOMember, type TierInfo } from "../lib/dao"
import { useDaoRoute } from "../hooks/useDaoRoute"
import { revealInvisibleFormatting } from "../lib/dao/v2Text"
import type { LayoutContext } from "../types/layout"
import "./daomembers.css"

export function DAOMembers() {
    const navigate = useNetworkNav()
    const { realmPath, encodedSlug } = useDaoRoute()
    const { adena } = useOutletContext<LayoutContext>()
    const networkKey = useNetworkKey()
    const { capabilities } = useDaoKind(realmPath || undefined)


    const [tierFilter, setTierFilter] = useState<string>("all")
    const [roleFilter, setRoleFilter] = useState<string>("all")

    // Server state lives in React Query, keyed by realm. Disabled without a
    // realmPath, which keeps the skeleton up exactly like the old early-return.
    const membersQuery = useQuery({
        queryKey: ["dao", "members", realmPath],
        enabled: !!realmPath,
        queryFn: async () => {
            const cfg = await getDAOConfig(GNO_RPC_URL, realmPath!)
            // Strict: a failed roster read shows as an error, never as an empty DAO.
            const mems = await getDAOMembers(GNO_RPC_URL, realmPath!, cfg?.memberstorePath, true)
            return { config: cfg, members: mems }
        },
    })
    const config = membersQuery.data?.config ?? null
    const members = membersQuery.data?.members ?? []
    const loading = membersQuery.isPending

    // The fetch error comes from the query, with a dismissal flag so the
    // toast doesn't resurrect.
    const [fetchErrorDismissed, setFetchErrorDismissed] = useState(false)
    const error = membersQuery.isError && !fetchErrorDismissed
        ? (membersQuery.error instanceof Error ? membersQuery.error.message : "Failed to load members")
        : null

    const tiers = config?.tierDistribution || []
    const totalPower = tiers.reduce((sum, t) => sum + t.power, 0)
    const allRoles = Array.from(new Set(members.flatMap((m) => m.roles))).filter(Boolean)
    let filteredMembers = tierFilter === "all" ? members : members.filter((m) => m.tier === tierFilter)
    if (roleFilter !== "all") {
        filteredMembers = filteredMembers.filter((m) => m.roles.includes(roleFilter))
    }

    // Membership and roles change only through proposals the DAO votes on;
    // this page is read-only and links members to the matching proposal form.
    const viewerIsMember = !!adena.address && members.some((m) => m.address === adena.address)
    const proposeBase = `/${networkKey}/dao/${encodedSlug}/propose`
    const canPropose = (kind: "add_member" | "remove_member" | "change_role") =>
        viewerIsMember && !config?.isArchived && capabilities.propose.includes(kind)
    const roleChangesPossible = canPropose("change_role") && (config?.v2 ? config.v2.roles.length > 0 : true)
    const showTiers = members.some((m) => m.tier)
    const showPower = !showTiers && !!config?.v2

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
                <h2 className="k-members__title">Members</h2>
                <p className="k-members__subtitle">{revealInvisibleFormatting(config?.name || "DAO")} — {members.length} {members.length === 1 ? "member" : "members"}</p>
                {capabilities.propose.length > 0 && (
                    <p className="k-members__subtitle">Members and roles change only through proposals that pass a vote.</p>
                )}
                {canPropose("add_member") && (
                    <Link className="k-btn-secondary" to={`${proposeBase}?type=add_member`} style={{ display: "inline-block", marginTop: 8 }}>
                        Propose a new member
                    </Link>
                )}
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
                            const colors: Record<string, string> = { T1: "var(--color-brand)", T2: "var(--color-info)", T3: "var(--color-accent-gold)" }
                            return <div key={t.tier} style={{ width: `${pct}%`, background: colors[t.tier] || "var(--color-text-secondary)", transition: "width 0.4s" }} />
                        })}
                    </div>
                </div>
            )}

            {config?.isArchived && (
                <p role="status">This DAO is archived.</p>
            )}

            {/* Tier Filters */}
            {tiers.length > 0 && (
                <div className="k-members__filters">
                    <FilterButton label="All" count={members.length} active={tierFilter === "all"} onClick={() => setTierFilter("all")} color="var(--color-surface-light)" />
                    {tiers.map((t) => {
                        const colors: Record<string, string> = { T1: "var(--color-brand)", T2: "var(--color-info)", T3: "var(--color-accent-gold)" }
                        return <FilterButton key={t.tier} label={t.tier} count={t.memberCount} active={tierFilter === t.tier} onClick={() => setTierFilter(t.tier)} color={colors[t.tier] || "var(--color-text-secondary)"} />
                    })}
                </div>
            )}

            {/* Role Filters */}
            {allRoles.length > 0 && (
                <div className="k-members__filters">
                    <FilterButton label="All Roles" count={members.length} active={roleFilter === "all"} onClick={() => setRoleFilter("all")} color="var(--color-surface-light)" />
                    {allRoles.map((role) => {
                        const count = members.filter((m) => m.roles.includes(role)).length
                        return <FilterButton key={role} label={revealInvisibleFormatting(role)} count={count} active={roleFilter === role} onClick={() => setRoleFilter(role)} color={roleColors[role] || "var(--color-text-secondary)"} />
                    })}
                </div>
            )}

            {/* Members List */}
            <div className="k-members__list">
                <div className="k-members__list-header">
                    <span>Address</span>
                    <span>{showTiers ? "Tier" : showPower ? "Voting power" : ""}</span>
                    <span style={{ textAlign: "right" }}>Role</span>
                </div>

                {filteredMembers.length === 0 && (
                    <div className="k-dashed k-members__empty">
                        <p className="k-members__empty-text">No members found for this filter</p>
                    </div>
                )}

                {filteredMembers.map((m) => (
                    <MemberRow
                        key={m.address}
                        member={m}
                        isCurrentUser={!!adena.address && m.address === adena.address}
                        showPower={showPower}
                        proposeRoleChange={roleChangesPossible ? `${proposeBase}?type=change_role&target=${m.address}` : undefined}
                        proposeRemoval={canPropose("remove_member") && members.length > 1 ? `${proposeBase}?type=remove_member&target=${m.address}` : undefined}
                    />
                ))}
            </div>

            <ErrorToast message={error} onDismiss={() => setFetchErrorDismissed(true)} />
        </div>
    )
}

// ── Components ────────────────────────────────────────────

const tierColors: Record<string, string> = { T1: "var(--color-brand)", T2: "var(--color-info)", T3: "var(--color-accent-gold)" }
const roleColors: Record<string, string> = { admin: "var(--color-accent-gold)", dev: "var(--color-brand)", finance: "var(--color-accent-purple)", ops: "var(--color-info)", member: "var(--color-text-secondary)" }

function TierSummaryCard({ tier, totalPower }: { tier: TierInfo; totalPower: number }) {
    const color = tierColors[tier.tier] || "var(--color-text-secondary)"
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
                border: `1px solid ${active ? color + "44" : "var(--color-surface-base)"}`,
                color: active ? color : "var(--color-text-secondary)",
            }}
        >
            {label}<span className="k-members__filter-count">({count})</span>
        </button>
    )
}

function MemberRow({ member, isCurrentUser, showPower, proposeRoleChange, proposeRemoval }: {
    member: DAOMember
    isCurrentUser: boolean
    showPower: boolean
    proposeRoleChange?: string
    proposeRemoval?: string
}) {
    const np = useNetworkPath()
    const tierColor = tierColors[member.tier] || "var(--color-text-secondary)"

    return (
        <div className="k-card k-members__row">
            <div className="k-members__row-grid">
                <div className="k-members__row-addr">
                    {member.username && (
                        <a href={np(`u/${member.username.replace("@", "")}`)} className="k-members__row-username">{revealInvisibleFormatting(member.username)}</a>
                    )}
                    <CopyableAddress address={member.address} />
                    <Link to={np(`profile/${member.address}`)} className="k-members__row-profile">Profile</Link>
                    {isCurrentUser && <span className="k-members__row-you">YOU</span>}
                    {isCurrentUser && !member.username && (
                        <a href={`${getExplorerBaseUrl()}/${getUserRegistryPath().replace("gno.land/", "")}`} target="_blank" rel="noopener noreferrer" className="k-members__row-register">
                            Register @username →
                        </a>
                    )}
                </div>

                {member.tier ? (
                    <span className="k-members__tier-badge" style={{ background: `${tierColor}15`, color: tierColor }}>{member.tier}</span>
                ) : showPower ? (
                    <span className="k-members__power" aria-label={`Voting power ${member.votingPower.toLocaleString("en-US")}`}>{member.votingPower.toLocaleString("en-US")}</span>
                ) : <span />}

                <div className="k-members__roles">
                    {member.roles.map((role) => {
                        const color = roleColors[role] || "var(--color-text-secondary)"
                        return (
                            <span key={role} className="k-members__role-badge" style={{ background: `${color}15`, color }}>
                                {revealInvisibleFormatting(role)}
                            </span>
                        )
                    })}
                </div>
            </div>
            {(proposeRoleChange || proposeRemoval) && (
                <div className="k-members__row-actions">
                    {proposeRoleChange && <Link to={proposeRoleChange} className="k-members__row-action">Propose role change</Link>}
                    {proposeRemoval && <Link to={proposeRemoval} className="k-members__row-action">Propose removal</Link>}
                </div>
            )}
        </div>
    )
}
