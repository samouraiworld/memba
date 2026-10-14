import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createDraftSession, createNotesStore, type NotesStore } from '../../../lib/notes/drafts'
import type { ChainNote, NotesPage } from '../../../lib/notes/chain/schema'
import { NotesList } from './NotesList'
import { announceNoteChange, announceNotesFocus } from '../../../lib/notes/freshness'

const partition = { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner: 'owner' }
const utf8 = (value: string) => new TextEncoder().encode(value)
function note(id: string, patch: Partial<ChainNote> = {}): ChainNote {
    return { id, owner: 'owner', pendingOwner: '', ownerGeneration: '1', mode: 3, stateRevision: '6', titleRevision: '1', bodyRevision: '1', epoch: '0', title: utf8('Sushi'), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '1', operationId: 'cd'.repeat(16), actor: 'owner', height: '2', ...patch }
}
const noteOf = (id: string) => note(id)
const page = (items: ChainNote[], nextCursor = ''): NotesPage => ({ items, nextCursor })
const stores: NotesStore[] = []
function setup() { const store = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(store); return { store, session: createDraftSession(), client: { byOwner: vi.fn().mockResolvedValue(page([])) } } }
afterEach(async () => { vi.useRealTimers(); await Promise.all(stores.splice(0).map(store => store.close())) })
const list = () => screen.getAllByRole('listitem').map(item => item.textContent)

