/**
 * Home — mode-aware Control Room landing page.
 *
 * Composes three zones top-to-bottom:
 *   1. StatusStrip — brand/network heartbeat (+ wallet chips in member mode)
 *   2. SPINE — action inbox (member) or visitor hero (visitor)
 *   3. BOARD — member: your-worlds section + explore (ShowcaseBoard)
 *              visitor: ShowcaseBoard (Phase 1 — unchanged)
 *
 * Member branch (Task 2.3 Atlas rewire):
 *   StatusStrip → wallet chips (balance + truncated address, honest) →
 *   ActionInbox → YourWorldsPanel → ShowcaseBoard (explore)
 *
 * @module pages/Home
 */

import { useOutletContext } from "react-router-dom"
import type { LayoutContext } from "../types/layout"
import { useNetworkKey } from "../hooks/useNetworkNav"
import { StatusStrip } from "../components/home/StatusStrip"
import { ActionInbox } from "../components/home/ActionInbox"
import { VisitorHero } from "../components/home/VisitorHero"
import { ShowcaseBoard } from "../components/home/ShowcaseBoard"
import { BelowFold } from "../components/home/BelowFold"
import { YourWorldsPanel } from "../components/home/panels/YourWorldsPanel"
import "../components/home/home.css"

export interface HomeProps {
    mode: "visitor" | "member"
}

/** Truncate a Gno address to "g1ab…cdef" form (4 + … + 4 chars). */
function truncateAddress(addr: string): string {
    if (addr.length <= 10) return addr
    return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

/** Wallet chips row — balance + address, both optional (honest: omit when absent). */
function WalletChips({ balance, address }: { balance: string; address: string }) {
    const showBalance = balance && balance !== "0"
    const showAddress = !!address

    // If neither chip would render, skip the row entirely
    if (!showBalance && !showAddress) return null

    return (
        <div className="wallet-chips" data-testid="wallet-chips">
            {showBalance && (
                <span className="wallet-chip wallet-chip--balance" data-testid="wallet-chip-balance">
                    {balance}
                </span>
            )}
            {showAddress && (
                <span className="wallet-chip wallet-chip--address" data-testid="wallet-chip-address">
                    {truncateAddress(address)}
                </span>
            )}
        </div>
    )
}

export function Home({ mode }: HomeProps) {
    const { adena, balance } = useOutletContext<LayoutContext>()
    const activeNetworkKey = useNetworkKey()

    if (mode === "visitor") {
        return (
            <div className="home-root" data-testid="home-root">
                {/* Zone 1: brand/network heartbeat */}
                <StatusStrip />

                {/* Zone 2: SPINE — visitor hero */}
                <div className="home-spine" data-testid="home-spine-visitor">
                    <VisitorHero />
                </div>

                {/* Zone 3: BOARD — ShowcaseBoard (board of doors, Phase 1) */}
                <div className="home-state-board" data-testid="home-state-board">
                    <ShowcaseBoard networkKey={activeNetworkKey} />
                    <BelowFold networkKey={activeNetworkKey} />
                </div>
            </div>
        )
    }

    // Member branch — Atlas layout (Task 2.3)
    // A future 3rd mode must NOT fall through here — add an explicit branch above.
    return (
        <div className="home-root" data-testid="home-root">
            {/* Zone 1: brand/network heartbeat + wallet chips */}
            <StatusStrip />
            <WalletChips
                balance={balance}
                address={adena.connected ? adena.address : ""}
            />

            {/* Zone 2: SPINE — action inbox */}
            <div className="home-spine" data-testid="home-spine-member">
                <ActionInbox />
            </div>

            {/* Zone 3: BOARD — your worlds → explore */}
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
