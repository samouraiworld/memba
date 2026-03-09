/**
 * Unit tests for leaderboard queries + scoring.
 */
import { describe, it, expect } from "vitest"
import { calculateScore, sortEntries } from "./queries"
import type { LeaderboardEntry } from "./queries"

// ── calculateScore ────────────────────────────────────────────

describe("calculateScore", () => {
    it("applies correct weights (packages=10, proposals=5, votes=2, contributions=1)", () => {
        expect(calculateScore({ packages: 1, proposals: 1, votes: 1, contributions: 1 })).toBe(18)
    })

    it("handles zero stats", () => {
        expect(calculateScore({ packages: 0, proposals: 0, votes: 0 })).toBe(0)
    })

    it("handles missing contributions", () => {
        expect(calculateScore({ packages: 3, proposals: 2, votes: 5 })).toBe(50)
    })

    it("large values compute correctly", () => {
        expect(calculateScore({ packages: 100, proposals: 50, votes: 200, contributions: 500 })).toBe(2150)
    })
})

// ── sortEntries ───────────────────────────────────────────────

describe("sortEntries", () => {
    const entries: LeaderboardEntry[] = [
        { address: "g1a", username: "alice", packages: 5, proposals: 10, votes: 20, score: 150 },
        { address: "g1b", username: "bob", packages: 10, proposals: 5, votes: 5, score: 135 },
        { address: "g1c", username: "charlie", packages: 3, proposals: 15, votes: 10, score: 125 },
    ]

    it("sorts by score descending", () => {
        const sorted = sortEntries(entries, "score", "desc")
        expect(sorted[0].username).toBe("alice")
        expect(sorted[2].username).toBe("charlie")
    })

    it("sorts by score ascending", () => {
        const sorted = sortEntries(entries, "score", "asc")
        expect(sorted[0].username).toBe("charlie")
        expect(sorted[2].username).toBe("alice")
    })

    it("sorts by packages descending", () => {
        const sorted = sortEntries(entries, "packages", "desc")
        expect(sorted[0].username).toBe("bob")
    })

    it("sorts by proposals descending", () => {
        const sorted = sortEntries(entries, "proposals", "desc")
        expect(sorted[0].username).toBe("charlie")
    })

    it("sorts by votes descending", () => {
        const sorted = sortEntries(entries, "votes", "desc")
        expect(sorted[0].username).toBe("alice")
    })

    it("does not mutate original array", () => {
        const original = [...entries]
        sortEntries(entries, "packages", "asc")
        expect(entries).toEqual(original)
    })
})
