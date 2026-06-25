/**
 * BelowFold — the home content below the showcase board: an honest
 * "ecosystem at a glance" band, the explore-gno.land quick-nav, and a
 * clearly-labelled "coming soon" teaser. Shared by visitor + member home.
 *
 * @module components/home/BelowFold
 */
import { EcosystemBand } from "./EcosystemBand"
import { ExploreGrid } from "./ExploreGrid"
import { ComingSoon } from "./ComingSoon"
import "./home.css"

export interface BelowFoldProps {
    networkKey: string
}

export function BelowFold({ networkKey }: BelowFoldProps) {
    return (
        <div className="below-fold" data-testid="below-fold">
            <EcosystemBand />
            <ExploreGrid networkKey={networkKey} />
            <ComingSoon />
        </div>
    )
}
