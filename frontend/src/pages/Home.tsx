/**
 * Home — mode-aware Control Room landing page.
 *
 * Composes three zones top-to-bottom:
 *   1. StatusStrip — brand/network heartbeat
 *   2. SPINE — member: MemberHero (identity + standing) + ActionInbox
 *              visitor: VisitorHero + ValueStrip on-ramp
 *   3. BOARD — member: your-worlds section + explore (ShowcaseBoard) + below-fold
 *              visitor: ShowcaseBoard + below-fold
 *
 * Member branch (W-M1): the bare wallet-chips band is replaced by MemberHero —
 * an editorial identity + XP/candidature-standing anchor at the same bar as the
 * visitor hero. ActionInbox + YourWorldsPanel follow below it.
 *
 * @module pages/Home
 */

import { useNetworkKey } from "../hooks/useNetworkNav"
import { StatusStrip } from "../components/home/StatusStrip"
import { MemberHero } from "../components/home/MemberHero"
import { ActionInbox } from "../components/home/ActionInbox"
import { VisitorHero } from "../components/home/VisitorHero"
import { ValueStrip } from "../components/home/ValueStrip"
import { ShowcaseBoard } from "../components/home/ShowcaseBoard"
import { BelowFold } from "../components/home/BelowFold"
import { YourWorldsPanel } from "../components/home/panels/YourWorldsPanel"
import "../components/home/home.css"

export interface HomeProps {
    mode: "visitor" | "member"
}

export function Home({ mode }: HomeProps) {
    const activeNetworkKey = useNetworkKey()

    if (mode === "visitor") {
        return (
            <div className="home-root" data-testid="home-root">
                {/* Zone 1: brand/network heartbeat */}
                <StatusStrip />

                {/* Zone 2: SPINE — visitor hero + plain-language on-ramp */}
                <div className="home-spine" data-testid="home-spine-visitor">
                    <VisitorHero />
                    <ValueStrip networkKey={activeNetworkKey} />
                </div>

                {/* Zone 3: BOARD — ShowcaseBoard (board of doors, Phase 1) */}
                <div className="home-state-board" data-testid="home-state-board">
                    <ShowcaseBoard networkKey={activeNetworkKey} />
                    <BelowFold networkKey={activeNetworkKey} />
                </div>
            </div>
        )
    }

    // Member branch — Atlas layout (W-M1 member hero)
    // A future 3rd mode must NOT fall through here — add an explicit branch above.
    return (
        <div className="home-root" data-testid="home-root">
            {/* Zone 1: brand/network heartbeat */}
            <StatusStrip />

            {/* Zone 2: SPINE — member hero (identity + standing) + action inbox */}
            <div className="home-spine" data-testid="home-spine-member">
                <MemberHero />
                <ActionInbox />
            </div>

            {/* Zone 3: BOARD — your worlds → explore → below the fold */}
            <div className="home-state-board" data-testid="home-board-member">
                {/* Your worlds section — member-only saved-DAO panel */}
                <YourWorldsPanel />

                {/* Explore section — reuse ShowcaseBoard (same doors as visitor) */}
                <ShowcaseBoard networkKey={activeNetworkKey} />

                {/* Below the fold — ecosystem band, explore grid, coming-soon */}
                <BelowFold networkKey={activeNetworkKey} />
            </div>
        </div>
    )
}
