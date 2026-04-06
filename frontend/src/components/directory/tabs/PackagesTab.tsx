/**
 * Packages Tab — Directory tab showing on-chain packages.
 * Extracted from Directory.tsx for maintainability.
 * @module components/directory/tabs/PackagesTab
 */

import { useState, useEffect, useMemo, useDeferredValue } from "react"
import { ArrowRight } from "@phosphor-icons/react"
import { getExplorerBaseUrl } from "../../../lib/config"
import { fetchPackages, fetchPackagesLive } from "../../../lib/directory"
import { RealmDetailDrawer } from "../RealmDetailDrawer"

export function PackagesTab() {
    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const [packages, setPackages] = useState(() => fetchPackages())
    const [drawerPath, setDrawerPath] = useState<string | null>(null)
    const [drawerGnowebUrl, setDrawerGnowebUrl] = useState<string | undefined>()

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
                        <button
                            key={p.path}
                            className="dir-card dir-card--clickable"
                            data-testid="package-card"
                            onClick={() => {
                                setDrawerPath(p.path)
                                setDrawerGnowebUrl(p.gnowebUrl)
                            }}
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
                        </button>
                    ))}
                </div>

                {/* Detail drawer */}
                {drawerPath && (
                    <RealmDetailDrawer
                        path={drawerPath}
                        gnowebUrl={drawerGnowebUrl}
                        isPackage
                        onClose={() => setDrawerPath(null)}
                    />
                )}
            )}
        </div>
    )
}
