import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { NotesStore } from '../../../lib/notes/drafts'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import type { PublicComment } from '../../../lib/notes/chain/comments'
import { PublicCommentPanel } from './PublicCommentPanel'
const mocks = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn(), recover: vi.fn(), list: vi.fn(), sign: vi.fn(), dismiss: vi.fn(), settle: vi.fn(), version: 0, next: 0 }))
vi.mock('../../sign/signerContext', () => ({ useSigner: () => ({ sign: mocks.sign, version: mocks.version }) }))
vi.mock('../../../lib/notes/config', () => ({ notesDeployment: () => ({}), newNoteId: () => (++mocks.next).toString(16).padStart(32, '0') }))
vi.mock('../../../lib/notes/chain/comments', () => ({ readPublicComments: mocks.read }))
vi.mock('../../../lib/notes/chain/commentRequest', () => ({ preparePublicCommentRequest: mocks.prepare, recoverPublicCommentIntent: mocks.recover, commentIntentRealm: (id: string) => `notes/comments/${id}` }))
vi.mock('../../../lib/notes/chain/commentMessages', () => ({ publicCommentMessage: () => ({}) }))
vi.mock('../../../lib/notes/chain/commentQuote', () => ({ publicCommentBudget: () => ({ estimatedDepositUgnot: '2260000', suggestedCapUgnot: '2800000' }), publicCommentQuote: () => vi.fn() }))
vi.mock('../../../lib/notes/intents', () => ({ NotesIntents: class { list = mocks.list } }))
const noteId = 'ab'.repeat(16), cid = 'cd'.repeat(16)
const note = { id: noteId, owner: 'owner', mode: 4, epoch: '0', bodyRevision: '1', stateRevision: '1', ownerGeneration: '1', deleted: false } as ChainNote
const row = (patch: Partial<PublicComment> = {}): PublicComment => ({ id: cid, author: 'owner', parent: '', anchor: '', body: 'Public comment', epoch: '0', bodyRevision: '1', revision: '1', deleted: false, hidden: false, resolved: false, encrypted: false, operationId: 'ef'.repeat(16), actor: 'owner', createdHeight: '1', height: '1', ...patch })
const pending = { phase: 'unknown', operationId: 'aa'.repeat(16), verification: { kind: 'comment-v1' } }
function setup(owner: string | null = 'owner', value = note, strict = false) {
    const props = { note: value, owner, client: { chainId: 'test-chain' } as NotesReadClient, store: {} as NotesStore }
    const element = <PublicCommentPanel {...props} />
    const view = render(strict ? <StrictMode>{element}</StrictMode> : element)
    const composer = screen.queryByText('Write a public comment'); if (composer) fireEvent.click(composer)
    return { ...view, props }
}
async function compose() {
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'My public reply' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review comment' })).toBeEnabled())
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
    vi.clearAllMocks(); mocks.next = 0; mocks.version = 0
    mocks.read.mockResolvedValue({ items: [row()], nextCursor: '' }); mocks.list.mockResolvedValue([]); mocks.recover.mockResolvedValue('unknown')
    mocks.prepare.mockResolvedValue({ onDismissed: mocks.dismiss, onSettled: mocks.settle }); mocks.sign.mockReturnValue(true)
})
describe('public-only comment controls', () => {
    it('can prepare a fresh comment review after StrictMode effect replay', async () => {
        setup('owner', note, true); await compose()
        fireEvent.click(screen.getByRole('button', { name: 'Review comment' }))
        await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        expect(mocks.prepare.mock.calls[0][0].session.capture().signal.aborted).toBe(false)
        expect(mocks.prepare.mock.calls[0][0].operation.caller).toBe('owner')
    })
    it('lets a guest read without touching receipts or preparing a signature', async () => {
        setup(null); expect(await screen.findByText('Public comment')).toBeVisible()
        expect(screen.getByText('Connect your wallet to comment.')).toBeVisible()
        expect(screen.queryByLabelText('Comment')).toBeNull(); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled()
    })
    it('lets a connected nonowner comment in PublicOpen with a distinct ID, reply and explicit cap', async () => {
        setup('member'); fireEvent.click(await screen.findByRole('button', { name: 'Reply' })); await compose()
        fireEvent.change(screen.getByLabelText('Quoted passage (optional)'), { target: { value: 'Quoted passage' } })
        fireEvent.change(screen.getByLabelText('Maximum storage deposit (GNOT)'), { target: { value: '3' } })
        fireEvent.click(screen.getByRole('button', { name: 'Review comment' }))
        await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        const input = mocks.prepare.mock.calls[0][0]
        expect(input.maxDepositUgnot).toBe('3000000'); expect(input.operation.commentId).not.toBe(input.operation.operationId)
        expect(input.operation).toMatchObject({ caller: 'member', noteId, action: { kind: 'add', parent: cid, bodyRevision: '1', epoch: '0', body: 'My public reply', anchor: 'Quoted passage' } })
        expect(screen.queryByRole('button', { name: 'Delete comment' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Resolve thread' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Hide comment' })).toBeNull()
    })
    it.each([[false, 'Resolve thread', 'resolve', true], [true, 'Reopen thread', 'resolve', false], [false, 'Hide comment', 'hide', true], [true, 'Unhide comment', 'hide', false]] as const)('binds moderation target %s / %s', async (initial, button, kind, target) => {
        mocks.read.mockResolvedValue({ items: [row({ resolved: initial, hidden: initial })], nextCursor: '' }); setup()
        fireEvent.click(await screen.findByRole('button', { name: button }))
        await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
        expect(mocks.prepare.mock.calls[0][0].operation.action).toEqual({ kind, revision: '1', [kind === 'resolve' ? 'resolved' : 'hidden']: target })
    })
    it('allows author deletion while retaining a tombstone and forbids posting outside PublicOpen', async () => {
        setup('owner', { ...note, deleted: true }); fireEvent.click(await screen.findByRole('button', { name: 'Delete comment' }))
        await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
        expect(mocks.prepare.mock.calls[0][0].operation.action).toEqual({ kind: 'delete', revision: '1' })
        expect(screen.queryByLabelText('Comment')).toBeNull(); expect(screen.queryByRole('button', { name: 'Hide comment' })).toBeNull()
    })
    it('keeps restricted notes read-only for new comments and masks encrypted historical actions', async () => {
        mocks.read.mockResolvedValue({ items: [row({ encrypted: true, body: '' })], nextCursor: '' }); setup('owner', { ...note, mode: 3 })
        expect(await screen.findByText('Encrypted comment')).toBeVisible()
        expect(screen.queryByLabelText('Comment')).toBeNull()
        for (const name of ['Delete comment', 'Resolve thread', 'Hide comment']) expect(screen.queryByRole('button', { name })).toBeNull()
        expect(mocks.prepare).not.toHaveBeenCalled()
    })
    it('keeps unknown receipts and composer text, checks explicitly, and never resends', async () => {
        mocks.list.mockResolvedValue([pending]); setup()
        fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Keep this thought' } })
        fireEvent.click(await screen.findByRole('button', { name: 'Check comment outcome' }))
        expect(await screen.findByText('The outcome remains unknown. Nothing was resent.')).toBeVisible()
        expect(screen.getByLabelText('Comment')).toHaveValue('Keep this thought'); expect(screen.getByRole('button', { name: 'Review comment' })).toBeDisabled()
        expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled()
    })
    it('retains unsupported private receipts without routing them to a public recovery function', async () => {
        mocks.list.mockResolvedValue([{ ...pending, verification: { kind: 'private-comment-v1' } }]); setup()
        expect(await screen.findByText(/This saved operation is not supported/)).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Check comment outcome' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Review comment' })).toBeDisabled(); expect(mocks.recover).not.toHaveBeenCalled()
    })
    it('rechecks durable receipts before posting and fails closed if storage cannot be read', async () => {
        mocks.list.mockResolvedValueOnce([]).mockResolvedValue([pending]); const view = setup(); await compose()
        fireEvent.click(screen.getByRole('button', { name: 'Review comment' }))
        expect(await screen.findByText('Check the unresolved comment receipt before posting again.')).toBeVisible()
        expect(mocks.prepare).not.toHaveBeenCalled(); view.unmount(); mocks.list.mockRejectedValue(new Error('sensitive storage diagnostic')); setup()
        expect(await screen.findByText(/Saved comment receipts could not be read/)).toBeVisible()
        expect(screen.getByRole('button', { name: 'Review comment' })).toBeDisabled(); expect(screen.queryByText('sensitive storage diagnostic')).toBeNull()
    })
    it.each(['account', 'network', 'note', 'unmount'])('invalidates a delayed review on %s change before it reaches the signer', async change => {
        const delayed = deferred<object>(); mocks.prepare.mockReturnValueOnce(delayed.promise)
        const view = setup(); await compose(); fireEvent.click(screen.getByRole('button', { name: 'Review comment' }))
        await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
        const guard = mocks.prepare.mock.calls[0][0].session.capture()
        if (change === 'unmount') view.unmount()
        else view.rerender(<PublicCommentPanel {...view.props} {...(change === 'account' ? { owner: 'other' } : change === 'network' ? { client: { chainId: 'other' } as NotesReadClient } : { note: { ...note, id: 'ff'.repeat(16) } })} />)
        expect(guard.signal.aborted).toBe(true)
        await act(async () => delayed.resolve({ onDismissed: mocks.dismiss }))
        expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.dismiss).toHaveBeenCalledOnce()
    })
    it('rejects an insufficient cap and keeps newer composer edits after confirmation', async () => {
        setup(); await compose(); fireEvent.change(screen.getByLabelText('Maximum storage deposit (GNOT)'), { target: { value: '1' } })
        fireEvent.click(screen.getByRole('button', { name: 'Review comment' })); await screen.findByText('Enter a deposit cap of at least 2.26 GNOT.')
        expect(mocks.sign).not.toHaveBeenCalled()
        fireEvent.change(screen.getByLabelText('Maximum storage deposit (GNOT)'), { target: { value: '3' } })
        fireEvent.click(screen.getByRole('button', { name: 'Review comment' })); await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Newer unsent edit' } })
        act(() => mocks.sign.mock.calls[0][0].onSettled('confirmed', undefined))
        expect(screen.getByLabelText('Comment')).toHaveValue('Newer unsent edit')
    })
})
