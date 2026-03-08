/**
 * FeaturedDAOs — Curated horizontal carousel of top DAOs.
 *
 * Shows rich metadata from Render parsing for seed DAOs.
 * Horizontal scroll on mobile.
 */

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { encodeSlug } from "../../lib/daoSlug"
import { batchGetDAOMetadata, type DAOMetadata } from "../../lib/daoMetadata"
import { SEED_DAOS } from "../../lib/directory"
import { GNO_RPC_URL } from "../../lib/config"

export function FeaturedDAOs() {
    const navigate = useNavigate()
    const [metadata, setMetadata] = useState<Map<string, DAOMetadata>>(new Map())

    useEffect(() => {
        const paths = SEED_DAOS.map(d => d.path)
        batchGetDAOMetadata(GNO_RPC_URL, paths)
            .then(setMetadata)
            .catch(() => { /* best-effort */ })
    }, [])

    if (SEED_DAOS.length === 0) return null

    return (
        <div className="dir-featured" data-testid="featured-daos">
            {SEED_DAOS.map(dao => {
                const meta = metadata.get(dao.path)
                return (
                    <button
                        key={dao.path}
                        className="dir-featured-card"
                        onClick={() => navigate(`/dao/${encodeSlug(dao.path)}`)}
                        data-testid="featured-dao-card"
                    >
                        <div className="dir-featured-name">{dao.name}</div>
                        <div className="dir-featured-desc">
                            {meta?.description || `Explore ${dao.name} on gno.land`}
                        </div>
                        <div className="dir-featured-stats">
                            <span className="dir-card-stat">
                                <span className="stat-value">{meta?.memberCount ?? "—"}</span> members
                            </span>
                            <span className="dir-card-stat">
                                <span className="stat-value">{meta?.proposalCount ?? "—"}</span> proposals
                            </span>
                        </div>
                    </button>
                )
            })}
        </div>
    )
}
