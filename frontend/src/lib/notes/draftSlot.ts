import type { DraftRecord, DraftWriteGuard, NotesScope, NotesStore } from './drafts'
/** Read the CAS token first so an intervening recreation can never become our overwrite token. */
export async function readDraftSlot(store: NotesStore, scope: NotesScope, guard: DraftWriteGuard): Promise<{ revision: string; draft: DraftRecord | null }> {
    const current = () => { if (guard.signal.aborted) throw new Error('Draft session changed.') }
    current(); const revision = await store.getDraftRevision(scope); current()
    const draft = await store.getDraft(scope); current()
    return { revision, draft }
}
