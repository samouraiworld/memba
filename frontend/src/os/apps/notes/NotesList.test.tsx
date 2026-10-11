import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createDraftSession, createNotesStore, type NotesStore } from '../../../lib/notes/drafts'
import type { ChainNote, NotesPage } from '../../../lib/notes/chain/schema'
import { NotesList } from './NotesList'

const partition = { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner: 'owner' }
const utf8 = (value: string) => new TextEncoder().encode(value)
function note(id: string, patch: Partial<ChainNote> = {}): ChainNote {
    return { id, owner: 'owner', pendingOwner: '', ownerGeneration: '1', mode: 3, stateRevision: '6', titleRevision: '1', bodyRevision: '1', epoch: '0', title: utf8('Sushi'), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '1', operationId: 'cd'.repeat(16), actor: 'owner', height: '2', ...patch }
}
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
        await waitFor(() => expect(list()).toEqual(['Packing listPublicRevision 3 · draft on this device', 'New noteDraftOn this device · just now', 'SushiPublicRevision 6', 'Private notePrivateRevision 6']))
        expect(screen.queryByText(/ciphertext/)).toBeNull()
        expect(screen.getByRole('button', { name: /Sushi/ })).toHaveAttribute('aria-current', 'true')
        expect(screen.getByRole('button', { name: /New note/ })).not.toHaveAttribute('aria-current')
        fireEvent.click(screen.getByRole('button', { name: /Private note/ }))
        expect(onOpen).toHaveBeenCalledExactlyOnceWith(locked)
        expect(client.byOwner).toHaveBeenCalledExactlyOnceWith('owner', '', 20)
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
