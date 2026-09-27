/**
 * How a visit enters Memba OS: a plain visit shows the Connect/Guest choice
 * unless Settings skips it. A direct link opens its content immediately.
 *
 * @module os/shell/entry
 */

export const OS_LOCKED_KEY = "memba_os_locked"
export type OsEntry =
    /** Plain /os visit with intro enabled. */
    | "lock"
    /** A wallet session reconnects with intro skipped or a direct link. */
    | "resume"
    /** A shared link and no session: open the content as a guest, no lock screen. */
    | "link"
    /** Intro skipped, no session: the guest desktop. */
    | "guest"

export function resolveEntry(opts: { skipIntro: boolean; resuming: boolean; deepLink: boolean; locked?: boolean }): OsEntry {
    if (opts.locked) return "lock"
    if (opts.resuming && (opts.deepLink || opts.skipIntro)) return "resume"
    if (opts.deepLink) return "link"
    return opts.skipIntro ? "guest" : "lock"
}

export function readLocked(): boolean {
    try { return localStorage.getItem(OS_LOCKED_KEY) === "1" } catch { return false }
}

export function markLocked(locked: boolean): void {
    try {
        if (locked) localStorage.setItem(OS_LOCKED_KEY, "1")
        else localStorage.removeItem(OS_LOCKED_KEY)
    } catch {
        // A storage-denied tab still locks until this page is reloaded.
    }
}
