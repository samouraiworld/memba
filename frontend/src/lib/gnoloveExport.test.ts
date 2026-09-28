/**
 * Tests for gnoloveExport.ts — CSV and Markdown generation.
 *
 * @module lib/gnoloveExport.test
 */

import { describe, it, expect, vi } from "vitest"
import { generateCSV, generateMarkdown, exportToPDF } from "./gnoloveExport"
import type { TPullRequest } from "./gnoloveSchemas"

const { autoTableSpy } = vi.hoisted(() => ({ autoTableSpy: vi.fn() }))

// Stub jspdf so the test doesn't try to write a real file in jsdom.
vi.mock("jspdf", () => ({
    jsPDF: class {
        setFontSize() {}
        text() {}
        save() {}
    },
}))
vi.mock("jspdf-autotable", () => ({ default: autoTableSpy }))

const samplePR = {
    id: "1",
    number: 42,
    state: "MERGED",
    title: "Fix bug in auth flow",
    url: "https://github.com/gnolang/gno/pull/42",
    authorLogin: "alice",
    authorAvatarUrl: "https://example.com/avatar.png",
    mergedAt: "2026-03-20T10:00:00Z",
    isDraft: false,
    reviewDecision: "APPROVED",
    createdAt: "2026-03-18T08:00:00Z",
    updatedAt: "2026-03-20T10:00:00Z",
} as unknown as TPullRequest

const prWithSpecialChars = {
    ...samplePR,
    id: "2",
    number: 43,
    title: 'Add "feature", with commas',
    authorLogin: "bob",
} as unknown as TPullRequest

describe("generateCSV", () => {
    it("produces valid CSV with headers", () => {
        const csv = generateCSV([samplePR])
        const lines = csv.split("\n")
        expect(lines[0]).toBe("Title,Number,Author,Report Status,State,Review Decision,Draft,URL,Created,Merged")
        expect(lines).toHaveLength(2)
    })

    it("escapes double quotes in titles", () => {
        const csv = generateCSV([prWithSpecialChars])
        expect(csv).toContain('""feature""')
    })

    it("handles empty PR array", () => {
        const csv = generateCSV([])
        const lines = csv.split("\n")
        expect(lines).toHaveLength(1) // only header
    })

    it("includes all fields", () => {
        const csv = generateCSV([samplePR])
        const row = csv.split("\n")[1]
        expect(row).toContain("42")
        expect(row).toContain("alice")
        expect(row).toContain("MERGED")
        expect(row).toContain("APPROVED")
    })

    it("preserves the report bucket beside the raw GitHub state", () => {
        const waiting = { ...samplePR, id: "waiting", state: "OPEN", mergedAt: null } as unknown as TPullRequest
        const blocked = { ...waiting, id: "blocked" } as unknown as TPullRequest
        const csv = generateCSV([waiting, blocked], pr => pr.id === "waiting" ? "Waiting" : "Blocked")
        expect(csv).toContain(",Waiting,OPEN,")
        expect(csv).toContain(",Blocked,OPEN,")
    })

    it("sanitizes formula injection in titles", () => {
        const malicious = { ...samplePR, id: "99", title: '=HYPERLINK("http://evil.com","Click")' } as unknown as TPullRequest
        const csv = generateCSV([malicious])
        // Should prefix with tab to prevent Excel formula execution
        expect(csv).not.toContain('"=HYPERLINK')
        expect(csv).toContain('\t=HYPERLINK')
    })

    it("sanitizes plus/minus/at prefixed titles", () => {
        const plusPR = { ...samplePR, id: "100", title: "+cmd|'/C calc'!A0" } as unknown as TPullRequest
        const csv = generateCSV([plusPR])
        expect(csv).toContain("\t+cmd")
    })

    it("omits malformed or non-GitHub PR URLs from CSV", () => {
        const malicious = { ...samplePR, url: "https://github.com/a/b/pull/1\n=2+2" } as unknown as TPullRequest
        const csv = generateCSV([malicious])
        expect(csv).not.toContain("=2+2")
        expect(csv).not.toContain("https://github.com/a/b/pull/1")
    })
})

