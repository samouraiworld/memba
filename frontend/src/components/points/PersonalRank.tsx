/**
 * PersonalRank — the connected member's standing on the reputation leaderboard: exact rank out of the
 * holder count, plus tier and points. Reads a PointsProfile (from points.ts getProfile). An address
 * that holds no points is shown as "Unranked" rather than "#0".
 *
 * @module components/points/PersonalRank
 */

import { TierBadge } from "./TierBadge"
import type { PointsProfile } from "../../lib/points"
import "./points.css"

export function PersonalRank({ profile }: { profile: PointsProfile }) {
    const { points, tier, rank, holders } = profile
    const ranked = rank > 0
    return (
        <div className="personal-rank" data-testid="personal-rank">
            <div className="personal-rank__standing">
                {ranked ? (
                    <>
                        <span className="personal-rank__hash">#</span>
                        <span className="personal-rank__value">{rank.toLocaleString()}</span>
                        <span className="personal-rank__of">of {holders.toLocaleString()}</span>
                    </>
                ) : (
                    <span className="personal-rank__unranked">Unranked</span>
                )}
            </div>
            <div className="personal-rank__meta">
                <TierBadge tier={tier} />
                <span className="personal-rank__points">{points.toLocaleString()} MP</span>
            </div>
        </div>
    )
}
