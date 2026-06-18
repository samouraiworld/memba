/**
 * Home — mode-aware Control Room landing page.
 *
 * Composes three zones top-to-bottom:
 *   1. StatusStrip — brand/network heartbeat
 *   2. SPINE — action inbox (member) or visitor hero (visitor) [placeholder]
 *   3. STATE BOARD — realtime status panels [placeholder]
 *
 * The spine and board placeholders carry stable data-testid attributes that
 * Tasks 1.2/1.3 (spine) and 1.4+ (board) will fill with real components.
 *
 * @module pages/Home
 */

import { useOutletContext } from "react-router-dom"
import type { LayoutContext } from "../types/layout"
import { StatusStrip } from "../components/home/StatusStrip"
import { ActionInbox } from "../components/home/ActionInbox"
import { VisitorHero } from "../components/home/VisitorHero"
import { StateBoard } from "../components/home/StateBoard"
import { NetworkPulsePanel } from "../components/home/panels/NetworkPulsePanel"
import { YourWorldsPanel } from "../components/home/panels/YourWorldsPanel"
import { EcosystemPanel } from "../components/home/panels/EcosystemPanel"
import { FeaturedDaoPanel } from "../components/home/panels/FeaturedDaoPanel"
import { ValidatorsPanel } from "../components/home/panels/ValidatorsPanel"
import "../components/home/home.css"

export interface HomeProps {
    mode: "visitor" | "member"
}

export function Home({ mode }: HomeProps) {
    // Available for child components / future tasks that need auth/adena
    useOutletContext<LayoutContext>()

    return (
        <div className="home-root" data-testid="home-root">
            {/* Zone 1: brand/network heartbeat */}
            <StatusStrip />

            {/* Zone 2: SPINE — action inbox (member) or visitor hero (visitor) */}
            <div
                className="home-spine"
                data-testid={mode === "member" ? "home-spine-member" : "home-spine-visitor"}
            >
                {mode === "member" && <ActionInbox />}
                {mode === "visitor" && <VisitorHero />}
            </div>

            {/* Zone 3: STATE BOARD — realtime status panels */}
            <div className="home-state-board" data-testid="home-state-board">
                <StateBoard eagerIndices={[0]}>
                    <NetworkPulsePanel key="pulse" />
                    <EcosystemPanel key="ecosystem" />
                    <ValidatorsPanel key="validators" />
                    <FeaturedDaoPanel key="featured-dao" />
                    {mode === "member" && <YourWorldsPanel key="your-worlds" />}
                </StateBoard>
            </div>
        </div>
    )
}
