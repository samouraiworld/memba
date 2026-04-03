/**
 * Realms Tab — Directory tab showing on-chain realms with Render() preview.
 * Extracted from Directory.tsx for maintainability.
 * @module components/directory/tabs/RealmsTab
 */

import { useState, useEffect, useCallback, useMemo, useDeferredValue } from "react"
import { GNO_RPC_URL, getExplorerBaseUrl } from "../../../lib/config"
import { fetchRealms, fetchRealmsLive } from "../../../lib/directory"
import { queryRender } from "../../../lib/dao/shared"

const REALM_CATEGORY_COLORS: Record<string, string> = {
    standard: "#00d4aa",
    defi: "#f59e0b",
    social: "#8b5cf6",
    utility: "#3b82f6",
    game: "#ef4444",
    unknown: "#666",
}

export function RealmsTab() {
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
