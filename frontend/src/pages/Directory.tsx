/**
 * Directory Page — Organization Hub for discovering DAOs, Tokens, and Users.
 *
 * v2.2a upgrade: premium design with glassmorphism cards, rich DAO metadata,
 * featured carousel, and proper CSS extraction (no inline styles).
 *
 * Data layer: lib/directory.ts (token/user parsing + cache)
 * Metadata: lib/daoMetadata.ts (DAO Render parsing)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight } from "@phosphor-icons/react"
import { GNO_RPC_URL } from "../lib/config"
import { encodeSlug } from "../lib/daoSlug"
import {
    getDirectoryDAOs,
    fetchTokens,
    fetchUsers,
    type DirectoryToken,
    type DirectoryUser,
} from "../lib/directory"
import { batchGetDAOMetadata, type DAOMetadata } from "../lib/daoMetadata"
import { DAOCard, FeaturedDAOs } from "../components/directory"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import "./directory.css"

type DirectoryTab = "daos" | "tokens" | "users"

export function Directory() {
    const navigate = useNavigate()
    const [tab, setTab] = useState<DirectoryTab>("daos")

    // M6 pattern: page title
    useEffect(() => { document.title = "Directory — Memba" }, [])

    return (
        <div className="dir-page">
            <div className="dir-header">
                <h1>📂 Directory</h1>
                <p>Discover DAOs, tokens, and users on gno.land</p>
            </div>

            <div className="dir-tabs" role="tablist">
                {([
                    { key: "daos" as const, label: "🏛️ DAOs" },
                    { key: "tokens" as const, label: "🪙 Tokens" },
                    { key: "users" as const, label: "👤 Users" },
                ]).map(t => (
                    <button
                        key={t.key}
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

            {tab === "daos" && <DAOsTab navigate={navigate} />}
            {tab === "tokens" && <TokensTab navigate={navigate} />}
            {tab === "users" && <UsersTab navigate={navigate} />}
        </div>
    )
}

// ── DAOs Tab ─────────────────────────────────────────────────

function DAOsTab({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
    const [search, setSearch] = useState("")
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
        search
            ? allDAOs.filter(d =>
                d.name.toLowerCase().includes(search.toLowerCase()) ||
                d.path.toLowerCase().includes(search.toLowerCase()),
            )
            : allDAOs,
        [allDAOs, search])

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Featured carousel */}
            <FeaturedDAOs />

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

function TokensTab({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
    const [tokens, setTokens] = useState<DirectoryToken[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
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
        search
            ? tokens.filter(t =>
                t.name.toLowerCase().includes(search.toLowerCase()) ||
                t.symbol.toLowerCase().includes(search.toLowerCase()),
            )
            : tokens,
        [tokens, search])

    const pageItems = filtered.slice(0, (page + 1) * PAGE_SIZE)
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

function UsersTab({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
    const [users, setUsers] = useState<DirectoryUser[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [page, setPage] = useState(0)
    const PAGE_SIZE = 20
    const fetchedRef = useRef(false)

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try {
            const data = await fetchUsers()
            setUsers(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load users")
        } finally { setLoading(false) }
    }, [])

    useEffect(() => {
        if (!fetchedRef.current) { fetchedRef.current = true; load() }
    }, [load])

    const filtered = useMemo(() =>
        search
            ? users.filter(u =>
                u.name.toLowerCase().includes(search.toLowerCase()) ||
                u.address.includes(search.toLowerCase()),
            )
            : users,
        [users, search])

    const pageItems = filtered.slice(0, (page + 1) * PAGE_SIZE)
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
                        {pageItems.map(u => (
                            <button
                                key={u.address}
                                className="dir-card"
                                onClick={() => navigate(`/profile/${u.address}`)}
                                data-testid="user-card"
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <div className="dir-user-avatar">@</div>
                                    <div className="dir-card-main">
                                        <div className="dir-card-name">@{u.name}</div>
                                        <div className="dir-card-path">
                                            {u.address.length > 20
                                                ? `${u.address.slice(0, 10)}…${u.address.slice(-6)}`
                                                : u.address}
                                        </div>
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
