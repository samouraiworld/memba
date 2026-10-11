import { NOTE_ID, newNoteId } from '../../../lib/notes/config'
import type { DraftWriteGuard, NotesPartition, NotesStore } from '../../../lib/notes/drafts'

/** Disposable interface state: Settings › Reset local app data clears this prefix. */
export const LAST_NOTE_PREFIX = 'memba_notes_last:'
function lastNoteKey({ chainId, realm, owner }: NotesPartition): string { return LAST_NOTE_PREFIX + JSON.stringify([chainId, realm, owner]) }

/** The note this account last had open on this network. Unavailable storage remembers nothing. */
export function readLastNote(partition: NotesPartition): string | null {
    try {
        const value = localStorage.getItem(lastNoteKey(partition))
        return value !== null && NOTE_ID.test(value) ? value : null
    } catch { return null }
}

export function writeLastNote(partition: NotesPartition, noteId: string): void {
    if (!NOTE_ID.test(noteId)) return
    try { localStorage.setItem(lastNoteKey(partition), noteId) } catch { /* Notes then opens a blank draft next time. */ }
}

/** Forget `noteId` as the last note (it was deleted); another remembered note is kept. */
export function clearLastNote(partition: NotesPartition, noteId: string): void {
    try { if (localStorage.getItem(lastNoteKey(partition)) === noteId) localStorage.removeItem(lastNoteKey(partition)) } catch { /* Nothing was remembered. */ }
}

/** A blank local draft, ready to type in. An untouched one is reused so opening Notes never piles up empty notes. */
export async function openBlankDraft(store: NotesStore, partition: NotesPartition, guard: DraftWriteGuard): Promise<string | null> {
    if (guard.signal.aborted) return null
    try {
        const blank = (await store.listDrafts(partition)).find(draft => draft.payload.kind === 'public' && !draft.payload.title && !draft.payload.body && !draft.payload.base)
        if (guard.signal.aborted) return null
        if (blank) return blank.scope.noteId
    } catch { /* An unreadable draft elsewhere must not prevent a new note. */ }
    if (guard.signal.aborted) return null
    const noteId = newNoteId()
    const result = await store.saveDraft({ ...partition, noteId }, '0', { kind: 'public', title: '', body: '' }, guard)
    return result.status === 'saved' && !guard.signal.aborted ? noteId : null
}
