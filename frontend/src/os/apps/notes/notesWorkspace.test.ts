import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createDraftSession, createNotesStore, type NotesStore } from '../../../lib/notes/drafts'
import { clearLastNote, LAST_NOTE_PREFIX, openBlankDraft, readLastNote, writeLastNote } from './notesWorkspace'
import { resetLocalUiData } from '../settings/localData'

const partition = { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner: 'guest' }
const stores: NotesStore[] = []
function store() { const value = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(value); return value }
afterEach(async () => { localStorage.clear(); vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(value => value.close())) })

describe('last opened note', () => {
    it('is remembered per network, deployment and account, and only as a valid note ID', () => {
        expect(readLastNote(partition)).toBeNull()
        writeLastNote(partition, 'ab'.repeat(16))
        expect(readLastNote(partition)).toBe('ab'.repeat(16))
        expect(readLastNote({ ...partition, owner: 'g1member' })).toBeNull()
        expect(readLastNote({ ...partition, chainId: 'onyx-1' })).toBeNull()
        writeLastNote(partition, '../wallet')
        expect(readLastNote(partition)).toBe('ab'.repeat(16))
        localStorage.setItem(LAST_NOTE_PREFIX + JSON.stringify([partition.chainId, partition.realm, partition.owner]), 'not-a-note')
        expect(readLastNote(partition)).toBeNull()
    })
    it('treats unavailable storage as nothing remembered', () => {
        vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('denied') })
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('denied') })
        expect(() => writeLastNote(partition, 'ab'.repeat(16))).not.toThrow()
        expect(readLastNote(partition)).toBeNull()
    })
    it('forgets a deleted note only when it is the remembered one', () => {
        writeLastNote(partition, 'ab'.repeat(16))
        clearLastNote(partition, 'cd'.repeat(16)); expect(readLastNote(partition)).toBe('ab'.repeat(16))
        clearLastNote(partition, 'ab'.repeat(16)); expect(readLastNote(partition)).toBeNull()
    })
    it('is cleared with the other disposable interface state', () => {
        writeLastNote(partition, 'ab'.repeat(16))
        resetLocalUiData(localStorage)
        expect(readLastNote(partition)).toBeNull()
    })
})

describe('blank draft', () => {
    it('saves an empty local draft once and reuses it while it stays untouched', async () => {
        const notes = store(), session = createDraftSession()
        const first = await openBlankDraft(notes, partition, session)
        expect(first).toMatch(/^[0-9a-f]{32}$/)
        expect(await notes.getDraft({ ...partition, noteId: first! })).toMatchObject({ localRevision: '1', payload: { kind: 'public', title: '', body: '' } })
        expect(await openBlankDraft(notes, partition, session)).toBe(first)
        await notes.saveDraft({ ...partition, noteId: first! }, '1', { kind: 'public', title: 'Sushi', body: '' }, session)
        const second = await openBlankDraft(notes, partition, session)
        expect(second).not.toBe(first)
        expect(await notes.listDrafts(partition)).toHaveLength(2)
    })
    it('opens nothing when storage refuses the draft or the workspace closed meanwhile', async () => {
        const notes = store(), session = createDraftSession()
        vi.spyOn(notes, 'saveDraft').mockResolvedValue({ status: 'unavailable' })
        expect(await openBlankDraft(notes, partition, session)).toBeNull()
        vi.mocked(notes.saveDraft).mockRestore()
        const closing = session.capture(); session.invalidate()
        expect(await openBlankDraft(notes, partition, closing)).toBeNull()
        const late = createDraftSession(), pending = openBlankDraft(notes, partition, late.capture())
        late.invalidate()
        expect(await pending).toBeNull()
        expect(await notes.listDrafts(partition)).toHaveLength(0)
    })
})
