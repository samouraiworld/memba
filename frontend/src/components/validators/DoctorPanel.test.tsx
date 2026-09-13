/**
 * DoctorPanel — consensus diagnostics now come from gnomonitoring's chain-health
 * view. Before this, every consensus alert here (stuck round, BFT threshold,
 * round > 0) read from a client-side parser that threw on every chain, so none
 * of them could ever fire. These tests pin the ones that survive, and pin the
 * ones deliberately NOT ported against returning as false alarms.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { DoctorPanel } from "./DoctorPanel"
import type { ConsensusView } from "../../lib/chainHealthApi"
import type { NetInfo } from "../../lib/validators"

const view = (over: Partial<ConsensusView> = {}): ConsensusView => ({
    height: 4440, round: 0, isStuck: false, valsetSize: 4, totalVotingPower: 240,
    quorum: 161, faultTolerance: 1, precommitCount: 4, latestBlockTime: "2026-09-13T10:00:00Z", peerCount: 13,
    ...over,
})

// A healthy peer set, so only consensus diagnostics can appear.
const healthyNet = {
    peerCount: 10,
    peers: Array.from({ length: 10 }, (_, i) => ({
        nodeId: `node${i}`, moniker: `peer-${i}`, rpcAddr: "tcp://10.0.0.1:26657", remoteHeight: 4440,
    })),
} as unknown as NetInfo

describe("DoctorPanel — consensus diagnostics", () => {
    it("raises an error when the chain is not advancing", () => {
        render(<DoctorPanel netInfo={healthyNet} consensus={view({ isStuck: true })} localHeight={4440} />)
        expect(screen.getByText(/chain is not advancing/i)).toBeInTheDocument()
    })

    it("warns when consensus is past round 0", () => {
        render(<DoctorPanel netInfo={healthyNet} consensus={view({ round: 1 })} localHeight={4440} />)
        expect(screen.getByText(/consensus on round 1 \(expected round 0\)/i)).toBeInTheDocument()
    })

    it("escalates to an error from round 3", () => {
        const { container } = render(<DoctorPanel netInfo={healthyNet} consensus={view({ round: 3 })} localHeight={4440} />)
        expect(screen.getByText(/consensus on round 3/i)).toBeInTheDocument()
        expect(container.querySelector(".hk-doctor__alert--error")).not.toBeNull()
    })

    it("reports all clear for a healthy, advancing chain on round 0", () => {
        render(<DoctorPanel netInfo={healthyNet} consensus={view()} localHeight={4440} />)
        expect(screen.getByText(/no issues detected/i)).toBeInTheDocument()
    })

    it("does not alarm on a partial precommit count taken mid-round", () => {
        // The old "precommits below BFT threshold" alert was gated on round age,
        // which the REST payload does not carry. Without that gate a mid-round
        // snapshot is almost always partial — so it must NOT come back as an alert.
        render(<DoctorPanel netInfo={healthyNet} consensus={view({ precommitCount: 1 })} localHeight={4440} />)
        expect(screen.getByText(/no issues detected/i)).toBeInTheDocument()
        expect(screen.queryByText(/below BFT threshold/i)).not.toBeInTheDocument()
    })

    it("still renders peer diagnostics when consensus data is unavailable", () => {
        render(<DoctorPanel netInfo={healthyNet} consensus={null} localHeight={4440} />)
        expect(screen.getByText(/no issues detected/i)).toBeInTheDocument()
    })
})
