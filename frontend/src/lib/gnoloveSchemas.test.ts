/**
 * Tests for gnoloveSchemas.ts — Zod schema validation.
 *
 * @module lib/gnoloveSchemas.test
 */

import { describe, it, expect } from "vitest"
import {
    UserSchema, IssueSchema, PullRequestSchema, CommitSchema,
    EnhancedUserWithStatsSchema, RepositorySchema,
    PackageSchema, NamespaceSchema, ProposalSchema,
    GovdaoMemberSchema, ScoreFactorsSchema, PullRequestReportSchema,
    ContributorsResponseSchema, LabelSchema, NotablePRSchema,
} from "./gnoloveSchemas"

describe("UserSchema", () => {
    it("parses valid user", () => {
        const user = UserSchema.parse({
            login: "alice", id: 1, avatarUrl: "https://a.com/a.png",
            url: "https://github.com/alice", name: "Alice",
        })
        expect(user.login).toBe("alice")
        expect(user.id).toBe("1") // coerced
    })

    it("normalizes PascalCase fields from Go backend", () => {
        const user = UserSchema.parse({
            Login: "bob", ID: 2, AvatarURL: "https://a.com/b.png",
            URL: "https://github.com/bob", Name: "Bob",
        })
        expect(user.login).toBe("bob")
        expect(user.avatarUrl).toBe("https://a.com/b.png")
    })

    it("rejects invalid user", () => {
        expect(() => UserSchema.parse({ login: "x" })).toThrow()
    })
})

describe("IssueSchema", () => {
    it("parses valid issue with PascalCase normalization", () => {
        const issue = IssueSchema.parse({
            CreatedAt: "2026-01-01", UpdatedAt: "2026-01-02",
            ID: 42, Number: 1, State: "OPEN", Title: "Bug",
            URL: "https://github.com/test/issues/1",
        })
        expect(issue.title).toBe("Bug")
        expect(issue.id).toBe("42")
    })
})

describe("PullRequestSchema", () => {
    it("parses PR with merged date", () => {
        const pr = PullRequestSchema.parse({
            createdAt: "2026-01-01", updatedAt: "2026-01-02",
            id: "1", number: 10, state: "MERGED", title: "feat: add feature",
            url: "https://github.com/test/pull/10", mergedAt: "2026-01-02",
        })
        expect(pr.state).toBe("MERGED")
        expect(pr.mergedAt).toBe("2026-01-02")
    })
})

describe("CommitSchema", () => {
    it("parses commit with preprocessor", () => {
        const commit = CommitSchema.parse({
            ID: "abc123", CreatedAt: "2026-01-01", UpdatedAt: "2026-01-02",
            AuthorID: "user1", URL: "https://github.com/test/commit/abc",
            title: "fix: bug",
        })
        expect(commit.id).toBe("abc123")
        expect(commit.authorID).toBe("user1")
    })
})

describe("EnhancedUserWithStatsSchema", () => {
    it("parses user with stats defaults", () => {
        const user = EnhancedUserWithStatsSchema.parse({
            login: "alice", id: 1, avatarUrl: "https://a.com/a.png",
            url: "https://github.com/alice", name: "Alice",
        })
        expect(user.TotalCommits).toBe(0)
        expect(user.score).toBe(0)
    })
})

describe("RepositorySchema", () => {
    it("parses valid repo", () => {
        const repo = RepositorySchema.parse({
            id: "1", name: "gno", owner: "gnolang", baseBranch: "master",
        })
        expect(repo.name).toBe("gno")
    })
})

describe("PackageSchema", () => {
    it("parses valid package", () => {
        const pkg = PackageSchema.parse({
            address: "g1abc", path: "gno.land/p/demo/avl", namespace: "demo", blockHeight: 100,
        })
        expect(pkg.namespace).toBe("demo")
    })
})

describe("NamespaceSchema", () => {
    it("parses valid namespace", () => {
        const ns = NamespaceSchema.parse({
            hash: "abc", namespace: "demo", address: "g1abc", blockHeight: 100,
        })
        expect(ns.namespace).toBe("demo")
    })
})

describe("ProposalSchema", () => {
    it("parses proposal with defaults", () => {
        const prop = ProposalSchema.parse({
            id: "1", address: "g1abc", path: "gno.land/r/gov/dao", blockHeight: 100,
        })
        expect(prop.title).toBe("")
        expect(prop.files).toEqual([])
        expect(prop.votes).toEqual([])
    })
})

describe("GovdaoMemberSchema", () => {
    it("parses member", () => {
        const member = GovdaoMemberSchema.parse({ address: "g1abc", tier: "T1" })
        expect(member.tier).toBe("T1")
    })
})

