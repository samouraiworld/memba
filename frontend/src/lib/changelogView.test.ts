import { describe, expect, it } from "vitest"
import { CHANGELOG_ENTRIES, CHANGELOG_FILTERS, filterChangelog, groupChangelog, type ChangelogEntry } from "./changelogView"
import { LEGACY_ENTRIES } from "./changelogLegacy"

const entry = (over: Partial<ChangelogEntry>): ChangelogEntry => ({ date: "", title: "Title", tags: ["memba"], items: ["item"], ...over })

describe("changelogView", () => {
    it("holds the current releases first, then the curated legacy entries", () => {
        expect(CHANGELOG_ENTRIES.length).toBeGreaterThan(LEGACY_ENTRIES.length)
        expect(CHANGELOG_ENTRIES.slice(-LEGACY_ENTRIES.length)).toEqual(LEGACY_ENTRIES)
    })

    it("filters by tag, and keeps everything for all", () => {
        const entries = [entry({ title: "a" }), entry({ title: "b", tags: ["network", "gno-core"] }), entry({ title: "c", tags: ["memba", "network"] })]
        expect(filterChangelog(entries, "all")).toBe(entries)
        expect(filterChangelog(entries, "network").map((e) => e.title)).toEqual(["b", "c"])
        expect(filterChangelog(entries, "gno-core").map((e) => e.title)).toEqual(["b"])
        expect(CHANGELOG_FILTERS[0]).toBe("all")
    })

    it("groups same-day entries under one long date, in entry order", () => {
        const groups = groupChangelog([entry({ date: "2026-03-18", title: "a" }), entry({ date: "2026-03-15", title: "b" }), entry({ date: "2026-03-18", title: "c" })])
        expect(groups.map((g) => [g.key, g.label, g.entries.map((e) => e.title)])).toEqual([
            ["2026-03-18", "March 18, 2026", ["a", "c"]],
            ["2026-03-15", "March 15, 2026", ["b"]],
        ])
    })

    it("heads only the unreleased block \"Unreleased\"; an undated shipped block goes under its version", () => {
        const groups = groupChangelog([
            entry({ unreleased: true, title: "Unreleased" }),
            entry({ version: "v6.2.2", title: "Audit fixes" }),
            entry({ title: "Untitled history" }),
        ])
        expect(groups.map((g) => g.label)).toEqual(["Unreleased", "v6.2.2", "Untitled history"])
    })

    it("runs the real changelog newest first", () => {
        const dates = groupChangelog(CHANGELOG_ENTRIES).map((g) => g.key).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
        expect(dates.length).toBeGreaterThan(LEGACY_ENTRIES.length / 2)
        expect(dates).toEqual([...dates].sort().reverse())
        // The unreleased block, when there is one, leads.
        const unreleased = groupChangelog(CHANGELOG_ENTRIES).findIndex((g) => g.key === "")
        expect(unreleased).toBeLessThanOrEqual(0)
    })
})
