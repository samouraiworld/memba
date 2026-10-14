import type { DraftPayload, DraftRecord, DraftWriteGuard, NotesScope, NotesStore, NotesWriteResult } from './drafts'
import { NOTES_STEP_TIMEOUT_MS, NotesTimeoutError, withTimeout } from './freshness'
/** Read the CAS token first so an intervening recreation can never become our overwrite token. */
export async function readDraftSlot(store: NotesStore, scope: NotesScope, guard: DraftWriteGuard): Promise<{ revision: string; draft: DraftRecord | null }> {
    const current = () => { if (guard.signal.aborted) throw new Error('Draft session changed.') }
    current(); const revision = await store.getDraftRevision(scope); current()
    const draft = await store.getDraft(scope); current()
    return { revision, draft }
}
/** Storage did not answer the check that follows an aborted save: the save may or may not have landed. */
export class DraftWriteUnknownError extends Error {
    constructor() { super('Draft save outcome unknown'); this.name = 'DraftWriteUnknownError' }
}
/**
 * A draft save bounded in time that never lands after it was reported as not done: on timeout the
 * write is aborted (an IndexedDB transaction that has not committed rolls back), then what actually
 * happened is settled. A NotesTimeoutError always means nothing was written; a DraftWriteUnknownError
 * means the check could not tell.
 */
export async function saveDraftBounded(store: NotesStore, scope: NotesScope, expectedRevision: string, payload: DraftPayload, guard: DraftWriteGuard, ms = NOTES_STEP_TIMEOUT_MS, graceMs = 2000): Promise<NotesWriteResult<DraftRecord>> {
    const controller = new AbortController(), forward = () => controller.abort()
    if (guard.signal.aborted) controller.abort(); else guard.signal.addEventListener('abort', forward, { once: true })
    const pending = store.saveDraft(scope, expectedRevision, payload, { signal: controller.signal })
    try { return await withTimeout(pending, ms) } catch (error) {
        if (!(error instanceof NotesTimeoutError)) throw error
        controller.abort()
        // After the abort a write can only have landed if it committed first, which settles promptly.
        const late = await withTimeout(pending, graceMs).catch(() => null)
        if (!late) throw error
        if (late.status === 'saved') return late
        if (late.status !== 'session-changed') throw error
        // An abort racing the commit reports "session-changed": read what is stored.
        const unknown = () => { throw new DraftWriteUnknownError() }
        const revision = await withTimeout(store.getDraftRevision(scope), graceMs).catch(unknown)
        if (revision === expectedRevision) throw error
        const stored = await withTimeout(store.getDraft(scope), graceMs).catch(unknown)
        const ours = !!stored && stored.localRevision === String(BigInt(expectedRevision) + 1n) && samePublicPayload(stored.payload, payload)
        return ours ? { status: 'saved', value: stored } : { status: 'conflict' }
    } finally { guard.signal.removeEventListener('abort', forward) }
}
function samePublicPayload(a: DraftPayload, b: DraftPayload): boolean {
    if (a.kind !== 'public' || b.kind !== 'public' || a.title !== b.title || a.body !== b.body) return false
    const keys = ['stateRevision', 'epoch', 'ownerGeneration', 'titleRevision', 'bodyRevision'] as const
    return !a.base === !b.base && (!a.base || keys.every(key => a.base![key] === b.base![key]))
}
