/**
 * Directory Page — Central hub for discovering DAOs, Tokens, and Users.
 *
 * Queries on-chain registries via ABCI:
 * - DAOs: Hardcoded seed list + user's saved DAOs
 * - Tokens: gno.land/r/demo/grc20reg GRC20 registry
 * - Users: gno.land/r/demo/users namespace registry
 *
 * Client-side caching (5-minute TTL). Pagination via "Load More".
 *
 * v2.0.0-alpha.1 (Sprint C, Step 11)
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { GNO_RPC_URL } from "../lib/config"
import { encodeSlug, getSavedDAOs } from "../lib/daoSlug"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"

type DirectoryTab = "daos" | "tokens" | "users"

// ── ABCI query helper (with 1 retry for flaky RPC) ───────────────
async function queryRender(rpcUrl: string, path: string, args: string = ""): Promise<string> {
    const url = `${rpcUrl}/abci_query?path="vm/qrender"&data="${path}:${args}"`
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(url)
            const json = await res.json()
            const raw = json?.result?.response?.ResponseBase?.Data
            if (!raw) return ""
            try { return atob(raw) } catch { return raw }
        } catch (err) {
            if (attempt === 0) {
                await new Promise(r => setTimeout(r, 2000))
                continue
            }
            throw err
        }
    }
    return ""
}

// ── Known seed DAOs ──────────────────────────────────────────────
const SEED_DAOS = [
    { name: "GovDAO", path: "gno.land/r/gov/dao" },
    { name: "Worx DAO", path: "gno.land/r/demo/worx" },
]

// ── Token entry ──────────────────────────────────────────────────
interface TokenEntry { slug: string; name: string; symbol: string; path: string }
interface UserEntry { name: string; address: string }

// ── Cache ────────────────────────────────────────────────────────
const cache: Record<string, { data: unknown; ts: number }> = {}
const CACHE_TTL = 5 * 60 * 1000

function getCached<T>(key: string): T | null {
    const entry = cache[key]
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data as T
    return null
}

function setCache(key: string, data: unknown) {
    cache[key] = { data, ts: Date.now() }
}

export function Directory() {
    const navigate = useNavigate()
    const [tab, setTab] = useState<DirectoryTab>("daos")

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Header */}
            <div>
                <h2 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>
                    📂 Directory
                </h2>
                <p style={{ color: "#666", fontSize: 12, fontFamily: "JetBrains Mono, monospace", marginTop: 4 }}>
                    Discover DAOs, tokens, and users on gno.land
                </p>
            </div>

            {/* Tab bar */}
            <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #1a1a1a", paddingBottom: 0, overflowX: "auto" }}>
                {([
                    { key: "daos" as const, label: "🏛️ DAOs", emoji: "🏛️" },
                    { key: "tokens" as const, label: "🪙 Tokens", emoji: "🪙" },
                    { key: "users" as const, label: "👤 Users", emoji: "👤" },
                ]).map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        style={{
                            padding: "10px 18px", fontSize: 12,
                            fontFamily: "JetBrains Mono, monospace", fontWeight: 500,
                            background: "none", border: "none", cursor: "pointer",
                            color: tab === t.key ? "#00d4aa" : "#666",
                            borderBottom: tab === t.key ? "2px solid #00d4aa" : "2px solid transparent",
                            transition: "color 0.15s, border-color 0.15s",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            {tab === "daos" && <DAOsTab navigate={navigate} />}
            {tab === "tokens" && <TokensTab navigate={navigate} />}
            {tab === "users" && <UsersTab navigate={navigate} />}
        </div>
    )
}

// ── DAOs Tab ─────────────────────────────────────────────────────
function DAOsTab({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
    const [search, setSearch] = useState("")
    const savedDAOs = getSavedDAOs()

    // Merge seed + saved (deduplicate by path)
    const allDAOs = [...SEED_DAOS]
    for (const dao of savedDAOs) {
        if (!allDAOs.some(d => d.path === dao.realmPath)) {
            allDAOs.push({ name: dao.name, path: dao.realmPath })
        }
    }

    const filtered = search
        ? allDAOs.filter(d => d.name.toLowerCase().includes(search.toLowerCase()) || d.path.toLowerCase().includes(search.toLowerCase()))
        : allDAOs

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input
                type="text" placeholder="Search DAOs..."
                value={search} onChange={e => setSearch(e.target.value)}
                style={{
                    padding: "8px 14px", borderRadius: 8, border: "1px solid #1a1a1a",
                    background: "#0d0d0d", color: "#f0f0f0", fontSize: 12,
                    fontFamily: "JetBrains Mono, monospace", outline: "none",
                }}
                onFocus={e => e.currentTarget.style.borderColor = "rgba(0,212,170,0.3)"}
                onBlur={e => e.currentTarget.style.borderColor = "#1a1a1a"}
            />

            {filtered.length === 0 ? (
                <div className="k-dashed" style={{ padding: 28, textAlign: "center" }}>
                    <p style={{ color: "#555", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                        {search ? `No DAOs matching "${search}"` : "No DAOs found"}
                    </p>
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                    {filtered.map(dao => {
                        const isSaved = savedDAOs.some(s => s.realmPath === dao.path)
                        return (
                            <button
                                key={dao.path}
                                className="k-card"
                                onClick={() => navigate(`/dao/${encodeSlug(dao.path)}`)}
                                style={{
                                    padding: "14px 18px", cursor: "pointer", textAlign: "left", width: "100%",
                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                    border: "1px solid #1a1a1a", transition: "border-color 0.15s",
                                }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(0,212,170,0.2)"}
                                onMouseLeave={e => e.currentTarget.style.borderColor = "#1a1a1a"}
                            >
                                <div>
                                    <div style={{ fontSize: 13, fontWeight: 500, color: "#f0f0f0" }}>{dao.name}</div>
                                    <div style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#555", marginTop: 2 }}>
                                        {dao.path}
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                    {isSaved && (
                                        <span style={{
                                            fontSize: 9, padding: "2px 6px", borderRadius: 3,
                                            background: "rgba(0,212,170,0.08)", color: "#00d4aa",
                                            fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                        }}>SAVED</span>
                                    )}
                                    <span style={{ color: "#333", fontSize: 12 }}>→</span>
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button className="k-btn-primary" style={{ fontSize: 11, padding: "6px 14px" }} onClick={() => navigate("/dao/create")}>
                    + Create DAO
                </button>
            </div>
        </div>
    )
}

// ── Tokens Tab ───────────────────────────────────────────────────
function TokensTab({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
    const [tokens, setTokens] = useState<TokenEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [page, setPage] = useState(0)
    const PAGE_SIZE = 20

    const load = useCallback(async () => {
        const cached = getCached<TokenEntry[]>("tokens")
        if (cached) { setTokens(cached); setLoading(false); return }

        setLoading(true); setError(null)
        try {
            const raw = await queryRender(GNO_RPC_URL, "gno.land/r/demo/grc20reg")
            const entries: TokenEntry[] = []
            // Parse markdown table: | slug | name | symbol | path |
            const lines = raw.split("\n").filter(l => l.startsWith("|") && !l.startsWith("| slug") && !l.startsWith("|---"))
            for (const line of lines) {
                const cols = line.split("|").map(c => c.trim()).filter(Boolean)
                if (cols.length >= 4) {
                    // Extract path from markdown link if present: [text](/path)
                    const pathMatch = cols[3].match(/\[.*?\]\((.*?)\)/)
                    entries.push({
                        slug: cols[0],
                        name: cols[1],
                        symbol: cols[2],
                        path: pathMatch ? pathMatch[1] : cols[3],
                    })
                }
            }
            setTokens(entries)
            setCache("tokens", entries)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load tokens")
        } finally { setLoading(false) }
    }, [])

    useEffect(() => { load() }, [load])

    const filtered = search
        ? tokens.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || t.symbol.toLowerCase().includes(search.toLowerCase()))
        : tokens

    const pageItems = filtered.slice(0, (page + 1) * PAGE_SIZE)
    const hasMore = pageItems.length < filtered.length

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input
                type="text" placeholder="Search tokens by name or symbol..."
                value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
                style={{
                    padding: "8px 14px", borderRadius: 8, border: "1px solid #1a1a1a",
                    background: "#0d0d0d", color: "#f0f0f0", fontSize: 12,
                    fontFamily: "JetBrains Mono, monospace", outline: "none",
                }}
                onFocus={e => e.currentTarget.style.borderColor = "rgba(0,212,170,0.3)"}
                onBlur={e => e.currentTarget.style.borderColor = "#1a1a1a"}
            />

            {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : error ? (
                <div className="k-card" style={{ padding: 24, textAlign: "center" }}>
                    <p style={{ color: "#ef4444", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>{error}</p>
                    <button className="k-btn-secondary" onClick={load} style={{ fontSize: 11, marginTop: 8 }}>Retry</button>
                </div>
            ) : filtered.length === 0 ? (
                <div className="k-dashed" style={{ padding: 28, textAlign: "center" }}>
                    <p style={{ color: "#555", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                        {search ? `No tokens matching "${search}"` : "No tokens registered"}
                    </p>
                </div>
            ) : (
                <>
                    <div style={{ fontSize: 10, color: "#444", fontFamily: "JetBrains Mono, monospace" }}>
                        {filtered.length} token{filtered.length !== 1 ? "s" : ""} found
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8 }}>
                        {pageItems.map(t => (
                            <button
                                key={t.path || t.slug}
                                className="k-card"
                                onClick={() => navigate(`/tokens/${t.symbol}`)}
                                style={{
                                    padding: "12px 16px", cursor: "pointer", textAlign: "left", width: "100%",
                                    display: "flex", alignItems: "center", gap: 12,
                                    border: "1px solid #1a1a1a", transition: "border-color 0.15s",
                                }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(0,212,170,0.2)"}
                                onMouseLeave={e => e.currentTarget.style.borderColor = "#1a1a1a"}
                            >
                                <div style={{
                                    width: 36, height: 36, borderRadius: "50%",
                                    background: "rgba(0,212,170,0.06)", border: "1px solid rgba(0,212,170,0.12)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: 14, fontWeight: 700, color: "#00d4aa", flexShrink: 0,
                                }}>
                                    {t.symbol.charAt(0)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 500, color: "#f0f0f0" }}>
                                        {t.name}
                                    </div>
                                    <div style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#555", marginTop: 1 }}>
                                        ${t.symbol}
                                    </div>
                                </div>
                                <span style={{ color: "#333", fontSize: 12 }}>→</span>
                            </button>
                        ))}
                    </div>
                    {hasMore && (
                        <button
                            className="k-btn-secondary"
                            onClick={() => setPage(p => p + 1)}
                            style={{ fontSize: 11, padding: "8px 16px", alignSelf: "center" }}
                        >
                            Load More ({filtered.length - pageItems.length} remaining)
                        </button>
                    )}
                </>
            )}
        </div>
    )
}

// ── Users Tab ────────────────────────────────────────────────────
function UsersTab({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
    const [users, setUsers] = useState<UserEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [page, setPage] = useState(0)
    const PAGE_SIZE = 20
    const fetchedRef = useRef(false)

    const load = useCallback(async () => {
        const cached = getCached<UserEntry[]>("users")
        if (cached) { setUsers(cached); setLoading(false); return }

        setLoading(true); setError(null)
        try {
            const raw = await queryRender(GNO_RPC_URL, "gno.land/r/demo/users")
            const entries: UserEntry[] = []
            // Parse: "* [username](link) - address" format
            const lines = raw.split("\n")
            for (const line of lines) {
                const match = line.match(/\*\s*\[([^\]]+)\]\([^)]*\)\s*-?\s*(`?)([a-z0-9]+)\2/)
                if (match) {
                    entries.push({ name: match[1], address: match[3] })
                } else {
                    // Try simpler format: "* username - address"
                    const simple = line.match(/\*\s*(\S+)\s+(\S+)/)
                    if (simple && simple[2].startsWith("g1")) {
                        entries.push({ name: simple[1], address: simple[2] })
                    }
                }
            }
            setUsers(entries)
            setCache("users", entries)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load users")
        } finally { setLoading(false) }
    }, [])

    useEffect(() => {
        if (!fetchedRef.current) { fetchedRef.current = true; load() }
    }, [load])

    const filtered = search
        ? users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()) || u.address.includes(search.toLowerCase()))
        : users

    const pageItems = filtered.slice(0, (page + 1) * PAGE_SIZE)
    const hasMore = pageItems.length < filtered.length

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input
                type="text" placeholder="Search by name or address..."
                value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
                style={{
                    padding: "8px 14px", borderRadius: 8, border: "1px solid #1a1a1a",
                    background: "#0d0d0d", color: "#f0f0f0", fontSize: 12,
                    fontFamily: "JetBrains Mono, monospace", outline: "none",
                }}
                onFocus={e => e.currentTarget.style.borderColor = "rgba(0,212,170,0.3)"}
                onBlur={e => e.currentTarget.style.borderColor = "#1a1a1a"}
            />

            {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : error ? (
                <div className="k-card" style={{ padding: 24, textAlign: "center" }}>
                    <p style={{ color: "#ef4444", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>{error}</p>
                    <button className="k-btn-secondary" onClick={load} style={{ fontSize: 11, marginTop: 8 }}>Retry</button>
                </div>
            ) : filtered.length === 0 ? (
                <div className="k-dashed" style={{ padding: 28, textAlign: "center" }}>
                    <p style={{ color: "#555", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                        {search ? `No users matching "${search}"` : "No registered users found"}
                    </p>
                </div>
            ) : (
                <>
                    <div style={{ fontSize: 10, color: "#444", fontFamily: "JetBrains Mono, monospace" }}>
                        {filtered.length} user{filtered.length !== 1 ? "s" : ""} found
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {pageItems.map(u => (
                            <button
                                key={u.address}
                                className="k-card"
                                onClick={() => navigate(`/profile/${u.address}`)}
                                style={{
                                    padding: "10px 14px", cursor: "pointer", textAlign: "left", width: "100%",
                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                    border: "1px solid #1a1a1a", transition: "border-color 0.15s",
                                }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(0,212,170,0.2)"}
                                onMouseLeave={e => e.currentTarget.style.borderColor = "#1a1a1a"}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <div style={{
                                        width: 32, height: 32, borderRadius: "50%",
                                        background: "rgba(123,97,255,0.08)", border: "1px solid rgba(123,97,255,0.15)",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        fontSize: 14, color: "#7b61ff",
                                    }}>
                                        @
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 13, fontWeight: 500, color: "#f0f0f0" }}>
                                            @{u.name}
                                        </div>
                                        <div style={{
                                            fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                                            color: "#555", marginTop: 1,
                                        }}>
                                            {u.address.length > 20 ? `${u.address.slice(0, 10)}…${u.address.slice(-6)}` : u.address}
                                        </div>
                                    </div>
                                </div>
                                <span style={{ color: "#333", fontSize: 12 }}>→</span>
                            </button>
                        ))}
                    </div>
                    {hasMore && (
                        <button
                            className="k-btn-secondary"
                            onClick={() => setPage(p => p + 1)}
                            style={{ fontSize: 11, padding: "8px 16px", alignSelf: "center" }}
                        >
                            Load More ({filtered.length - pageItems.length} remaining)
                        </button>
                    )}
                </>
            )}
        </div>
    )
}
