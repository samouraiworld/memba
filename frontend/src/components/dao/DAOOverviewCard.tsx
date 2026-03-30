import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Bank, Archive } from "@phosphor-icons/react"
import { getExplorerBaseUrl, getUserRegistryPath } from "../../lib/config"
import { derivePkgBech32Addr } from "../../lib/dao/realmAddress"
import { PowerDonut } from "./TierPieChart"
import type { DAOConfig, DAOMember } from "../../lib/dao"

interface DAOOverviewCardProps {
    config: DAOConfig | null
    realmPath: string
    encodedSlug: string
    currentMember: DAOMember | undefined
    isAuthenticated: boolean
    walletAddress: string
    memberCount: number
    activeProposals: number
    awaitingExecution: number
    totalProposals: number
    nonVoterPercent: number
    nonVoterCount: number
    maxVoterParticipation: number
    proposalsWithVotesCount: number
    totalPower: number
    healthScore: { grade: string; total: number; color: string; participationPts: number; execPts: number; activityPts: number } | null
    session: { daoSlug: string; channelName: string } | null
    joinRoom: (opts: { daoSlug: string; channelName: string; mode: string; label: string; description: string }) => void
}

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
                    }).catch(() => {})
                } catch { /* Clipboard API not available */ }
            }}
            className="k-realm-address"
        >
            {copied ? "✓ Copied!" : <>{truncated} <span style={{ opacity: 0.5, fontSize: 9 }}>📋</span></>}
        </button>
    )
}

export function DAOOverviewCard({
    config, realmPath, encodedSlug, currentMember, isAuthenticated, walletAddress,
    memberCount, activeProposals, awaitingExecution, totalProposals,
    nonVoterPercent, nonVoterCount, maxVoterParticipation, proposalsWithVotesCount,
    totalPower, healthScore, session, joinRoom,
}: DAOOverviewCardProps) {
    const navigate = useNavigate()

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
                {isAuthenticated && !currentMember && (
                    <span className="dao-guest-badge">Guest</span>
                )}
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
                        <PowerDonut tiers={config.tierDistribution} totalPower={totalPower} size={80} />
                    )}
                    <div className="k-stat-grid k-stat-grid--compact">
                        {[
                            { icon: "👥", value: String(memberCount), label: "Members", tip: `${memberCount} members across ${config?.tierDistribution?.length || 1} tier(s). Click to scroll to members list.`, action: "members" },
                            { icon: "📋", value: String(activeProposals), label: "Active", accent: true, tip: `${activeProposals} open proposal(s) currently awaiting votes from DAO members. Click to scroll.`, action: "proposals" },
                            { icon: "⚡", value: String(awaitingExecution), label: "Execute", accent: awaitingExecution > 0, tip: `${awaitingExecution} proposal(s) have passed voting and are ready to be executed on-chain. Click to scroll.`, action: "execute" },
                            { icon: "📜", value: String(totalProposals), label: "Proposals", tip: `${totalProposals} total proposals submitted to this DAO (${activeProposals} active, ${awaitingExecution} passed). Click to scroll.`, action: "proposals" },
                            { icon: "🫥", value: nonVoterPercent > 0 ? `${nonVoterPercent}%` : "—", label: "Non-Voters", tip: `~${nonVoterCount} of ${memberCount} members have never voted. Based on best turnout (${maxVoterParticipation} voters) across ${proposalsWithVotesCount} proposal(s) with votes.` },
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
                    <button aria-label="Open Discussion Channels" className="dao-channels-sidebar__item" onClick={() => navigate(`/dao/${encodedSlug}/channels`)}>
                        <span className="dao-channels-sidebar__icon">#</span>
                        <span>general</span>
                    </button>
                    <button aria-label="Open Announcements" className="dao-channels-sidebar__item" onClick={() => navigate(`/dao/${encodedSlug}/channels`)}>
                        <span className="dao-channels-sidebar__icon">#</span>
                        <span>announcements</span>
                    </button>

                    <div className="dao-channels-sidebar__divider">
                        <span>🎙️ Voice Rooms</span>
                        {session && session.daoSlug === encodedSlug && (
                            <span className="dao-channels-sidebar__live-dot" />
                        )}
                    </div>

                    <button
                        aria-label="Join Public Room"
                        className={`dao-channels-sidebar__item dao-channels-sidebar__item--voice${session?.daoSlug === encodedSlug && session?.channelName === "public-room" ? " active" : ""}`}
                        onClick={() => walletAddress ? joinRoom({
                            daoSlug: encodedSlug || "",
                            channelName: "public-room",
                            mode: "voice",
                            label: "Public Room",
                            description: "Open voice room — anyone with a connected wallet can join.",
                        }) : undefined}
                        disabled={!walletAddress}
                    >
                        <span className="dao-channels-sidebar__icon">🔊</span>
                        <span>Public Room</span>
                    </button>

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

                    {!walletAddress && (
                        <div className="dao-channels-sidebar__hint">
                            Connect wallet to join
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
