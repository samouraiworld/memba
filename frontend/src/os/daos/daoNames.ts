/**
 * DAO names in Memba OS URLs (D35): the realm path after `gno.land/r/`, with
 * `/` written as `.` (`gno.land/r/alice/team` → `alice.team`), plus two short
 * aliases. Reversible without a lookup, and never ambiguous.
 *
 * @module os/daos/daoNames
 */
import { DAO_REALM_PATH } from "../../lib/config"

const PREFIX = "gno.land/r/"
/** Realm path segments, as lib/dao/kind's REALM_PATH_RE: the namespace may hold a hyphen, the rest may not. */
const NAMESPACE = /^[a-z0-9_-]{1,64}$/
const SEGMENT = /^[a-z0-9_]{1,64}$/
const validSegments = (segments: string[]) =>
    segments.length >= 2 && segments.length <= 6 && NAMESPACE.test(segments[0]) && segments.slice(1).every((s) => SEGMENT.test(s))

export const DAO_ALIASES: Readonly<Record<string, string>> = {
    govdao: "gno.land/r/gov/dao",
    memba_dao: DAO_REALM_PATH,
}

/** The realm path a name stands for, or null if the name can't be one. */
export function realmForName(name: string): string | null {
    if (Object.hasOwn(DAO_ALIASES, name)) return DAO_ALIASES[name]
    const segments = name.split(".")
    return validSegments(segments) ? PREFIX + segments.join("/") : null
}

/** The name for a realm path (an alias when there is one), or null if it isn't a /r/ realm path. */
export function nameForRealm(realmPath: string): string | null {
    for (const [alias, path] of Object.entries(DAO_ALIASES)) if (path === realmPath) return alias
    if (!realmPath.startsWith(PREFIX)) return null
    const segments = realmPath.slice(PREFIX.length).split("/")
    return validSegments(segments) ? segments.join(".") : null
}
