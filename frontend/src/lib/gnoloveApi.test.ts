/**
 * Tests for gnoloveApi.ts — API layer with Zod validation.
 *
 * @module lib/gnoloveApi.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as api from "./gnoloveApi"

const mockFetch = vi.fn()

beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch)
})

afterEach(() => {
    vi.restoreAllMocks()
})

function okResponse(data: unknown) {
    return { ok: true, json: () => Promise.resolve(data), text: () => Promise.resolve("") }
}

function errorResponse(status: number) {
    return { ok: false, status, statusText: "Error", text: () => Promise.resolve("err") }
}

describe("getContributors", () => {
    it("returns parsed data on success", async () => {
        const payload = {
            users: [{
                login: "alice", id: "1", avatarUrl: "https://a.com/a.png",
                url: "https://github.com/alice", name: "Alice",
                TotalCommits: 10, TotalPrs: 5, TotalIssues: 2, TotalReviewedPullRequests: 3, score: 42,
            }],
            lastSyncedAt: "2026-01-01T00:00:00Z",
        }
        mockFetch.mockResolvedValue(okResponse(payload))
        const result = await api.getContributors()
        expect(result).not.toBeNull()
        expect(result!.users).toHaveLength(1)
        expect(result!.users[0].login).toBe("alice")
        expect(result!.users[0].score).toBe(42)
    })

    it("returns null on network error", async () => {
        mockFetch.mockRejectedValue(new Error("Network failed"))
        const result = await api.getContributors()
        expect(result).toBeNull()
    })

    it("returns null on HTTP error", async () => {
        mockFetch.mockResolvedValue(errorResponse(500))
        const result = await api.getContributors()
        expect(result).toBeNull()
    })
})

describe("getLastIssues", () => {
    it("returns parsed issues", async () => {
        const issues = [{
            createdAt: "2026-01-01", updatedAt: "2026-01-02", id: "1",
            number: 42, state: "OPEN", title: "Fix bug",
            url: "https://github.com/test/issues/42",
        }]
        mockFetch.mockResolvedValue(okResponse(issues))
        const result = await api.getLastIssues()
        expect(result).toHaveLength(1)
        expect(result[0].title).toBe("Fix bug")
    })

    it("returns empty array on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        const result = await api.getLastIssues()
        expect(result).toEqual([])
    })
})

describe("getPullRequestsReport", () => {
    it("returns parsed report", async () => {
        const report = {
            merged: [{ createdAt: "2026-01-01", updatedAt: "2026-01-02", id: "1", number: 1, state: "MERGED", title: "PR1", url: "https://github.com/test/pull/1", mergedAt: "2026-01-02" }],
            in_progress: null, reviewed: null, waiting_for_review: null, blocked: null,
        }
        mockFetch.mockResolvedValue(okResponse(report))
        const result = await api.getPullRequestsReport(new Date("2026-01-01"), new Date("2026-01-07"))
        expect(result).not.toBeNull()
        expect(result!.merged).toHaveLength(1)
    })

    it("returns null on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        const result = await api.getPullRequestsReport(new Date(), new Date())
        expect(result).toBeNull()
    })
})

describe("getNewContributors", () => {
    it("returns parsed users", async () => {
        const users = [
            { login: "bob", id: "2", avatarUrl: "https://a.com/b.png", url: "https://github.com/bob", name: "Bob" },
        ]
        mockFetch.mockResolvedValue(okResponse(users))
        const result = await api.getNewContributors()
        expect(result).toHaveLength(1)
        expect(result[0].login).toBe("bob")
    })

    it("returns empty on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        expect(await api.getNewContributors()).toEqual([])
    })
})

describe("getRepositories", () => {
    it("returns parsed repos", async () => {
        const repos = [{ id: "1", name: "gno", owner: "gnolang", baseBranch: "master" }]
        mockFetch.mockResolvedValue(okResponse(repos))
        const result = await api.getRepositories()
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe("gno")
    })

    it("returns empty on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        expect(await api.getRepositories()).toEqual([])
    })
})

describe("getScoreFactors", () => {
    it("returns parsed factors", async () => {
        const factors = { prFactor: 5, issueFactor: 3, commitFactor: 1, reviewedPrFactor: 4 }
        mockFetch.mockResolvedValue(okResponse(factors))
        const result = await api.getScoreFactors()
        expect(result).not.toBeNull()
        expect(result!.prFactor).toBe(5)
    })

    it("returns null on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        expect(await api.getScoreFactors()).toBeNull()
    })
})

describe("getMilestone", () => {
    it("returns null on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        expect(await api.getMilestone(7)).toBeNull()
    })
})

describe("getContributor", () => {
    it("returns null for empty login", async () => {
        mockFetch.mockClear()
        const result = await api.getContributor("")
        expect(result).toBeNull()
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it("returns null on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        expect(await api.getContributor("alice")).toBeNull()
    })
})

describe("getProposals", () => {
    it("returns empty on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        expect(await api.getProposals()).toEqual([])
    })
})

describe("getGovdaoMembers", () => {
    it("returns empty on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        expect(await api.getGovdaoMembers()).toEqual([])
    })
})
