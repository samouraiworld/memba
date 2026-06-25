/**
 * ComingSoon — honest "not live yet" teaser for flag-gated features.
 *
 * NFT marketplace, Services, and agent credits are gated OFF (VITE_ENABLE_*),
 * so they are shown ONLY as clearly-labelled "soon" items — never as live,
 * navigable surfaces. This answers "what's coming" without violating the gating
 * policy (the build-time flag gate keeps the real features off).
 *
 * @module components/home/ComingSoon
 */
import { Buildings, Briefcase, PuzzlePiece } from "@phosphor-icons/react"
import "./home.css"

interface Upcoming {
    key: string
    label: string
    sub: string
    Icon: typeof Buildings
}

const UPCOMING: Upcoming[] = [
    { key: "marketplace", label: "NFT Marketplace", sub: "trade collectibles on gno", Icon: Buildings },
    { key: "services", label: "Services", sub: "freelance marketplace", Icon: Briefcase },
    { key: "agents", label: "Agent credits", sub: "on-chain AI agents", Icon: PuzzlePiece },
]

export function ComingSoon() {
    return (
        <section className="coming-soon" data-testid="coming-soon">
            <div className="below-fold__eyebrow">
                coming soon <span className="below-fold__eyebrow-note">· not live yet</span>
            </div>
            <div className="coming-soon__items">
                {UPCOMING.map(({ key, label, sub, Icon }) => (
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
