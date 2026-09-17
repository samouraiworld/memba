import { useNetworkNav } from "../../hooks/useNetworkNav"
import { Bank, Archive } from "@phosphor-icons/react"
import { getExplorerBaseUrl, getUserRegistryPath } from "../../lib/config"
import { PowerDonut } from "./TierPieChart"
import { DAOIdentityLabel } from "./DAOIdentityLabel"
import type { DAOConfig, DAOMember } from "../../lib/dao"

interface DAOOverviewCardProps {
    professional?: boolean
    proposalsKnown?: boolean
    membersKnown?: boolean
    config: DAOConfig | null
    realmPath: string
    encodedSlug: string
    currentMember: DAOMember | undefined
    isAuthenticated: boolean
    memberCount: number
    activeProposals: number
    awaitingExecution: number
    totalProposals: number
    nonVoterPercent: number
    nonVoterCount: number
    maxVoterParticipation: number
    proposalsWithVotesCount: number
    totalPower: number
    /** Whether this DAO has channels on this network (capability). */
    channels?: boolean
}

export function DAOOverviewCard({
    config, realmPath, encodedSlug, currentMember, isAuthenticated,
    memberCount, activeProposals, awaitingExecution, totalProposals,
    nonVoterPercent, nonVoterCount, maxVoterParticipation, proposalsWithVotesCount,
    totalPower, professional = false, proposalsKnown = true, membersKnown = true, channels = false,
}: DAOOverviewCardProps) {
    const navigate = useNetworkNav()

    return (
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

            {/* Realm path */}
            <div className="dao-path-row">
                <div className="dao-path-left">
                    <span className="dao-path-text">{realmPath}</span>
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
            </div>

            {/* Title + membership pill */}
            <div className="dao-title-row">
                <h2 className="dao-title">
                    <Bank size={20} style={{ color: "var(--color-k-dim)" }} /> {config?.name || "DAO Governance"}
                    {config?.isArchived && (
                        <span className="dao-badge-archived">
                            <Archive size={12} /> ARCHIVED
                        </span>
                    )}
                </h2>
                <DAOIdentityLabel realmPath={realmPath} name={config?.name || ""} />
                {isAuthenticated && currentMember && (
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
                {isAuthenticated && !currentMember && (!professional || membersKnown) && (
                    <span className="dao-guest-badge">Guest</span>
                )}
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
            {isAuthenticated && currentMember && !currentMember.username && (
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

            <div className="dao-divider" />

            {/* 2-column layout — stats left, channel sidebar right */}
            <div className="dao-card-columns">
                {/* Left: Donut + Stats */}
                <div className="dao-card-columns__left">
                    {config?.tierDistribution && config.tierDistribution.length > 0 && totalPower > 0 && (
                        professional ? <details className="gov-power-details"><summary>Voting power distribution · {totalPower} total</summary><PowerDonut tiers={config.tierDistribution} totalPower={totalPower} size={80} /></details> : <PowerDonut tiers={config.tierDistribution} totalPower={totalPower} size={80} />
                    )}
                    {professional ? <dl className="gov-summary">
                        {[
                            ["Members", membersKnown ? memberCount : null],
                            ["Open for voting", proposalsKnown ? activeProposals - awaitingExecution : null],
                            ["Awaiting execution", proposalsKnown ? awaitingExecution : null],
                            ["Total proposals", proposalsKnown ? totalProposals : null],
                        ].map(([label, value]) => <div key={label}>
                            <dt>{label}</dt><dd>{value ?? "—"}</dd>
                        </div>)}
                    </dl> : <div className="k-stat-grid k-stat-grid--compact">
                        {[
                            { icon: "👥", value: String(memberCount), label: "Members", tip: `${memberCount} members across ${config?.tierDistribution?.length || 1} tier(s). Click to scroll to members list.`, action: "members" },
                            { icon: "📋", value: String(activeProposals), label: "Active", accent: true, tip: `${activeProposals} open proposal(s) currently awaiting votes from DAO members. Click to scroll.`, action: "proposals" },
                            { icon: "⚡", value: String(awaitingExecution), label: "Execute", accent: awaitingExecution > 0, tip: `${awaitingExecution} proposal(s) have passed voting and are ready to be executed on-chain. Click to scroll.`, action: "execute" },
                            { icon: "📜", value: String(totalProposals), label: "Proposals", tip: `${totalProposals} total proposals submitted to this DAO (${activeProposals} active, ${awaitingExecution} passed). Click to scroll.`, action: "proposals" },
                            ...(nonVoterPercent > 0 ? [{ icon: "🫥", value: `${nonVoterPercent}%`, label: "Non-Voters", tip: `~${nonVoterCount} of ${memberCount} members have never voted. Based on best turnout (${maxVoterParticipation} voters) across ${proposalsWithVotesCount} proposal(s) with votes.` }] : []),
                            ...(totalPower > 0 ? [{ icon: "⚡", value: String(totalPower), label: "Voting power", tip: `Combined voting power across all ${config?.tierDistribution?.length || 1} tier(s). Voting power determines each member's influence when casting votes on proposals.` }] : []),
                        ].filter(Boolean).map(s => (
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
                    </div>}
                </div>

                {/* Right: channels, only where this DAO has them */}
                {channels && (
                    <div className="dao-channels-sidebar">
                        <button aria-label="Open channels" className="dao-channels-sidebar__item" onClick={() => navigate(`/dao/${encodedSlug}/channels`)}>
                            <span className="dao-channels-sidebar__icon">#</span>
                            <span>Channels</span>
                        </button>
                    </div>
                )}
            </div>

        </div>
    )
}
