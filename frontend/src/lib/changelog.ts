/**
 * changelog — W6.1: build-time parser turning the repo-root CHANGELOG.md into
 * the /changelogs page's entries. Adding a CHANGELOG entry now updates the
 * page with zero code changes.
 *
 * PARSE CONTRACT (canonical, for new entries — documented atop CHANGELOG.md):
 *
 *   ## [vX.Y.Z] — YYYY-MM-DD
 *   <!-- categories: memba, network, gno-core -->      (optional; default memba)
 *   ### Workstream title (#123, 2026-07-03)            (each becomes a digest item)
 *   - detail bullets (kept in the file; the page shows the section digest)
 *
 * The parser is deliberately TOLERANT of the historical heading variants that
 * already exist in the file (`## v6.3.1 — Title (date / date)`,
 * `## Unreleased — v6.2.2 (Title)`, `## v6.0.3 (Phase …) — Title`): version =
 * first vN.N.N token, date = first YYYY-MM-DD anywhere in the heading, title =
 * the heading minus version/date/bracket noise. Blocks with no `###` sections
 * fall back to their top-level bullets. Unknown formats degrade to skipped
 * blocks, never to a page crash — and the parser is unit-tested against the
 * REAL file so format drift fails CI, not production.
 */

export type ChangelogTag = "memba" | "network" | "gno-core"

export interface ParsedChangelogEntry {
    /** YYYY-MM-DD, or "" when the block is unreleased/undated. */
    date: string
    version?: string
    unreleased: boolean
    title: string
    tags: ChangelogTag[]
    items: string[]
}

const KNOWN_TAGS: ReadonlySet<string> = new Set(["memba", "network", "gno-core"])
const MAX_ITEMS_PER_ENTRY = 16

/** Strip markdown emphasis/links/code for plain-text display. */
function plainText(md: string): string {
    return md
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\s+/g, " ")
        .trim()
}

function extractTitle(heading: string, version: string | undefined, date: string): string {
    let t = heading
    if (version) t = t.replace(version, "")
    if (date) t = t.replace(date, "")
    t = t
        .replace(/unreleased/i, "")
        .replace(/[[\]]/g, "")
        .replace(/\(\s*[/\s\d-]*\)/g, "")     // leftover date-ish parens
        .replace(/^[\s—–\-:·]+|[\s—–\-:·]+$/g, "")
        .replace(/^\(|\)$/g, "")
        .trim()
    return plainText(t)
}

/** Parse the full CHANGELOG.md text into page entries (file order preserved). */
export function parseChangelogMarkdown(md: string): ParsedChangelogEntry[] {
    const entries: ParsedChangelogEntry[] = []
    // Split into `## ` blocks (skip the `# Changelog` prologue).
    const blocks = md.split(/^## /m).slice(1)

    for (const block of blocks) {
        const newline = block.indexOf("\n")
        if (newline === -1) continue
        const heading = block.slice(0, newline).trim()
        const body = block.slice(newline + 1)

        const version = heading.match(/v\d+\.\d+(?:\.\d+)?[a-z0-9.-]*/i)?.[0]
        const date = heading.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ""
        // TRULY unreleased = the canonical [Unreleased] block only. Historical
        // "## Unreleased — v6.2.x (…)" headings describe SHIPPED work merged
        // under an interim title — they carry a version and must never render
        // under "In progress" (review finding on this PR).
        const unreleased = /unreleased/i.test(heading) && !version
        if (!version && !unreleased) continue // not a release block (e.g. prose)

        // Optional category marker anywhere in the block.
        const catMatch = body.match(/<!--\s*categories:\s*([^>]+?)\s*-->/i)
        const tags = (catMatch
            ? catMatch[1].split(",").map(t => t.trim().toLowerCase()).filter(t => KNOWN_TAGS.has(t))
            : []) as ChangelogTag[]
        if (tags.length === 0) tags.push("memba")

        // Digest items: ### section titles; fallback to top-level bullets.
        let items = [...body.matchAll(/^### (.+)$/gm)].map(m => plainText(m[1]))
        if (items.length === 0) {
            items = [...body.matchAll(/^- (.+)$/gm)].map(m => plainText(m[1]))
        }
        if (items.length === 0) continue // nothing to show
        if (items.length > MAX_ITEMS_PER_ENTRY) {
            const hidden = items.length - MAX_ITEMS_PER_ENTRY
            items = items.slice(0, MAX_ITEMS_PER_ENTRY)
            items.push(`…and ${hidden} more (full detail in CHANGELOG.md)`)
        }

        const title = extractTitle(heading, version, date)
            || (unreleased ? "In progress" : `Release ${version}`)

        entries.push({ date, version, unreleased, title, tags, items })
    }

    return entries
}
