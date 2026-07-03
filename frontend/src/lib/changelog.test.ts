/**
 * W6.1 — changelog parser. Synthetic cases pin the contract + tolerant
 * variants; the REAL-FILE suite makes format drift fail CI instead of
 * silently emptying the /changelogs page.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseChangelogMarkdown } from "./changelog"

describe("parseChangelogMarkdown — contract format", () => {
    it("parses the canonical heading, categories marker, and section digest", () => {
        const md = `# Changelog

## [v9.0.0] — 2026-08-01
<!-- categories: memba, network -->

### Feature one (#900, 2026-08-01)
- bullet detail
### Feature two
- more detail
`
        const [e] = parseChangelogMarkdown(md)
        expect(e.version).toBe("v9.0.0")
        expect(e.date).toBe("2026-08-01")
        expect(e.unreleased).toBe(false)
        expect(e.tags).toEqual(["memba", "network"])
        expect(e.items).toEqual(["Feature one (#900, 2026-08-01)", "Feature two"])
    })

    it("defaults to the memba tag and ignores unknown categories", () => {
        const md = `## [v9.0.0] — 2026-08-01\n<!-- categories: bogus -->\n### X\n`
        expect(parseChangelogMarkdown(md)[0].tags).toEqual(["memba"])
        const md2 = `## [v9.0.1] — 2026-08-02\n### Y\n`
        expect(parseChangelogMarkdown(md2)[0].tags).toEqual(["memba"])
    })

    it("marks Unreleased blocks and tolerates a missing date", () => {
        const md = `## [Unreleased]\n### Pending thing\n`
        const [e] = parseChangelogMarkdown(md)
        expect(e.unreleased).toBe(true)
        expect(e.date).toBe("")
        expect(e.items).toEqual(["Pending thing"])
    })
})

describe("parseChangelogMarkdown — historical variants (tolerance)", () => {
    it("handles bracket-less headings with trailing date parens", () => {
        const md = `## v6.3.1 — Post-v6.3.0 cleanup (2026-05-26 / 2026-05-27)\n### Fixes\n`
        const [e] = parseChangelogMarkdown(md)
        expect(e.version).toBe("v6.3.1")
        expect(e.date).toBe("2026-05-26")
        expect(e.title).toContain("cleanup")
    })

    it("handles 'Unreleased — vX (title)' headings", () => {
        const md = `## Unreleased — v6.2.2 (Gnolove audit fixes)\n### A\n`
        const [e] = parseChangelogMarkdown(md)
        expect(e.version).toBe("v6.2.2")
        expect(e.unreleased).toBe(true)
        expect(e.title).toContain("Gnolove audit fixes")
    })

    it("falls back to top-level bullets when a block has no sections", () => {
        const md = `## v5.0.0 — 2026-05-01\n- **Bold item:** something\n- plain item\n`
        const [e] = parseChangelogMarkdown(md)
        expect(e.items).toEqual(["Bold item: something", "plain item"])
    })

    it("skips prose blocks without a version or Unreleased marker", () => {
        const md = `## Notes\nSome text.\n\n## v1.0.0 — 2026-01-01\n### Ship\n`
        const entries = parseChangelogMarkdown(md)
        expect(entries).toHaveLength(1)
        expect(entries[0].version).toBe("v1.0.0")
    })

    it("caps runaway digests with an overflow marker", () => {
        const sections = Array.from({ length: 20 }, (_, i) => `### S${i}`).join("\n")
        const md = `## v8.0.0 — 2026-08-01\n${sections}\n`
        const [e] = parseChangelogMarkdown(md)
        expect(e.items).toHaveLength(17)
        expect(e.items[16]).toContain("and 4 more")
    })
})

describe("parseChangelogMarkdown — THE REAL FILE (drift tripwire)", () => {
    const real = readFileSync(resolve(__dirname, "../../../CHANGELOG.md"), "utf8")

    it("parses a healthy number of release entries", () => {
        const entries = parseChangelogMarkdown(real)
        expect(entries.length).toBeGreaterThanOrEqual(8)
        // Newest-first file order preserved
        const versions = entries.map(e => e.version).filter(Boolean)
        expect(versions).toContain("v7.2.0")
        expect(versions).toContain("v6.0.2")
    })

    it("every parsed entry is renderable (title + ≥1 item; date shaped or empty)", () => {
        for (const e of parseChangelogMarkdown(real)) {
            expect(e.title.length).toBeGreaterThan(0)
            expect(e.items.length).toBeGreaterThan(0)
            expect(e.date === "" || /^\d{4}-\d{2}-\d{2}$/.test(e.date)).toBe(true)
            for (const t of e.tags) expect(["memba", "network", "gno-core"]).toContain(t)
        }
    })

    it("v7.2.0 carries its date and a workstream digest", () => {
        const v72 = parseChangelogMarkdown(real).find(e => e.version === "v7.2.0")!
        expect(v72.date).toBe("2026-06-29")
        expect(v72.items.length).toBeGreaterThanOrEqual(5)
    })
})
