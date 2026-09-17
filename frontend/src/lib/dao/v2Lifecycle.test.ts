import { describe, expect, it } from "vitest"
import { canVoteNow, executionState, powerPercent, relativeTime, type V2Proposal } from "./v2Lifecycle"

const base = {
    id: 1, title: "t", category: "governance", author: "g1x", action: { kind: "text", target: "", power: 0, roles: [] },
    electorate_power: 3, electorate_version: 0, created_at: 1_000, voting_ends_at: 2_000, status: "ACTIVE",
    yes: 0, no: 0, abstain: 0, accepted_at: 0, executable_at: 0, execute_by: 0,
} as V2Proposal

describe("version-2 proposal lifecycle", () => {
    it("formats relative times", () => {
        expect(relativeTime(1_030, 1_000)).toBe("now")
        expect(relativeTime(1_000 + 3 * 3600 + 20 * 60, 1_000)).toBe("in 3h 20m")
        expect(relativeTime(1_000, 1_000 + 2 * 86400 + 4 * 3600)).toBe("2d 4h ago")
        expect(relativeTime(1_000 + 5 * 60, 1_000)).toBe("in 5m")
    })

    it("allows votes only while ACTIVE and before the deadline", () => {
        expect(canVoteNow(base, 1_999)).toBe(true)
        expect(canVoteNow(base, 2_000)).toBe(false)
        expect(canVoteNow({ ...base, status: "ACCEPTED" }, 1_500)).toBe(false)
    })

    it("follows the realm's execution window: from executable_at through execute_by", () => {
        const accepted = { ...base, status: "ACCEPTED", accepted_at: 1_500, executable_at: 5_100, execute_by: 91_500 } as V2Proposal
        expect(executionState(base, 9_999)).toBe("not-accepted")
        expect(executionState(accepted, 5_099)).toBe("too-early")
        expect(executionState(accepted, 5_100)).toBe("open")
        expect(executionState(accepted, 91_500)).toBe("open")
        expect(executionState(accepted, 91_501)).toBe("closed")
    })

    it("computes power percentages", () => {
        expect(powerPercent(1, 3)).toBe(33.3)
        expect(powerPercent(0, 0)).toBe(0)
    })
})
