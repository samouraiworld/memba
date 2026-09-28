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
import type { MonitoringIncident } from "../../lib/gnomonitoring"

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
        render(<DoctorPanel netInfo={healthyNet} consensus={view()} localHeight={4440} incidentsAvailable />)
        expect(screen.getByText(/no issues detected/i)).toBeInTheDocument()
    })

    it("does not alarm on a partial precommit count taken mid-round", () => {
        // The old "precommits below BFT threshold" alert was gated on round age,
        // which the REST payload does not carry. Without that gate a mid-round
        // snapshot is almost always partial — so it must NOT come back as an alert.
        render(<DoctorPanel netInfo={healthyNet} consensus={view({ precommitCount: 1 })} localHeight={4440} incidentsAvailable />)
        expect(screen.getByText(/no issues detected/i)).toBeInTheDocument()
        expect(screen.queryByText(/below BFT threshold/i)).not.toBeInTheDocument()
    })

    it("still renders peer diagnostics when consensus data is unavailable", () => {
        render(<DoctorPanel netInfo={healthyNet} consensus={null} localHeight={4440} />)
        expect(screen.getByText(/unable to assess all network checks/i)).toBeInTheDocument()
        expect(screen.queryByText("ALL OK")).not.toBeInTheDocument()
    })

    it("does not claim the network is healthy without peer or consensus telemetry", () => {
        render(<DoctorPanel netInfo={null} consensus={null} localHeight={0} />)
        expect(screen.getByText(/unable to assess all network checks/i)).toBeInTheDocument()
        expect(screen.queryByText("ALL OK")).not.toBeInTheDocument()
    })

    it("does not treat peers without advertised RPC as unhealthy", () => {
        const privateRpcNet = {
            ...healthyNet,
            peers: healthyNet.peers.map(peer => ({ ...peer, rpcAddr: "" })),
        } as NetInfo
        render(<DoctorPanel netInfo={privateRpcNet} consensus={view()} localHeight={4440} incidentsAvailable />)
        expect(screen.getByText(/no issues detected/i)).toBeInTheDocument()
    })

    it("suppresses an incident after a later resolved event for that validator", () => {
        const time = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
        const incidents: MonitoringIncident[] = [
            { addr: "g1abc", moniker: "alpha", severity: "WARNING", timestamp: time(10), details: "Missed blocks" },
            { addr: "g1abc", moniker: "alpha", severity: "RESOLVED", timestamp: time(5), details: "Recovered" },
        ]
        render(<DoctorPanel netInfo={healthyNet} consensus={view()} localHeight={4440} incidents={incidents} incidentsAvailable />)
        expect(screen.queryByText(/WARNING: alpha/)).not.toBeInTheDocument()
        expect(screen.getByText(/no issues detected/i)).toBeInTheDocument()
    })

    it("shows the latest active incident for a validator", () => {
        const time = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
        const incidents: MonitoringIncident[] = [
            { addr: "g1abc", moniker: "alpha", severity: "RESOLVED", timestamp: time(10), details: "Recovered" },
            { addr: "g1abc", moniker: "alpha", severity: "CRITICAL", timestamp: time(5), details: "Stopped" },
        ]
        render(<DoctorPanel netInfo={healthyNet} consensus={view()} localHeight={4440} incidents={incidents} incidentsAvailable />)
        expect(screen.getByText(/CRITICAL: alpha — Stopped/)).toBeInTheDocument()
    })

    it("does not present an old incident as a current alert", () => {
        const incidents: MonitoringIncident[] = [
            { addr: "g1abc", moniker: "alpha", severity: "CRITICAL", timestamp: new Date(Date.now() - 48 * 60 * 60_000).toISOString(), details: "Stopped" },
        ]
        render(<DoctorPanel netInfo={healthyNet} consensus={view()} localHeight={4440} incidents={incidents} incidentsAvailable />)
        expect(screen.queryByText(/CRITICAL: alpha/)).not.toBeInTheDocument()
        expect(screen.getByText(/no issues detected/i)).toBeInTheDocument()
    })

    it("withholds all clear when incidents could not be fetched", () => {
        render(<DoctorPanel netInfo={healthyNet} consensus={view()} localHeight={4440} />)
        expect(screen.queryByText("ALL OK")).not.toBeInTheDocument()
        expect(screen.getByText(/incident data is unavailable/i)).toBeInTheDocument()
    })
})
