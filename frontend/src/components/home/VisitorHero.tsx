/**
 * VisitorHero — conviction hero for logged-out visitors.
 *
 * Renders:
 *   1. Headline + subtitle
 *   2. Primary CTA: "Explore DAOs" — plain network-aware link, no wallet needed
 *   3. Secondary CTA: "Connect wallet" button (adena.connect) or "Install Adena" link
 *   4. "no wallet needed to look around" hint
 *
 * @module components/home/VisitorHero
 */

import { useOutletContext } from "react-router-dom"
import type { LayoutContext } from "../../types/layout"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { ACTIVE_HEADLINE } from "./visitorHeroHeadlines"
import { NetworkProofCard } from "./NetworkProofCard"

export function VisitorHero() {
    const { adena } = useOutletContext<LayoutContext>()
    const networkKey = useNetworkKey()
    const daoHref = `/${networkKey}/dao`

    return (
        <section className="visitor-hero" data-testid="visitor-hero">
            <div className="visitor-hero__lead">
            <h1 className="visitor-hero__headline">
                {ACTIVE_HEADLINE}
            </h1>
            <p className="visitor-hero__subtitle">
                Governance, treasury, tokens, services, and collectibles — all on gno.land.
            </p>

            <div className="visitor-hero__ctas">
                {/* Primary CTA — always a plain link, no wallet required */}
                <a
                    href={daoHref}
                    className="visitor-hero__cta visitor-hero__cta--primary"
                    data-testid="visitor-hero-explore"
                >
                    Explore DAOs
                </a>

                {/* Secondary CTA — depends on wallet install state */}
                {adena.installed ? (
                    <button
                        type="button"
                        className="visitor-hero__cta visitor-hero__cta--secondary"
                        data-testid="visitor-hero-connect"
                        onClick={() => void adena.connect()}
                    >
                        Connect wallet
                    </button>
                ) : (
                    <a
                        href="https://adena.app"
                        target="_blank"
                        rel="noreferrer"
                        className="visitor-hero__cta visitor-hero__cta--secondary"
                        data-testid="visitor-hero-install"
                    >
                        Install Adena
                    </a>
                )}
            </div>

            <p className="visitor-hero__hint">
                No wallet needed to look around.
            </p>
            </div>

            {/* Right column: live proof object — the product is alive */}
            <NetworkProofCard />
        </section>
    )
}
