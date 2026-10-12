import type { NotesScope } from './drafts'

/**
 * Saves a closing editor still has in flight, per note: an editor reopened on the same note
 * (X → Y → X) reads the draft only after them, so it never loads a revision that is about
 * to be replaced and then reports a conflict with itself.
 */
const pending = new Map<string, Promise<void>>()
const key = (scope: NotesScope) => JSON.stringify([scope.chainId, scope.realm, scope.owner, scope.noteId])

export function trackDraftFlush(scope: NotesScope, flush: Promise<unknown>): void {
    const id = key(scope), previous = pending.get(id)
    const all: Promise<void> = Promise.all([previous, flush.catch(() => {})]).then(() => {
        if (pending.get(id) === all) pending.delete(id)
    })
    pending.set(id, all)
}
/** How long a reopened editor waits for a closing save before opening the stored draft anyway. */
export const DRAFT_FLUSH_WAIT_MS = 5_000
/**
 * Resolves true once no save of a closed editor of this note is in flight (at once when none is), or false
 * when one is still running after `ms`: storage that never answers must not leave the editor loading forever.
 */
export function draftFlushed(scope: NotesScope, ms = DRAFT_FLUSH_WAIT_MS): Promise<boolean> {
    const flush = pending.get(key(scope))
    if (!flush) return Promise.resolve(true)
    let timer: ReturnType<typeof setTimeout> | undefined
    return Promise.race([flush.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), ms) })]).finally(() => clearTimeout(timer))
}
