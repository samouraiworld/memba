/**
 * DAOs Tab — Directory tab showing all discoverable DAOs.
 * Extracted from Directory.tsx for maintainability.
 * @module components/directory/tabs/DAOsTab
 */

import { useState, useMemo, useDeferredValue, useEffect } from "react"
import { GNO_RPC_URL } from "../../../lib/config"
import { getDirectoryDAOs } from "../../../lib/directory"
import { useResolvedDirectoryDaos } from "../../../hooks/useResolvedDirectoryDaos"
import { encodeSlug } from "../../../lib/daoSlug"
import { batchGetDAOMetadata, type DAOMetadata } from "../../../lib/daoMetadata"
import { DAOCard, FeaturedDAOs } from "../index"
import type { TabProps } from "./types"

export function DAOsTab({ navigate }: TabProps) {
    const [search, setSearch] = useState("")
    // I2 audit fix: useDeferredValue for search — smooth typing with large datasets
    const deferredSearch = useDeferredValue(search)
    const [daoRefreshKey, setDaoRefreshKey] = useState(0)
    const [metadata, setMetadata] = useState<Map<string, DAOMetadata>>(new Map())

    // daoRefreshKey forces recalculation when user saves a DAO
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const allDAOs = useMemo(() => getDirectoryDAOs(), [daoRefreshKey])

    // R2-D2: the seed+saved list is not network-aware, so it can contain DAOs
    // deployed on another testnet (or never deployed) that 404 on the active
    // network. Resolve each on-chain and show only the ones that render here.
    const { daos: resolvedDAOs, loading: resolving } = useResolvedDirectoryDaos(allDAOs, GNO_RPC_URL)

    // Fetch metadata for the resolved DAOs (skip the ones we already dropped).
    useEffect(() => {
        const paths = resolvedDAOs.map(d => d.path)
        if (paths.length === 0) return
        batchGetDAOMetadata(GNO_RPC_URL, paths)
            .then(setMetadata)
            .catch(() => { /* best-effort */ })
    }, [resolvedDAOs])

    const filtered = useMemo(() =>
        deferredSearch
            ? resolvedDAOs.filter(d =>
                d.name.toLowerCase().includes(deferredSearch.toLowerCase()) ||
                d.path.toLowerCase().includes(deferredSearch.toLowerCase()),
            )
            : resolvedDAOs,
        [resolvedDAOs, deferredSearch])

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* I1 audit fix: pass metadata from parent to avoid duplicate RPC calls */}
            <FeaturedDAOs metadata={metadata} />

            <div className="dir-search-row">
                <input
                    type="text"
                    placeholder="Search DAOs..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="dir-search"
                    data-testid="dao-search"
                />
                <button
                    className="k-btn-primary dir-create-btn"
                    onClick={() => navigate("/dao/create")}
                    data-testid="create-dao-btn"
                >
                    <span className="dir-create-btn__full">+ Create DAO</span>
                    <span className="dir-create-btn__compact">+</span>
                </button>
            </div>

            {resolving && filtered.length === 0 ? (
                <div className="dir-empty" data-testid="dao-resolving">
                    <p>Loading DAOs on this network…</p>
                </div>
            ) : filtered.length === 0 ? (
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

        </div>
    )
}
