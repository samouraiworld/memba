/**
 * FeaturedDAOs — Curated horizontal carousel of top DAOs.
 *
 * Shows rich metadata from Render parsing for seed DAOs.
 * Horizontal scroll on mobile.
 *
 * I1 audit fix: metadata is passed from parent (DAOsTab) instead
 * of fetching independently, avoiding duplicate RPC calls.
 */

import { useNetworkNav } from "../../hooks/useNetworkNav"
import { encodeSlug } from "../../lib/daoSlug"
import { type DAOMetadata } from "../../lib/daoMetadata"
import { SEED_DAOS } from "../../lib/directory"

interface FeaturedDAOsProps {
    metadata: Map<string, DAOMetadata>
}

export function FeaturedDAOs({ metadata }: FeaturedDAOsProps) {
    const navigate = useNetworkNav()

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

