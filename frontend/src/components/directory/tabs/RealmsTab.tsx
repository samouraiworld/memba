/**
 * Realms Tab — Directory tab showing on-chain realms with Render() preview.
 * Extracted from Directory.tsx for maintainability.
 * @module components/directory/tabs/RealmsTab
 */

import { useState, useMemo, useDeferredValue, type CSSProperties } from "react"
import { getExplorerBaseUrl } from "../../../lib/config"
import { useDirectoryDiscovery } from "../../../hooks/useDirectoryDiscovery"
import { discoveryProvenanceLabel } from "../../../lib/directoryDiscovery"
import { useDirectoryRender } from "../../../hooks/useDirectoryRender"
import { useNetwork } from "../../../hooks/useNetwork"
import { RealmDetailDrawer } from "../RealmDetailDrawer"
import { ExplorerLink } from "../ExplorerLink"
import { RecentSubmissionsSection } from "../RecentSubmissionsSection"
import DOMPurify from "dompurify"
import { renderMarkdown } from "../../../lib/markdownLite"

const REALM_CATEGORY_COLORS: Record<string, string> = {
    standard: "var(--color-brand)",
    defi: "var(--color-accent-gold)",
    social: "var(--color-accent-purple-alt)",
    utility: "var(--color-info)",
    game: "var(--color-danger)",
    unknown: "var(--color-text-secondary)",
}

export function RealmsTab() {
    const { networkKey } = useNetwork()
    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const [categoryFilter, setCategoryFilter] = useState<string>("all")
    // Phase 3b: Realm Render() preview
    const [expandedRealm, setExpandedRealm] = useState<string | null>(null)
    const preview = useDirectoryRender(expandedRealm)
    const realmRender = preview.data?.trim() === "404" ? "" : preview.data
    const renderLoading = preview.loading
    // Drawer for gnoweb-grade detail view
    const [drawerPath, setDrawerPath] = useState<string | null>(null)
    const [drawerGnowebUrl, setDrawerGnowebUrl] = useState<string | undefined>()

    const handleRealmClick = (path: string) => setExpandedRealm(current => current === path ? null : path)

    const { discovery: { realms } } = useDirectoryDiscovery()

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
                aria-label="Search realms"
            />

            {/* Category filter pills */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {categories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setCategoryFilter(cat)}
                        className={`dir-category-pill${categoryFilter === cat ? " k-brand-text" : ""}`}
                        data-active={categoryFilter === cat}
                        aria-pressed={categoryFilter === cat}
                        style={{
                            borderColor: categoryFilter === cat
                                ? (REALM_CATEGORY_COLORS[cat] || "var(--color-text-dim)")
                                : undefined,
                            ["--ck"]: REALM_CATEGORY_COLORS[cat] || "var(--color-text-secondary)",
                        } as CSSProperties}
                    >
                        {cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </button>
                ))}
            </div>

            <div className="dir-count" role="status" aria-live="polite">
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
                                aria-expanded={expandedRealm === r.path}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                                    <div className="dir-token-avatar k-brand-text" style={{
                                        background: `${REALM_CATEGORY_COLORS[r.category] || "var(--color-text-secondary)"}15`,
                                        ["--ck"]: REALM_CATEGORY_COLORS[r.category] || "var(--color-text-secondary)",
                                    } as CSSProperties}>
                                        🌐
                                    </div>
                                    <div className="dir-card-main">
                                        <div className="dir-card-name">
                                            {r.name}
                                            <span
                                                className="dir-inline-badge k-brand-text"
                                                style={{
                                                    background: `${REALM_CATEGORY_COLORS[r.category] || "var(--color-text-secondary)"}15`,
                                                    ["--ck"]: REALM_CATEGORY_COLORS[r.category] || "var(--color-text-secondary)",
                                                } as CSSProperties}
                                            >
                                                {r.category}
                                            </span>
                                            {r.deploymentStatus === "live" && (
                                                <span className="dir-inline-badge dir-inline-badge--live">Live</span>
                                            )}
                                        </div>
                                        <div className="dir-card-path">{r.path}</div>
                                        <div className="dir-card-desc">{r.description}</div>
                                        <div className="dir-card-desc">{discoveryProvenanceLabel(r)}</div>
                                    </div>
                                </div>
                                <span className={`dir-expand-icon${expandedRealm === r.path ? " open" : ""}`}>▶</span>
                            </button>
                            {expandedRealm === r.path && (
                                <div className="dir-render-preview">
                                    {renderLoading ? (
                                        <p role="status">Loading realm preview…</p>
                                    ) : (
                                        <>
                                            {preview.isError ? <p role="status">Could not read this realm’s Render output. <button className="dir-gnoweb-link" type="button" onClick={() => void preview.refetch()}>Retry preview</button></p> : realmRender ? <div
                                                className="dir-render-preview__content"
                                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(realmRender.slice(0, 1000))) }}
                                            /> : <p>This realm returned no preview content.</p>}
                                            <div className="dir-render-preview__links">
                                                <button
                                                    className="dir-render-preview__link dir-render-preview__link--primary"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        setDrawerPath(r.path)
                                                        setDrawerGnowebUrl(r.gnowebUrl)
                                                    }}
                                                >
                                                    View Details →
                                                </button>
                                                <ExplorerLink
                                                    realmPath={r.path}
                                                    networkKey={networkKey}
                                                    className="dir-render-preview__link"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                                {/* External block explorer (gnoweb on current networks) — labelled
                                                    distinctly from the in-app "🔎 Explorer" viewer above; ↗ signals new tab. */}
                                                <a
                                                    href={`${getExplorerBaseUrl()}/${r.path.replace("gno.land/", "")}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="dir-render-preview__link"
                                                >
                                                    Block explorer ↗
                                                </a>
                                                {r.gnowebUrl && (
                                                    <a
                                                        href={r.gnowebUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="dir-render-preview__link"
                                                    >
                                                        gnoweb →
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

            <RecentSubmissionsSection kind="realm" />

            {/* Detail drawer */}
            {drawerPath && (
                <RealmDetailDrawer
                    path={drawerPath}
                    gnowebUrl={drawerGnowebUrl}
                    onClose={() => setDrawerPath(null)}
                />
            )}
        </div>
    )
}
