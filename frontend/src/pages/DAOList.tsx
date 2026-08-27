import { useState, useMemo } from "react"
import { useQueries } from "@tanstack/react-query"
import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { Bank, LinkSimple } from "@phosphor-icons/react"
import { ErrorToast } from "../components/ui/ErrorToast"
import { GNO_RPC_URL, getExplorerBaseUrl } from "../lib/config"
import { getDAOConfig, type DAOConfig } from "../lib/dao"
import {
    FEATURED_DAO,
    encodeSlug,
    getSavedDAOsForOrg,
    addSavedDAOForOrg,
    removeSavedDAOForOrg,
    validateRealmPath,
} from "../lib/daoSlug"
import { useUnvotedProposals } from "../hooks/useUnvotedProposals"
import { useNotifications } from "../hooks/useNotifications"
import { useOrg } from "../contexts/OrgContext"
import type { LayoutContext } from "../types/layout"
import "./daolist.css"

interface DAOEntry {
    realmPath: string
    name: string
    config: DAOConfig | null
    featured?: boolean
}

export function DAOList() {
    const navigate = useNetworkNav()
    const { auth } = useOutletContext<LayoutContext>()
    const { activeOrgId, activeOrgName, isOrgMode } = useOrg()

    const [error, setError] = useState<string | null>(null)

    // Connect form — collapsed by default
    const [showConnect, setShowConnect] = useState(false)
    const [realmInput, setRealmInput] = useState("")
    const [connecting, setConnecting] = useState(false)

    // Bumped after add/remove so the memo re-reads localStorage.
    const [savedVersion, setSavedVersion] = useState(0)

    // The base list (featured + saved) is synchronous localStorage — cards
    // render immediately as placeholders (name + path, no config yet).
    const baseEntries = useMemo(() => {
        const allPaths = new Map<string, { name: string; featured: boolean }>()
        allPaths.set(FEATURED_DAO.realmPath, { name: FEATURED_DAO.name, featured: true })
        for (const s of getSavedDAOsForOrg(activeOrgId)) {
            if (!allPaths.has(s.realmPath)) {
                allPaths.set(s.realmPath, { name: s.name, featured: false })
            }
        }
        return Array.from(allPaths.entries()).map(([realmPath, meta]) => ({ realmPath, ...meta }))
        // eslint-disable-next-line react-hooks/exhaustive-deps -- savedVersion forces the localStorage re-read
    }, [activeOrgId, savedVersion])

    // One config query per DAO: each card fills in as its config resolves —
    // the old progressive per-DAO .then chain, now cache-shared (the key
    // matches ProposalView/DAOMembers' config query, so navigating into a DAO
    // hits a warm cache). A failed config keeps the placeholder, as before.
    const configQueries = useQueries({
        queries: baseEntries.map((e) => ({
            queryKey: ["dao", "config", e.realmPath],
            queryFn: async () => {
                try {
                    return await getDAOConfig(GNO_RPC_URL, e.realmPath)
                } catch {
                    return null
                }
            },
        })),
    })
    const daoEntries: DAOEntry[] = baseEntries.map((e, i) => {
        const config = configQueries[i]?.data ?? null
        return { realmPath: e.realmPath, name: config?.name || e.name, config, featured: e.featured }
    })

    // Action Required: unvoted proposals
    const userAddress = auth.isAuthenticated ? (auth as { address?: string }).address || null : null
    const { proposals: unvotedProposals } = useUnvotedProposals(userAddress)

    // v2.10: Notification unread count per DAO
    const daoPaths = useMemo(() => daoEntries.map(d => d.realmPath), [daoEntries])
    const { getDAOUnreadCount } = useNotifications(daoPaths, userAddress)

    // Per-DAO unvoted count for red dot on cards
    const unvotedByDao = useMemo(() => {
        const map = new Map<string, number>()
        for (const p of unvotedProposals) {
            map.set(p.realmPath, (map.get(p.realmPath) || 0) + 1)
        }
        return map
    }, [unvotedProposals])

    const handleConnect = async () => {
        const path = realmInput.trim()
        if (!path) return
        const validationError = validateRealmPath(path)
        if (validationError) {
            setError(validationError)
            return
        }

        setConnecting(true)
        setError(null)
        try {
            const config = await getDAOConfig(GNO_RPC_URL, path)
            if (!config) {
                setError("No DAO found at this realm path. It may not be deployed yet.")
                return
            }
            addSavedDAOForOrg(activeOrgId, path, config.name)
            setSavedVersion((v) => v + 1)
            setRealmInput("")
            navigate(`/dao/${encodeSlug(path)}`)
        } catch {
            setError("Could not connect to DAO realm. Please check the path.")
        } finally {
            setConnecting(false)
        }
    }

    const handleRemove = (realmPath: string) => {
        removeSavedDAOForOrg(activeOrgId, realmPath)
        // Featured stays regardless (it isn't in saved storage); bumping the
        // version re-derives the list from localStorage.
        setSavedVersion((v) => v + 1)
    }

    // Compute summary stats
    const totalMembers = daoEntries.reduce((sum, d) => sum + (d.config?.memberCount || 0), 0)

    return (
        <div className="animate-fade-in k-daolist">
            {/* Back nav */}
            <button className="k-daolist__back" onClick={() => navigate(auth.isAuthenticated ? "/dashboard" : "/")}>
                {auth.isAuthenticated ? "← Back to Dashboard" : "← Home"}
            </button>

            {/* Header */}
            <div>
                <h2 className="k-daolist__title">
                    <Bank size={20} className="k-daolist__title-icon" /> DAO Governance
                </h2>
                <p className="k-daolist__subtitle">
                    Browse proposals, vote, and manage DAO governance on gno.land
                </p>
                {isOrgMode && (
                    <div className="k-daolist__org-badge">
                        <span className="k-daolist__org-dot" />
                        Team: {activeOrgName}
                    </div>
                )}
            </div>

            {/* ── Action Required Banner ──────────────────────── */}
            {unvotedProposals.length > 0 && (
                <div className="k-daolist__action-banner">
                    <div className="k-daolist__action-header">
                        <span style={{ fontSize: 14 }}>⚡</span>
                        <span className="k-daolist__action-title">
                            🗳️ {unvotedProposals.length} proposal{unvotedProposals.length > 1 ? "s" : ""} need{unvotedProposals.length === 1 ? "s" : ""} your vote
                        </span>
                    </div>
                    <div className="k-daolist__action-list">
                        {unvotedProposals.slice(0, 3).map(p => (
                            <div
                                key={`${p.realmPath}:${p.proposalId}`}
                                className="k-daolist__action-item"
                                onClick={() => navigate(`/dao/${p.daoSlug}/proposal/${p.proposalId}`)}
                            >
                                <span className="k-daolist__action-dao">{p.daoName}</span>
                                <span className="k-daolist__action-sep">—</span>
                                <span className="k-daolist__action-proposal">
                                    #{p.proposalId}: {p.proposalTitle}
                                </span>
                                <span className="k-daolist__action-arrow">→</span>
                            </div>
                        ))}
                        {unvotedProposals.length > 3 && (
                            <span className="k-daolist__action-more" onClick={() => navigate("/dao")}>
                                +{unvotedProposals.length - 3} more…
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* ── Summary Line ───────────────────────────────────── */}
            {daoEntries.length > 0 && (
                <div className="k-daolist__summary">
                    <span>{daoEntries.length} DAO{daoEntries.length !== 1 ? "s" : ""}</span>
                    <span>·</span>
                    <span>{unvotedProposals.length} pending vote{unvotedProposals.length !== 1 ? "s" : ""}</span>
                    {totalMembers > 0 && (
                        <>
                            <span>·</span>
                            <span>{totalMembers} member{totalMembers !== 1 ? "s" : ""} total</span>
                        </>
                    )}
                </div>
            )}

            {/* ── DAO Grid (MOVED UP — primary content) ──────────
                No loading branch: the base list is synchronous localStorage,
                so cards render immediately and fill as configs resolve. */}
            {daoEntries.length === 0 ? (
                <div className="k-dashed k-daolist__empty">
                    <div className="k-daolist__empty-icon">
                        <Bank size={24} />
                    </div>
                    <h3 className="k-daolist__empty-title">No DAOs yet</h3>
                    <p className="k-daolist__empty-desc">
                        Connect to a DAO by clicking below, or create your own
                    </p>
                </div>
            ) : (
                <div className="k-daolist__grid">
                    {daoEntries.map((dao) => (
                        <DAOCard
                            key={dao.realmPath}
                            dao={dao}
                            unvotedCount={unvotedByDao.get(dao.realmPath) || 0}
                            notifCount={getDAOUnreadCount(dao.realmPath)}
                            onOpen={() => {
                                addSavedDAOForOrg(activeOrgId, dao.realmPath, dao.name)
                                navigate(`/dao/${encodeSlug(dao.realmPath)}`)
                            }}
                            onRemove={dao.featured ? undefined : () => handleRemove(dao.realmPath)}
                        />
                    ))}
                </div>
            )}

            {/* ── Quick Actions ─────────────────────────────────── */}
            <div className="k-daolist__actions">
                <button id="dao-create-btn" className="k-btn-primary" onClick={() => navigate("/dao/create")}>
                    + Create a DAO
                </button>
                <button className="k-btn-secondary" onClick={() => setShowConnect(!showConnect)}>
                    <LinkSimple size={14} /> {showConnect ? "Hide" : "Connect to DAO"}
                </button>
            </div>

            {/* ── Connect Form (COLLAPSED by default) ──────────── */}
            {showConnect && (
                <div className="k-card k-daolist__connect-form">
                    <div className="k-daolist__connect-header">
                        <span className="k-daolist__connect-header-icon"><LinkSimple size={20} /></span>
                        <div>
                            <div className="k-daolist__connect-title">Connect to a DAO</div>
                            <div className="k-daolist__connect-desc">
                                Enter a DAO realm path to explore its governance
                            </div>
                        </div>
                    </div>

                    <div className="k-daolist__connect-row">
                        <input
                            id="dao-connect-input"
                            className="k-daolist__connect-input"
                            type="text"
                            value={realmInput}
                            onChange={(e) => setRealmInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                            placeholder="gno.land/r/your/dao"
                            maxLength={100}
                            disabled={connecting}
                            aria-label="DAO realm path"
                        />
                        <button
                            id="dao-connect-btn"
                            className="k-btn-primary"
                            onClick={handleConnect}
                            disabled={connecting || !realmInput.trim()}
                            style={{ whiteSpace: "nowrap", opacity: !realmInput.trim() ? 0.4 : 1 }}
                        >
                            {connecting ? "Connecting..." : "Connect"}
                        </button>
                    </div>
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Components ────────────────────────────────────────────

function DAOCard({
    dao,
    unvotedCount,
    notifCount,
    onOpen,
    onRemove,
}: {
    dao: DAOEntry
    unvotedCount: number
    notifCount: number
    onOpen: () => void
    onRemove?: () => void
}) {
    const cardClass = [
        "k-card k-dao-card",
        dao.featured ? "k-dao-card--featured" : "",
        dao.config?.isArchived ? "k-dao-card--archived" : "",
    ].filter(Boolean).join(" ")

    return (
        <div
            className={cardClass}
            onClick={onOpen}
            role="button"
            tabIndex={0}
            aria-label={`Open ${dao.name}`}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onOpen()
                }
            }}
        >
            {/* Header */}
            <div className="k-dao-card__header">
                <div className="k-dao-card__name-row">
                    <span className="k-dao-card__icon"><Bank size={22} /></span>
                    <div>
                        <span className="k-dao-card__name">
                            {dao.name}
                        </span>
                        {dao.featured && (
                            <span className="k-dao-card__badge k-dao-card__badge--featured">
                                FEATURED
                            </span>
                        )}
                        {dao.config?.isArchived && (
                            <span className="k-dao-card__badge k-dao-card__badge--archived">
                                📦 Archived
                            </span>
                        )}
                    </div>
                </div>
                {onRemove && (
                    <button
                        className="k-dao-card__remove"
                        onClick={(e) => { e.stopPropagation(); onRemove() }}
                        title="Remove"
                        aria-label={`Remove ${dao.name}`}
                    >
                        ×
                    </button>
                )}
            </div>

            {/* Unvoted indicator */}
            {unvotedCount > 0 && (
                <div className="k-dao-card__indicator k-dao-card__indicator--warn">
                    <span className="k-dao-card__indicator-dot k-dao-card__indicator-dot--warn" />
                    <span className="k-dao-card__indicator-text k-dao-card__indicator-text--warn">
                        {unvotedCount} vote{unvotedCount > 1 ? "s" : ""} needed
                    </span>
                </div>
            )}

            {/* v2.10: Notification unread indicator */}
            {notifCount > 0 && unvotedCount === 0 && (
                <div className="k-dao-card__indicator k-dao-card__indicator--info">
                    <span className="k-dao-card__indicator-dot k-dao-card__indicator-dot--info" />
                    <span className="k-dao-card__indicator-text k-dao-card__indicator-text--info">
                        {notifCount} new notification{notifCount > 1 ? "s" : ""}
                    </span>
                </div>
            )}

            {/* Realm path + source link */}
            <div className="k-dao-card__path-row">
                <div className="k-dao-card__path">
                    {dao.realmPath}
                </div>
                <a
                    className="k-dao-card__source-link"
                    href={`${getExplorerBaseUrl()}/r/${dao.realmPath.replace("gno.land/r/", "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View source on gno.land"
                    onClick={(e) => e.stopPropagation()}
                >
                    &lt;/&gt;
                </a>
            </div>

            {/* Stats */}
            {dao.config && (
                <div className="k-dao-card__stats">
                    <div className="k-dao-card__stats-row">
                        <span>👥 {dao.config.memberCount} members</span>
                        <span>📊 {dao.config.threshold} threshold</span>
                    </div>

                    {/* Tier distribution badges */}
                    {dao.config.tierDistribution && dao.config.tierDistribution.length > 0 && (
                        <div className="k-dao-card__tiers">
                            {dao.config.tierDistribution.map((t) => {
                                const colors: Record<string, string> = { T1: "var(--color-brand)", T2: "var(--color-info)", T3: "var(--color-accent-gold)" }
                                const color = colors[t.tier] || "var(--color-text-secondary)"
                                return (
                                    <span key={t.tier} className="k-dao-card__tier" style={{ background: `${color}12`, color }}>
                                        <span className="k-dao-card__tier-dot" style={{ background: color }} />
                                        {t.tier}: {t.memberCount} • {t.power}pw
                                    </span>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Description */}
            {dao.config?.description && (
                <p className="k-dao-card__desc">
                    {dao.config.description}
                </p>
            )}

            {/* CTA */}
            <div className="k-dao-card__cta">
                <span className="k-dao-card__cta-text">Open →</span>
            </div>
        </div>
    )
}
