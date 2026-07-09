/**
 * ExploreGrid — below-the-fold quick-nav to the LIVE gno.land surfaces.
 *
 * Static, network-aware links (no data fetch). The tile set derives from the
 * shared surface manifest at render time: whatever the current flags gate OFF
 * is deliberately NOT here — it renders in <ComingSoon> labelled "soon"
 * instead, per the honesty/gating policy.
 *
 * @module components/home/ExploreGrid
 */
import { Link } from "react-router-dom"
import { liveSurfaces } from "./homeSurfaces"
import "./home.css"

export interface ExploreGridProps {
    networkKey: string
}

export function ExploreGrid({ networkKey }: ExploreGridProps) {
    return (
        <section className="explore-grid" data-testid="explore-grid">
            <div className="below-fold__eyebrow">explore gno.land</div>
            <div className="explore-grid__items">
                {liveSurfaces().map(({ key, route, label, sub, Icon }) => (
                    <Link
                        key={key}
                        to={`/${networkKey}/${route}`}
                        className="explore-tile"
                        data-testid={`explore-${key}`}
                    >
                        <Icon size={18} aria-hidden="true" className="explore-tile__icon" />
                        <span className="explore-tile__text">
                            <span className="explore-tile__label">{label}</span>
                            <span className="explore-tile__sub">{sub}</span>
                        </span>
                    </Link>
                ))}
            </div>
        </section>
    )
}
