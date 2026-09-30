import { describe, expect, it } from "vitest"
import { weightedConfigSchema, type WeightedBallot } from "./weighted"
import { weightedFixture } from "./testdata/weighted"
import v12Native from "./testdata/weighted-v12/native.json"
import { APPLICATION_POLICY_KEYS } from "./weightedApplications"
import { STATUS_TEXT, applicationRules, ballotText, chainTimeText, decisionRules, durationText, isOpenProposal, isVoteOpen, proposalTimes, roleText, seatText, statusNote, tallyText, weightedReadError } from "./weightedView"

const ballot = (over: Partial<WeightedBallot>): WeightedBallot => ({ schema: "memba-weighted-host/v12", proposalId: "1", voter: "g1voter", eligible: true, choice: null, votedAtHeight: null, ...over })

describe("weighted DAO display text", () => {
    it("states how each category passes from the contract's own numbers", () => {
        const rules = decisionRules(weightedConfigSchema.parse(v12Native.records.config))
        expect(rules.map((r) => r.category)).toEqual(["critical", "financial", "routine"])
        expect(rules[0]).toMatchObject({ routes: ["6 points and at least 4 people, then 24 hours", "5 developers, then 72 hours"], delayed: true })
        expect(rules[1]).toMatchObject({ covers: "fees, treasuries, unpausing and escrow disputes", routes: ["5 points and at least 3 people"], delayed: false })
        expect(rules[2]).toMatchObject({ covers: "moderation", routes: ["3 points and at least 2 people"], delayed: false })
    })

    it("offers only the critical route before the application version, and names recovery only where it exists", () => {
        const v1 = decisionRules(weightedConfigSchema.parse(weightedFixture(1).config))
        expect(v1).toHaveLength(1)
        expect(v1[0].covers).toBe("role changes")
        expect(decisionRules(weightedConfigSchema.parse(weightedFixture(2).config))[0].covers).toBe("role changes and key recoveries")
    })

    it("counts a tally in singular and plural, and says when the contract no longer reports it", () => {
        expect(tallyText({ talliesAvailable: true, weightYes: 2, peopleYes: 1, developersYes: 0 })).toBe("2 points · 1 person · 0 developers voting yes")
        expect(tallyText({ talliesAvailable: true, weightYes: 1, peopleYes: 1, developersYes: 1 })).toBe("1 point · 1 person · 1 developer voting yes")
        expect(tallyText({ talliesAvailable: false, weightYes: null, peopleYes: null, developersYes: null })).toBe("Historical vote totals are unavailable.")
    })

    it("treats a proposal as open until it executes, expires or is invalidated, and its vote as open until the deadline", () => {
        for (const status of ["VOTING", "TIMELOCKED", "READY"] as const) {
            expect(isOpenProposal({ status })).toBe(true)
            expect(isVoteOpen({ status, votingClosed: false })).toBe(true)
            expect(isVoteOpen({ status, votingClosed: true })).toBe(false)
        }
        for (const status of ["EXPIRED", "INVALIDATED", "EXECUTED"] as const) {
            expect(isOpenProposal({ status })).toBe(false)
            expect(isVoteOpen({ status, votingClosed: false })).toBe(false)
        }
        expect(Object.keys(STATUS_TEXT).sort()).toEqual(["EXECUTED", "EXPIRED", "INVALIDATED", "READY", "TIMELOCKED", "VOTING"])
    })

    it("describes a ballot without inventing one", () => {
        expect(ballotText(undefined, true)).toBeNull()
        expect(ballotText("error", true)).toBe("Your ballot could not be read.")
        expect(ballotText(ballot({ eligible: false }), true)).toBe("Your address is not eligible to vote on this proposal.")
        expect(ballotText(ballot({ choice: "no", votedAtHeight: "42" }), true)).toBe("You voted no (block 42).")
        expect(ballotText(ballot({}), true)).toBe("You have not voted.")
        expect(ballotText(ballot({}), false)).toBe("You did not vote.")
    })

    it("explains an invalidation by its cause and reveals hidden characters in the target", () => {
        const invalidated = (invalidation: Parameters<typeof statusNote>[0]["invalidation"]) => statusNote({ status: "INVALIDATED", category: "critical", invalidation })
        expect(invalidated({ cause: "pause", height: "9", proposalId: null, target: "gno.land/r/samcrew/memba_feed_v1" })).toBe("Invalidated at block 9: a member paused gno.land/r/samcrew/memba_feed_v1.")
        expect(invalidated({ cause: "pause", height: "9", proposalId: null, target: "feed\u202e" })).toContain("[U+202E]")
    })

    it("says when voting closes, or that it is over, and from when each way of passing lets it execute, in the reader's time zone", () => {
        const at = { votingDeadline: "2026-11-21T03:56:00Z", weightedAfter: null, developerAfter: null }
        expect(proposalTimes({ ...at, status: "VOTING", votingClosed: false })).toEqual([{ label: "Voting closes", iso: at.votingDeadline, text: chainTimeText(at.votingDeadline) }])
        expect(proposalTimes({ ...at, status: "EXPIRED", votingClosed: true })[0]).toMatchObject({ label: "Voting closed" })
        // The chain closes voting by time only: an executed proposal before its deadline is over, not closing later.
        expect(proposalTimes({ ...at, status: "EXECUTED", votingClosed: false })[0]).toEqual({ label: "Voting", iso: at.votingDeadline, text: "Over (the proposal is executed)" })
        expect(proposalTimes({ ...at, status: "INVALIDATED", votingClosed: false })[0].text).toBe("Over (the proposal is invalidated)")
        expect(proposalTimes({ ...at, status: "TIMELOCKED", votingClosed: true, weightedAfter: "2026-11-22T00:00:00Z", developerAfter: "2026-11-24T00:00:00Z" }).map((t) => t.label))
            .toEqual(["Voting closed", "Executable from (points vote)", "Executable from (developers' vote)"])
        expect(chainTimeText("2026-11-21T03:56:00Z")).toMatch(/2026, \d{2}:\d{2} \S+$/)
    })

    it("states the voting period in days, and route delays in hours", () => {
        expect(durationText(604800)).toBe("7 days")
        expect(durationText(86400)).toBe("1 day")
        expect(durationText(5400)).toBe("1.5 hours")
    })

    it("states each application's rules as the contract enforces them, every operation grouped by the host's category", () => {
        const config = v12Native.records.config as unknown as Record<string, { successor: string } & Record<string, unknown>>
        expect(applicationRules("marketPolicy", config.marketPolicy)).toEqual([
            "Financial votes cover fees and the treasury.",
            `Handing it back takes a critical vote and goes only to ${config.marketPolicy.successor}, who must accept.`,
        ])
        // The App Store policy publishes no fee or treasury category; the host still makes them financial.
        expect(applicationRules("appstorePolicy", config.appstorePolicy).slice(0, 5)).toEqual([
            "Critical votes cover who curates and sealing imported listings.",
            "Financial votes cover fees and the treasury.",
            "Routine votes cover approving, rejecting, delisting and restoring listings, and clearing their flags.",
            "While the DAO controls it, any member can pause it at once; unpausing takes a financial vote.",
            "A fee vote can set at most 100 GNOT.",
        ])
        expect(applicationRules("reviewsPolicy", config.reviewsPolicy)[0]).toBe("Routine votes cover hiding reviews and comments and unhiding them.")
        for (const key of ["channelsPolicy", "feedbackPolicy"] as const) expect(applicationRules(key, config[key])[0]).toBe("Critical votes cover its members, members' roles and creating channels.")
        expect(applicationRules("questPolicy", config.questPolicy)).toHaveLength(2)
        // Every operation has plain words: no contract operation name reaches the reader.
        for (const key of APPLICATION_POLICY_KEYS) expect(applicationRules(key, config[key]).join(" ")).not.toMatch(/\b(accept|return|abort|set|add|remove|hide|seal|clear|refund|pay|create)-[a-z]/)
        expect(applicationRules("feedPolicy", { ...config.feedPolicy, successor: "feed\u202e" }).at(-1)).toContain("[U+202E]")
    })

    it("explains a status only where the status alone does not", () => {
        const at = { cause: "superseded-execution" as const, height: "9", proposalId: "4", target: null }
        expect(statusNote({ status: "INVALIDATED", category: "critical", invalidation: at })).toBe("Invalidated at block 9: proposal #4 executed.")
        // A realm published before invalidation records says only that it happened.
        expect(statusNote({ status: "INVALIDATED", category: "critical" })).toBe("Invalidated: another proposal executed after this was proposed.")
        expect(statusNote({ status: "TIMELOCKED", category: "critical", invalidation: null })).toBe("It passed. It can execute from the earliest time below.")
        expect(statusNote({ status: "READY", category: "financial", invalidation: null })).toBe("Financial proposals can execute as soon as they pass.")
        expect(statusNote({ status: "READY", category: "critical", invalidation: null })).toBeNull()
        for (const status of ["VOTING", "EXPIRED", "EXECUTED"] as const) expect(statusNote({ status, category: "routine", invalidation: null })).toBeNull()
    })

    it("names a seat and its roles", () => {
        expect(seatText({ founder: true, weight: 2 })).toBe("Founder · 2 points")
        expect(seatText({ founder: false, weight: 1 })).toBe("Core developer · 1 point")
        expect(roleText({ admin: true, finance: true })).toBe("Admin · Finance")
        expect(roleText({ admin: false, finance: false })).toBe("No admin or finance role")
    })

    it("keeps a read failure's own message, and explains a contract it cannot validate", () => {
        expect(weightedReadError(new Error("RPC network does not match the selected chain"))).toBe("RPC network does not match the selected chain")
        const invalid = weightedConfigSchema.safeParse({ schema: "memba-weighted-host/v13" })
        expect(invalid.success).toBe(false)
        expect(weightedReadError(invalid.error)).toMatch(/^Could not validate weighted governance data\./)
        expect(weightedReadError("boom")).toMatch(/^Could not validate weighted governance data\./)
    })
})
