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
import { useState, useEffect, useCallback } from "react"
import { GNO_RPC_URL, getExplorerBaseUrl } from "../lib/config"
import { queryRender } from "../lib/dao/shared"
import { ChainMetricsBanner } from "../components/directory"
import { DAOsTab, TokensTab, UsersTab, PackagesTab, RealmsTab, GovDAOTab, LeaderboardTab } from "../components/directory/tabs"
import { trackPageVisit, trackDirectoryTab } from "../lib/quests"
import "./directory.css"

type DirectoryTab = "daos" | "tokens" | "users" | "packages" | "realms" | "govdao" | "leaderboard"

export function Directory() {
    const navigate = useNetworkNav()
    const [tab, setTab] = useState<DirectoryTab>(() => {
        trackDirectoryTab("daos")
        return "daos"
    })
    const [globalSearch, setGlobalSearch] = useState("")
    const [realmPreview, setRealmPreview] = useState<{ path: string; content: string } | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)

    // M6 pattern: page title + quest tracking
    useEffect(() => {
        document.title = "Directory — Memba"
        trackPageVisit("directory")
    }, [])

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
                        onClick={() => { trackDirectoryTab(t.key); setTab(t.key) }}
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
