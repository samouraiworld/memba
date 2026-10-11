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
/** Resolves once no save of a closed editor of this note is in flight (immediately when none is). */
export function draftFlushed(scope: NotesScope): Promise<void> {
    return pending.get(key(scope)) ?? Promise.resolve()
}