describe("generateMarkdown", () => {
    it("produces valid Markdown table", () => {
        const md = generateMarkdown([samplePR], "merged", "Mar 18 — Mar 24, 2026")
        expect(md).toContain("# Gnolove Weekly Report")
        expect(md).toContain("## Merged")
        expect(md).toContain("| # | Title | Author | Report Status | State |")
        expect(md).toContain("#42")
        expect(md).toContain("@alice")
    })

    it("escapes pipe characters in titles", () => {
        const prWithPipe = { ...samplePR, id: "3", title: "Fix | character in title" } as unknown as TPullRequest
        const md = generateMarkdown([prWithPipe], "merged", "test-week")
        expect(md).toContain("Fix \\| character in title")
    })

    it("escapes bracket characters to prevent link injection", () => {
        const prWithBrackets = { ...samplePR, id: "4", title: "]click[here](http://evil.com)" } as unknown as TPullRequest
        const md = generateMarkdown([prWithBrackets], "merged", "test-week")
        // Brackets should be escaped to prevent breaking markdown link syntax
        expect(md).toContain("\\]")
        expect(md).toContain("\\[")
    })

    it("uses the selected report period in the heading", () => {
        expect(generateMarkdown([], "all", "September 2026", "Monthly"))
            .toContain("# Gnolove Monthly Report — September 2026")
        expect(generateMarkdown([], "all", "All Time", "All Time"))
            .toContain("# Gnolove All Time Report — All Time")
    })

    it("keeps API text literal and refuses unsafe PR links", () => {
        const pr = {
            ...samplePR,
            title: "![remote](https://example.com/x.png) | <img src=x>",
            url: "javascript:alert(1)",
            authorLogin: "[someone](https://example.com)",
        } as unknown as TPullRequest
        const md = generateMarkdown([pr], "all", "test-week")
        expect(md).toContain("\\!\\[remote\\]")
        expect(md).toContain("\\<img src=x\\>")
        expect(md).not.toContain("](javascript:")
        expect(md).toContain("@\\[someone\\]")
    })

    it("formats tab labels correctly", () => {
        const md = generateMarkdown([], "in_progress", "test-week")
        expect(md).toContain("## In Progress")
    })

    it("keeps report status distinct from GitHub state in an all-status export", () => {
        const waiting = { ...samplePR, state: "OPEN", mergedAt: null } as unknown as TPullRequest
        const md = generateMarkdown([waiting], "all", "test-week", "Weekly", () => "Waiting")
        expect(md).toContain("| Waiting | OPEN |")
        expect(generateCSV([waiting], () => "In Progress")).toContain(",In Progress,OPEN,")
    })

    it("handles empty PR array", () => {
        const md = generateMarkdown([], "waiting_for_review", "test-week")
        expect(md).toContain("## Waiting For Review")
        expect(md).not.toContain("| #4")
    })

    it("includes generation date", () => {
        const md = generateMarkdown([samplePR], "merged", "test-week")
        const today = new Date().toISOString().split("T")[0]
        expect(md).toContain(`_Generated by Gnolove on ${today}_`)
    })
})

describe("exportToPDF (lazy-loads jspdf)", () => {
    // jsPDF + jspdf-autotable add ~85 KB gz to the gnolove chunk's first paint
    // when statically imported. The export function must be async + dynamic-import
    // jspdf inside the body so the chunk-graph keeps PDF deps in their own chunk.
    // The bundle-budget CI script in Task 0.8 verifies the chunk split; this test
    // enforces the prerequisite property (async signature) that enables it.

    it("is an async function", () => {
        expect(exportToPDF.constructor.name).toBe("AsyncFunction")
    })

    it("passes the report status and raw state to the PDF table", async () => {
        autoTableSpy.mockClear()
        const blocked = { ...samplePR, state: "OPEN", mergedAt: null } as unknown as TPullRequest
        await exportToPDF([blocked], "all", "test-week", () => "Blocked")
        expect(autoTableSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            head: [["#", "Title", "Author", "Report Status", "State"]],
            body: [["#42", "Fix bug in auth flow", "alice", "Blocked", "OPEN"]],
        }))
    })

    it("returns a Promise that resolves", async () => {
        await expect(exportToPDF([], "merged", "test-week")).resolves.toBeUndefined()
    })
})
