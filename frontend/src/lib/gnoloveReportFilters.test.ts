import { describe, it, expect } from "vitest"
import { filterPrs, hasActivityInRange, type FilterCriteria } from "./gnoloveReportFilters"
import type { TPullRequest } from "./gnoloveSchemas"

const makePr = (overrides: Partial<TPullRequest> = {}): TPullRequest => ({
    id: "pr1",
    title: "Test PR",
    url: "https://github.com/gnolang/gno/pull/1",
    state: "merged",
    createdAt: "2026-05-20T10:00:00Z",
    mergedAt: "2026-05-21T10:00:00Z",
    updatedAt: "2026-05-21T10:00:00Z",
    author: null,
    authorLogin: "notJoon",
    ...overrides,
})

const baseCriteria: FilterCriteria = {
    teamName: "all",
    selectedRepos: new Set(),
    period: "all_time",
    start: new Date("2026-05-18"),
    end: new Date("2026-05-25"),
    activeTab: "all",
    report: null,
}

describe("hasActivityInRange", () => {
    it("returns true when createdAt is in range", () => {
        const pr = makePr({ createdAt: "2026-05-20T12:00:00Z" })
        expect(hasActivityInRange(pr, new Date("2026-05-19"), new Date("2026-05-25"))).toBe(true)
    })

    it("returns false when all dates are outside range", () => {
        const pr = makePr({
            createdAt: "2026-05-10T00:00:00Z",
            mergedAt: "2026-05-11T00:00:00Z",
            updatedAt: "2026-05-11T00:00:00Z",
        })
        expect(hasActivityInRange(pr, new Date("2026-05-18"), new Date("2026-05-25"))).toBe(false)
    })

    it("returns true when mergedAt is in range even if createdAt is not", () => {
        const pr = makePr({
            createdAt: "2026-05-01T00:00:00Z",
            mergedAt: "2026-05-20T00:00:00Z",
        })
        expect(hasActivityInRange(pr, new Date("2026-05-18"), new Date("2026-05-25"))).toBe(true)
    })
})

describe("filterPrs", () => {
    it("returns all PRs with no filters", () => {
        const prs = [makePr(), makePr({ id: "pr2" })]
        const result = filterPrs(prs, baseCriteria)
        expect(result).toHaveLength(2)
    })

    it("filters by team name", () => {
        const prs = [
            makePr({ authorLogin: "notJoon" }),
            makePr({ id: "pr2", authorLogin: "outsider" }),
        ]
        const result = filterPrs(prs, { ...baseCriteria, teamName: "Onbloc" })
        expect(result).toHaveLength(1)
        expect(result[0].authorLogin).toBe("notJoon")
    })

    it("filters by selected repos", () => {
        const prs = [
            makePr({ url: "https://github.com/gnolang/gno/pull/1" }),
            makePr({ id: "pr2", url: "https://github.com/gnolang/gno-by-example/pull/2" }),
        ]
        const result = filterPrs(prs, {
            ...baseCriteria,
            selectedRepos: new Set(["gnolang/gno"]),
        })
        expect(result).toHaveLength(1)
    })

    it("filters by weekly period using activity range", () => {
        const prs = [
            makePr({ createdAt: "2026-05-20T00:00:00Z", mergedAt: "2026-05-21T00:00:00Z" }),
            makePr({ id: "pr2", createdAt: "2026-05-01T00:00:00Z", mergedAt: "2026-05-02T00:00:00Z", updatedAt: "2026-05-02T00:00:00Z" }),
        ]
        const result = filterPrs(prs, {
            ...baseCriteria,
            period: "weekly",
            start: new Date("2026-05-18"),
            end: new Date("2026-05-25"),
        })
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe("pr1")
    })

    it("filters by active tab using report subset", () => {
        const pr1 = makePr({ id: "merged1" })
        const pr2 = makePr({ id: "open1" })
        const result = filterPrs([pr1, pr2], {
            ...baseCriteria,
            activeTab: "merged",
            report: { merged: [pr1], in_progress: [pr2] },
        })
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe("merged1")
    })

    it("combines team + repo filters", () => {
        const prs = [
            makePr({ authorLogin: "notJoon", url: "https://github.com/gnolang/gno/pull/1" }),
            makePr({ id: "pr2", authorLogin: "notJoon", url: "https://github.com/gnolang/other/pull/2" }),
            makePr({ id: "pr3", authorLogin: "outsider", url: "https://github.com/gnolang/gno/pull/3" }),
        ]
        const result = filterPrs(prs, {
            ...baseCriteria,
            teamName: "Onbloc",
            selectedRepos: new Set(["gnolang/gno"]),
        })
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe("pr1")
    })
})
