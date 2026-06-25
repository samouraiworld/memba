/**
 * ExploreGrid — below-the-fold quick-nav to the LIVE gno.land surfaces.
 *
 * Static, network-aware links (no data fetch). Gated/upcoming features
 * (NFT marketplace, Services, agent credits) are deliberately NOT here — they
 * live in <ComingSoon> labelled "soon", per the honesty/gating policy.
 *
 * @module components/home/ExploreGrid
 */
import { Link } from "react-router-dom"
import { Wallet, Users, Globe, Heart, Trophy, Vault } from "@phosphor-icons/react"
import "./home.css"

interface Surface {
    key: string
    label: string
    sub: string
    Icon: typeof Wallet
}

const SURFACES: Surface[] = [
    { key: "tokens", label: "Tokens", sub: "create & explore", Icon: Wallet },
    { key: "directory", label: "Directory", sub: "find anyone", Icon: Users },
    { key: "validators", label: "Validators", sub: "network set", Icon: Globe },
    { key: "gnolove", label: "Gnolove", sub: "contributor board", Icon: Heart },
    { key: "quests", label: "Quests", sub: "earn XP", Icon: Trophy },
    { key: "multisig", label: "Multisig", sub: "shared treasury", Icon: Vault },
]

export interface ExploreGridProps {
    networkKey: string
}

export function ExploreGrid({ networkKey }: ExploreGridProps) {
    return (
        <section className="explore-grid" data-testid="explore-grid">
            <div className="below-fold__eyebrow">explore gno.land</div>
            <div className="explore-grid__items">
                {SURFACES.map(({ key, label, sub, Icon }) => (
                    <Link
                        key={key}
                        to={`/${networkKey}/${key}`}
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
