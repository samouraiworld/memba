/**
 * Directory Page — Organization Hub for discovering DAOs, Tokens, and Users.
 *
 * v2.2a upgrade: premium design with glassmorphism cards, rich DAO metadata,
 * featured carousel, and proper CSS extraction (no inline styles).
 *
 * Data layer: lib/directory.ts (token/user parsing + cache)
 * Metadata: lib/daoMetadata.ts (DAO Render parsing)
 */

import { useNetworkNav } from "../hooks/useNetworkNav"
import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from "react"
import { ArrowRight } from "@phosphor-icons/react"
import { GNO_RPC_URL, GNOLOVE_API_URL, getExplorerBaseUrl } from "../lib/config"
import { encodeSlug } from "../lib/daoSlug"
import {
    getDirectoryDAOs,
    fetchTokens,
    fetchUsers,
    fetchPackages,
    fetchPackagesLive,
    fetchRealms,
    fetchRealmsLive,
    batchFetchUserAvatars,
    calculateContributionScores,
    parseDAOMemberAddresses,
    SEED_DAOS,
    type DirectoryToken,
    type DirectoryUser,
    type ContributionScore,
} from "../lib/directory"
import { getDAOProposals, type DAOProposal } from "../lib/dao"
import { getContributors } from "../lib/gnoloveApi"
import type { TEnhancedUserWithStats } from "../lib/gnoloveSchemas"
import { batchGetDAOMetadata, type DAOMetadata } from "../lib/daoMetadata"
import { queryRender } from "../lib/dao/shared"
import { resolveAvatarUrl } from "../lib/ipfs"
import { DAOCard, FeaturedDAOs, ChainMetricsBanner } from "../components/directory"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import "./directory.css"

type DirectoryTab = "daos" | "tokens" | "users" | "packages" | "realms" | "govdao" | "leaderboard"

