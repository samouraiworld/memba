/**
 * Directory Page — Organization Hub for discovering DAOs, Tokens, and Users.
 *
 * v2.2a upgrade: premium design with glassmorphism cards, rich DAO metadata,
 * featured carousel, and proper CSS extraction (no inline styles).
 *
 * v3.0 refactor: all 7 tab components extracted to components/directory/tabs/
 * for maintainability. This file is now a thin shell (tab router + search).
 *
 * Data layer: lib/directory.ts (token/user parsing + cache)
 * Metadata: lib/daoMetadata.ts (DAO Render parsing)
 */

import { useNetworkNav } from "../hooks/useNetworkNav"
import { useEffect, useCallback, useMemo, useDeferredValue } from "react"
import { useDirectoryUrlState } from "../hooks/useDirectoryUrlState"
import { type DirectoryTab, resolveActiveTab } from "../lib/directoryUrl"
import { useTabListKeyboard } from "../hooks/useTabListKeyboard"
import { getExplorerBaseUrl, isExplorerEnabled } from "../lib/config"
import { useDirectoryRender } from "../hooks/useDirectoryRender"
import { ChainMetricsBanner } from "../components/directory"
import { DAOsTab, TokensTab, UsersTab, PackagesTab, RealmsTab, GovDAOTab, LeaderboardTab, ExplorerTab } from "../components/directory/tabs"
import { trackPageVisit, trackDirectoryTab } from "../lib/quests"
import { getDirectoryDAOs } from "../lib/directory"
import type { DirectoryDAO, DirectoryPackage, DirectoryRealm } from "../lib/directory"
import { encodeSlug } from "../lib/daoSlug"
import { isValidRealmPath } from "../lib/gnowebSource"
import { useDirectoryDiscovery } from "../hooks/useDirectoryDiscovery"
import { RealmDetailDrawer } from "../components/directory/RealmDetailDrawer"
import { toExplorerRelPath } from "../lib/explorerLink"
import "./directory.css"

// W5.2: Packages leads — it is by far the most-filled tab on test13 today
// (DAO count is still small). Revisit the order once DAOs catch up.
const TAB_DEFS: { key: DirectoryTab; label: string }[] = [
    { key: "packages", label: "📦 Packages" },
    { key: "daos", label: "🏛️ DAOs" },
    { key: "realms", label: "🌐 Realms" },
    { key: "tokens", label: "🪙 Tokens" },
    { key: "users", label: "👤 Users" },
    { key: "govdao", label: "🏛️ GovDAO" },
    { key: "leaderboard", label: "🏆 Leaderboard" },
]

