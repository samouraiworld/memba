/**
 * Governance Readiness — who can act on the validator set, and how much failure
 * the set can currently absorb.
 *
 * This is the read-only replacement for a rejected feature: a UI that would have
 * let a user draft a GovDAO proposal to eject a "misbehaving" validator. Two of
 * the four reasons it was rejected are facts about the chain that belong on
 * screen rather than behind a button:
 *
 *   - GovDAO membership. Only members can create proposals
 *     (r/gov/dao/impl/v0/govdao.gno), and on gnoland-1 there is exactly ONE.
 *     A public "propose" button would be a paid revert for everyone else.
 *   - Liveness. tm2 needs more than 2/3 of voting power to commit. On the live
 *     4 x 60 set, removing any validator drops fault tolerance from 1 to 0: any
 *     single remaining operator could then halt the chain, and a halted chain
 *     cannot pass the governance proposal that would repair it.
 *
 * Pure: no fetching, no rendering. Inputs come from getMemberstoreTiers (dao/)
 * and the roster's voting powers.
 */

import { computeBftLiveness, type BftLiveness, type ChainValidator } from "./chainHealthApi"
import type { TierInfo } from "./dao/shared"

/** GovDAO's realm. Hardcoded as a literal in directory.ts and daoSlug.ts; this
 *  is the one place the readiness panel reads it from. */
export const GOVDAO_REALM_PATH = "gno.land/r/gov/dao"

export interface GovernanceReadiness {
    /** null when membership could not be read — see buildGovernanceReadiness. */
    govdao: { memberCount: number; tiers: TierInfo[] } | null
    /** The validator set as it stands. */
    liveness: BftLiveness
    /** The same set minus its heaviest validator — the worst case for removing
     *  or losing one. null when fewer than two validators exist. */
    afterLosingLargest: BftLiveness | null
    /** True only when membership was read AND totals exactly one. */
    singleMemberGovernance: boolean
}

const asValidators = (powers: readonly number[]): ChainValidator[] =>
    powers.map((votingPower) => ({ address: "", votingPower, keepRunning: true, serverType: null }))

export function buildGovernanceReadiness(input: {
    tiers: readonly TierInfo[] | null
    votingPowers: readonly number[]
}): GovernanceReadiness {
    // A zero, negative or NaN power is not a validator contributing to quorum;
    // letting one through would shift the 2/3 threshold on bad data.
    const powers = input.votingPowers.filter((p) => Number.isFinite(p) && p > 0)

    const liveness = computeBftLiveness(asValidators(powers))

    let afterLosingLargest: BftLiveness | null = null
    if (powers.length >= 2) {
        const withoutLargest = [...powers].sort((a, b) => b - a).slice(1)
        afterLosingLargest = computeBftLiveness(asValidators(withoutLargest))
    }

    // getMemberstoreTiers returns [] both when the render is missing and when
    // nothing parses, so an empty list is indistinguishable from a failed read.
    // Report it as unknown. "0 members" would be a false and alarming claim
    // about the chain's governance.
    const tiers = input.tiers && input.tiers.length > 0 ? [...input.tiers] : null
    const govdao = tiers
        ? { memberCount: tiers.reduce((sum, t) => sum + t.memberCount, 0), tiers }
        : null

    return {
        govdao,
        liveness,
        afterLosingLargest,
        singleMemberGovernance: govdao !== null && govdao.memberCount === 1,
    }
}
