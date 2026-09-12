/**
 * ConsensusWidget — regression cover for a card that rendered NOTHING.
 *
 * This component and the eight others on the telemetry page had no tests at all,
 * which is precisely why nobody noticed that its data source threw on every
 * chain and the card removed itself from the DOM. The first assertion below is
 * the one that would have caught it.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ConsensusWidget } from "./ConsensusWidget"
import type { ConsensusView } from "../../lib/chainHealthApi"

const view = (over: Partial<ConsensusView> = {}): ConsensusView => ({
    height: 4440, round: 0, isStuck: false,
    valsetSize: 4, totalVotingPower: 240, quorum: 161, faultTolerance: 1,
    precommitCount: 3, latestBlockTime: "2026-09-12T21:07:18Z", peerCount: 13,
    ...over,
})

describe("ConsensusWidget", () => {
    it("still renders a card when there is no data — it must never vanish", () => {
        // THE regression. The old component did `if (!cs && !loading) return null`,
        // so a null source left a hole in the grid instead of the "unavailable"
        // message it already had written. A telemetry card that disappears tells
        // the reader nothing; one that says it has no data tells them where to look.
        const { container } = render(<ConsensusWidget view={null} loading={false} />)
        expect(container.querySelector("#hk-consensus-widget")).toBeInTheDocument()
        expect(screen.getByText(/unavailable/i)).toBeInTheDocument()
    })

    it("distinguishes 'still loading' from 'we asked and got nothing'", () => {
        render(<ConsensusWidget view={null} loading={true} />)
        expect(screen.getByText(/loading consensus state/i)).toBeInTheDocument()
    })

    it("renders height, round and precommit progress", () => {
        render(<ConsensusWidget view={view()} loading={false} />)
        expect(screen.getByText("4,440")).toBeInTheDocument()
        expect(screen.getByRole("progressbar", { name: /3 of 4 validators have precommitted/i }))
            .toBeInTheDocument()
    })

    it("labels quorum as voting power, distinct from the validator count", () => {
        // The old card showed `min bft` = ceil(valsetSize * 2/3) = 3, a COUNT,
        // beside a valset of 4. Those units only coincide while weights are equal.
        render(<ConsensusWidget view={view()} loading={false} />)
        expect(screen.getByText("161")).toBeInTheDocument()   // quorum, in power
        expect(screen.getByText("240")).toBeInTheDocument()   // total power
        expect(screen.getByText("4")).toBeInTheDocument()     // valset count
    })

    it("warns explicitly when the set cannot absorb a single failure", () => {
        render(<ConsensusWidget view={view({ faultTolerance: 0, valsetSize: 3 })} loading={false} />)
        expect(screen.getByText(/0 failures/i)).toBeInTheDocument()
        expect(screen.getByText(/would halt consensus/i)).toBeInTheDocument()
    })

    it("does not cry halt on a healthy set", () => {
        render(<ConsensusWidget view={view({ faultTolerance: 1 })} loading={false} />)
        expect(screen.getByText(/1 failure$/i)).toBeInTheDocument()
        expect(screen.queryByText(/would halt consensus/i)).not.toBeInTheDocument()
    })

    it("surfaces a stuck chain — a reachable RPC is not a live chain", () => {
        render(<ConsensusWidget view={view({ isStuck: true })} loading={false} />)
        expect(screen.getByText(/not advancing/i)).toBeInTheDocument()
    })

    it("flags a non-zero round, which means the previous one failed to commit", () => {
        render(<ConsensusWidget view={view({ round: 2 })} loading={false} />)
        expect(screen.getByText(/round > 0/i)).toBeInTheDocument()
    })
})
