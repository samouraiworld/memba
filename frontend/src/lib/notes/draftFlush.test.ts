import { describe, expect, it } from 'vitest'
import { draftFlushed, trackDraftFlush } from './draftFlush'

const scope = { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner: 'guest', noteId: '01'.repeat(16) }
function deferred() { let resolve!: () => void, reject!: (error: Error) => void; const promise = new Promise<void>((ok, no) => { resolve = ok; reject = no }); return { promise, resolve, reject } }
const settled = async (promise: Promise<unknown>) => { let done = false; void promise.then(() => { done = true }); await new Promise(resolve => setTimeout(resolve, 0)); return done }

describe('pending draft flushes', () => {
    it('resolves at once when nothing is pending for the note', async () => {
        expect(await settled(draftFlushed(scope))).toBe(true)
    })
    it('waits for every pending flush of the same note only, and survives a failed flush', async () => {
        const first = deferred(), second = deferred()
        trackDraftFlush(scope, first.promise); trackDraftFlush(scope, second.promise)
        expect(await settled(draftFlushed({ ...scope, noteId: '02'.repeat(16) }))).toBe(true)
        expect(await settled(draftFlushed({ ...scope, owner: 'g1other' }))).toBe(true)
        const waiting = draftFlushed(scope)
        first.reject(new Error('storage refused'))
        expect(await settled(waiting)).toBe(false)
        second.resolve()
        expect(await settled(waiting)).toBe(true)
        expect(await settled(draftFlushed(scope))).toBe(true)
    })
})
