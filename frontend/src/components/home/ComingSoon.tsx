/**
 * ComingSoon — honest "not live yet" teaser for flag-gated features.
 *
 * The tile set derives from the shared surface manifest at render time:
 * whatever the current flags gate OFF shows here as a clearly-labelled
 * "soon" item — never as a live, navigable surface. Everything the flags
 * enable renders in <ExploreGrid> instead, so the two sections can never
 * contradict a deployment's actual gating.
 *
 * @module components/home/ComingSoon
 */
import { upcomingSurfaces } from "./homeSurfaces"
import "./home.css"

export function ComingSoon() {
    const upcoming = upcomingSurfaces()
    if (upcoming.length === 0) return null

    return (
        <section className="coming-soon" data-testid="coming-soon">
            <div className="below-fold__eyebrow">
                coming soon <span className="below-fold__eyebrow-note">· not live yet</span>
            </div>
            <div className="coming-soon__items">
                {upcoming.map(({ key, label, sub, Icon }) => (
                    <div key={key} className="coming-soon-tile" data-testid={`soon-${key}`}>
                        <div className="coming-soon-tile__head">
                            <Icon size={16} aria-hidden="true" className="coming-soon-tile__icon" />
                            <span className="coming-soon-tile__label">{label}</span>
                            <span className="coming-soon-tile__badge">soon</span>
                        </div>
                        <span className="coming-soon-tile__sub">{sub}</span>
                    </div>
                ))}
            </div>
        </section>
    )
}
