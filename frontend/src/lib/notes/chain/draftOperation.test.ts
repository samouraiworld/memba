import { describe, expect, it } from 'vitest'
import type { DraftRecord } from '../drafts'
import { changedPublicFields, draftPublicOperation } from './draftOperation'
import { publicNoteMessage } from './messages'
import { encode64, type ChainNote } from './schema'
const draft: DraftRecord = { schema: 1, scope: { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner: 'alice', noteId: 'ab'.repeat(16) }, localRevision: '4', updatedAt: 0, payload: { kind: 'public', title: 'Field guide', body: 'Saved content' } }
describe('published draft baselines', () => {
    it('creates when there is no explicit chain baseline, never silently updates a current note', () => {
        expect(draftPublicOperation(draft, 'cd'.repeat(16), 3, '100000').action).toEqual({ kind: 'create', mode: 3, title: 'Field guide', body: 'Saved content', maxFeeUgnot: '100000' })
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

const enc = (value: string) => new TextEncoder().encode(value)
const base = { stateRevision: '7', epoch: '2', ownerGeneration: '1', titleRevision: '5', bodyRevision: '6' }
const published = { title: enc('Sushi'), body: enc('Rice\n\nNori') } as ChainNote
const author = { ...draft.scope, owner: 'g1jw76lxvzjafw2kyjhdnzwggcftyhnlfjaer2u0' }
const edit = (title: string, body: string) => draftPublicOperation({ ...draft, scope: author, payload: { kind: 'public', title, body, base } }, 'cd'.repeat(16), 3, '100000')
const sent = (title: string, body: string) => publicNoteMessage(changedPublicFields(edit(title, body), published), '1000').value.args
describe('field_mask sends only fields whose stored bytes change', () => {
    it.each([
        ['title only', 'Sushi rolls', 'Rice\n\nNori', '1', 'Sushi rolls', ''],
        ['body only', 'Sushi', 'Rice\n\nNori\n\nSalmon', '2', '', 'Rice\n\nNori\n\nSalmon'],
        ['both', 'Maki', 'Rice', '3', 'Maki', 'Rice'],
        ['body cleared', 'Sushi', '', '2', '', ''],
        ['an edge space on an unchanged title', ' Sushi ', 'Rice', '2', '', 'Rice'],
    ])('%s', (_case, title, body, mask, sentTitle, sentBody) => {
        const args = sent(title, body)
        expect(args[3]).toBe(mask)
        expect(args[4]).toBe(sentTitle ? encode64(enc(sentTitle)) : '')
        expect(args[5]).toBe(sentBody ? encode64(enc(sentBody)) : '')
    })
    it('refuses to publish when neither field changes, so nothing is re-stored', () => {
        expect(() => changedPublicFields(edit('Sushi', 'Rice\n\nNori'), published)).toThrow(expect.objectContaining({ code: 'unchanged' }))
        expect(() => changedPublicFields(edit('Sushi ', 'Rice\n\nNori'), published)).toThrow(expect.objectContaining({ code: 'unchanged' }))
    })
    it('compares exact UTF-8 bytes, not rendering: canonically equivalent text in another encoding is a change', () => {
        const composed = { ...published, body: enc('Caf\u00e9') } as ChainNote
        expect(publicNoteMessage(changedPublicFields(edit('Sushi', 'Cafe\u0301'), composed), '1000').value.args[3]).toBe('2')
        expect(() => changedPublicFields(edit('Sushi', 'Caf\u00e9'), composed)).toThrow(expect.objectContaining({ code: 'unchanged' }))
    })
    it('trims a new title and leaves create and other operations untouched', () => {
        expect(edit('  Maki \t', 'Rice').action).toMatchObject({ title: 'Maki' })
        const create = draftPublicOperation({ ...draft, payload: { kind: 'public', title: ' New ', body: 'x' } }, 'cd'.repeat(16), 3, '100000')
        expect(create.action).toMatchObject({ kind: 'create', title: 'New' })
        expect(changedPublicFields(create, published)).toEqual(create)
    })
})
