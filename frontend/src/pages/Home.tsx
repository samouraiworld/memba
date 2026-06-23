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
import { useNetworkKey } from "../hooks/useNetworkNav"
import { StatusStrip } from "../components/home/StatusStrip"
import { ActionInbox } from "../components/home/ActionInbox"
import { VisitorHero } from "../components/home/VisitorHero"
import { StateBoard } from "../components/home/StateBoard"
import { ShowcaseBoard } from "../components/home/ShowcaseBoard"
import { NetworkPulsePanel } from "../components/home/panels/NetworkPulsePanel"
import { YourWorldsPanel } from "../components/home/panels/YourWorldsPanel"
import { EcosystemPanel } from "../components/home/panels/EcosystemPanel"
import { FeaturedDaoPanel } from "../components/home/panels/FeaturedDaoPanel"
import { ValidatorsPanel } from "../components/home/panels/ValidatorsPanel"
import { GnolovePanel } from "../components/home/panels/GnolovePanel"
import { DirectoryPanel } from "../components/home/panels/DirectoryPanel"
import "../components/home/home.css"

export interface HomeProps {
    mode: "visitor" | "member"
}

export function Home({ mode }: HomeProps) {
    // Available for child components / future tasks that need auth/adena
    useOutletContext<LayoutContext>()
    const activeNetworkKey = useNetworkKey()

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

            {/* Zone 3: BOARD.
                - Visitor: ShowcaseBoard — the "board of doors" (Task 1.2a; more
                  doors arrive in 1.2b). Phase 2 migrates the member board.
                - Member: StateBoard — realtime status panels. DOM order = mobile
                  priority column: NetworkPulse → YourWorlds → FeaturedDao →
                  Validators → Gnolove → Directory → Ecosystem. */}
            <div className="home-state-board" data-testid="home-state-board">
                {mode === "visitor" ? (
                    <ShowcaseBoard networkKey={activeNetworkKey} />
                ) : (
                    // Member-only branch: StateBoard with live status panels.
                    // A future 3rd mode (e.g. "preview") must NOT fall through here —
                    // add an explicit conditional above instead of extending this else.
                    <StateBoard eagerIndices={[0]}>
                        <NetworkPulsePanel key="pulse" />
                        <YourWorldsPanel key="your-worlds" />
                        <FeaturedDaoPanel key="featured-dao" />
                        <ValidatorsPanel key="validators" />
                        <GnolovePanel key="gnolove" />
                        <DirectoryPanel key="directory" />
                        <EcosystemPanel key="ecosystem" />
                    </StateBoard>
                )}
            </div>
        </div>
    )
}
