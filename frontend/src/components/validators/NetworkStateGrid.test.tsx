/**
 * NetworkStateGrid — consensus rows now come from the chain-health view.
 *
 * Its old consensus source was a client-side parser that threw on every chain,
 * so `min bft`, `margin` and `can add validator` never rendered, and the genesis
 * rows always showed a dash. Two of those were also wrong on their own terms:
 * `min bft` was a validator COUNT where commit safety is decided by voting
 * POWER, and `can add validator` was a hardcoded `true`.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { NetworkStateGrid } from "./NetworkStateGrid"
import type { ConsensusView } from "../../lib/chainHealthApi"
import type { NetworkStats } from "../../lib/validators"

const stats: NetworkStats = {
    blockHeight: 4440, avgBlockTime: 4.1, totalValidators: 4, totalVotingPower: 240,
    chainId: "gnoland-1", catchingUp: false, latestBlockTime: "2026-09-13T10:00:00Z",
}
const view = (over: Partial<ConsensusView> = {}): ConsensusView => ({
    height: 4440, round: 0, isStuck: false, valsetSize: 4, totalVotingPower: 240,
    quorum: 161, faultTolerance: 1, precommitCount: 4, latestBlockTime: "2026-09-13T10:00:00Z", peerCount: 13,
    ...over,
})

describe("NetworkStateGrid", () => {
    it("shows quorum in voting power, not as a validator count", () => {
        render(<NetworkStateGrid stats={stats} consensus={view()} peerCount={13} mempoolCount={0} />)
        expect(screen.getByText("161 of 240")).toBeInTheDocument()
        expect(screen.queryByText(/min bft/i)).not.toBeInTheDocument()
    })

    it("shows how many validators the set can lose", () => {
        render(<NetworkStateGrid stats={stats} consensus={view({ faultTolerance: 1 })} peerCount={13} mempoolCount={0} />)
        expect(screen.getByText("1 failure")).toBeInTheDocument()
    })

    it("drops rows it has no honest source for", () => {
        render(<NetworkStateGrid stats={stats} consensus={view()} peerCount={13} mempoolCount={0} />)
        // Hardcoded `true` in the old parser — never a real answer.
        expect(screen.queryByText(/can add validator/i)).not.toBeInTheDocument()
        // Genesis time is not in any payload this page fetches; the rows only
        // ever displayed a dash.
        expect(screen.queryByText(/genesis time/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/genesis age/i)).not.toBeInTheDocument()
    })

    it("falls back to network stats for the valset when consensus is unavailable", () => {
        render(<NetworkStateGrid stats={stats} consensus={null} peerCount={13} mempoolCount={0} />)
        expect(screen.getByText("gnoland-1")).toBeInTheDocument()
        expect(screen.queryByText("161 of 240")).not.toBeInTheDocument()
    })
})
