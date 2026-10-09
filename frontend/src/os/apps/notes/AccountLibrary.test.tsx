import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChainNote, NotesPage } from '../../../lib/notes/chain/schema'
import { AccountLibrary } from './AccountLibrary'
const noteId = 'ab'.repeat(16)
function note(patch: Partial<ChainNote> = {}): ChainNote {
    return { id: noteId, owner: 'owner', pendingOwner: '', ownerGeneration: '1', mode: 3, stateRevision: '9007199254740993', titleRevision: '1', bodyRevision: '1', epoch: '0', title: new TextEncoder().encode('Public title'), commitment: new Uint8Array(), deleted: false, listed: false, createdHeight: '1', operationId: 'cd'.repeat(16), actor: 'owner', height: '2', ...patch }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const page = (items: ChainNote[], nextCursor = ''): NotesPage => ({ items, nextCursor })
const next = '00000000000000000020:' + noteId
function client() { return { byOwner: vi.fn().mockResolvedValue(page([])), sharedWith: vi.fn().mockResolvedValue(page([])) } }
describe('account on-chain library', () => {
    it('discovers owned and shared notes with opaque encrypted labels and opens only IDs', async () => {
        const c = client(), onOpen = vi.fn()
        c.byOwner.mockResolvedValue(page([note(), note({ id: 'ee'.repeat(16), mode: 1, title: new Uint8Array([255, 255]) })]))
        c.sharedWith.mockResolvedValue(page([note({ owner: 'another', mode: 1, title: new TextEncoder().encode('Never display ciphertext as text') })]))
        render(<AccountLibrary client={c} owner="owner" onOpen={onOpen} />)
        fireEvent.click(await screen.findByRole('button', { name: /Public title/ }))
        expect(onOpen).toHaveBeenCalledWith(noteId)
        expect(screen.getByRole('button', { name: /Encrypted note · eeeeeeee/ })).toBeVisible()
        expect(c.byOwner).toHaveBeenCalledWith('owner', '', 20)
        fireEvent.click(screen.getByRole('button', { name: 'Shared with you' }))
        expect(screen.queryByText('Public title')).toBeNull()
        fireEvent.click(await screen.findByRole('button', { name: /Encrypted note · abababab/ }))
        expect(c.sharedWith).toHaveBeenCalledWith('owner', '', 20)
        expect(screen.queryByText('Never display ciphertext as text')).toBeNull()
    })
    it('retries the failed cursor, deduplicates pages and rejects non-descending cursors', async () => {
        const c = client()
        c.byOwner.mockResolvedValueOnce(page([note()], next)).mockRejectedValueOnce(new Error('secret diagnostic'))
            .mockResolvedValueOnce(page([note(), note({ id: 'ee'.repeat(16), title: new TextEncoder().encode('Second') })], '00000000000000000010:' + noteId))
            .mockResolvedValueOnce(page([note({ id: 'ff'.repeat(16), title: new TextEncoder().encode('Invalid page') })], next))
        render(<AccountLibrary client={c} owner="owner" onOpen={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Load more account notes' }))
        expect(await screen.findByRole('alert')).not.toHaveTextContent('secret diagnostic')
        fireEvent.click(screen.getByRole('button', { name: 'Retry account notes' }))
        expect(await screen.findByText('Second')).toBeVisible()
        expect(screen.getAllByText('Public title')).toHaveLength(1)
        expect(c.byOwner.mock.calls.slice(0, 3)).toEqual([['owner', '', 20], ['owner', next, 20], ['owner', next, 20]])
        fireEvent.click(screen.getByRole('button', { name: 'Load more account notes' }))
        await screen.findByRole('alert'); expect(screen.queryByText('Invalid page')).toBeNull()
    })
    it('hides previous-account rows and ignores stale pagination after an account change', async () => {
        const old = deferred<NotesPage>(), c = client()
        c.byOwner.mockResolvedValueOnce(page([note()], next)).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([]))
        const view = render(<AccountLibrary client={c} owner="owner" onOpen={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Load more account notes' }))
        view.rerender(<AccountLibrary client={c} owner="new-owner" onOpen={vi.fn()} />)
        expect(screen.queryByText('Public title')).toBeNull()
        await screen.findByText('No published notes owned by this account.')
        await act(async () => { old.resolve(page([note()])) })
        expect(screen.queryByText('Public title')).toBeNull()
        expect(c.byOwner).toHaveBeenLastCalledWith('new-owner', '', 20)
    })
    it('ignores old network/source responses and refreshes the current list only', async () => {
        const old = deferred<NotesPage>(), first = client(), second = client()
        first.byOwner.mockReturnValue(old.promise)
        second.byOwner.mockResolvedValue(page([note()])); second.sharedWith.mockResolvedValue(page([]))
        const view = render(<AccountLibrary client={first} owner="owner" onOpen={vi.fn()} />)
        view.rerender(<AccountLibrary client={second} owner="owner" onOpen={vi.fn()} />)
        await screen.findByText('Public title')
        fireEvent.click(screen.getByRole('button', { name: 'Shared with you' }))
        await screen.findByText('No notes are currently shared with this account.')
        await act(async () => { old.resolve(page([note({ title: new TextEncoder().encode('Old network') })])) })
        expect(screen.queryByText('Old network')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Refresh account notes' }))
        await waitFor(() => expect(second.sharedWith).toHaveBeenCalledTimes(2))
    })
    it('fails closed for deleted or wrong-owner records and retries the initial page', async () => {
        const c = client()
        c.byOwner.mockResolvedValueOnce(page([note({ owner: 'other' })])).mockResolvedValueOnce(page([note({ deleted: true })])).mockResolvedValueOnce(page([]))
        render(<AccountLibrary client={c} owner="owner" onOpen={vi.fn()} />)
        await screen.findByRole('alert'); expect(screen.queryByText('Public title')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Retry account notes' }))
        await waitFor(() => expect(c.byOwner).toHaveBeenCalledTimes(2)); await screen.findByRole('alert')
        fireEvent.click(screen.getByRole('button', { name: 'Retry account notes' }))
        await screen.findByText('No published notes owned by this account.')
    })
})
