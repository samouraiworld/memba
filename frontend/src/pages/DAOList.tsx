import { useState, useMemo } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { Link, useOutletContext } from "react-router-dom"
import { useNetworkKey, useNetworkNav } from "../hooks/useNetworkNav"
import { Bank, LinkSimple } from "@phosphor-icons/react"
import { ErrorToast } from "../components/ui/ErrorToast"
import { GNO_CHAIN_ID, GNO_RPC_URL, NETWORKS, getExplorerBaseUrl, PRO_APP_ENABLED } from "../lib/config"
import { getRpcUrlsInOrder } from "../lib/rpcFallback"
import { checkPendingDAOs, listPendingDAOs, removePendingDAO, type PendingCheck, type PendingDAO } from "../lib/dao/packageStatus"
import { TxStatusHash } from "../components/proposal/TxStatus"
import { getDAOConfig, type DAOConfig } from "../lib/dao"
import {
    FEATURED_DAO,
    encodeSlug,
    getSavedDAOsForOrg,
    saveDAOForRecovery, addSavedDAOForOrg,
    removeSavedDAOForOrg,
    validateRealmPath,
} from "../lib/daoSlug"
import { useUnvotedProposals } from "../hooks/useUnvotedProposals"
import { useNotifications } from "../hooks/useNotifications"
import { useOrg } from "../contexts/OrgContext"
import type { LayoutContext } from "../types/layout"
import { DAOIdentityLabel } from "../components/dao/DAOIdentityLabel"
import "./daolist.css"

interface DAOEntry {
    realmPath: string
    name: string
    config: DAOConfig | null
    featured?: boolean
}

