/**
 * Tests for gnoloveFilters.ts — Team filter and sort logic.
 *
 * Covers the fix from fix/gnolove-team-filter-logic branch:
 * When teams are excluded, only show members of the remaining active teams
 * (non-team contributors are excluded when any filter is active).
 *
 * @module lib/gnoloveFilters.test
 */

import { describe, it, expect } from "vitest"
import { deriveExcludeLogins, filterAndSortContributors } from "./gnoloveFilters"
import type { ContributorEntry } from "./gnoloveFilters"

// ── Test fixtures ────────────────────────────────────────────

const coreTeamMember: ContributorEntry = { login: "moul", score: 100, TotalCommits: 50, TotalPrs: 30, TotalIssues: 10, TotalReviewedPullRequests: 20 }
const samouraiMember: ContributorEntry = { login: "zxxma", score: 80, TotalCommits: 40, TotalPrs: 20, TotalIssues: 5, TotalReviewedPullRequests: 15 }
const onblocMember: ContributorEntry = { login: "notJoon", score: 60, TotalCommits: 30, TotalPrs: 15, TotalIssues: 8, TotalReviewedPullRequests: 10 }
const nonTeamMember: ContributorEntry = { login: "random-contributor", score: 50, TotalCommits: 20, TotalPrs: 10, TotalIssues: 3, TotalReviewedPullRequests: 5 }
const allUsers = [coreTeamMember, samouraiMember, onblocMember, nonTeamMember]

// ── deriveExcludeLogins ──────────────────────────────────────

describe("deriveExcludeLogins", () => {
    it("returns undefined when no teams are excluded", () => {
        expect(deriveExcludeLogins(new Set())).toBeUndefined()
    })

    it("returns logins of excluded team members", () => {
        const excluded = new Set(["Core Team"])
        const logins = deriveExcludeLogins(excluded)
        expect(logins).toBeDefined()
        expect(logins).toContain("moul")
        expect(logins).toContain("jaekwon")
        expect(logins).not.toContain("zxxma")
    })

    it("returns combined logins for multiple excluded teams", () => {
        const excluded = new Set(["Core Team", "Samourai.world"])
        const logins = deriveExcludeLogins(excluded)
        expect(logins).toContain("moul")
        expect(logins).toContain("zxxma")
        expect(logins).not.toContain("notJoon")
    })

    it("returns undefined for non-existent team name", () => {
        const excluded = new Set(["Fake Team"])
        expect(deriveExcludeLogins(excluded)).toBeUndefined()
    })
})

// ── filterAndSortContributors ────────────────────────────────

describe("filterAndSortContributors", () => {
    it("returns all users sorted by score desc when no teams excluded", () => {
        const result = filterAndSortContributors(allUsers, new Set(), "score", "desc")
        expect(result).toHaveLength(4)
        expect(result[0].login).toBe("moul") // score 100
        expect(result[3].login).toBe("random-contributor") // score 50
    })

    it("sorts by score ascending", () => {
        const result = filterAndSortContributors(allUsers, new Set(), "score", "asc")
        expect(result[0].login).toBe("random-contributor") // score 50
        expect(result[3].login).toBe("moul") // score 100
    })

    it("sorts by TotalCommits", () => {
        const result = filterAndSortContributors(allUsers, new Set(), "TotalCommits", "desc")
        expect(result[0].login).toBe("moul") // 50 commits
    })

    it("sorts by TotalPrs", () => {
        const result = filterAndSortContributors(allUsers, new Set(), "TotalPrs", "desc")
        expect(result[0].login).toBe("moul") // 30 PRs
    })

    // ── KEY FIX TEST: Excluding a team filters out non-team members too ──

    it("when a team is excluded, only shows remaining active team members (not non-team contributors)", () => {
        const excluded = new Set(["Core Team"])
        const result = filterAndSortContributors(allUsers, excluded, "score", "desc")
        // Should show: samouraiMember, onblocMember
        // Should NOT show: coreTeamMember (excluded), nonTeamMember (not in any active team)
        expect(result).toHaveLength(2)
        expect(result.map(u => u.login)).toContain("zxxma")
        expect(result.map(u => u.login)).toContain("notJoon")
        expect(result.map(u => u.login)).not.toContain("moul")
        expect(result.map(u => u.login)).not.toContain("random-contributor")
    })

    it("excluding multiple teams narrows results to remaining team members", () => {
        const excluded = new Set(["Core Team", "Onbloc"])
        const result = filterAndSortContributors(allUsers, excluded, "score", "desc")
        // Only Samourai.world member remains
        expect(result).toHaveLength(1)
        expect(result[0].login).toBe("zxxma")
    })

    it("excluding ALL teams returns empty list", () => {
        const allTeamNames = new Set([
            "Core Team", "All in Bits", "Onbloc", "VarMeta",
            "Samourai.world", "Berty", "DevX", "Grants",
        ])
        const result = filterAndSortContributors(allUsers, allTeamNames, "score", "desc")
        expect(result).toHaveLength(0)
    })

    it("handles users with missing score gracefully", () => {
        const users: ContributorEntry[] = [
            { login: "moul", score: undefined, TotalCommits: 10 },
            { login: "zxxma", score: 50 },
        ]
        const result = filterAndSortContributors(users, new Set(), "score", "desc")
        expect(result[0].login).toBe("zxxma") // 50 vs undefined (0)
    })

    it("does not mutate original array", () => {
        const original = [...allUsers]
        filterAndSortContributors(allUsers, new Set(), "score", "asc")
        expect(allUsers).toEqual(original)
    })
})
