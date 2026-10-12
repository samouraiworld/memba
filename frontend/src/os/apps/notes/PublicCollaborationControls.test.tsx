import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import type { NotesStore } from '../../../lib/notes/drafts'
import { PublicCollaborationControls } from './PublicCollaborationControls'
import { useNoteFreshness } from '../../../lib/notes/freshness'
const calls = vi.hoisted(() => ({ prepare: vi.fn(), sign: vi.fn(), pending: vi.fn() }))
vi.mock('../../sign/signerContext', () => ({ useSigner: () => ({ sign: calls.sign }) }))
vi.mock('../../../lib/notes/chain/request', () => ({ preparePublicNoteRequest: calls.prepare }))
vi.mock('../../../lib/notes/intents', () => ({ NotesIntents: class { list = calls.pending } }))
vi.mock('../../../lib/notes/config', () => ({ newNoteId: () => crypto.randomUUID().replaceAll('-', ''), notesDeployment: () => ({ realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 }) }))
const owner = 'g1jw76lxvzjafw2kyjhdnzwggcftyhnlfjaer2u0'
const note = { id: 'ab'.repeat(16), owner, stateRevision: '4', ownerGeneration: '1', mode: 4, epoch: '0', deleted: false, listed: true } as ChainNote
const capability = { id: note.id, stateRevision: '4', ownerGeneration: '1', mode: 4 as const, deleted: false, allowPublicWrites: false }
function props(enabled = false) { return { note, owner, store: {} as NotesStore, onChanged: vi.fn(), client: { chainId: 'gnoland-1', assertCurrent: vi.fn(), publicCapabilities: vi.fn(async () => ({ ...capability, allowPublicWrites: enabled })) } as unknown as NotesReadClient } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
async function review(enabled = false) {
    fireEvent.click(await screen.findByRole('radio', { name: enabled ? /Only me/ : /Everyone with a wallet/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply with Adena' }))
}
const apply = () => screen.getByRole('button', { name: 'Apply with Adena' })
beforeEach(() => { vi.clearAllMocks(); calls.prepare.mockResolvedValue({ onDismissed: vi.fn(), onSettled: vi.fn() }); calls.sign.mockReturnValue(true); calls.pending.mockResolvedValue([]) })
describe('owner community editing consent', () => {
    it.each([false, true])('applies the exact target boolean opposite to enabled=%s with the quoted cap, never on render', async enabled => {
        const input = props(enabled); render(<PublicCollaborationControls {...input} />)
        expect(await screen.findByRole('radio', { name: enabled ? /Everyone with a wallet/ : /Only me/ })).toBeChecked()
        expect(screen.queryByRole('button', { name: 'Apply with Adena' })).toBeNull()
        expect(calls.sign).not.toHaveBeenCalled(); expect(calls.prepare).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('radio', { name: enabled ? /Only me/ : /Everyone with a wallet/ }))
        expect(screen.getByText('≈ 1.2 GNOT')).toBeVisible(); expect(screen.getByText(/at most 2.4 GNOT/)).toBeVisible()
        fireEvent.click(apply()); await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        expect(calls.prepare.mock.calls[0][0]).toMatchObject({ maxDepositUgnot: '2400000', draftLocalRevision: '0', operation: { caller: owner, noteId: note.id, action: { kind: 'public-writes', revision: '4', enabled: !enabled } } })
        expect(input.onChanged).not.toHaveBeenCalled()
        expect(screen.getByText(/Waiting for your signature/)).toBeVisible()
    })
    it('lets Cancel put the choice back without preparing anything', async () => {
        render(<PublicCollaborationControls {...props()} />)
        fireEvent.click(await screen.findByRole('radio', { name: /Everyone with a wallet/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(screen.getByRole('radio', { name: /Only me/ })).toBeChecked(); expect(screen.queryByRole('button', { name: 'Apply with Adena' })).toBeNull()
        expect(calls.prepare).not.toHaveBeenCalled()
    })
    it.each([{ owner: null }, { owner: 'collaborator' }])('shows the setting read-only to everyone else (%j)', async patch => {
        const input = props(true); render(<PublicCollaborationControls {...input} {...patch} />)
        expect(await screen.findByText(/^Everyone with a wallet\./)).toBeVisible()
        expect(screen.queryByRole('radio')).toBeNull(); expect(screen.queryByRole('button')).toBeNull(); expect(calls.sign).not.toHaveBeenCalled()
    })
    it.each([{ note: { ...note, deleted: true } }, { note: { ...note, mode: 3 } }, { hidden: true }])('offers no community editing outside a live visible mode4 note (%j)', patch => {
        const input = props(); render(<PublicCollaborationControls {...input} {...patch} />)
        expect(screen.queryByRole('button')).toBeNull(); expect(screen.queryByRole('radio')).toBeNull(); expect(input.client.publicCapabilities).not.toHaveBeenCalled(); expect(calls.sign).not.toHaveBeenCalled()
    })
    it.each([null, { ...capability, id: 'cd'.repeat(16) }, { ...capability, stateRevision: '5' }, { ...capability, ownerGeneration: '2' }, { ...capability, mode: 3 }, { ...capability, deleted: true }])('fails closed for missing or mismatched capability (%j)', value => {
        const input = props(); vi.mocked(input.client.publicCapabilities).mockResolvedValue(value as typeof capability | null)
        render(<PublicCollaborationControls {...input} />)
        return screen.findByRole('alert').then(alert => { expect(alert).toHaveTextContent('could not be checked'); expect(screen.queryByRole('radio')).toBeNull(); expect(calls.prepare).not.toHaveBeenCalled() })
    })
    it('can retry a failed getter without preparing a request', async () => {
        const input = props(); vi.mocked(input.client.publicCapabilities).mockRejectedValueOnce(new Error('RPC failure'))
        render(<PublicCollaborationControls {...input} />); fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
        expect(await screen.findByRole('radio', { name: /Only me/ })).toBeChecked(); expect(calls.prepare).not.toHaveBeenCalled()
    })
    it('refuses a grant that changed on chain before the review', async () => {
        const input = props(); render(<PublicCollaborationControls {...input} />)
        await screen.findByRole('radio', { name: /Only me/ })
        vi.mocked(input.client.publicCapabilities).mockResolvedValue({ ...capability, allowPublicWrites: true })
        await review(); await screen.findByText(/permission or note changed/); expect(calls.prepare).not.toHaveBeenCalled()
    })
    it('retains and blocks an unknown outcome without refresh or resend', async () => {
        const input = props(); render(<PublicCollaborationControls {...input} />); await review()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        await act(async () => calls.sign.mock.calls[0][0].onSettled('unknown'))
        expect(apply()).toBeDisabled()
        expect(screen.getByText(/operation receipt was kept/)).toBeVisible(); expect(input.onChanged).not.toHaveBeenCalled(); expect(calls.prepare).toHaveBeenCalledOnce()
    })
    it('retains and blocks a submitted outcome that is not yet seen on chain', async () => {
        const input = props(); render(<PublicCollaborationControls {...input} />); await review()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        await act(async () => calls.sign.mock.calls[0][0].onSettled('submitted'))
        expect(apply()).toBeDisabled()
        expect(screen.getByText(/not yet seen on chain/)).toBeVisible(); expect(input.onChanged).not.toHaveBeenCalled()
    })
    it.each(['prepared', 'submitted', 'unknown'])('blocks before preparing while a %s receipt for this note is unresolved', async phase => {
        calls.pending.mockResolvedValue([{ scope: { noteId: 'cd'.repeat(16) }, phase }, { scope: { noteId: note.id }, phase }])
        render(<PublicCollaborationControls {...props()} />); await review()
        await screen.findByText(/unresolved receipt/); expect(calls.prepare).not.toHaveBeenCalled()
        expect(calls.pending).toHaveBeenCalledWith({ chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner })
        expect(apply()).toBeDisabled()
    })
    it('ignores settled receipts and receipts for other notes', async () => {
        calls.pending.mockResolvedValue([{ scope: { noteId: note.id }, phase: 'confirmed' }, { scope: { noteId: note.id }, phase: 'not-sent' }, { scope: { noteId: 'cd'.repeat(16) }, phase: 'unknown' }])
        render(<PublicCollaborationControls {...props()} />); await review(); await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
    })
    it('prepares once for a double click', async () => {
        render(<PublicCollaborationControls {...props()} />)
        fireEvent.click(await screen.findByRole('radio', { name: /Everyone with a wallet/ }))
        const button = apply()
        fireEvent.click(button); fireEvent.click(button)
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce()); expect(calls.prepare).toHaveBeenCalledOnce()
    })
    it('refreshes only on confirmed settlement and dismisses a refused signature sheet', async () => {
        const announced = vi.fn()
        function Listener() { useNoteFreshness('gnoland-1', note.id, announced); return null }
        const input = props(), view = render(<><Listener /><PublicCollaborationControls {...input} /></>); await review()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        await act(async () => calls.sign.mock.calls[0][0].onSettled('confirmed')); expect(input.onChanged).toHaveBeenCalledOnce()
        expect(screen.getByText(/Editing is open: every wallet can now edit this note/)).toBeVisible()
        expect(announced).toHaveBeenCalledExactlyOnceWith({ stateRevision: '5' })
        view.unmount(); calls.sign.mockReturnValue(false)
        const dismissed = vi.fn(); calls.prepare.mockResolvedValue({ onDismissed: dismissed })
        render(<PublicCollaborationControls {...props()} />); await review(); await waitFor(() => expect(dismissed).toHaveBeenCalledOnce())
    })
    it.each(['client', 'store', 'account', 'note', 'revision', 'generation', 'mode', 'epoch', 'deleted', 'listed', 'hidden'] as const)('invalidates a late prepared request when %s changes', async field => {
        const input = props(), pending = deferred<object>(); calls.prepare.mockReturnValueOnce(pending.promise)
        const view = render(<PublicCollaborationControls {...input} />); await review(); await waitFor(() => expect(calls.prepare).toHaveBeenCalledOnce())
        const guard = calls.prepare.mock.calls[0][0].session.capture()
        const patch = field === 'client' ? { client: { ...input.client } } : field === 'store' ? { store: {} as NotesStore } : field === 'account' ? { owner: 'other' } : field === 'hidden' ? { hidden: true }
            : { note: { ...note, ...(field === 'note' ? { id: 'cd'.repeat(16) } : field === 'revision' ? { stateRevision: '5' } : field === 'generation' ? { ownerGeneration: '2' } : field === 'mode' ? { mode: 3 } : field === 'epoch' ? { epoch: '1' } : field === 'deleted' ? { deleted: true } : { listed: false }) } }
        view.rerender(<PublicCollaborationControls {...input} {...patch} />); expect(guard.signal.aborted).toBe(true)
        const onDismissed = vi.fn(); await act(async () => pending.resolve({ onDismissed }))
        expect(onDismissed).toHaveBeenCalledOnce(); expect(calls.sign).not.toHaveBeenCalled(); expect(input.onChanged).not.toHaveBeenCalled()
    })
    it('ignores a late confirmation after the reader is hidden, and works under StrictMode', async () => {
        const input = props(), view = render(<StrictMode><PublicCollaborationControls {...input} /></StrictMode>); await review()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        view.rerender(<PublicCollaborationControls {...input} hidden />)
        await act(async () => calls.sign.mock.calls[0][0].onSettled('confirmed')); expect(input.onChanged).not.toHaveBeenCalled()
    })
})
