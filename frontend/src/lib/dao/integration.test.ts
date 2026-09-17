/**
 * ABCI Render() format integration tests.
 *
 * These tests validate that our parsers correctly handle real-world
 * Render() output variations from test12, gnoland1, and GovDAO v3.
 *
 * Purpose: Catch upstream format changes (gno#5037, gno#5222) early
 * by testing against representative samples of each format variant.
 *
 * @format-dependent — Update these samples when Gno upstream changes Render() output.
 */
import { describe, it, expect } from "vitest"
import {
    _parseProposalList,
    _parseMemberstoreTiers,
    _parseMembersFromRender,
    _normalizeStatus,
    GOVDAO_VOTE_FUNC,
    GOVDAO_EXECUTE_FUNC,
    buildDaoMsg,
    isGovDAOPath as isGovDAO,
} from "./index"
import { bech32Encode } from "./realmAddress"

// ── GovDAO v3 Render() format — full page sample ────────────────

const GOVDAO_V3_FULL_PAGE = `# GovDAO

This is the governance DAO for the Gno blockchain.

[> Go to Memberstore <](https://test12.gno.land/r/gov/dao/v3/memberstore)

## Proposals

### [Prop #42 - Add validator node alpha](link)
Author: [@zooma](https://gno.land/u/zooma)
Category: governance
Status: ACTIVE
Tiers eligible to vote: T1, T2, T3

---

### [Prop #41 - Treasury transfer to dev fund](link)
Author: [@samcrew](https://gno.land/u/samcrew)
Category: treasury
Status: ACCEPTED
Tiers eligible to vote: T1

---

### [Prop #40 - Remove inactive member](link)
Author: g1abcdef1234567890abcdef1234567890abcdef
Category: membership
Status: REJECTED
Tiers eligible to vote: T1, T2

---

### [Prop #39 - Protocol upgrade v2](link)
Author: [@lours](https://gno.land/u/lours)
Category: governance
Status: EXECUTED
Tiers eligible to vote: T1, T2, T3

---

**1** | [2](?page=2) | [3](?page=3)
`

describe("GovDAO v3 full page parsing", () => {
    it("parses all 4 proposals from a full page", () => {
        const proposals = _parseProposalList(GOVDAO_V3_FULL_PAGE)
        expect(proposals).toHaveLength(4)
    })

    it("parses proposal IDs in descending order", () => {
        const proposals = _parseProposalList(GOVDAO_V3_FULL_PAGE)
        expect(proposals.map(p => p.id)).toEqual([42, 41, 40, 39])
    })

    it("maps all status values correctly", () => {
        const proposals = _parseProposalList(GOVDAO_V3_FULL_PAGE)
        expect(proposals[0].status).toBe("open")       // ACTIVE
        expect(proposals[1].status).toBe("passed")      // ACCEPTED
        expect(proposals[2].status).toBe("rejected")    // REJECTED
        expect(proposals[3].status).toBe("executed")    // EXECUTED
    })

    it("parses @username authors with profile URLs", () => {
        const proposals = _parseProposalList(GOVDAO_V3_FULL_PAGE)
        expect(proposals[0].author).toBe("@zooma")
        expect(proposals[0].authorProfile).toBe("https://gno.land/u/zooma")
    })

    it("parses raw g1 address authors", () => {
        const proposals = _parseProposalList(GOVDAO_V3_FULL_PAGE)
        expect(proposals[2].author).toBe("g1abcdef1234567890abcdef1234567890abcdef")
    })

    it("parses categories correctly", () => {
        const proposals = _parseProposalList(GOVDAO_V3_FULL_PAGE)
        expect(proposals[0].category).toBe("governance")
        expect(proposals[1].category).toBe("treasury")
        expect(proposals[2].category).toBe("membership")
    })

    it("parses tier eligibility", () => {
        const proposals = _parseProposalList(GOVDAO_V3_FULL_PAGE)
        expect(proposals[0].tiers).toEqual(["T1", "T2", "T3"])
        expect(proposals[1].tiers).toEqual(["T1"])
        expect(proposals[2].tiers).toEqual(["T1", "T2"])
    })
})

// ── Memberstore Render() format ──────────────────────────────────

const MEMBERSTORE_FULL = `# Memberstore

This memberstore tracks all GovDAO members.

Tier T1 contains 11 members with power: 33
Tier T2 contains 5 members with power: 10
Tier T3 contains 20 members with power: 20

## Members

### T1 Members
- g1addr1 (power: 3)
- g1addr2 (power: 3)
`

describe("Memberstore tier parsing (real format)", () => {
    it("parses all 3 tiers from full memberstore page", () => {
        const tiers = _parseMemberstoreTiers(MEMBERSTORE_FULL)
        expect(tiers).toHaveLength(3)
    })

    it("preserves tier order and values", () => {
        const tiers = _parseMemberstoreTiers(MEMBERSTORE_FULL)
        expect(tiers[0]).toEqual({ tier: "T1", memberCount: 11, power: 33 })
        expect(tiers[1]).toEqual({ tier: "T2", memberCount: 5, power: 10 })
        expect(tiers[2]).toEqual({ tier: "T3", memberCount: 20, power: 20 })
    })

    it("handles single member (singular grammar)", () => {
        const tiers = _parseMemberstoreTiers("Tier T1 contains 1 member with power: 3")
        expect(tiers).toHaveLength(1)
        expect(tiers[0].memberCount).toBe(1)
    })
})

