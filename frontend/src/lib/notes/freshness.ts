import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * In-page freshness signals for public notes. A confirmed transaction announces the note it
 * changed (with its new revision when known); focus signals ask every open view of a note to
 * re-check the chain. Views re-read on their own; nothing here caches chain data.
 */
export interface NoteChange { chainId: string; noteId: string; stateRevision?: string }
type Signal = { kind: 'change'; change: NoteChange } | { kind: 'focus'; chainId?: string; noteId?: string }
const listeners = new Set<(signal: Signal) => void>()
/** Focus checks are throttled per view so window switching does not flood the RPC. */
const FOCUS_INTERVAL_MS = 4000

function emit(signal: Signal) {
    for (const listener of [...listeners]) {
        try { listener(signal) } catch { /* One view's failure never blocks another's refresh. */ }
    }
}
export function announceNoteChange(change: NoteChange): void { emit({ kind: 'change', change: { ...change } }) }
/** A Notes window came to the front; omit the note to re-check every open note. */
export function announceNotesFocus(chainId?: string, noteId?: string): void { emit({ kind: 'focus', chainId, noteId }) }
/** Calls `listener` for every confirmed note change in this page; returns the unsubscribe. */
export function onNoteChange(listener: (change: NoteChange) => void): () => void {
    const relay = (signal: Signal) => { if (signal.kind === 'change') listener({ ...signal.change }) }
    listeners.add(relay)
    return () => { listeners.delete(relay) }
}

/** Calls `listener`, at most once per focus interval, when a Notes window on this network comes to the front; returns the unsubscribe. */
export function onNotesFocus(chainId: string, listener: () => void): () => void {
    let last = Date.now()
    const relay = (signal: Signal) => {
        if (signal.kind !== 'focus' || (signal.chainId && signal.chainId !== chainId) || Date.now() - last < FOCUS_INTERVAL_MS) return
        last = Date.now(); listener()
    }
    listeners.add(relay)
    return () => { listeners.delete(relay) }
}

export function useNoteFreshness(chainId: string, noteId: string, onChange: (change: { stateRevision?: string }) => void): void {
    const callback = useRef(onChange)
    useEffect(() => { callback.current = onChange }, [onChange])
    useEffect(() => {
        // A view that just subscribed has just read: its first focus check waits the interval.
        let last = Date.now()
        const focus = () => {
            const now = Date.now()
            if (now - last < FOCUS_INTERVAL_MS) return
            last = now; callback.current({})
        }
        const listener = (signal: Signal) => {
            if (signal.kind === 'change') {
                if (signal.change.chainId !== chainId || signal.change.noteId !== noteId) return
                last = Date.now(); callback.current(signal.change.stateRevision ? { stateRevision: signal.change.stateRevision } : {})
            } else if ((!signal.chainId || signal.chainId === chainId) && (!signal.noteId || signal.noteId === noteId)) focus()
        }
        const visible = () => { if (document.visibilityState === 'visible') focus() }
        listeners.add(listener); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visible)
        return () => { listeners.delete(listener); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible) }
    }, [chainId, noteId])
}

/**
 * A re-read counter for one note plus the highest revision a confirmed change announced, so a
 * read that comes back older can be recognised as node lag rather than shown.
 */
export function useNoteRefresh(chainId: string, noteId: string) {
    const [tick, setTick] = useState(0)
    const key = `${chainId}\n${noteId}`
    const expected = useRef<{ key: string; revision: string } | null>(null)
    useNoteFreshness(chainId, noteId, useCallback((change: { stateRevision?: string }) => {
        const known = expected.current?.key === key ? expected.current.revision : undefined
        if (change.stateRevision && (!known || BigInt(change.stateRevision) > BigInt(known))) expected.current = { key, revision: change.stateRevision }
        setTick(value => value + 1)
    }, [key]))
    const minimum = useCallback(() => expected.current?.key === key ? expected.current.revision : undefined, [key])
    const bump = useCallback(() => setTick(value => value + 1), [])
    return { tick, minimum, bump }
}
/** RPC nodes may lag a confirmed block: a few spaced re-reads before accepting an older answer. */
export const LAG_RETRIES = 4, LAG_DELAY_MS = 600
/**
 * Reads until `revision(value)` reaches `minimum` (null counts as behind), at most `retries` extra
 * times; returns the last answer, or undefined once `alive()` turns false.
 */
export async function readFresh<T>(read: () => Promise<T>, revision: (value: T) => string | null, minimum: string | undefined, alive: () => boolean, retries = LAG_RETRIES, delayMs = LAG_DELAY_MS): Promise<T | undefined> {
    for (let attempt = 0; ; attempt++) {
        const value = await read()
        if (!alive()) return undefined
        const seen = revision(value)
        if (!minimum || attempt >= retries || (seen !== null && BigInt(seen) >= BigInt(minimum))) return value
        await new Promise(resolve => setTimeout(resolve, delayMs))
        if (!alive()) return undefined
    }
}

export class NotesTimeoutError extends Error {
    constructor() { super('Notes step timed out'); this.name = 'NotesTimeoutError' }
}
/** Default bound for one network or storage step of a review. */
export const NOTES_STEP_TIMEOUT_MS = 20_000
/** Bounds the wait only: the step itself cannot be cancelled, so callers must ignore its late result. */
export function withTimeout<T>(promise: Promise<T>, ms = NOTES_STEP_TIMEOUT_MS): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new NotesTimeoutError()), ms) })
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}
