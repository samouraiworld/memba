import { useEffect, useRef } from 'react'

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
