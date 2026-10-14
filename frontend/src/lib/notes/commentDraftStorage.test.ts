import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCommentDrafts, commentDigest, commentPosted, holdSentComment, readCommentDraft, settleSentComment, takeCommentDraft, writeCommentDraft } from './commentDraftStorage'

const scope = { chainId: 'gnoland-1', owner: 'g1member', noteId: '01'.repeat(16) }
const quote = { text: 'Bamboo mat', bodyRevision: '5', confirmedFor: '5' }
beforeEach(() => { sessionStorage.clear(); localStorage.clear() })

describe('unsent comment text', () => {
    it('is kept for this tab only, per network, account and note, and cleared once empty', () => {
        writeCommentDraft(scope, { body: 'I can bring the mat', quote })
        expect(readCommentDraft(scope)).toEqual({ body: 'I can bring the mat', quote })
        expect(localStorage.length).toBe(0)
        expect(readCommentDraft({ ...scope, owner: 'g1other' })).toBeNull()
        expect(readCommentDraft({ ...scope, chainId: 'onyx-1' })).toBeNull()
        expect(readCommentDraft({ ...scope, noteId: '02'.repeat(16) })).toBeNull()
        writeCommentDraft(scope, { body: '', quote: { text: '', bodyRevision: '', confirmedFor: '' } })
        expect(readCommentDraft(scope)).toBeNull(); expect(sessionStorage.length).toBe(0)
    })
    it('ignores malformed or oversized stored values and survives refused storage', () => {
        const [key] = (() => { writeCommentDraft(scope, { body: 'x', quote }); return [sessionStorage.key(0)!] })()
        for (const bad of ['{', '[]', JSON.stringify({ body: 1, quote }), JSON.stringify({ body: 'x'.repeat(8003), quote }), JSON.stringify({ body: 'x', quote: { ...quote, text: 'q'.repeat(601) } })]) {
            sessionStorage.setItem(key, bad); expect(readCommentDraft(scope)).toBeNull()
        }
        const setItem = Storage.prototype.setItem
        Storage.prototype.setItem = () => { throw new Error('quota') }
        try { expect(() => writeCommentDraft(scope, { body: 'kept in memory', quote })).not.toThrow() } finally { Storage.prototype.setItem = setItem }
    })
    it('holds a sent comment aside until its outcome, and gives it back after a reload', async () => {
        writeCommentDraft(scope, { body: 'Sent text', quote }); holdSentComment(scope, 'op1', { body: 'Sent text', quote })
        expect(takeCommentDraft(scope)).toBeNull()
        settleSentComment(scope, 'op2', { body: 'Sent text', quote }, false); expect(takeCommentDraft(scope)).toBeNull()
        // A reload loses the request that would have settled it: the text comes back (its receipt still blocks a resend).
        vi.resetModules(); const reloaded = await import('./commentDraftStorage')
        expect(reloaded.takeCommentDraft(scope)).toEqual({ body: 'Sent text', quote })
        expect(reloaded.takeCommentDraft({ ...scope, owner: 'g1other' })).toBeNull()
    })
    it('forgets a posted comment and an explicit disconnect forgets held ones', () => {
        holdSentComment(scope, 'op1', { body: 'Sent text', quote }); settleSentComment(scope, 'op1', { body: 'Sent text', quote }, true)
        expect(sessionStorage.length).toBe(0)
        holdSentComment(scope, 'op2', { body: 'Other', quote }); clearCommentDrafts()
        expect(sessionStorage.length).toBe(0); settleSentComment(scope, 'op2', { body: 'Other', quote }, false); expect(readCommentDraft(scope)).toBeNull()
    })
    it('merges returned or orphaned text with a draft written meanwhile, never dropping either', async () => {
        holdSentComment(scope, 'op1', { body: 'Sent text', quote })
        const other = { text: 'Other quote', bodyRevision: '6', confirmedFor: '6' }
        writeCommentDraft(scope, { body: '', quote: other })
        settleSentComment(scope, 'op1', { body: 'Sent text', quote }, false)
        expect(readCommentDraft(scope)).toEqual({ body: 'Sent text', quote: other })
        holdSentComment(scope, 'op2', { body: 'Sent text', quote: other })
        writeCommentDraft(scope, { body: 'Newer edit', quote: other })
        vi.resetModules(); const reloaded = await import('./commentDraftStorage')
        expect(reloaded.takeCommentDraft(scope)).toEqual({ body: 'Sent text\n\nNewer edit', quote: other })
    })
    it('forgets a posted comment by its digests, wherever it is stored', () => {
        writeCommentDraft(scope, { body: 'Posted', quote })
        commentPosted(scope, { bodySha256: commentDigest('Posted'), anchorSha256: commentDigest(quote.text) })
        expect(readCommentDraft(scope)).toBeNull()
        writeCommentDraft(scope, { body: 'Posted', quote })
        commentPosted(scope, { bodySha256: commentDigest('Posted'), anchorSha256: commentDigest('another quote') })
        expect(readCommentDraft(scope)).toEqual({ body: 'Posted', quote })
    })
})
