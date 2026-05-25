import { describe, it, expect } from "vitest"
import {
    computeCycleTimeHistogram,
    computeContributionTiers,
    computeVoteData,
    computeTeamData,
    computeStats,
} from "./gnoloveAnalytics"
import { TimeFilter } from "./gnoloveConstants"

describe("computeCycleTimeHistogram", () => {
    const NOW = new Date("2026-05-25T12:00:00Z").getTime()

    it("returns empty buckets for null input", () => {
        const result = computeCycleTimeHistogram(null, TimeFilter.MONTHLY, NOW)
        expect(result).toHaveLength(7)
        expect(result.every(b => b.count === 0)).toBe(true)
    })

    it("assigns a same-day merge to <1d bucket", () => {
        const merged = [{
            id: "1", title: "fast", url: "https://github.com/gnolang/gno/pull/1",
            createdAt: "2026-05-20T10:00:00Z", mergedAt: "2026-05-20T18:00:00Z",
            author: null, authorLogin: "dev1",
        }]
        const result = computeCycleTimeHistogram(merged as any, TimeFilter.MONTHLY, NOW)
        expect(result[0].label).toBe("<1d")
        expect(result[0].count).toBe(1)
    })

    it("assigns a 5-day merge to 3-7d bucket", () => {
        const merged = [{
            id: "2", title: "medium", url: "https://github.com/gnolang/gno/pull/2",
            createdAt: "2026-05-15T00:00:00Z", mergedAt: "2026-05-20T00:00:00Z",
            author: null, authorLogin: "dev1",
        }]
        const result = computeCycleTimeHistogram(merged as any, TimeFilter.YEARLY, NOW)
        expect(result[2].label).toBe("3-7d")
        expect(result[2].count).toBe(1)
    })

    it("excludes PRs outside the period cutoff", () => {
        const merged = [{
            id: "3", title: "old", url: "https://github.com/gnolang/gno/pull/3",
            createdAt: "2026-01-01T00:00:00Z", mergedAt: "2026-01-02T00:00:00Z",
            author: null, authorLogin: "dev1",
        }]
        const result = computeCycleTimeHistogram(merged as any, TimeFilter.MONTHLY, NOW)
        expect(result.every(b => b.count === 0)).toBe(true)
    })

    it("handles >3mo bucket for very slow PRs", () => {
        const merged = [{
            id: "4", title: "slow", url: "https://github.com/gnolang/gno/pull/4",
            createdAt: "2025-01-01T00:00:00Z", mergedAt: "2026-05-20T00:00:00Z",
            author: null, authorLogin: "dev1",
        }]
        const result = computeCycleTimeHistogram(merged as any, TimeFilter.ALL_TIME, NOW)
        expect(result[6].label).toBe(">3mo")
        expect(result[6].count).toBe(1)
    })
})

describe("computeContributionTiers", () => {
    it("returns empty for undefined input", () => {
        expect(computeContributionTiers(undefined)).toEqual([])
    })

    it("buckets users by PR count", () => {
        const users = [
            { login: "a", TotalPrs: 1, score: 10 },
            { login: "b", TotalPrs: 3, score: 20 },
            { login: "c", TotalPrs: 12, score: 30 },
            { login: "d", TotalPrs: 0, score: 0 },
        ]
        const result = computeContributionTiers({ users, lastSyncedAt: null } as any)
        expect(result[0].count).toBe(1) // 1 PR
        expect(result[1].count).toBe(1) // 2-5
        expect(result[3].count).toBe(1) // 11-25
    })
})

describe("computeVoteData", () => {
    it("returns empty for undefined", () => {
        expect(computeVoteData(undefined)).toEqual([])
    })

    it("aggregates votes per proposal", () => {
        const proposals = [{
            id: "prop1", title: "Add feature X",
            votes: [
                { vote: "YES", voter: "a" },
                { vote: "YES", voter: "b" },
                { vote: "NO", voter: "c" },
            ],
        }]
        const result = computeVoteData(proposals as any)
        expect(result).toHaveLength(1)
        expect(result[0].yes).toBe(2)
        expect(result[0].no).toBe(1)
        expect(result[0].abstain).toBe(0)
    })

    it("truncates long proposal titles", () => {
        const proposals = [{
            id: "prop2", title: "A very long proposal title that exceeds twenty characters",
            votes: [{ vote: "YES", voter: "a" }],
        }]
        const result = computeVoteData(proposals as any)
        expect(result[0].name.length).toBeLessThanOrEqual(23) // 20 + "..."
    })
})

describe("computeTeamData", () => {
    const teams = [
        { slug: "core", name: "Core", color: "purple" as const, description: "", members: ["alice", "bob"] },
    ]
    const colors = { purple: "#a855f7", blue: "#4a9eff", green: "#22c55e", orange: "#f97316", pink: "#ec4899", red: "#ef4444" } as any

    it("returns empty for undefined contributors", () => {
        expect(computeTeamData(undefined, teams, colors)).toEqual([])
    })

    it("sums team member stats", () => {
        const contributors = {
            users: [
                { login: "alice", score: 50, TotalPrs: 10, TotalCommits: 20, TotalIssues: 5, TotalReviewedPullRequests: 3 },
                { login: "bob", score: 30, TotalPrs: 5, TotalCommits: 10, TotalIssues: 2, TotalReviewedPullRequests: 1 },
                { login: "charlie", score: 100, TotalPrs: 50, TotalCommits: 100, TotalIssues: 10, TotalReviewedPullRequests: 20 },
            ],
            lastSyncedAt: null,
        }
        const result = computeTeamData(contributors as any, teams, colors)
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe("Core")
        expect(result[0].score).toBe(80)
        expect(result[0].prs).toBe(15)
    })
})

describe("computeStats", () => {
    it("returns null for undefined contributors", () => {
        expect(computeStats(undefined, [], [], [], [])).toBeNull()
    })

    it("aggregates all metrics", () => {
        const contributors = {
            users: [
                { login: "a", TotalPrs: 10, TotalCommits: 20, TotalIssues: 5, TotalReviewedPullRequests: 3 },
                { login: "b", TotalPrs: 5, TotalCommits: 10, TotalIssues: 2, TotalReviewedPullRequests: 1 },
            ],
            lastSyncedAt: null,
        }
        const result = computeStats(contributors as any, [{} as any, {} as any], [{} as any], [{} as any, {} as any, {} as any], [{} as any])
        expect(result).not.toBeNull()
        expect(result!.totalContributors).toBe(2)
        expect(result!.totalPrs).toBe(15)
        expect(result!.totalCommits).toBe(30)
        expect(result!.totalProposals).toBe(2)
        expect(result!.govdaoMembers).toBe(1)
        expect(result!.totalPackages).toBe(3)
        expect(result!.totalNamespaces).toBe(1)
    })
})