// ── Memba DAO (basedao) member format ────────────────────────────

const V = (i: number) => bech32Encode("g", new Uint8Array(20).fill(i))

const MEMBA_DAO_MEMBERS_V530 = `# MyDAO

A community governance DAO.

## Members (5)
- ${V(1)} (roles: admin, dev) | power: 3
- ${V(2)} (roles: dev) | power: 2
- ${V(3)} (roles: member) | power: 1
- ${V(4)} (roles: finance, ops) | power: 2
- ${V(5)} (roles: member) | power: 1
`

describe("Memba DAO member parsing (v5.3.0 format)", () => {
    it("parses all 5 members", () => {
        const members = _parseMembersFromRender(MEMBA_DAO_MEMBERS_V530)
        expect(members).toHaveLength(5)
    })

    it("parses multiple roles correctly", () => {
        const members = _parseMembersFromRender(MEMBA_DAO_MEMBERS_V530)
        expect(members[0].roles).toEqual(["admin", "dev"])
        expect(members[3].roles).toEqual(["finance", "ops"])
    })

    it("parses voting power", () => {
        const members = _parseMembersFromRender(MEMBA_DAO_MEMBERS_V530)
        expect(members[0].votingPower).toBe(3)
        expect(members[2].votingPower).toBe(1)
    })
})

// ── basedao fallback proposal format ─────────────────────────────

const BASEDAO_PROPOSALS = `# MyDAO

A community DAO.

## Proposals

### Proposal #1: Deploy token contract
Status: ACTIVE

### Proposal #2: Increase treasury allocation
Status: ACCEPTED

### Proposal #3: Archive old channels
Status: EXECUTED
`

describe("basedao proposal format parsing", () => {
    it("parses basedao simple format", () => {
        const proposals = _parseProposalList(BASEDAO_PROPOSALS)
        expect(proposals).toHaveLength(3)
    })

    it("parses sequential IDs", () => {
        const proposals = _parseProposalList(BASEDAO_PROPOSALS)
        expect(proposals.map(p => p.id)).toEqual([1, 2, 3])
    })

    it("parses titles from colon-separated format", () => {
        const proposals = _parseProposalList(BASEDAO_PROPOSALS)
        expect(proposals[0].title).toBe("Deploy token contract")
    })
})

// ── GovDAO function name constants (gno#5222 migration) ──────────

describe("GovDAO function name constants", () => {
    it("GOVDAO_VOTE_FUNC is MustVoteOnProposalSimple", () => {
        expect(GOVDAO_VOTE_FUNC).toBe("MustVoteOnProposalSimple")
    })

    it("buildDaoMsg uses the GovDAO functions for GovDAO", () => {
        const caller = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
        expect(buildDaoMsg("govdao", "gno.land/r/gov/dao", { type: "vote", id: 1, vote: "YES" }, caller).value.func).toBe(GOVDAO_VOTE_FUNC)
        expect(buildDaoMsg("govdao", "gno.land/r/gov/dao", { type: "execute", id: 1 }, caller).value.func).toBe(GOVDAO_EXECUTE_FUNC)
    })

    it("buildDaoMsg uses VoteOnProposal for version-1 Memba DAOs", () => {
        const msg = buildDaoMsg("memba-v1", "gno.land/r/samcrew/mydao", { type: "vote", id: 1, vote: "YES" }, "g1manfred47kzduec920z88wfr64ylksmdcedlf5")
        expect(msg.value.func).toBe("VoteOnProposal")
    })
})

// ── isGovDAO path detection ──────────────────────────────────────

describe("isGovDAO path detection (comprehensive)", () => {
    it("detects standard GovDAO path", () => {
        expect(isGovDAO("gno.land/r/gov/dao")).toBe(true)
    })

    it("rejects versioned and sub-paths (exact match only)", () => {
        expect(isGovDAO("gno.land/r/gov/dao/v3")).toBe(false)
        expect(isGovDAO("gno.land/r/gov/dao/v3/memberstore")).toBe(false)
    })

    it("rejects lookalike paths in another namespace", () => {
        expect(isGovDAO("gno.land/r/alice/gov/dao")).toBe(false)
    })

    it("rejects user DAOs", () => {
        expect(isGovDAO("gno.land/r/samcrew/memba_dao")).toBe(false)
    })

    it("rejects similar-looking paths", () => {
        expect(isGovDAO("gno.land/r/user/governance")).toBe(false)
    })
})

// ── normalizeStatus edge cases ───────────────────────────────────

describe("normalizeStatus edge cases", () => {
    const statusMap: Array<[string, string]> = [
        ["ACTIVE", "open"],
        ["ACCEPTED", "passed"],
        ["REJECTED", "rejected"],
        ["EXECUTED", "executed"],
        ["passed", "passed"],
        ["failed", "rejected"],
        ["completed", "executed"],
        ["TIMED_OUT", "open"],  // unknown → defaults to open
        ["", "open"],
    ]

    for (const [input, expected] of statusMap) {
        it(`maps "${input}" to "${expected}"`, () => {
            expect(_normalizeStatus(input)).toBe(expected)
        })
    }
})
