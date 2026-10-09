import { describe, expect, it } from 'vitest'
import type { DraftRecord } from '../drafts'
import { draftPublicOperation } from './draftOperation'
const draft: DraftRecord = { schema: 1, scope: { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner: 'alice', noteId: 'ab'.repeat(16) }, localRevision: '4', updatedAt: 0, payload: { kind: 'public', title: 'Whitepaper', body: 'Saved content' } }
describe('published draft baselines', () => {
    it('creates when there is no explicit chain baseline, never silently updates a current note', () => {
        expect(draftPublicOperation(draft, 'cd'.repeat(16), 3, '100000').action).toEqual({ kind: 'create', mode: 3, title: 'Whitepaper', body: 'Saved content', maxFeeUgnot: '100000' })
    })
    it('uses the old saved revision rather than a revision fetched when opening the wallet', () => {
        const current = { ...draft, payload: { kind: 'public' as const, title: 'Changed title', body: 'Changes', base: { stateRevision: '7', epoch: '2', ownerGeneration: '1', titleRevision: '5', bodyRevision: '6' } } }
        expect(draftPublicOperation(current, 'cd'.repeat(16), 3, '100000').action).toEqual({ kind: 'commit', revision: '7', epoch: '2', title: 'Changed title', body: 'Changes' })
    })
    it('rejects guest and encrypted drafts before requesting any wallet access', () => {
        expect(() => draftPublicOperation({ ...draft, scope: { ...draft.scope, owner: 'guest' } }, '', 3, '0')).toThrow()
        expect(() => draftPublicOperation({ ...draft, payload: { kind: 'encrypted', envelope: new Uint8Array([1]) } }, '', 3, '0')).toThrow()
    })
})
