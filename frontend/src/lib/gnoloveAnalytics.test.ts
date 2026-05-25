import { describe, it, expect } from "vitest"
import {
    computeCycleTimeHistogram,
    computeContributionTiers,
    computeVoteData,
    computeTeamData,
    computeStats,
} from "./gnoloveAnalytics"
import { TimeFilter } from "./gnoloveConstants"
import type { TeamColor, Team } from "./gnoloveConstants"
import type { TPullRequest, TContributorsResponse, TProposal, TGovdaoMember, TPackage, TNamespace } from "./gnoloveSchemas"

const makeMergedPr = (overrides: Partial<TPullRequest> = {}): TPullRequest => ({
    createdAt: "2026-05-20T10:00:00Z",
    updatedAt: "2026-05-20T18:00:00Z",
    id: "1",
    number: 1,
    state: "merged",
    title: "fast",
    url: "https://github.com/gnolang/gno/pull/1",
    mergedAt: "2026-05-20T18:00:00Z",
    author: null,
    authorLogin: "dev1",
    ...overrides,
})

const makeContributors = (
    users: TContributorsResponse["users"],
): TContributorsResponse => ({ users, lastSyncedAt: null })

const makeUser = (overrides: Partial<TContributorsResponse["users"][number]> = {}): TContributorsResponse["users"][number] => ({
    login: "dev1",
    id: "u1",
    avatarUrl: "https://github.com/dev1.png",
    url: "https://github.com/dev1",
    name: "Dev One",
    TotalCommits: 0,
    TotalPrs: 0,
    TotalIssues: 0,
    TotalReviewedPullRequests: 0,
    score: 0,
    ...overrides,
})

describe("computeCycleTimeHistogram", () => {
    const NOW = new Date("2026-05-25T12:00:00Z").getTime()

    it("returns empty buckets for null input", () => {
        const result = computeCycleTimeHistogram(null, TimeFilter.MONTHLY, NOW)
        expect(result).toHaveLength(7)
        expect(result.every(b => b.count === 0)).toBe(true)
    })

    it("assigns a same-day merge to <1d bucket", () => {
        const merged = [makeMergedPr({
            createdAt: "2026-05-20T10:00:00Z",
            mergedAt: "2026-05-20T18:00:00Z",
        })]
        const result = computeCycleTimeHistogram(merged, TimeFilter.MONTHLY, NOW)
        expect(result[0].label).toBe("<1d")
        expect(result[0].count).toBe(1)
    })

    it("assigns a 5-day merge to 3-7d bucket", () => {
        const merged = [makeMergedPr({
            id: "2",
            title: "medium",
            url: "https://github.com/gnolang/gno/pull/2",
            createdAt: "2026-05-15T00:00:00Z",
            mergedAt: "2026-05-20T00:00:00Z",
        })]
        const result = computeCycleTimeHistogram(merged, TimeFilter.YEARLY, NOW)
        expect(result[2].label).toBe("3-7d")
        expect(result[2].count).toBe(1)
    })

    it("excludes PRs outside the period cutoff", () => {
        const merged = [makeMergedPr({
            id: "3",
            title: "old",
            url: "https://github.com/gnolang/gno/pull/3",
            createdAt: "2026-01-01T00:00:00Z",
            mergedAt: "2026-01-02T00:00:00Z",
        })]
        const result = computeCycleTimeHistogram(merged, TimeFilter.MONTHLY, NOW)
        expect(result.every(b => b.count === 0)).toBe(true)
    })

    it("handles >3mo bucket for very slow PRs", () => {
        const merged = [makeMergedPr({
            id: "4",
            title: "slow",
            url: "https://github.com/gnolang/gno/pull/4",
            createdAt: "2025-01-01T00:00:00Z",
            mergedAt: "2026-05-20T00:00:00Z",
        })]
        const result = computeCycleTimeHistogram(merged, TimeFilter.ALL_TIME, NOW)
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
            makeUser({ login: "a", TotalPrs: 1, score: 10 }),
            makeUser({ login: "b", TotalPrs: 3, score: 20 }),
            makeUser({ login: "c", TotalPrs: 12, score: 30 }),
            makeUser({ login: "d", TotalPrs: 0, score: 0 }),
        ]
        const result = computeContributionTiers(makeContributors(users))
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
        const proposals: TProposal[] = [{
            id: "prop1",
            address: "g1abc",
            path: "/r/gov",
            blockHeight: 100,
            files: [],
            votes: [
                { proposalID: "prop1", address: "g1a", blockHeight: 100, vote: "YES", hash: "h1" },
                { proposalID: "prop1", address: "g1b", blockHeight: 100, vote: "YES", hash: "h2" },
                { proposalID: "prop1", address: "g1c", blockHeight: 100, vote: "NO", hash: "h3" },
            ],
            executionHeight: 0,
            status: "active",
            title: "Add feature X",
            description: "",
        }]
        const result = computeVoteData(proposals)
        expect(result).toHaveLength(1)
        expect(result[0].yes).toBe(2)
        expect(result[0].no).toBe(1)
        expect(result[0].abstain).toBe(0)
    })

    it("truncates long proposal titles", () => {
        const proposals: TProposal[] = [{
            id: "prop2",
            address: "g1abc",
            path: "/r/gov",
            blockHeight: 100,
            files: [],
            votes: [{ proposalID: "prop2", address: "g1a", blockHeight: 100, vote: "YES", hash: "h1" }],
            executionHeight: 0,
            status: "active",
            title: "A very long proposal title that exceeds twenty characters",
            description: "",
        }]
        const result = computeVoteData(proposals)
        expect(result[0].name.length).toBeLessThanOrEqual(23) // 20 + "..."
    })
})

