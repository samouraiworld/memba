/**
 * Keeps SECURITY.md's advisory ledger honest.
 *
 * A published-advisories table is a promise to readers: "this is every resolved
 * security issue we know of". It decays silently — an advisory gets written under
 * docs/advisories/ during an incident, and nobody remembers to add the row. The
 * table then understates the history while looking complete, which is the one
 * failure mode a security page cannot afford.
 *
 * So this binds the two together: every advisory file must have a row, every row
 * must have a file, and each row's facts must match what the advisory itself
 * says. Nothing here judges the advisory's content — only that the summary a
 * reader sees first agrees with the document behind it.
 *
 * Lives in the frontend test tree because that is where this repo already puts
 * repo-root document guards (see config.csp.test.ts for netlify.toml and
 * changelog.test.ts for CHANGELOG.md).
 */
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

const ROOT = resolve(__dirname, "../../..")
const securityMd = readFileSync(resolve(ROOT, "SECURITY.md"), "utf8")
const advisoryDir = resolve(ROOT, "docs/advisories")

/** Advisory IDs on disk, from the filenames (the naming rule SECURITY.md states). */
const filesOnDisk = readdirSync(advisoryDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort()

/** The ledger section, isolated so a stray MEMBA-YYYY-NNN elsewhere in the file
 *  (prose, a link) cannot be mistaken for a table row. */
function ledgerSection(): string {
    const start = securityMd.indexOf("## Published Advisories")
    expect(start, "SECURITY.md has no '## Published Advisories' section").toBeGreaterThan(-1)
    const rest = securityMd.slice(start + 1)
    const end = rest.indexOf("\n## ")
    return end === -1 ? rest : rest.slice(0, end)
}

/** IDs that appear as a linked row in the ledger table. */
function ledgerRows(): { id: string; row: string }[] {
    return ledgerSection()
        .split("\n")
        .filter((l) => l.trim().startsWith("|") && /\[MEMBA-\d{4}-\d{3}\]/.test(l))
        .map((row) => ({ id: /\[(MEMBA-\d{4}-\d{3})\]/.exec(row)![1], row }))
}

describe("SECURITY.md advisory ledger", () => {
    it("finds advisories and rows at all — the guard must not go vacuous", () => {
        expect(filesOnDisk.length).toBeGreaterThan(0)
        expect(ledgerRows().length).toBeGreaterThan(0)
    })

    it("lists every advisory that exists on disk", () => {
        const listed = ledgerRows().map((r) => r.id).sort()
        const missing = filesOnDisk.filter((id) => !listed.includes(id))
        expect(
            missing,
            `docs/advisories/ contains ${missing.join(", ")} with no row in SECURITY.md. ` +
                `An unlisted advisory makes the table understate the history while looking complete.`,
        ).toEqual([])
    })

    it("has no row pointing at an advisory that does not exist", () => {
        const dangling = ledgerRows().map((r) => r.id).filter((id) => !filesOnDisk.includes(id))
        expect(dangling, `SECURITY.md links advisories with no file: ${dangling.join(", ")}`).toEqual([])
    })

    it("links each row at the advisory's real path", () => {
        for (const { id, row } of ledgerRows()) {
            expect(row, `${id}'s link should point at docs/advisories/${id}.md`).toContain(
                `docs/advisories/${id}.md`,
            )
        }
    })

    it("agrees with each advisory on severity and fix version", () => {
        for (const { id, row } of ledgerRows()) {
            const doc = readFileSync(resolve(advisoryDir, `${id}.md`), "utf8")

            // Advisories carry these as `| **Field** | value |` metadata rows.
            const sev = /\|\s*\*\*Severity\*\*\s*\|\s*([^|]+?)\s*\|/.exec(doc)?.[1]
            const fixed = /\|\s*\*\*Fixed in\*\*\s*\|\s*([^|]+?)\s*\|/.exec(doc)?.[1]

            if (sev) {
                // The advisory says e.g. "High (likelihood × impact)"; the ledger
                // states the level plus a CVSS vector. Compare the level only —
                // the parenthetical is the document's own reasoning, not a fact
                // the summary needs to repeat verbatim.
                const level = sev.split(/[\s(]/)[0]
                expect(row, `${id}: ledger severity should match the advisory's "${level}"`)
                    .toMatch(new RegExp(level, "i"))
            }
            if (fixed) {
                const version = /v?\d+\.\d+\.\d+/.exec(fixed)?.[0]
                if (version) {
                    expect(row, `${id}: ledger should record the advisory's fix version ${version}`)
                        .toContain(version)
                }
            }
        }
    })
})