describe("ScoreFactorsSchema", () => {
    it("parses score factors", () => {
        const factors = ScoreFactorsSchema.parse({
            prFactor: 5, issueFactor: 3, commitFactor: 1, reviewedPrFactor: 4,
        })
        expect(factors.prFactor).toBe(5)
    })
})

describe("LabelSchema", () => {
    it("parses label with coerced id", () => {
        const label = LabelSchema.parse({ id: 123, name: "bug", color: "ff0000" })
        expect(label.id).toBe("123")
    })
})

describe("PullRequestReportSchema", () => {
    it("accepts null arrays", () => {
        const report = PullRequestReportSchema.parse({
            merged: null, in_progress: null, reviewed: null,
            waiting_for_review: null, blocked: null,
        })
        expect(report.merged).toBeNull()
    })
})

describe("ContributorsResponseSchema", () => {
    it("parses composite response", () => {
        const response = ContributorsResponseSchema.parse({
            users: [{
                login: "alice", id: 1, avatarUrl: "https://a.com/a.png",
                url: "https://github.com/alice", name: "Alice",
                TotalCommits: 10, TotalPrs: 5, TotalIssues: 2,
                TotalReviewedPullRequests: 3, score: 42,
            }],
            lastSyncedAt: "2026-01-01T00:00:00Z",
        })
        expect(response.users).toHaveLength(1)
        expect(response.lastSyncedAt).toBe("2026-01-01T00:00:00Z")
    })
})

describe("NotablePRSchema", () => {
    it("parses a full board item", () => {
        const item = NotablePRSchema.parse({
            itemID: "PVTI_abc", number: 5653, title: "test13 upgrade",
            url: "https://github.com/gnolang/gno/pull/5653",
            repository: "gnolang/gno", authorLogin: "aeddi",
            state: "OPEN", isDraft: false, reviewDecision: "REVIEW_REQUIRED",
            status: "Needs review", updatedAt: "2026-06-03T10:00:00Z",
            syncedAt: "2026-06-04T00:00:00Z", // extra backend field — ignored
        })
        expect(item.number).toBe(5653)
        expect(item.status).toBe("Needs review")
        expect(item.repository).toBe("gnolang/gno")
    })

    it("defaults nullish optional fields to safe empties", () => {
        const item = NotablePRSchema.parse({
            itemID: "PVTI_def", number: 1, title: "draft thing",
            url: "https://github.com/gnolang/gno/pull/1",
            repository: "gnolang/gno", updatedAt: "2026-06-03T10:00:00Z",
            authorLogin: null, state: null, reviewDecision: null, status: null,
        })
        expect(item.authorLogin).toBe("")
        expect(item.status).toBe("")
        expect(item.isDraft).toBe(false)
    })

    it("parses enriched fields (area, size, labels, reviewers, reviews)", () => {
        const item = NotablePRSchema.parse({
            itemID: "PVTI_xyz", number: 5728, title: "grc721 ledger split",
            url: "https://github.com/gnolang/gno/pull/5728", repository: "gnolang/gno",
            authorLogin: "jinoosss", authorAvatarUrl: "https://avatars.githubusercontent.com/u/1",
            state: "OPEN", isDraft: false, reviewDecision: "CHANGES_REQUESTED",
            status: "Todo", mainArea: "Gnops", additions: 2797, deletions: 1380,
            labels: [{ name: ":receipt: package/realm", color: "ededed" }],
            assignees: ["jinoosss"], requestedReviewers: ["davd-gzl", "aeddi"],
            reviews: [{ login: "jeronimoalbi", state: "APPROVED" }],
            createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-04T00:00:00Z",
        })
        expect(item.mainArea).toBe("Gnops")
        expect(item.additions).toBe(2797)
        expect(item.labels[0].name).toContain("package/realm")
        expect(item.requestedReviewers).toEqual(["davd-gzl", "aeddi"])
        expect(item.reviews[0]).toEqual({ login: "jeronimoalbi", state: "APPROVED" })
    })

    it("defaults enriched arrays/numbers when absent", () => {
        const item = NotablePRSchema.parse({
            itemID: "PVTI_min", number: 2, title: "minimal", url: "https://x/2",
            repository: "gnolang/gno", updatedAt: "2026-06-03T10:00:00Z",
        })
        expect(item.mainArea).toBe("")
        expect(item.additions).toBe(0)
        expect(item.labels).toEqual([])
        expect(item.requestedReviewers).toEqual([])
        expect(item.reviews).toEqual([])
    })
})
