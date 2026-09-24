/**
 * How a visit enters Memba OS (D7): the lock screen shows on a first visit
 * only; a wallet session resumes without it; a deep link opens its content
 * straight away as a guest.
 *
 * @module os/shell/entry
 */

/** Set once the visitor has passed the lock screen (or skipped it via a link or a session). */
export const OS_SEEN_KEY = "memba_os_seen"

export type OsEntry =
    /** First visit, no session, plain /os: show the lock screen. */
    | "lock"
    /** A wallet session from an earlier visit is reconnecting: no lock screen. */
    | "resume"
    /** A shared link and no session: open the content as a guest, no lock screen. */
    | "link"
    /** Already seen, no session: the guest desktop. */
    | "guest"

export function resolveEntry(opts: { seen: boolean; resuming: boolean; deepLink: boolean }): OsEntry {
    if (opts.resuming) return "resume"
    if (opts.deepLink) return "link"
    return opts.seen ? "guest" : "lock"
}

export function readSeen(): boolean {
    try {
        return localStorage.getItem(OS_SEEN_KEY) === "1"
    } catch {
        return false
    }
}

export function markSeen(): void {
    try {
        localStorage.setItem(OS_SEEN_KEY, "1")
    } catch {
        // Storage refused (private window): the lock screen shows again next visit.
    }
}