export function Directory() {
    const navigate = useNetworkNav()
    const [tab, setTab] = useState<DirectoryTab>("daos")
    const [globalSearch, setGlobalSearch] = useState("")
    const [realmPreview, setRealmPreview] = useState<{ path: string; content: string } | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)

    // M6 pattern: page title
    useEffect(() => { document.title = "Directory — Memba" }, [])

    // Phase 3a: Universal search — attempt qrender for gno.land paths
    const handleGlobalSearch = useCallback(async (query: string) => {
        setGlobalSearch(query)
        setRealmPreview(null)

        if (query.startsWith("gno.land/") && query.length > 12) {
            setPreviewLoading(true)
            try {
                const raw = await queryRender(GNO_RPC_URL, query, "")
                if (raw && !raw.includes("404")) {
                    setRealmPreview({ path: query, content: raw.slice(0, 500) })
                }
            } catch { /* not a valid realm */ }
            setPreviewLoading(false)
        }
    }, [])

    return (
        <div className="dir-page">
            <div className="dir-header">
                <h1>📂 Directory</h1>
                <p>Discover DAOs, tokens, packages, realms, and users on gno.land</p>
            </div>

            {/* Phase 3a: Live chain metrics */}
            <ChainMetricsBanner />

            {/* Phase 3a: Universal search */}
            <input
                type="text"
                placeholder="Search across all tabs or enter a gno.land/ path..."
                value={globalSearch}
                onChange={e => handleGlobalSearch(e.target.value)}
                className="dir-search dir-search--global"
                data-testid="global-search"
            />

            {/* Realm path preview */}
            {previewLoading && (
                <div className="k-shimmer" style={{ height: 48, borderRadius: 8, background: "#111" }} />
            )}
            {realmPreview && (
                <a
                    className="dir-realm-preview"
                    href={`${getExplorerBaseUrl()}/${realmPreview.path.replace("gno.land/", "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <div className="dir-realm-preview__path">{realmPreview.path}</div>
                    <pre className="dir-realm-preview__content">{realmPreview.content}</pre>
                </a>
            )}

            <div className="dir-tabs" role="tablist">
                {([
                    { key: "daos" as const, label: "🏛️ DAOs" },
                    { key: "tokens" as const, label: "🪙 Tokens" },
                    { key: "packages" as const, label: "📦 Packages" },
                    { key: "realms" as const, label: "🌐 Realms" },
                    { key: "users" as const, label: "👤 Users" },
                    { key: "govdao" as const, label: "🏛️ GovDAO" },
                    { key: "leaderboard" as const, label: "🏆 Leaderboard" },
                ]).map(t => (
                    <button
                        key={t.key}
                        id={`tab-${t.key}`}
                        className="dir-tab"
                        role="tab"
                        aria-selected={tab === t.key}
                        data-active={tab === t.key}
                        onClick={() => setTab(t.key)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* M2 audit fix: tabpanel role + aria-labelledby for complete ARIA pattern */}
            <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
                {tab === "daos" && <DAOsTab navigate={navigate} />}
                {tab === "tokens" && <TokensTab navigate={navigate} />}
                {tab === "packages" && <PackagesTab />}
                {tab === "realms" && <RealmsTab />}
                {tab === "users" && <UsersTab navigate={navigate} />}
                {tab === "govdao" && <GovDAOTab navigate={navigate} />}
                {tab === "leaderboard" && <LeaderboardTab navigate={navigate} />}
            </div>
        </div>
    )
}

// ── DAOs Tab ─────────────────────────────────────────────────

function DAOsTab({ navigate }: { navigate: ReturnType<typeof useNetworkNav> }) {
    const [search, setSearch] = useState("")
    // I2 audit fix: useDeferredValue for search — smooth typing with large datasets
    const deferredSearch = useDeferredValue(search)
    const [daoRefreshKey, setDaoRefreshKey] = useState(0)
    const [metadata, setMetadata] = useState<Map<string, DAOMetadata>>(new Map())

    // daoRefreshKey forces recalculation when user saves a DAO
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const allDAOs = useMemo(() => getDirectoryDAOs(), [daoRefreshKey])

    // Fetch metadata for all DAOs on mount
    useEffect(() => {
        const paths = allDAOs.map(d => d.path)
        batchGetDAOMetadata(GNO_RPC_URL, paths)
            .then(setMetadata)
            .catch(() => { /* best-effort */ })
    }, [allDAOs])

    const filtered = useMemo(() =>
        deferredSearch
            ? allDAOs.filter(d =>
                d.name.toLowerCase().includes(deferredSearch.toLowerCase()) ||
                d.path.toLowerCase().includes(deferredSearch.toLowerCase()),
            )
            : allDAOs,
        [allDAOs, deferredSearch])

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* I1 audit fix: pass metadata from parent to avoid duplicate RPC calls */}
            <FeaturedDAOs metadata={metadata} />

            <input
                type="text"
                placeholder="Search DAOs..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="dir-search"
                data-testid="dao-search"
            />

            {filtered.length === 0 ? (
                <div className="dir-empty">
                    <p>{search ? `No DAOs matching "${search}"` : "No DAOs found"}</p>
                </div>
            ) : (
                <div className="dir-grid">
                    {filtered.map(dao => (
                        <DAOCard
                            key={dao.path}
                            name={dao.name}
                            path={dao.path}
                            isSaved={dao.isSaved}
                            category={dao.category}
                            metadata={metadata.get(dao.path)}
                            onClick={() => navigate(`/dao/${encodeSlug(dao.path)}`)}
                            onSave={() => setDaoRefreshKey(k => k + 1)}
                        />
                    ))}
                </div>
            )}

            <div className="dir-actions">
                <button
                    className="k-btn-primary"
                    style={{ fontSize: 11, padding: "6px 14px" }}
                    onClick={() => navigate("/dao/create")}
                >
                    + Create DAO
                </button>
            </div>
        </div>
    )
}

// ── Tokens Tab ───────────────────────────────────────────────

function TokensTab({ navigate }: { navigate: ReturnType<typeof useNetworkNav> }) {
    const [tokens, setTokens] = useState<DirectoryToken[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const [error, setError] = useState<string | null>(null)
    const [page, setPage] = useState(0)
    const PAGE_SIZE = 20

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try {
            const data = await fetchTokens()
            setTokens(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load tokens")
        } finally { setLoading(false) }
    }, [])

    useEffect(() => { load() }, [load])

    const filtered = useMemo(() =>
        deferredSearch
            ? tokens.filter(t =>
                t.name.toLowerCase().includes(deferredSearch.toLowerCase()) ||
                t.symbol.toLowerCase().includes(deferredSearch.toLowerCase()),
            )
            : tokens,
        [tokens, deferredSearch])

    // M1 audit fix: memoize pageItems to avoid new array on every render
    const pageItems = useMemo(() => filtered.slice(0, (page + 1) * PAGE_SIZE), [filtered, page])
    const hasMore = pageItems.length < filtered.length

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input
                type="text"
                placeholder="Search tokens by name or symbol..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0) }}
                className="dir-search"
                data-testid="token-search"
            />

            {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : error ? (
                <div className="dir-error">
                    <p>{error}</p>
                    <button className="k-btn-secondary" onClick={load} style={{ fontSize: 11, marginTop: 8 }}>Retry</button>
                </div>
            ) : filtered.length === 0 ? (
                <div className="dir-empty">
                    <p>{search ? `No tokens matching "${search}"` : "No tokens registered"}</p>
                </div>
            ) : (
                <>
                    <div className="dir-count">
                        {filtered.length} token{filtered.length !== 1 ? "s" : ""} found
                    </div>
                    <div className="dir-grid">
                        {pageItems.map(t => (
                            <button
                                key={t.path || t.slug}
                                className="dir-card"
                                onClick={() => navigate(`/tokens/${t.symbol}`)}
                                data-testid="token-card"
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                                    <div className="dir-token-avatar">{t.symbol.charAt(0)}</div>
                                    <div className="dir-card-main">
                                        <div className="dir-card-name">{t.name}</div>
                                        <div className="dir-token-symbol">${t.symbol}</div>
                                    </div>
                                </div>
                                <ArrowRight size={14} className="dir-arrow" />
                            </button>
                        ))}
                    </div>
                    {hasMore && (
                        <button
                            className="k-btn-secondary dir-load-more"
                            onClick={() => setPage(p => p + 1)}
                        >
                            Load More ({filtered.length - pageItems.length} remaining)
                        </button>
                    )}
                </>
            )}
        </div>
    )
}

// ── Users Tab ────────────────────────────────────────────────

function UsersTab({ navigate }: { navigate: ReturnType<typeof useNetworkNav> }) {
    const [users, setUsers] = useState<DirectoryUser[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const [error, setError] = useState<string | null>(null)
    const [page, setPage] = useState(0)
    const [scores, setScores] = useState<Map<string, ContributionScore>>(new Map())
    const [avatarMap, setAvatarMap] = useState<Map<string, string>>(new Map())
    const PAGE_SIZE = 20
    const fetchedRef = useRef(false)

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try {
            const data = await fetchUsers()
            setUsers(data)

            // Fetch DAO member data for contribution scoring (best-effort)
            const memberMap = new Map<string, string[]>()
            // M3 fix: _settled naming convention for unused await result
            const _settled = await Promise.allSettled(
                SEED_DAOS.map(async dao => {
                    const raw = await queryRender(GNO_RPC_URL, dao.path, "")
                    if (raw) memberMap.set(dao.path, parseDAOMemberAddresses(raw))
                }),
            )
            void _settled // TypeScript requires reference
            if (memberMap.size > 0) {
                setScores(calculateContributionScores(data, memberMap))
            }

            // Fetch avatars for visible users (best-effort, capped at 10)
            const visibleAddrs = data.slice(0, PAGE_SIZE).map(u => u.address)
            const avatars = await batchFetchUserAvatars(visibleAddrs, GNOLOVE_API_URL)
            if (avatars.size > 0) setAvatarMap(avatars)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load users")
        } finally { setLoading(false) }
    }, [])

    useEffect(() => {
        if (!fetchedRef.current) { fetchedRef.current = true; load() }
    }, [load])

    const filtered = useMemo(() =>
        deferredSearch
            ? users.filter(u =>
                u.name.toLowerCase().includes(deferredSearch.toLowerCase()) ||
                u.address.includes(deferredSearch.toLowerCase()),
            )
            : users,
        [users, deferredSearch])

    const pageItems = useMemo(() => filtered.slice(0, (page + 1) * PAGE_SIZE), [filtered, page])
    const hasMore = pageItems.length < filtered.length

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input
                type="text"
                placeholder="Search by name or address..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0) }}
                className="dir-search"
                data-testid="user-search"
            />

            {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : error ? (
                <div className="dir-error">
                    <p>{error}</p>
                    <button className="k-btn-secondary" onClick={load} style={{ fontSize: 11, marginTop: 8 }}>Retry</button>
                </div>
            ) : filtered.length === 0 ? (
                <div className="dir-empty">
                    <p>{search ? `No users matching "${search}"` : "No registered users found"}</p>
                </div>
            ) : (
                <>
                    <div className="dir-count">
                        {filtered.length} user{filtered.length !== 1 ? "s" : ""} found
                    </div>
                    <div className="dir-user-list">
                        {pageItems.map(u => {
                            const score = scores.get(u.address)
                            return (
                                <button
                                    key={u.address}
                                    className="dir-card"
                                    onClick={() => navigate(`/profile/${u.address}`)}
                                    data-testid="user-card"
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <div className="dir-user-avatar">
                                            {avatarMap.get(u.address)
                                                ? <img src={resolveAvatarUrl(avatarMap.get(u.address)!)} alt={u.name} />
                                                : u.name.charAt(0)
                                            }
                                        </div>
                                        <div className="dir-card-main">
                                            <div className="dir-card-name">
                                                @{u.name}
                                                {score && score.daoCount > 0 && (
                                                    <span
                                                        className={`dir-inline-badge dir-activity-badge dir-activity-${score.level}`}
                                                        title={`Member of ${score.daoCount} DAO${score.daoCount !== 1 ? "s" : ""}`}
                                                        data-testid="user-score"
                                                    >
                                                        {score.level === "active" ? "⭐" : score.level === "moderate" ? "🔹" : "🔸"}
                                                        {score.daoCount} DAO{score.daoCount !== 1 ? "s" : ""}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="dir-card-path">
                                                {u.address.length > 20
                                                    ? `${u.address.slice(0, 10)}…${u.address.slice(-6)}`
                                                    : u.address}
                                            </div>
                                        </div>
                                    </div>
                                    <ArrowRight size={14} className="dir-arrow" />
                                </button>
                            )
                        })}
                    </div>
                    {hasMore && (
                        <button
                            className="k-btn-secondary dir-load-more"
                            onClick={() => setPage(p => p + 1)}
                        >
                            Load More ({filtered.length - pageItems.length} remaining)
                        </button>
                    )}
                </>
            )}
        </div>
    )
}

// ── Packages Tab ─────────────────────────────────────────────

function PackagesTab() {
    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const [packages, setPackages] = useState(() => fetchPackages())

    // Phase 3c: fetch live packages on mount
    useEffect(() => {
        fetchPackagesLive().then(setPackages)
    }, [])

    const filtered = useMemo(() =>
        deferredSearch
            ? packages.filter(p =>
                p.name.toLowerCase().includes(deferredSearch.toLowerCase()) ||
                p.path.toLowerCase().includes(deferredSearch.toLowerCase()) ||
                p.description.toLowerCase().includes(deferredSearch.toLowerCase()),
            )
            : packages,
        [packages, deferredSearch])

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input
                type="text"
                placeholder="Search packages by name or path..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="dir-search"
                data-testid="package-search"
            />

            <div className="dir-count">
                {filtered.length} package{filtered.length !== 1 ? "s" : ""} found
            </div>

            {filtered.length === 0 ? (
                <div className="dir-empty">
                    <p>{search ? `No packages matching "${search}"` : "No packages found"}</p>
                </div>
            ) : (
                <div className="dir-grid">
                    {filtered.map(p => (
                        <a
                            key={p.path}
                            className="dir-card"
                            href={`${getExplorerBaseUrl()}/${p.path.replace("gno.land/", "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="package-card"
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                                <div className="dir-token-avatar" style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
                                    📦
                                </div>
                                <div className="dir-card-main">
                                    <div className="dir-card-name">
                                        {p.name}
                                        {p.deploymentStatus === "live" && (
                                            <span className="dir-inline-badge dir-inline-badge--live">Live</span>
                                        )}
                                    </div>
                                    <div className="dir-card-path">{p.path}</div>
                                    <div className="dir-card-desc">{p.description}</div>
                                </div>
                            </div>
                            <div className="dir-card-actions">
                                {p.gnowebUrl && (
                                    <a
                                        href={p.gnowebUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="dir-gnoweb-link"
                                        onClick={e => e.stopPropagation()}
                                        title="View on gnoweb"
                                    >
                                        gnoweb
                                    </a>
                                )}
                                <ArrowRight size={14} className="dir-arrow" />
                            </div>
                        </a>
                    ))}
                </div>
            )}
        </div>
    )
}

