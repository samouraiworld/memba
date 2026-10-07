/**
 * An account deletion in progress, shared by every window and kept for the
 * browser session: once Memba's data is deleted, nothing may read the account
 * again (a read would create it again) until the sign-in account is gone too.
 * A failed later step stays here, so reopening Settings resumes it.
 *
 * @module os/account/deletion
 */
import { useSyncExternalStore } from "react"

export type DeleteStep = "memba" | "alerts" | "identity"
export interface Deletion {
    userId: string
    step: DeleteStep | "done"
    running: boolean
}

const KEY = "memba_account_deletion"
const listeners = new Set<() => void>()

function load(): Deletion | null {
    try {
        const d = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Deletion | null
        return d && typeof d.userId === "string" ? { ...d, running: false } : null
    } catch {
        return null
    }
}

let current: Deletion | null = load()

export function setDeletion(next: Deletion | null) {
    current = next
    try {
        if (next && next.step !== "done") sessionStorage.setItem(KEY, JSON.stringify(next))
        else sessionStorage.removeItem(KEY)
    } catch { /* storage unavailable: the pause holds for this page */ }
    listeners.forEach((l) => l())
}

export function useDeletion(): Deletion | null {
    return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => current)
}

/** Tests only: forget the deletion (a new page). */
export function resetDeletionForTests() {
    current = load()
}
