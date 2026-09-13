import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { HackerStatusBar } from "./HackerStatusBar"
import type { ConsensusView } from "../../lib/chainHealthApi"
import type { NetworkStats } from "../../lib/validators"

const stats: NetworkStats = {
    blockHeight: 4000, avgBlockTime: 4.1, totalValidators: 4, totalVotingPower: 240,
    chainId: "gnoland-1", catchingUp: false, latestBlockTime: "2026-09-13T10:00:00Z",
}
const view: ConsensusView = {
    height: 4440, round: 0, isStuck: false, valsetSize: 4, totalVotingPower: 240,
    quorum: 161, faultTolerance: 1, precommitCount: 4, latestBlockTime: "2026-09-13T10:00:00Z", peerCount: 13,
}

describe("HackerStatusBar", () => {
    it("prefers the live consensus height, which refreshes far more often than stats", () => {
        render(<HackerStatusBar stats={stats} consensus={view} netInfo={null} lastUpdated={null} />)
        expect(screen.getByText("4,440")).toBeInTheDocument()
    })

    it("falls back to network stats when the consensus view is unavailable", () => {
        render(<HackerStatusBar stats={stats} consensus={null} netInfo={null} lastUpdated={null} />)
        expect(screen.getByText("4,000")).toBeInTheDocument()
    })
})
