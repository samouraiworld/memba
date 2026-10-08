/** A durable, per-subject deletion barrier shared by same-origin tabs/windows.
 * Completed barriers stay: an old session must never recreate a deleted row. */
import { useSyncExternalStore } from "react"

export type DeleteStep = "memba" | "alerts" | "identity"
export interface Deletion { userId: string; step: DeleteStep | "done"; running: boolean }
const PREFIX = "memba_account_deletion:"
const BARRIER = "memba_account_deletion_barrier:"
const LEGACY_KEY = "memba_account_deletion"
const listeners = new Set<() => void>()
let current = new Map<string, Deletion>()
let latest: Deletion | null = null

function parse(raw: string | null): Deletion | null {
    if (!raw) return null
    const d = JSON.parse(raw) as Deletion
    if (!d || typeof d.userId !== "string" || !["memba", "alerts", "identity", "done"].includes(d.step)) throw new Error("Account deletion state could not be read.")
    return { userId: d.userId, step: d.step, running: false }
}

/** Read storage at every dispatch, without waiting for the storage event. */
export function getDeletion(userId: string): Deletion | null {
    const stored = parse(localStorage.getItem(PREFIX + userId))
    const legacy = parse(sessionStorage.getItem(LEGACY_KEY))
    return stored ?? (legacy?.userId === userId ? legacy : null) ?? (localStorage.getItem(BARRIER + userId) ? { userId, step: "memba", running: false } : null) ?? current.get(userId) ?? null
}

/** Monotonic barrier can be set before waiting for a lock without overwriting
 * another tab's progress. Only the exclusive lock holder writes progress. */
export function beginDeletion(userId: string, running = true) {
    localStorage.setItem(BARRIER + userId, "1")
    const d = getDeletion(userId)!
    current = new Map(current).set(userId, { ...d, running })
    latest = current.get(userId)!
    listeners.forEach(l => l())
}

export function setDeletion(next: Deletion | null) {
    if (!next) { current = new Map(); latest = null }
    else {
        current = new Map(current).set(next.userId, next)
        latest = next
        try {
            // Shared progress must persist before continuing to another step.
            localStorage.setItem(PREFIX + next.userId, JSON.stringify({ ...next, running: false }))
            try { sessionStorage.setItem(LEGACY_KEY, JSON.stringify(next)) } catch { /* shared barrier already persisted */ }
        } finally { listeners.forEach(l => l()) }
        return
    }
    listeners.forEach(l => l())
}

function refresh() {
    const next = new Map<string, Deletion>()
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)!
            if (key.startsWith(BARRIER)) { const id = key.slice(BARRIER.length); if (!next.has(id)) next.set(id, { userId: id, step: "memba", running: false }) }
            if (key.startsWith(PREFIX)) { const d = parse(localStorage.getItem(key)); if (d) next.set(d.userId, d) }
        }
        const legacy = parse(sessionStorage.getItem(LEGACY_KEY))
        if (legacy && !next.has(legacy.userId)) next.set(legacy.userId, legacy)
    } catch { /* dispatch checks fail closed if storage cannot be read */ }
    current = next
    latest = [...next.values()].at(-1) ?? null
    listeners.forEach(l => l())
}
if (typeof window !== "undefined") window.addEventListener("storage", e => { if (e.key === null || (e.key.startsWith(PREFIX) || e.key.startsWith(BARRIER))) refresh() })
refresh()
export function useDeletion(userId?: string): Deletion | null {
    return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => userId ? current.get(userId) ?? null : latest)
}
export function resetDeletionForTests() { refresh() }