// ── Realms Tab ───────────────────────────────────────────────

const REALM_CATEGORY_COLORS: Record<string, string> = {
    standard: "#00d4aa",
    defi: "#f59e0b",
    social: "#8b5cf6",
    utility: "#3b82f6",
    game: "#ef4444",
    unknown: "#666",
}

function RealmsTab() {
    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const [categoryFilter, setCategoryFilter] = useState<string>("all")
    // Phase 3b: Realm Render() preview
    const [expandedRealm, setExpandedRealm] = useState<string | null>(null)
    const [realmRender, setRealmRender] = useState<string | null>(null)
    const [renderLoading, setRenderLoading] = useState(false)

    const handleRealmClick = useCallback(async (path: string) => {
        if (expandedRealm === path) {
            setExpandedRealm(null)
            setRealmRender(null)
            return
        }
        setExpandedRealm(path)
        setRealmRender(null)
        setRenderLoading(true)
        try {
            const raw = await queryRender(GNO_RPC_URL, path, "")
            setRealmRender(raw && !raw.includes("404") ? raw.slice(0, 1000) : "No Render() output available.")
        } catch {
            setRealmRender("Failed to fetch Render() output.")
        }
        setRenderLoading(false)
    }, [expandedRealm])

    const [realms, setRealms] = useState(() => fetchRealms())

    // Phase 3c: fetch live realms on mount
    useEffect(() => {
        fetchRealmsLive().then(setRealms)
    }, [])

    const categories = useMemo(() => {
        const cats = new Set(realms.map(r => r.category))
        return ["all", ...Array.from(cats).sort()]
    }, [realms])

    const filtered = useMemo(() => {
        let result = realms
        if (categoryFilter !== "all") {
            result = result.filter(r => r.category === categoryFilter)
        }
        if (deferredSearch) {
            const q = deferredSearch.toLowerCase()
            result = result.filter(r =>
                r.name.toLowerCase().includes(q) ||
                r.path.toLowerCase().includes(q) ||
                r.description.toLowerCase().includes(q),
            )
        }
        return result
    }, [realms, categoryFilter, deferredSearch])

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input
                type="text"
                placeholder="Search realms by name or path..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="dir-search"
                data-testid="realm-search"
            />

            {/* Category filter pills */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {categories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setCategoryFilter(cat)}
                        className="dir-category-pill"
                        data-active={categoryFilter === cat}
                        style={{
                            borderColor: categoryFilter === cat
                                ? (REALM_CATEGORY_COLORS[cat] || "#444")
                                : undefined,
                            color: categoryFilter === cat
                                ? (REALM_CATEGORY_COLORS[cat] || "#888")
                                : undefined,
                        }}
                    >
                        {cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </button>
                ))}
            </div>

            <div className="dir-count">
                {filtered.length} realm{filtered.length !== 1 ? "s" : ""} found
            </div>

            {filtered.length === 0 ? (
                <div className="dir-empty">
                    <p>{search ? `No realms matching "${search}"` : "No realms found"}</p>
                </div>
            ) : (
                <div className="dir-grid">
                    {filtered.map(r => (
                        <div key={r.path} className={`dir-card dir-card--expandable${expandedRealm === r.path ? " expanded" : ""}`} data-testid="realm-card">
                            <button
                                className="dir-card__header"
                                onClick={() => handleRealmClick(r.path)}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                                    <div className="dir-token-avatar" style={{
                                        background: `${REALM_CATEGORY_COLORS[r.category] || "#666"}15`,
                                        color: REALM_CATEGORY_COLORS[r.category] || "#666",
                                    }}>
                                        🌐
                                    </div>
                                    <div className="dir-card-main">
                                        <div className="dir-card-name">
                                            {r.name}
                                            <span
                                                className="dir-inline-badge"
                                                style={{
                                                    background: `${REALM_CATEGORY_COLORS[r.category] || "#666"}15`,
                                                    color: REALM_CATEGORY_COLORS[r.category] || "#666",
                                                }}
                                            >
                                                {r.category}
                                            </span>
                                            {r.deploymentStatus === "live" && (
                                                <span className="dir-inline-badge dir-inline-badge--live">Live</span>
                                            )}
                                        </div>
                                        <div className="dir-card-path">{r.path}</div>
                                        <div className="dir-card-desc">{r.description}</div>
                                    </div>
                                </div>
                                <span className={`dir-expand-icon${expandedRealm === r.path ? " open" : ""}`}>▶</span>
                            </button>
                            {expandedRealm === r.path && (
                                <div className="dir-render-preview">
                                    {renderLoading ? (
                                        <div className="k-shimmer" style={{ height: 40, borderRadius: 6, background: "#111" }} />
                                    ) : (
                                        <>
                                            <pre className="dir-render-preview__content">{realmRender}</pre>
                                            <div className="dir-render-preview__links">
                                                <a
                                                    href={`${getExplorerBaseUrl()}/${r.path.replace("gno.land/", "")}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="dir-render-preview__link"
                                                >
                                                    View on Explorer →
                                                </a>
                                                {r.gnowebUrl && (
                                                    <a
                                                        href={r.gnowebUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="dir-render-preview__link"
                                                    >
                                                        View on gnoweb →
                                                    </a>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ── GovDAO Tab ──────────────────────────────────────────────

const GOVDAO_PATH = "gno.land/r/gov/dao"

function GovDAOTab({ navigate }: { navigate: ReturnType<typeof useNetworkNav> }) {
    const [proposals, setProposals] = useState<DAOProposal[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        getDAOProposals(GNO_RPC_URL, GOVDAO_PATH)
            .then(p => { if (!cancelled) setProposals(p.slice(0, 20)) })
            .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load GovDAO proposals") })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [])

    const statusColor = (s: string) => {
        if (s === "open") return "#00d4aa"
        if (s === "passed") return "#f59e0b"
        if (s === "executed") return "#3b82f6"
        if (s === "failed" || s === "rejected") return "#ef4444"
        return "#666"
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="dir-govdao-header">
                <div>
                    <h3 className="dir-govdao-title">GovDAO Proposals</h3>
                    <p className="dir-govdao-desc">Latest governance proposals from gno.land chain-level DAO</p>
                </div>
                <button
                    className="k-btn-primary"
                    style={{ fontSize: 11, padding: "6px 14px", whiteSpace: "nowrap" }}
                    onClick={() => navigate(`/dao/${encodeSlug(GOVDAO_PATH)}`)}
                >
                    Open GovDAO →
                </button>
            </div>

            {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : error ? (
                <div className="dir-error"><p>{error}</p></div>
            ) : proposals.length === 0 ? (
                <div className="dir-empty"><p>No proposals found</p></div>
            ) : (
                <div className="dir-govdao-list">
                    {proposals.map(p => (
                        <button
                            key={p.id}
                            className="dir-govdao-card"
                            onClick={() => navigate(`/dao/${encodeSlug(GOVDAO_PATH)}/proposal/${p.id}`)}
                        >
                            <div className="dir-govdao-card__id">#{p.id}</div>
                            <div className="dir-govdao-card__main">
                                <div className="dir-govdao-card__title">{p.title}</div>
                                <div className="dir-govdao-card__meta">
                                    <span
                                        className="dir-govdao-status"
                                        style={{ color: statusColor(p.status), borderColor: `${statusColor(p.status)}33` }}
                                    >
                                        {p.status}
                                    </span>
                                    {p.yesVotes + p.noVotes > 0 && (
                                        <span className="dir-govdao-votes">
                                            ✓ {p.yesVotes} / ✗ {p.noVotes}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <ArrowRight size={14} className="dir-arrow" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// ── Leaderboard Tab ─────────────────────────────────────────

function LeaderboardTab({ navigate }: { navigate: ReturnType<typeof useNetworkNav> }) {
    const [contributors, setContributors] = useState<TEnhancedUserWithStats[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        getContributors()
            .then(res => { if (!cancelled) setContributors(res?.users?.slice(0, 20) || []) })
            .catch(() => { if (!cancelled) setContributors([]) })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [])

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="dir-govdao-header">
                <div>
                    <h3 className="dir-govdao-title">Top Contributors</h3>
                    <p className="dir-govdao-desc">Most active Gno ecosystem contributors tracked by gnolove</p>
                </div>
                <button
                    className="k-btn-primary"
                    style={{ fontSize: 11, padding: "6px 14px", whiteSpace: "nowrap" }}
                    onClick={() => navigate("/gnolove")}
                >
                    Full Leaderboard →
                </button>
            </div>

            {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : contributors.length === 0 ? (
                <div className="dir-empty"><p>No contributor data available</p></div>
            ) : (
                <div className="dir-govdao-list">
                    {contributors.map((c, i) => (
                        <button
                            key={c.login}
                            className="dir-govdao-card"
                            onClick={() => navigate(`/gnolove`)}
                        >
                            <div className="dir-lb-rank">#{i + 1}</div>
                            <img
                                src={c.avatarUrl}
                                alt={c.login}
                                className="dir-lb-avatar"
                            />
                            <div className="dir-govdao-card__main">
                                <div className="dir-govdao-card__title">
                                    {c.name || c.login}
                                </div>
                                <div className="dir-govdao-card__meta">
                                    <span className="dir-govdao-votes">
                                        {c.TotalCommits} commits · {c.TotalPrs} PRs · {c.TotalIssues} issues
                                    </span>
                                </div>
                            </div>
                            <div className="dir-lb-score">
                                {c.score}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
