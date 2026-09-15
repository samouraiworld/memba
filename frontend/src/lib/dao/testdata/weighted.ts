// Synthetic public roster shared by browser and unit contract checks.
import { bech32Encode } from "../realmAddress"
export const weightedRealm = "gno.land/r/samcrew/memba_dao"
export function weightedFixture() {
    const members = Array.from({ length: 7 }, (_, i) => ({
        personId: i === 0 ? 'Founder zôÖma 🚀 "\\' : `Developer ${i}`,
        address: bech32Encode("g", Uint8Array.from({ length: 20 }, (_, n) => n === 19 ? i + 1 : 0)),
        founder: i === 0, weight: i === 0 ? 2 : 1, admin: i === 0, finance: i === 0,
    }))
    const config = { schema: "memba-weighted-host/v1", kind: "config", realmPath: weightedRealm, rosterSize: 7, totalPoints: 8, founderWeight: 2, developerWeight: 1, votingPeriodSeconds: 604800, maxProposalPage: 50,
        mutableRoles: ["admin", "finance"], roleChanges: { category: "critical", weightedPoints: 6, weightedPeople: 4, weightedDelaySeconds: 86400, independentDevelopers: 5, independentDelaySeconds: 259200 },
        capabilities: { roleProposals: true, memberReplacement: false, migration: false, treasuryExecution: false, applicationActions: false },
    }
    const proposal = { id: "1", proposer: members[0].address, action: { type: "set-role", target: members[1].address, role: "admin", grant: true }, category: "critical", status: "VOTING", qualified: false, ready: false, votingClosed: false, talliesAvailable: true, weightYes: 2, peopleYes: 1, developersYes: 0,
        createdAt: "2026-09-15T10:00:00Z", votingDeadline: "2026-09-22T10:00:00Z", weightedAfter: null, developerAfter: null }
    const roster = { schema: config.schema, kind: "members", members }
    const page = { schema: config.schema, kind: "proposals", total: "1", proposals: [proposal], nextBefore: null }
    return { config, members, roster, proposal, page }
}
export function qevalWire(value: unknown) { return `(${JSON.stringify(JSON.stringify(value))} string)` }
