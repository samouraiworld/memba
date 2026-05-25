/**
 * Tests for gnoloveApi.ts — API layer with Zod validation.
 *
 * Post-PR-1: errors propagate (throw) instead of being swallowed.
 * React Query catches these; consumers see isError: true.
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
        expect(result.users).toHaveLength(1)
        expect(result.users[0].login).toBe("alice")
        expect(result.users[0].score).toBe(42)
    })

    it("throws on network error", async () => {
        mockFetch.mockRejectedValue(new Error("Network failed"))
        await expect(api.getContributors()).rejects.toThrow("Network failed")
    })

    it("throws HttpError on HTTP error", async () => {
        mockFetch.mockResolvedValue(errorResponse(500))
        await expect(api.getContributors()).rejects.toThrow(api.HttpError)
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

    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getLastIssues()).rejects.toThrow("fail")
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
        expect(result.merged).toHaveLength(1)
    })

    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getPullRequestsReport(new Date(), new Date())).rejects.toThrow("fail")
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

    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getNewContributors()).rejects.toThrow("fail")
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

    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getRepositories()).rejects.toThrow("fail")
    })
})

describe("getScoreFactors", () => {
    it("returns parsed factors", async () => {
        const factors = { prFactor: 5, issueFactor: 3, commitFactor: 1, reviewedPrFactor: 4 }
        mockFetch.mockResolvedValue(okResponse(factors))
        const result = await api.getScoreFactors()
        expect(result).not.toBeNull()
        expect(result.prFactor).toBe(5)
    })

    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getScoreFactors()).rejects.toThrow("fail")
    })
})

describe("getMilestone", () => {
    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getMilestone(7)).rejects.toThrow("fail")
    })
})

describe("getContributor", () => {
    it("returns null for empty login without fetching", async () => {
        mockFetch.mockClear()
        const result = await api.getContributor("")
        expect(result).toBeNull()
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getContributor("alice")).rejects.toThrow("fail")
    })
})

describe("getProposals", () => {
    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getProposals()).rejects.toThrow("fail")
    })
})

describe("getGovdaoMembers", () => {
    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getGovdaoMembers()).rejects.toThrow("fail")
    })
})

describe("getTeams", () => {
    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getTeams()).rejects.toThrow("fail")
    })
})

describe("getTeamActiveRepos", () => {
    it("returns null for empty slug without fetching", async () => {
        mockFetch.mockClear()
        const result = await api.getTeamActiveRepos("")
        expect(result).toBeNull()
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getTeamActiveRepos("core")).rejects.toThrow("fail")
    })
})

describe("getTeamStats", () => {
    it("returns null for empty slug without fetching", async () => {
        mockFetch.mockClear()
        const result = await api.getTeamStats("")
        expect(result).toBeNull()
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getTeamStats("core")).rejects.toThrow("fail")
    })
})

describe("getAIReports", () => {
    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getAIReports()).rejects.toThrow("fail")
    })
})

describe("getTopics", () => {
    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getTopics()).rejects.toThrow("fail")
    })
})

describe("getContributorCohorts", () => {
    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getContributorCohorts()).rejects.toThrow("fail")
    })
})

describe("getTeamCollab", () => {
    it("throws on error", async () => {
        mockFetch.mockRejectedValue(new Error("fail"))
        await expect(api.getTeamCollab()).rejects.toThrow("fail")
    })
})

describe("HttpError", () => {
    it("is thrown on non-ok HTTP response", async () => {
        mockFetch.mockResolvedValue(errorResponse(503))
        try {
            await api.getTeams()
            expect.fail("should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(api.HttpError)
            expect((err as api.HttpError).status).toBe(503)
        }
    })
})

describe("extractRepoFromUrl", () => {
    it("extracts owner/repo from GitHub URL", () => {
        expect(api.extractRepoFromUrl("https://github.com/gnolang/gno/pull/1")).toBe("gnolang/gno")
    })

    it("returns empty string for non-GitHub URL", () => {
        expect(api.extractRepoFromUrl("https://example.com")).toBe("")
    })
})
