/**
 * Packages Tab — Directory tab showing on-chain packages.
 * Extracted from Directory.tsx for maintainability.
 * @module components/directory/tabs/PackagesTab
 */

import { useState, useMemo, useDeferredValue } from "react"
import { ArrowRight } from "@phosphor-icons/react"
import { useDirectoryDiscovery } from "../../../hooks/useDirectoryDiscovery"
import { discoveryProvenanceLabel } from "../../../lib/directoryDiscovery"
import { RealmDetailDrawer } from "../RealmDetailDrawer"
import { RecentSubmissionsSection } from "../RecentSubmissionsSection"

export function PackagesTab() {
    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const { discovery: { packages } } = useDirectoryDiscovery()
    const [drawerPath, setDrawerPath] = useState<string | null>(null)
    const [drawerGnowebUrl, setDrawerGnowebUrl] = useState<string | undefined>()

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
                aria-label="Search packages"
            />

            <div className="dir-count" role="status" aria-live="polite">
                {filtered.length} package{filtered.length !== 1 ? "s" : ""} found
            </div>

            {filtered.length === 0 ? (
                <div className="dir-empty">
                    <p>{search ? `No packages matching "${search}"` : "No verified packages in this directory yet. Explore the Realms tab or enter an exact path above."}</p>
                </div>
            ) : (
                <div className="dir-grid">
                    {filtered.map(p => (
                        <div
                            key={p.path}
                            className="dir-card dir-card--clickable"
                            data-testid="package-card"
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                                <div className="dir-token-avatar" style={{ background: "rgba(99,102,241,0.15)", color: "var(--color-k-purple-text)" }}>
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
                                    <div className="dir-card-desc">{discoveryProvenanceLabel(p)}</div>
                                </div>
                            </div>
                            <div className="dir-card-actions">
                                <button type="button" className="dir-gnoweb-link" onClick={() => { setDrawerPath(p.path); setDrawerGnowebUrl(p.gnowebUrl) }} aria-label={`View ${p.name} source`}>View source</button>
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
                        </div>
                    ))}
                </div>
            )}

            <RecentSubmissionsSection kind="package" />

            {/* Detail drawer */}
            {drawerPath && (
                <RealmDetailDrawer
                    path={drawerPath}
                    gnowebUrl={drawerGnowebUrl}
                    isPackage
                    onClose={() => setDrawerPath(null)}
                />
            )}
        </div>
    )
}
