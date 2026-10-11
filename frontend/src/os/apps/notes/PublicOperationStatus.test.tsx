import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotesStore } from '../../../lib/notes/drafts'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { NotesIntent } from '../../../lib/notes/intents'
import { PublicOperationStatus } from './PublicOperationStatus'
const calls = vi.hoisted(() => ({ list: vi.fn(), recover: vi.fn() }))
vi.mock('../../../lib/notes/intents', () => ({ NotesIntents: class { list = calls.list } }))
vi.mock('../../../lib/notes/chain/recovery', () => ({ recoverPublicIntent: calls.recover }))
vi.mock('../../sign/signerContext', () => ({ useSigner: () => ({ version: 1 }) }))
const partition = { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner: 'wallet' }
const receipt = { scope: { ...partition, noteId: 'ab'.repeat(16) }, operationId: 'cd'.repeat(16), phase: 'unknown', verification: { kind: 'public-v1' } } as NotesIntent
const props = { partition, client: {} as NotesReadClient, store: {} as NotesStore, onOpen: vi.fn() }
beforeEach(() => { vi.clearAllMocks(); calls.list.mockResolvedValue([receipt]); calls.recover.mockResolvedValue('unknown') })
describe('public receipts are read-only recovery', () => {
    it('keeps unknown receipts visible and checks only on explicit action without a signature or draft change', async () => {
        render(<PublicOperationStatus {...props} />)
        const check = await screen.findByRole('button', { name: 'Check outcome' }); expect(calls.recover).not.toHaveBeenCalled()
        fireEvent.click(check); await screen.findByText(/outcome remains unknown/)
        expect(calls.recover).toHaveBeenCalledOnce(); expect(screen.getByText(/Outcome unknown · Operation/)).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Open note' })); expect(props.onOpen).toHaveBeenCalledWith(receipt.scope.noteId)
    })
    it('retains unsupported receipts without invoking another protocol or resending', async () => {
        calls.list.mockResolvedValue([{ ...receipt, verification: { kind: 'private-v1' } }])
        render(<PublicOperationStatus {...props} />); await screen.findByText(/unsupported in this public view/)
        expect(screen.queryByRole('button', { name: 'Check outcome' })).toBeNull(); expect(calls.recover).not.toHaveBeenCalled()
    })
    it('confirmation asks for comparison without touching the local baseline', async () => {
        calls.recover.mockResolvedValue('confirmed'); render(<PublicOperationStatus {...props} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Check outcome' })); await screen.findByText(/draft baseline was kept/)
        expect(calls.recover).toHaveBeenCalledOnce()
    })
    it('suppresses a late result from an old account generation', async () => {
        let resolve!: (value: string) => void; calls.recover.mockImplementationOnce(() => new Promise(done => { resolve = done }))
        const view = render(<PublicOperationStatus {...props} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Check outcome' })); await waitFor(() => expect(calls.recover).toHaveBeenCalledOnce())
        const guard = calls.recover.mock.calls[0][3].capture()
        view.rerender(<PublicOperationStatus {...props} partition={{ ...partition, owner: 'other' }} />); expect(guard.signal.aborted).toBe(true)
        await act(async () => resolve('confirmed')); expect(screen.queryByText(/Publication confirmed/)).toBeNull()
    })
})