export function DAOList() {
    const navigate = useNetworkNav()
    const networkKey = useNetworkKey()
    const { auth } = useOutletContext<LayoutContext>()
    const { activeOrgId, activeOrgName, isOrgMode } = useOrg()

    const [error, setError] = useState<string | null>(null)

    // Connect form — collapsed by default
    const [search, setSearch] = useState("")
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

    // Deploys gno.land has not enabled yet (kept in this browser by Create DAO).
    // Opening the list re-checks them; an enabled one becomes a normal entry.
    const [pendingVersion, setPendingVersion] = useState(0)
    const pendingNow = useMemo(() => listPendingDAOs(GNO_CHAIN_ID).filter(p => (p.orgId ?? null) === activeOrgId),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- pendingVersion forces the localStorage re-read
        [pendingVersion, savedVersion, activeOrgId])
    const pendingQuery = useQuery({
        queryKey: ["dao", "pending", GNO_CHAIN_ID, activeOrgId, pendingVersion],
        enabled: pendingNow.length > 0,
        retry: false,
        queryFn: ({ signal }) => checkPendingDAOs({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID, rpcUrls: getRpcUrlsInOrder() }, (entry: PendingDAO) => {
            saveDAOForRecovery(entry.orgId ?? null, entry.path, entry.name)
            setSavedVersion((v) => v + 1)
        }, signal),
    })
    const pendingChecks: (PendingDAO & { check?: PendingCheck["check"] })[] = pendingQuery.data?.filter(p => (p.orgId ?? null) === activeOrgId) ?? pendingNow

    const visibleDAOs = daoEntries.filter(dao => !PRO_APP_ENABLED || `${dao.name} ${dao.realmPath}`.toLowerCase().includes(search.trim().toLowerCase()))

    // Action Required: unvoted proposals
    const userAddress = auth.isAuthenticated ? (auth as { address?: string }).address || null : null
    const { proposals: unvotedProposals } = useUnvotedProposals(userAddress)

    // v2.10: Notification unread count per DAO
    const daoPaths = useMemo(() => baseEntries.map(d => d.realmPath), [baseEntries])
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
                        <span style={{ fontSize: "var(--pro-body, 14px)" }}>⚡</span>
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
            {PRO_APP_ENABLED && (
                <div className="pro-collection-toolbar">
                    <label htmlFor="dao-search">Your DAOs</label>
                    <input id="dao-search" type="search" placeholder="Search by name or realm"
                        value={search} onChange={e => setSearch(e.target.value)} />
                    <span role="status">{visibleDAOs.length} {visibleDAOs.length === 1 ? "DAO" : "DAOs"}</span>
                </div>
            )}
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

            {pendingChecks.length > 0 && (
                <section className="k-card k-daolist__pending" aria-labelledby="pending-daos-title">
                    <div className="k-daolist__pending-header">
                        <h3 id="pending-daos-title" className="k-daolist__pending-title">DAO submissions</h3>
                        <button className="k-btn-secondary" onClick={() => setPendingVersion((v) => v + 1)} disabled={pendingQuery.isFetching}>
                            {pendingQuery.isFetching ? "Checking…" : "Check again"}
                        </button>
                    </div>
                    <p className="k-daolist__pending-note">These are saved submission attempts from this browser. Only a live package is ready to use.</p>
                    <ul className="k-daolist__pending-list">
                        {pendingChecks.map((p) => (
                            <li key={p.path} className="k-daolist__pending-item">
                                <div className="k-daolist__pending-path">{p.path}</div>
                                <div>{p.name}</div>
                                <div role="status" className="k-daolist__pending-status">
                                    {pendingQuery.isFetching || p.check === undefined ? "Checking the network…"
                                        : p.check === "waiting" ? `Not enabled yet: ${p.reason}`
                                            : p.check === "not-found" ? "The network has no package at this path. The submission may have failed; check the transaction."
                                                : p.check === "live-unsaved" ? "The DAO is live, but could not be saved in this browser. Keep its realm path and check again."
                                                : "The status could not be read. Try again later."}
                                </div>
                                {p.txHash && <TxStatusHash hash={p.txHash} />}
                                {p.check === "not-found" && p.phase !== "intent" && (
                                    <button className="k-btn-secondary" onClick={() => { removePendingDAO(GNO_CHAIN_ID, p.path); setPendingVersion((v) => v + 1) }}>
                                        Remove from this list
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
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
                    {visibleDAOs.map((dao) => (
                        <DAOCard
                            key={dao.realmPath}
                            dao={dao}
                            href={`/${networkKey}/dao/${encodeSlug(dao.realmPath)}`}
                            unvotedCount={unvotedByDao.get(dao.realmPath) || 0}
                            notifCount={getDAOUnreadCount(dao.realmPath)}
                            onOpen={() => addSavedDAOForOrg(activeOrgId, dao.realmPath, dao.name)}
                            onRemove={dao.featured ? undefined : () => handleRemove(dao.realmPath)}
                        />
                    ))}
                </div>
            )}

            {PRO_APP_ENABLED && visibleDAOs.length === 0 && search.trim() && <p role="status">No DAOs match “{search}”. <button className="k-btn-secondary" onClick={() => setSearch("")}>Clear search</button></p>}

            {/* ── Quick Actions ─────────────────────────────────── */}
            <div className="k-daolist__actions">
                {NETWORKS[networkKey]?.userDaos?.create === true && <button id="dao-create-btn" className="k-btn-primary" onClick={() => navigate("/dao/create")}>
                    + Create a DAO
                </button>}
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
    href,
    unvotedCount,
    notifCount,
    onOpen,
    onRemove,
}: {
    dao: DAOEntry
    href: string
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
        // The name link stretches over the card, so the whole card opens the DAO
        // without nesting the source link or the remove button inside a link.
        <div className={cardClass}>
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
                    aria-label={`View source of ${dao.realmPath}`}
                >
                    &lt;/&gt;
                </a>
            </div>

            {/* Header */}
            <div className="k-dao-card__header">
                <div className="k-dao-card__name-row">
                    <span className="k-dao-card__icon"><Bank size={22} /></span>
                    <div>
                        <Link to={href} className="k-dao-card__name k-dao-card__link" onClick={onOpen}>
                            {dao.name}
                        </Link>
                        <DAOIdentityLabel realmPath={dao.realmPath} name={dao.name} />
                        {dao.featured && (
                            <span className="k-dao-card__badge k-dao-card__badge--featured">
                                FEATURED
                            </span>
                        )}
                        {dao.config?.isArchived && (
                            <span className="k-dao-card__badge k-dao-card__badge--archived">
                                Archived
                            </span>
                        )}
                    </div>
                </div>
                {onRemove && (
                    <button
                        className="k-dao-card__remove"
                        onClick={onRemove}
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

            {/* Stats */}
            {dao.config && (
                <div className="k-dao-card__stats">
                    {(dao.config.memberCount > 0 || dao.config.threshold) && (
                        <div className="k-dao-card__stats-row">
                            {dao.config.memberCount > 0 && <span>{dao.config.memberCount} {dao.config.memberCount === 1 ? "member" : "members"}</span>}
                            {dao.config.threshold && <span>Threshold {dao.config.threshold}</span>}
                        </div>
                    )}

                    {/* Tier distribution badges */}
                    {dao.config.tierDistribution && dao.config.tierDistribution.length > 0 && (
                        <div className="k-dao-card__tiers">
                            {dao.config.tierDistribution.map((t) => {
                                const colors: Record<string, string> = { T1: "var(--color-brand)", T2: "var(--color-info)", T3: "var(--color-accent-gold)" }
                                const color = colors[t.tier] || "var(--color-text-secondary)"
                                return (
                                    <span key={t.tier} className="k-dao-card__tier" style={{ background: `${color}12`, color }}>
                                        <span className="k-dao-card__tier-dot" style={{ background: color }} />
                                        {t.tier}: {t.memberCount} • {t.power} voting power
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
                <span className="k-dao-card__cta-text" aria-hidden="true">Open →</span>
            </div>
        </div>
    )
}