describe("computeTeamData", () => {
    const teams: Team[] = [
        { slug: "core", name: "Core", color: "purple", description: "", members: ["alice", "bob"] },
    ]
    const colors: Record<TeamColor, string> = {
        purple: "#a855f7",
        blue: "#4a9eff",
        green: "#22c55e",
        pink: "#ec4899",
        red: "#ef4444",
        yellow: "#eab308",
        brown: "#92400e",
    }

    it("returns empty for undefined contributors", () => {
        expect(computeTeamData(undefined, teams, colors)).toEqual([])
    })

    it("sums team member stats", () => {
        const contributors = makeContributors([
            makeUser({ login: "alice", score: 50, TotalPrs: 10, TotalCommits: 20, TotalIssues: 5, TotalReviewedPullRequests: 3 }),
            makeUser({ login: "bob", score: 30, TotalPrs: 5, TotalCommits: 10, TotalIssues: 2, TotalReviewedPullRequests: 1 }),
            makeUser({ login: "charlie", score: 100, TotalPrs: 50, TotalCommits: 100, TotalIssues: 10, TotalReviewedPullRequests: 20 }),
        ])
        const result = computeTeamData(contributors, teams, colors)
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
        const contributors = makeContributors([
            makeUser({ login: "a", TotalPrs: 10, TotalCommits: 20, TotalIssues: 5, TotalReviewedPullRequests: 3 }),
            makeUser({ login: "b", TotalPrs: 5, TotalCommits: 10, TotalIssues: 2, TotalReviewedPullRequests: 1 }),
        ])
        const proposals: TProposal[] = [
            { id: "p1", address: "g1", path: "/r/gov", blockHeight: 1, files: [], votes: [], executionHeight: 0, status: "", title: "", description: "" },
            { id: "p2", address: "g1", path: "/r/gov", blockHeight: 2, files: [], votes: [], executionHeight: 0, status: "", title: "", description: "" },
        ]
        const govdaoMembers: TGovdaoMember[] = [{ address: "g1abc", tier: "1" }]
        const packages: TPackage[] = [
            { address: "g1", path: "/r/pkg1", namespace: "gno.land", blockHeight: 1 },
            { address: "g1", path: "/r/pkg2", namespace: "gno.land", blockHeight: 2 },
            { address: "g1", path: "/r/pkg3", namespace: "gno.land", blockHeight: 3 },
        ]
        const namespaces: TNamespace[] = [{ hash: "h1", namespace: "gno.land", address: "g1", blockHeight: 1 }]
        const result = computeStats(contributors, proposals, govdaoMembers, packages, namespaces)
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