describe('My notes list', () => {
    it('keeps a note with unsent text reachable even when it is not one of mine (a comment on someone else\'s note)', async () => {
        const { store, client } = setup(), onOpen = vi.fn(), theirs = 'ee'.repeat(16)
        client.byOwner.mockResolvedValue(page([note('cc'.repeat(16))]))
        render(<NotesList store={store} partition={partition} client={client} owner="owner" query="" selected={null} unsaved={[theirs, 'cc'.repeat(16)]} refresh={0} onOpen={onOpen} />)
        await waitFor(() => expect(list()).toEqual(['Unsaved textUnsavedA comment or edit not sent yet', 'SushiPublicUnsaved changes · Revision 6']))
        fireEvent.click(screen.getByRole('button', { name: /Unsaved text/ }))
        expect(onOpen).toHaveBeenCalledExactlyOnceWith(theirs)
    })
    it('names unsent text on someone else\'s note after that note, from its metadata only', async () => {
        const { store, client } = setup(), onOpen = vi.fn(), theirs = 'ee'.repeat(16)
        const noteMetadata = vi.fn(async (id: string) => id === theirs ? { ...noteOf(theirs), owner: 'someone', title: utf8('Sushi (rc1 canary)') } : null), note = vi.fn()
        const reader = { ...client, noteMetadata, note }
        render(<NotesList store={store} partition={partition} client={reader} owner="owner" query="" selected={null} unsaved={[theirs]} refresh={0} onOpen={onOpen} />)
        await waitFor(() => expect(list()).toEqual(['Sushi (rc1 canary)UnsavedNot sent yet']))
        expect(noteMetadata).toHaveBeenCalledExactlyOnceWith(theirs); expect(note).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: /Sushi \(rc1 canary\)/ }))
        expect(onOpen).toHaveBeenCalledExactlyOnceWith(theirs)
    })
    it('names unsent text on a private note "Private note" without decoding its title', async () => {
        const { store, client } = setup(), theirs = 'ee'.repeat(16)
        const reader = { ...client, noteMetadata: vi.fn(async (id: string) => ({ ...noteOf(id), owner: 'someone', mode: 1, title: utf8('ciphertext must stay hidden') })) }
        render(<NotesList store={store} partition={partition} client={reader} owner="owner" query="" selected={null} unsaved={[theirs]} refresh={0} onOpen={vi.fn()} />)
        await waitFor(() => expect(list()).toEqual(['Private noteUnsavedNot sent yet']))
        expect(document.body.textContent).not.toContain('ciphertext')
    })
    it('mixes local drafts, published and private notes with a state and one line of context', async () => {
        const { store, session, client } = setup(), onOpen = vi.fn()
        const draft = 'aa'.repeat(16), edited = 'bb'.repeat(16), published = 'cc'.repeat(16), locked = 'dd'.repeat(16)
        const now = Date.now()
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now - 2_000)
        await store.saveDraft({ ...partition, noteId: draft }, '0', { kind: 'public', title: '', body: '' }, session)
        vi.setSystemTime(now - 1_000)
        await store.saveDraft({ ...partition, noteId: edited }, '0', { kind: 'public', title: 'Packing list', body: 'Tent', base: { stateRevision: '2', epoch: '0', ownerGeneration: '1', titleRevision: '1', bodyRevision: '2' } }, session)
        client.byOwner.mockResolvedValue(page([note(edited, { stateRevision: '3' }), note(published), note(locked, { mode: 1, title: utf8('ciphertext must stay hidden') })]))
        render(<NotesList store={store} partition={partition} client={client} owner="owner" query="" selected={published} refresh={0} onOpen={onOpen} />)
        vi.useRealTimers()
        // Drafts (device) and published notes (chain) load independently: wait for both.
        // F12: an untouched blank draft is not listed unless it is the note on screen.
        await waitFor(() => expect(list()).toEqual(['Packing listPublicRevision 3 · draft on this device', 'SushiPublicRevision 6', 'Private notePrivateRevision 6']))
        expect(screen.queryByText(/ciphertext/)).toBeNull()
        expect(screen.getByRole('button', { name: /Sushi/ })).toHaveAttribute('aria-current', 'true')
        expect(screen.queryByRole('button', { name: /New note/ })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /Private note/ }))
        expect(onOpen).toHaveBeenCalledExactlyOnceWith(locked)
        expect(client.byOwner).toHaveBeenCalledExactlyOnceWith('owner', '', 20)
    })

    it('lists an untouched blank draft only while it is the note on screen (F12)', async () => {
        const { store, session, client } = setup(), blank = 'aa'.repeat(16)
        await store.saveDraft({ ...partition, noteId: blank }, '0', { kind: 'public', title: '', body: '' }, session)
        const view = render(<NotesList store={store} partition={partition} client={client} owner="owner" query="" selected={blank} refresh={0} onOpen={vi.fn()} />)
        expect(await screen.findByRole('button', { name: /New note/ })).toHaveAttribute('aria-current', 'true')
        view.rerender(<NotesList store={store} partition={partition} client={client} owner="owner" query="" selected={null} refresh={0} onOpen={vi.fn()} />)
        expect(await screen.findByText('No notes yet.')).toBeVisible(); expect(screen.queryByRole('button', { name: /New note/ })).toBeNull()
    })
    it('keeps a blank draft listed while it holds unsaved text, even when another note is open (F12)', async () => {
        const { store, session, client } = setup(), blank = 'aa'.repeat(16)
        await store.saveDraft({ ...partition, noteId: blank }, '0', { kind: 'public', title: '', body: '' }, session)
        render(<NotesList store={store} partition={partition} client={client} owner="owner" query="" selected={null} unsaved={[blank]} refresh={0} onOpen={vi.fn()} />)
        expect(await screen.findByRole('button', { name: /New note/ })).toHaveTextContent('Unsaved changes')
    })
    describe('a row with a draft of a published note', () => {
        const id = 'bb'.repeat(16), base = { stateRevision: '6', epoch: '0', ownerGeneration: '1', titleRevision: '1', bodyRevision: '1' }
        async function draftOf(store: NotesStore, session: ReturnType<typeof createDraftSession>, owner = 'owner', patch = {}) {
            await store.saveDraft({ ...partition, owner, noteId: id }, '0', { kind: 'public', title: 'Sushi', body: 'Rice', base, ...patch }, session)
        }
        /** Metadata (no body) for every row; the body only to compare a draft that follows the published revision. */
        function reads(meta: () => ChainNote | null, full: () => ChainNote | null = meta) {
            return { noteMetadata: vi.fn<(id: string) => Promise<ChainNote | null>>(async () => meta()), note: vi.fn<(id: string) => Promise<ChainNote | null>>(async () => full()) }
        }
        it('says nothing about the draft when it holds no unpublished changes (F8)', async () => {
            const { store, session, client } = setup(); await draftOf(store, session)
            const live = note(id), chain = reads(() => live, () => ({ ...live, body: utf8('Rice') }))
            client.byOwner.mockResolvedValue(page([live]))
            render(<NotesList store={store} partition={partition} client={{ ...client, ...chain }} owner="owner" query="" selected={null} refresh={0} onOpen={vi.fn()} />)
            // The draft was compared with the published text, then said nothing.
            await waitFor(() => expect(chain.note).toHaveBeenCalledWith(id)); await act(async () => {})
            await waitFor(() => expect(list()).toEqual(['SushiPublicRevision 6']))
        })
        it('follows the revision the note-change announcement brings, also for a note of someone else (F18)', async () => {
            const { store, session, client } = setup(), b = { ...partition, owner: 'b' }; await draftOf(store, session, 'b')
            let live = note(id, { owner: 'a' })
            const chain = reads(() => live, () => ({ ...live, body: utf8('Rice') }))
            render(<NotesList store={store} partition={b} client={{ ...client, ...chain }} owner="b" query="" selected={null} refresh={0} onOpen={vi.fn()} />)
            await waitFor(() => expect(list()).toEqual(['SushiPublicRevision 6']))
            live = note(id, { owner: 'a', stateRevision: '7' })
            act(() => announceNoteChange({ chainId: partition.chainId, noteId: id, stateRevision: '7' }))
            await waitFor(() => expect(list()).toEqual(['SushiPublicRevision 7 · draft on this device']))
            act(() => announceNoteChange({ chainId: 'other-1', noteId: id }))
            // Revision 7 is not the draft's base: its body is never fetched.
            expect(chain.noteMetadata).toHaveBeenCalledTimes(2); expect(chain.note).toHaveBeenCalledOnce()
        })
        it('keeps the higher revision when a lagging node answers an announcement with an older one', async () => {
            const { store, session, client } = setup(); await draftOf(store, session)
            let live = note(id)
            const chain = reads(() => live, () => ({ ...live, body: utf8('Rice') }))
            render(<NotesList store={store} partition={partition} client={{ ...client, ...chain }} owner="owner" query="" selected={null} refresh={0} onOpen={vi.fn()} />)
            await waitFor(() => expect(list()).toEqual(['SushiPublicRevision 6']))
            live = note(id, { stateRevision: '7' })
            act(() => announceNoteChange({ chainId: partition.chainId, noteId: id, stateRevision: '7' }))
            await waitFor(() => expect(list()).toEqual(['SushiPublicRevision 7 · draft on this device']))
            live = note(id)
            act(() => announceNoteChange({ chainId: partition.chainId, noteId: id }))
            await waitFor(() => expect(chain.noteMetadata).toHaveBeenCalledTimes(3)); await act(async () => {})
            expect(list()).toEqual(['SushiPublicRevision 7 · draft on this device'])
        })
        it('reads the notes behind its rows again when Notes comes to the front, at most once per interval', async () => {
            vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(10_000)
            const { store, session, client } = setup(); await draftOf(store, session)
            let live = note(id)
            const chain = reads(() => live, () => ({ ...live, body: utf8('Rice') }))
            render(<NotesList store={store} partition={partition} client={{ ...client, ...chain }} owner="owner" query="" selected={null} refresh={0} onOpen={vi.fn()} />)
            await waitFor(() => expect(list()).toEqual(['SushiPublicRevision 6']))
            live = note(id, { stateRevision: '8' })
            // Just read: an immediate focus, or one for another network, reads nothing.
            act(() => { announceNotesFocus(partition.chainId); vi.setSystemTime(20_000); announceNotesFocus('other-1') })
            await act(async () => {})
            expect(chain.noteMetadata).toHaveBeenCalledOnce()
            act(() => announceNotesFocus(partition.chainId, 'ee'.repeat(16)))
            await waitFor(() => expect(list()).toEqual(['SushiPublicRevision 8 · draft on this device']))
            expect(chain.noteMetadata).toHaveBeenCalledTimes(2)
        })
        it('reads each note once, not again on every autosave or focus (drafts reload)', async () => {
            const { store, session, client } = setup(); await draftOf(store, session)
            const live = note(id), chain = reads(() => live, () => ({ ...live, body: utf8('Rice') })), reader = { ...client, ...chain }
            const view = render(<NotesList store={store} partition={partition} client={reader} owner="owner" query="" selected={null} refresh={0} onOpen={vi.fn()} />)
            await waitFor(() => expect(list()).toEqual(['SushiPublicRevision 6']))
            for (const refresh of [1, 2, 3]) { view.rerender(<NotesList store={store} partition={partition} client={reader} owner="owner" query="" selected={null} refresh={refresh} onOpen={vi.fn()} />); await act(async () => { window.dispatchEvent(new Event('focus')) }) }
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
            expect(chain.noteMetadata).toHaveBeenCalledOnce(); expect(chain.note).toHaveBeenCalledOnce()
        })
        it('says Deleted for a deleted note that still has a draft here (F32)', async () => {
            const { store, session, client } = setup(); await draftOf(store, session, 'owner', { title: 'Sushi (rc1 canary)' })
            render(<NotesList store={store} partition={partition} client={{ ...client, ...reads(() => note(id, { stateRevision: '9', deleted: true })) }} owner="owner" query="" selected={null} refresh={0} onOpen={vi.fn()} />)
            await waitFor(() => expect(list()).toEqual(['Sushi (rc1 canary)DeletedDraft on this device · open it to remove it']))
        })
        it('never takes an absent answer for a deletion: a node may lag, and notes are never removed', async () => {
            const { store, session, client } = setup(); await draftOf(store, session)
            const chain = reads(() => null)
            render(<NotesList store={store} partition={partition} client={{ ...client, ...chain }} owner="owner" query="" selected={null} refresh={0} onOpen={vi.fn()} />)
            await waitFor(() => expect(chain.noteMetadata).toHaveBeenCalledWith(id)); await act(async () => {})
            expect(list()).toEqual(['SushiPublicRevision 6 · draft on this device'])
        })
    })
    it('orders drafts saved in the same millisecond deterministically and marks unsaved ones', async () => {
        const { store, session, client } = setup(), guest = { ...partition, owner: 'guest' }
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(5_000)
        for (const noteId of ['cc'.repeat(16), 'aa'.repeat(16), 'bb'.repeat(16)]) await store.saveDraft({ ...guest, noteId }, '0', { kind: 'public', title: noteId.slice(0, 2), body: '' }, session)
        vi.useRealTimers()
        render(<NotesList store={store} partition={guest} client={client} owner={null} query="" selected={null} unsaved={['bb'.repeat(16)]} refresh={0} onOpen={vi.fn()} />)
        await screen.findByRole('button', { name: /^cc/ })
        expect(list().map(text => text?.slice(0, 2))).toEqual(['aa', 'bb', 'cc'])
        expect(screen.getByRole('button', { name: /^bb/ })).toHaveTextContent('Unsaved changes')
    })
    it('filters by title and lists only this device for a guest', async () => {
        const { store, session, client } = setup(), guest = { ...partition, owner: 'guest' }
        await store.saveDraft({ ...guest, noteId: 'aa'.repeat(16) }, '0', { kind: 'public', title: 'Sushi rice', body: '' }, session)
        await store.saveDraft({ ...guest, noteId: 'bb'.repeat(16) }, '0', { kind: 'public', title: 'Trip budget', body: '' }, session)
        const view = render(<NotesList store={store} partition={guest} client={client} owner={null} query="" selected={null} refresh={0} onOpen={vi.fn()} />)
        expect(await screen.findAllByRole('listitem')).toHaveLength(2)
        view.rerender(<NotesList store={store} partition={guest} client={client} owner={null} query=" SUSHI " selected={null} refresh={0} onOpen={vi.fn()} />)
        expect(list()).toEqual([expect.stringMatching(/^Sushi rice/)])
        view.rerender(<NotesList store={store} partition={guest} client={client} owner={null} query="paella" selected={null} refresh={0} onOpen={vi.fn()} />)
        expect(screen.getByText('No notes match this search.')).toBeVisible()
        expect(client.byOwner).not.toHaveBeenCalled()
        expect(screen.queryByRole('status')).toBeNull()
    })

    it('shows a new local draft after a refresh signal', async () => {
        const { store, session, client } = setup()
        const view = render(<NotesList store={store} partition={partition} client={client} owner="owner" query="" selected={null} refresh={0} onOpen={vi.fn()} />)
        expect(await screen.findByText('No notes yet.')).toBeVisible()
        await store.saveDraft({ ...partition, noteId: 'aa'.repeat(16) }, '0', { kind: 'public', title: 'Sushi', body: '' }, session)
        view.rerender(<NotesList store={store} partition={partition} client={client} owner="owner" query="" selected={null} refresh={1} onOpen={vi.fn()} />)
        expect(await screen.findByRole('button', { name: /Sushi/ })).toBeVisible()
    })

    it('retries a failed page without diagnostics or alerts, then loads more without duplicates', async () => {
        const { store, client } = setup(), next = '00000000000000000020:' + 'cc'.repeat(16)
        client.byOwner.mockRejectedValueOnce(new Error('secret diagnostic'))
            .mockResolvedValueOnce(page([note('cc'.repeat(16))], next))
            .mockResolvedValueOnce(page([note('cc'.repeat(16)), note('ee'.repeat(16), { title: utf8('Second') })]))
        render(<NotesList store={store} partition={partition} client={client} owner="owner" query="" selected={null} refresh={0} onOpen={vi.fn()} />)
        const failure = await screen.findByText(/could not be loaded/)
        expect(failure).not.toHaveTextContent('secret diagnostic')
        expect(screen.queryByRole('alert')).toBeNull()
        fireEvent.click(within(failure).getByRole('button', { name: 'Retry' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Show more notes' }))
        expect(await screen.findByRole('button', { name: /Second/ })).toBeVisible()
        expect(screen.getAllByRole('button', { name: /Sushi/ })).toHaveLength(1)
        expect(client.byOwner.mock.calls).toEqual([['owner', '', 20], ['owner', '', 20], ['owner', next, 20]])
    })
})
