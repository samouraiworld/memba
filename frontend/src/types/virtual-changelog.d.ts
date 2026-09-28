declare module "virtual:memba-changelog" {
    import type { ParsedChangelogEntry } from "../lib/changelog"
    const entries: readonly ParsedChangelogEntry[]
    export default entries
}
