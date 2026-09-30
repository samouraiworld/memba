/**
 * changelogView — the entries the changelog shows and how they are filtered
 * and grouped, shared by the classic /changelogs page and the Memba OS News
 * window. Current releases come from CHANGELOG.md (lib/changelog.ts, through
 * the build plugin's digest); the curated pre-v6 history from
 * lib/changelogLegacy.ts.
 *
 * @module lib/changelogView
 */
import changelogEntries from "virtual:memba-changelog"
import { UNRELEASED_LABEL, type ChangelogTag } from "./changelog"
import { LEGACY_ENTRIES } from "./changelogLegacy"
import { formatNewsDate } from "./newsDate"

export interface ChangelogEntry {
    date: string
    version?: string
    unreleased?: boolean
    title: string
    tags: ChangelogTag[]
    items: string[]
}

export type ChangelogFilter = ChangelogTag | "all"

export const CHANGELOG_FILTERS: readonly ChangelogFilter[] = ["all", "memba", "network", "gno-core"]

export const CHANGELOG_LABELS: Record<ChangelogFilter, string> = {
    all: "All",
    memba: "Memba",
    network: "Network",
    "gno-core": "Gno Core",
}

export const FULL_CHANGELOG_URL = "https://github.com/samouraiworld/memba/blob/main/CHANGELOG.md"

/** The build plugin ships only the parsed digest, not the full changelog. */
export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [...changelogEntries, ...LEGACY_ENTRIES]

export function filterChangelog(entries: readonly ChangelogEntry[], filter: ChangelogFilter): readonly ChangelogEntry[] {
    return filter === "all" ? entries : entries.filter(e => e.tags.includes(filter))
}

export interface ChangelogGroup {
    key: string
    /** The group's heading: its date, "Unreleased", or a version. */
    label: string
    entries: ChangelogEntry[]
}

/**
 * Group by date, in entry order. Undated entries: the truly-unreleased block
 * groups under "Unreleased"; shipped-but-undated historical blocks group
 * under their own version label.
 */
export function groupChangelog(entries: readonly ChangelogEntry[]): ChangelogGroup[] {
    const groups = new Map<string, ChangelogGroup>()
    for (const entry of entries) {
        const key = entry.date || (entry.unreleased ? "" : entry.version || entry.title)
        let group = groups.get(key)
        if (!group) {
            const label = /^\d{4}-\d{2}-\d{2}$/.test(key) ? formatNewsDate(key) : key === "" ? UNRELEASED_LABEL : key
            group = { key, label, entries: [] }
            groups.set(key, group)
        }
        group.entries.push(entry)
    }
    return [...groups.values()]
}