export function Directory() {
    const navigate = useNetworkNav()
    const [urlState, setUrlState] = useDirectoryUrlState()
    // Explorer is the merged-in realm viewer, shown as a gated last tab. A deep-link
    // to ?tab=explorer with the flag off falls back to the default tab, so there is
    // never a dead nav button or a blank panel.
    const explorerOn = isExplorerEnabled()
    // Memoized so the useCallback below (which depends on it) keeps a stable
    // identity — a fresh array each render would defeat the memo.
    const tabDefs = useMemo(
        () => explorerOn ? [...TAB_DEFS, { key: "explorer" as DirectoryTab, label: "🔎 Explorer" }] : TAB_DEFS,
        [explorerOn],
    )
    const tab: DirectoryTab = resolveActiveTab(urlState.tab, explorerOn)
    const globalSearch = urlState.q
    const deferredGlobalSearch = useDeferredValue(globalSearch)
    const previewPath = globalSearch.startsWith("gno.land/r/") ? globalSearch : null
    const preview = useDirectoryRender(previewPath, 300)
    const realmPreview = preview.data && preview.data.trim() !== "404" ? { path: previewPath!, content: preview.data.slice(0, 500) } : null
    const packagePath = globalSearch.startsWith("gno.land/p/") && isValidRealmPath(globalSearch.replace(/^gno\.land/, "")) ? globalSearch : null

    // M6 pattern: page title + quest tracking. Track the initial (possibly
    // deep-linked via ?tab=) tab once on mount.
    useEffect(() => {
        document.title = "Directory — Memba"
        trackPageVisit("directory")
        trackDirectoryTab(urlState.tab)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Cross-tab search data (loaded once for filtering)
    const allDAOs = useMemo(() => getDirectoryDAOs(), [])
    const { discovery, isPending: discoveryLoading, refetch: retryDiscovery } = useDirectoryDiscovery()
    const allPackages = discovery.packages
    const allRealms = discovery.realms
    const openResult = (path: string) => setUrlState({
        tab: explorerOn ? "explorer" : path.startsWith("gno.land/p/") ? "packages" : "realms",
        realm: toExplorerRelPath(path),
    })
    const selectedPath = `/${toExplorerRelPath(urlState.realm)}`
    const showSelectedDrawer = !explorerOn && ["packages", "realms"].includes(tab) && isValidRealmPath(selectedPath)


    // Cross-tab search results
    const crossTabResults = useMemo(() => {
        const q = deferredGlobalSearch.toLowerCase().trim()
        if (!q || q.startsWith("gno.land/")) return null

        const matchDAO = (d: DirectoryDAO) =>
            d.name.toLowerCase().includes(q) || d.path.toLowerCase().includes(q)
        const matchPkg = (p: DirectoryPackage) =>
            p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
        const matchRealm = (r: DirectoryRealm) =>
            r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)

        const daos = allDAOs.filter(matchDAO).slice(0, 5)
        const packages = allPackages.filter(matchPkg).slice(0, 5)
        const realms = allRealms.filter(matchRealm).slice(0, 5)

        if (daos.length === 0 && packages.length === 0 && realms.length === 0) return null
        return { daos, packages, realms }
    }, [deferredGlobalSearch, allDAOs, allPackages, allRealms])

    const handleGlobalSearch = useCallback((query: string) => {
        setUrlState({ q: query })
    }, [setUrlState])

    const selectTab = useCallback((key: DirectoryTab) => {
        trackDirectoryTab(key)
        setUrlState({ tab: key })
    }, [setUrlState])

    // APG tabs pattern: Arrow/Home/End move between tabs, with a roving tabindex.
    // This page's hand-rolled version was the most complete of the three in the
    // app and became useTabListKeyboard; nine other tablists had no keyboard
    // support at all. Behaviour is unchanged — this is the same code, shared.
    const tabKeys = useMemo(() => tabDefs.map(t => t.key), [tabDefs])
    const { tabProps } = useTabListKeyboard<DirectoryTab>({
        keys: tabKeys,
        active: tab,
        onSelect: selectTab,
    })

    return (
        <div className="dir-page">
            <div className="dir-header">
                <h1>📂 Directory</h1>
                <p>Discover DAOs, tokens, packages, realms, and users on gno.land</p>
            </div>

            {/* Phase 3a: Live chain metrics */}
            <ChainMetricsBanner />
            <p className="dir-discovery-status" role="status">
                {discoveryLoading ? "Checking this network’s namespace listings…" : discovery.status === "ready" ? "Namespace listings checked. This is a curated directory, not a complete chain index." : "Live namespace discovery is unavailable or incomplete. Available editorial and reference paths are shown below."}
                {" Reference and saved paths may not be deployed on this network."}
                {!discoveryLoading && discovery.status !== "ready" && <button type="button" onClick={() => void retryDiscovery()}>Retry discovery</button>}
            </p>

            {/* Phase 3a: Universal search */}
            <div role="search" aria-label="Search directory">
            <input
                type="text"
                placeholder="Search across all tabs or enter a gno.land/ path..."
                value={globalSearch}
                onChange={e => handleGlobalSearch(e.target.value)}
                className="dir-search dir-search--global"
                data-testid="global-search"
                aria-label="Search across all tabs or enter a gno.land path"
            />
            </div>

            {/* Cross-tab search results */}
            {crossTabResults && (
                <div className="dir-cross-results" aria-live="polite">
                    {crossTabResults.daos.length > 0 && (
                        <div className="dir-cross-section">
                            <div className="dir-cross-section__header">DAOs ({crossTabResults.daos.length})</div>
                            <div className="dir-cross-section__items">
                                {crossTabResults.daos.map(d => (
                                    <button
                                        key={d.path}
                                        className="dir-cross-item"
                                        onClick={() => navigate(`/dao/${encodeSlug(d.path)}`)}
                                    >
                                        <span className="dir-cross-item__icon">🏛️</span>
                                        <span className="dir-cross-item__name">{d.name}</span>
                                        <span className="dir-cross-item__path">{d.path}</span>
                                    </button>
                                ))}
                                {crossTabResults.daos.length >= 5 && (
                                    <button className="dir-cross-show-all" onClick={() => setUrlState({ tab: "daos", q: "" })}>
                                        Show all DAOs →
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                    {crossTabResults.realms.length > 0 && (
                        <div className="dir-cross-section">
                            <div className="dir-cross-section__header">Realms ({crossTabResults.realms.length})</div>
                            <div className="dir-cross-section__items">
                                {crossTabResults.realms.map(r => (
                                    <button
                                        key={r.path}
                                        className="dir-cross-item"
                                        onClick={() => openResult(r.path)}
                                    >
                                        <span className="dir-cross-item__icon">🌐</span>
                                        <span className="dir-cross-item__name">{r.name}</span>
                                        <span className="dir-cross-item__path">{r.path}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {crossTabResults.packages.length > 0 && (
                        <div className="dir-cross-section">
                            <div className="dir-cross-section__header">Packages ({crossTabResults.packages.length})</div>
                            <div className="dir-cross-section__items">
                                {crossTabResults.packages.map(p => (
                                    <button
                                        key={p.path}
                                        className="dir-cross-item"
                                        onClick={() => openResult(p.path)}
                                    >
                                        <span className="dir-cross-item__icon">📦</span>
                                        <span className="dir-cross-item__name">{p.name}</span>
                                        <span className="dir-cross-item__path">{p.path}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* No-results state for a text query that matched nothing (DB3) */}
            {deferredGlobalSearch.trim().length > 0
                && !deferredGlobalSearch.trim().toLowerCase().startsWith("gno.land/")
                && !crossTabResults && (
                <div className="dir-cross-results" role="status" aria-live="polite">
                    <div className="dir-empty">
                        <p>No DAOs, realms, or packages match "{globalSearch.trim()}". Try a tab below or enter a full <code>gno.land/</code> path.</p>
                    </div>
                </div>
            )}

            {/* Realm path preview */}
            {preview.loading && <p role="status">Loading realm preview…</p>}
            {previewPath && preview.isError && <p role="status">Could not read this realm’s Render output. <button type="button" className="dir-gnoweb-link" onClick={() => void preview.refetch()}>Retry preview</button></p>}
            {previewPath && preview.isSuccess && !realmPreview && <p role="status">This realm returned no preview content. <button type="button" className="dir-gnoweb-link" onClick={() => openResult(previewPath)}>View realm details</button></p>}
            {packagePath && <p>Packages have source code rather than a rendered page. <button type="button" className="dir-gnoweb-link" onClick={() => openResult(packagePath)}>View package source</button></p>}
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
                {tabDefs.map(t => (
                    <button
                        key={t.key}
                        {...tabProps(t.key)}
                        className="dir-tab"
                        data-active={tab === t.key}
                        onClick={() => selectTab(t.key)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* M2 audit fix: tabpanel role + aria-labelledby for complete ARIA pattern */}
            <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
                {tab === "daos" && <DAOsTab navigate={navigate} />}
                {tab === "tokens" && <TokensTab />}
                {tab === "packages" && <PackagesTab />}
                {tab === "realms" && <RealmsTab />}
                {tab === "users" && <UsersTab navigate={navigate} />}
                {tab === "govdao" && <GovDAOTab navigate={navigate} />}
                {tab === "leaderboard" && <LeaderboardTab navigate={navigate} />}
                {tab === "explorer" && explorerOn && (
                    <ExplorerTab
                        realm={urlState.realm}
                        onRealmChange={(rel) => setUrlState({ tab: "explorer", realm: rel })}
                    />
                )}
            </div>
            {showSelectedDrawer && <RealmDetailDrawer key={selectedPath} path={`gno.land${selectedPath}`} isPackage={selectedPath.startsWith("/p/")} onClose={() => setUrlState({ realm: "" })} />}
        </div>
    )
}
