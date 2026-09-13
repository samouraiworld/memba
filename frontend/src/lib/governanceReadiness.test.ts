/**
 * Governance Readiness — the read-only replacement for the rejected
 * "propose ejection" UI.
 *
 * That UI was rejected on four grounds, two of which this view model now states
 * on screen instead of hiding behind a button: GovDAO on gnoland-1 has exactly
 * ONE member (so nobody else can act), and removing any validator from the live
 * 4-validator set drops Byzantine fault tolerance from 1 to 0 (so the action
 * would make the chain haltable by any single operator).
 *
 * Numbers below are the live gnoland-1 values measured 2026-09-12/13.
 */

import { describe, it, expect } from "vitest"
import { buildGovernanceReadiness } from "./governanceReadiness"
import type { TierInfo } from "./dao/shared"

const LIVE_TIERS: TierInfo[] = [
    { tier: "T1", memberCount: 1, power: 3 },
    { tier: "T2", memberCount: 0, power: 0 },
    { tier: "T3", memberCount: 0, power: 0 },
]
const LIVE_POWERS = [60, 60, 60, 60]

describe("buildGovernanceReadiness", () => {
    it("reports the live set: 4 validators, quorum 161, tolerates one failure", () => {
        const r = buildGovernanceReadiness({ tiers: LIVE_TIERS, votingPowers: LIVE_POWERS })
        expect(r.liveness.validatorCount).toBe(4)
        expect(r.liveness.totalVotingPower).toBe(240)
        expect(r.liveness.quorum).toBe(161)
        expect(r.liveness.faultTolerance).toBe(1)
    })

    it("shows what losing the largest validator would do: tolerance falls to zero", () => {
        // 180 - 60 = 120 against a quorum of 121 — short by ONE unit.
        const r = buildGovernanceReadiness({ tiers: LIVE_TIERS, votingPowers: LIVE_POWERS })
        expect(r.afterLosingLargest).not.toBeNull()
        expect(r.afterLosingLargest!.validatorCount).toBe(3)
        expect(r.afterLosingLargest!.quorum).toBe(121)
        expect(r.afterLosingLargest!.faultTolerance).toBe(0)
    })

    it("removes the HEAVIEST validator for the what-if, not an arbitrary one", () => {
        // Worst case is what matters: losing the 100 leaves 30 of 130.
        const r = buildGovernanceReadiness({ tiers: LIVE_TIERS, votingPowers: [10, 100, 10, 10] })
        expect(r.afterLosingLargest!.totalVotingPower).toBe(30)
    })

    it("sums GovDAO membership across tiers and flags single-member governance", () => {
        const r = buildGovernanceReadiness({ tiers: LIVE_TIERS, votingPowers: LIVE_POWERS })
        expect(r.govdao).not.toBeNull()
        expect(r.govdao!.memberCount).toBe(1)
        expect(r.govdao!.tiers).toHaveLength(3)
        expect(r.singleMemberGovernance).toBe(true)
    })

    it("does not flag single-member governance once a second member exists", () => {
        const tiers: TierInfo[] = [{ tier: "T1", memberCount: 2, power: 6 }, { tier: "T2", memberCount: 1, power: 2 }]
        const r = buildGovernanceReadiness({ tiers, votingPowers: LIVE_POWERS })
        expect(r.govdao!.memberCount).toBe(3)
        expect(r.singleMemberGovernance).toBe(false)
    })

    it("treats unreadable membership as UNKNOWN, never as zero members", () => {
        // getMemberstoreTiers returns [] both when the render is missing and when
        // nothing parses. "0 members" would be a false, alarming claim about the
        // chain's governance; the honest state is "we could not read it".
        for (const tiers of [null, []] as const) {
            const r = buildGovernanceReadiness({ tiers, votingPowers: LIVE_POWERS })
            expect(r.govdao, `tiers=${JSON.stringify(tiers)}`).toBeNull()
            expect(r.singleMemberGovernance).toBe(false)
        }
    })

    it("has no what-if for a set that cannot lose a validator and remain a set", () => {
        expect(buildGovernanceReadiness({ tiers: LIVE_TIERS, votingPowers: [60] }).afterLosingLargest).toBeNull()
        const empty = buildGovernanceReadiness({ tiers: LIVE_TIERS, votingPowers: [] })
        expect(empty.afterLosingLargest).toBeNull()
        expect(empty.liveness.validatorCount).toBe(0)
    })

    it("ignores non-positive and non-finite powers rather than letting them skew quorum", () => {
        const r = buildGovernanceReadiness({ tiers: LIVE_TIERS, votingPowers: [60, 60, 60, 60, 0, NaN, -5] })
        expect(r.liveness.validatorCount).toBe(4)
        expect(r.liveness.totalVotingPower).toBe(240)
    })
})
