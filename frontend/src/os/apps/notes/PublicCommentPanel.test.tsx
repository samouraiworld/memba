import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { NotesStore } from '../../../lib/notes/drafts'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import type { PublicComment } from '../../../lib/notes/chain/comments'
import { PublicCommentPanel } from './PublicCommentPanel'
import { announceNoteChange } from '../../../lib/notes/freshness'
import { mayCloseWindow } from '../../shell/closeGuards'
import { clearCommentDrafts } from '../../../lib/notes/commentDraftStorage'
const mocks = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn(), recover: vi.fn(), list: vi.fn(), sign: vi.fn(), send: vi.fn(), dismiss: vi.fn(), settle: vi.fn(), version: 0, next: 0 }))
vi.mock('../../sign/signerContext', () => ({ useSigner: () => ({ sign: mocks.sign, version: mocks.version }) }))
vi.mock('../../../lib/notes/config', () => ({ notesDeployment: () => ({}), newNoteId: () => (++mocks.next).toString(16).padStart(32, '0') }))
vi.mock('../../../lib/notes/chain/comments', async importOriginal => ({ ...await importOriginal<typeof import('../../../lib/notes/chain/comments')>(), readPublicComments: mocks.read }))
vi.mock('../../../lib/notes/chain/commentRequest', () => ({ preparePublicCommentRequest: mocks.prepare, recoverPublicCommentIntent: mocks.recover, commentIntentRealm: (_realm: string, id: string) => `notes/comments/${id}` }))
vi.mock('../../../lib/notes/chain/commentMessages', () => ({ publicCommentMessage: () => ({}) }))
vi.mock('../../../lib/notes/chain/commentQuote', () => ({ publicCommentBudget: () => ({ estimatedDepositUgnot: '2260000', suggestedCapUgnot: '2800000' }), publicCommentQuote: () => vi.fn() }))
vi.mock('../../../lib/notes/intents', () => ({ NotesIntents: class { list = mocks.list } }))
const noteId = 'ab'.repeat(16), cid = 'cd'.repeat(16)
const note = { id: noteId, owner: 'owner', mode: 4, epoch: '0', bodyRevision: '1', stateRevision: '1', ownerGeneration: '1', deleted: false } as ChainNote
const row = (patch: Partial<PublicComment> = {}): PublicComment => ({ id: cid, author: 'owner', parent: '', anchor: '', body: 'Public comment', epoch: '0', bodyRevision: '1', revision: '1', deleted: false, hidden: false, resolved: false, encrypted: false, operationId: 'ef'.repeat(16), actor: 'owner', createdHeight: '1', height: '1', ...patch })
const text = (value: string) => new TextEncoder().encode(value)
const pending = { phase: 'unknown', operationId: 'aa'.repeat(16), verification: { kind: 'comment-v1' } }
function setup(owner: string | null = 'owner', value = note, strict = false, previewRoot: HTMLElement | null = null) {
    const props = { note: value, owner, client: { chainId: 'test-chain', note: vi.fn(async () => value) } as unknown as NotesReadClient, store: {} as NotesStore, previewRoot }
    const element = <PublicCommentPanel {...props} />
    const view = render(strict ? <StrictMode>{element}</StrictMode> : element)
    return { ...view, props }
}
async function compose() {
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'My public reply' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Comment' })).toBeEnabled())
}
/** The rendered note, with `text` selected in it the way a reader selects a passage. */
function preview(text: string) {
    const root = document.createElement('article'); root.dataset.testPreview = ''; root.textContent = text; document.body.append(root)
    return root
}
function select(root: HTMLElement, passage: string) {
    const node = root.firstChild!, start = node.textContent!.indexOf(passage), range = document.createRange()
    range.setStart(node, start); range.setEnd(node, start + passage.length)
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
    fireEvent.mouseUp(root)
}
/** The wallet returned a transaction hash for the review being signed: sent, not yet confirmed. */
const broadcast = (call = 0) => act(async () => { await mocks.sign.mock.calls[call][0].send(undefined, async () => {}) })
const digest = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value)))
async function post() {
    fireEvent.click(screen.getByRole('button', { name: 'Comment' })); await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
    vi.clearAllMocks(); mocks.next = 0; mocks.version = 0; sessionStorage.clear(); document.querySelectorAll('article[data-test-preview]').forEach(node => node.remove())
    mocks.read.mockResolvedValue({ items: [row()], nextCursor: '' }); mocks.list.mockResolvedValue([]); mocks.recover.mockResolvedValue('unknown')
    mocks.prepare.mockResolvedValue({ onDismissed: mocks.dismiss, onSettled: mocks.settle, send: mocks.send }); mocks.sign.mockReturnValue(true); mocks.send.mockResolvedValue({ hash: 'aa'.repeat(32) })
})
describe('public-only comment controls', () => {
    it('can prepare a fresh comment review after StrictMode effect replay', async () => {
        setup('owner', note, true); await compose()
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
        await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        expect(mocks.prepare.mock.calls[0][0].session.capture().signal.aborted).toBe(false)
        expect(mocks.prepare.mock.calls[0][0].operation.caller).toBe('owner')
    })
    it('asks before the Notes window closes while a comment is unsent', async () => {
        setup('owner'); await compose()
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
        expect(mayCloseWindow('app:notes')).toBe(false); expect(confirm).toHaveBeenCalledOnce()
        fireEvent.change(screen.getByLabelText('Comment'), { target: { value: '' } })
        expect(mayCloseWindow('app:notes')).toBe(true); confirm.mockRestore()
    })
    it('lets a guest read without touching receipts or preparing a signature', async () => {
        setup(null); expect(await screen.findByText('Public comment')).toBeVisible()
        expect(screen.getByText('Connect your wallet to comment.')).toBeVisible()
        expect(screen.queryByLabelText('Comment')).toBeNull(); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled()
    })
    it('lets a connected nonowner comment in PublicOpen with a distinct ID, a reply, a quote selected in the note and the quoted cap', async () => {
        const root = preview('Intro. Quoted passage here.')
        setup('member', { ...note, body: text('Intro. Quoted passage here.') }, false, root); fireEvent.click(await screen.findByRole('button', { name: 'Reply' })); await compose()
        select(root, 'Quoted passage')
        expect(screen.getByText('Quoted passage', { selector: 'blockquote' })).toBeVisible()
        expect(screen.getByText('≈ 2.26 GNOT')).toBeVisible(); expect(screen.getByText('At most 2.8 GNOT').tagName).toBe('SMALL')
        // F16: the composer says the deposit is not returned, on its own line apart from the cap.
        expect(screen.getByText('Storage deposit, not returned').tagName).toBe('SMALL')
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
        await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        const input = mocks.prepare.mock.calls[0][0]
        expect(input.maxDepositUgnot).toBe('2800000'); expect(input.operation.commentId).not.toBe(input.operation.operationId)
        expect(input.operation).toMatchObject({ caller: 'member', noteId, action: { kind: 'add', parent: cid, bodyRevision: '1', epoch: '0', body: 'My public reply', anchor: 'Quoted passage' } })
        expect(screen.queryByRole('button', { name: /^More actions for the comment by / })).toBeNull()
    })
    it.each([[false, 'Resolve thread', 'resolve', true], [true, 'Reopen thread', 'resolve', false], [false, 'Hide comment', 'hide', true], [true, 'Unhide comment', 'hide', false]] as const)('binds moderation target %s / %s', async (initial, button, kind, target) => {
        mocks.read.mockResolvedValue({ items: [row({ resolved: initial, hidden: initial })], nextCursor: '' }); setup()
        fireEvent.click(await screen.findByRole('button', { name: /^More actions for the comment by / })); fireEvent.click(screen.getByRole('menuitem', { name: button }))
        await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
        expect(mocks.prepare.mock.calls[0][0].operation.action).toEqual({ kind, revision: '1', [kind === 'resolve' ? 'resolved' : 'hidden']: target })
    })
    it('keeps the card menu, with disabled items, while an action is prepared, so the focus stays on it', async () => {
        const held = deferred<unknown>(); mocks.prepare.mockReturnValueOnce(held.promise); setup()
        const more = await screen.findByRole('button', { name: /^More actions for the comment by / })
        fireEvent.click(more); fireEvent.click(screen.getByRole('menuitem', { name: 'Resolve thread' }))
        await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
        expect(more).toBeInTheDocument(); expect(more).toHaveFocus()
        fireEvent.click(more)
        for (const item of screen.getAllByRole('menuitem')) expect(item).toHaveAttribute('aria-disabled', 'true')
        fireEvent.click(screen.getByRole('menuitem', { name: 'Hide comment' }))
        expect(screen.getByRole('menu')).toBeVisible(); expect(mocks.prepare).toHaveBeenCalledOnce()
        await act(async () => { held.resolve({ onDismissed: mocks.dismiss, onSettled: mocks.settle, send: mocks.send }) })
        await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Hide comment' })).not.toHaveAttribute('aria-disabled'))
    })
    it('allows author deletion while retaining a tombstone and forbids posting outside PublicOpen', async () => {
        setup('owner', { ...note, deleted: true }); fireEvent.click(await screen.findByRole('button', { name: /^More actions for the comment by / }))
        expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Delete comment']); fireEvent.click(screen.getByRole('menuitem', { name: 'Delete comment' }))
        await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
        expect(mocks.prepare.mock.calls[0][0].operation.action).toEqual({ kind: 'delete', revision: '1' })
        expect(screen.queryByLabelText('Comment')).toBeNull(); expect(screen.queryByRole('button', { name: 'Hide comment' })).toBeNull()
    })
    it('keeps restricted notes read-only for new comments and masks encrypted historical actions', async () => {
        mocks.read.mockResolvedValue({ items: [row({ encrypted: true, body: '' })], nextCursor: '' }); setup('owner', { ...note, mode: 3 })
        expect(await screen.findByText('Encrypted comment')).toBeVisible()
        expect(screen.queryByLabelText('Comment')).toBeNull()
        expect(screen.queryByRole('button', { name: /^More actions for the comment by / })).toBeNull()
        expect(mocks.prepare).not.toHaveBeenCalled()
    })
    it('keeps unknown receipts and composer text, checks explicitly, and never resends', async () => {
        mocks.list.mockResolvedValue([pending]); setup()
        fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Keep this thought' } })
        fireEvent.click(await screen.findByRole('button', { name: 'Check comment outcome' }))
        expect(await screen.findByText('The outcome remains unknown. Nothing was resent.')).toBeVisible()
        expect(screen.getByLabelText('Comment')).toHaveValue('Keep this thought'); expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled()
        expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled()
    })
    it('retains unsupported private receipts without routing them to a public recovery function', async () => {
        mocks.list.mockResolvedValue([{ ...pending, verification: { kind: 'private-comment-v1' } }]); setup()
        expect(await screen.findByText(/This saved operation is not supported/)).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Check comment outcome' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled(); expect(mocks.recover).not.toHaveBeenCalled()
    })
    it('rechecks durable receipts before posting and fails closed if storage cannot be read', async () => {
        mocks.list.mockResolvedValueOnce([]).mockResolvedValue([pending]); const view = setup(); await compose()
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
        expect(await screen.findByText('Check the unresolved comment receipt before posting again.')).toBeVisible()
        expect(mocks.prepare).not.toHaveBeenCalled(); view.unmount(); mocks.list.mockRejectedValue(new Error('sensitive storage diagnostic')); setup()
        expect(await screen.findByText(/Saved comment receipts could not be read/)).toBeVisible()
        expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled(); expect(screen.queryByText('sensitive storage diagnostic')).toBeNull()
    })
    it.each(['account', 'network', 'note', 'unmount'])('invalidates a delayed review on %s change before it reaches the signer', async change => {
        const delayed = deferred<object>(); mocks.prepare.mockReturnValueOnce(delayed.promise)
        const view = setup(); await compose(); fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
        await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
        const guard = mocks.prepare.mock.calls[0][0].session.capture()
        if (change === 'unmount') view.unmount()
        else view.rerender(<PublicCommentPanel {...view.props} {...(change === 'account' ? { owner: 'other' } : change === 'network' ? { client: { chainId: 'other' } as NotesReadClient } : { note: { ...note, id: 'ff'.repeat(16) } })} />)
        expect(guard.signal.aborted).toBe(true)
        await act(async () => delayed.resolve({ onDismissed: mocks.dismiss }))
        expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.dismiss).toHaveBeenCalledOnce()
    })
    it('keeps a draft across a community edit while invalidating the previous review', async () => {
        const delayed = deferred<object>(); mocks.prepare.mockReturnValueOnce(delayed.promise)
        const root = preview('An Original passage here.')
        const view = setup('member', note, false, root); await compose()
        select(root, 'Original passage')
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
        await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
        const oldGuard = mocks.prepare.mock.calls[0][0].session.capture()
        view.rerender(<PublicCommentPanel {...view.props} note={{ ...note, stateRevision: '2', bodyRevision: '2' }} />)
        expect(oldGuard.signal.aborted).toBe(true)
        expect(screen.getByLabelText('Comment')).toHaveValue('My public reply')
        expect(screen.getByText('Original passage', { selector: 'blockquote' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled()
        await act(async () => delayed.resolve({ onDismissed: mocks.dismiss }))
        expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.dismiss).toHaveBeenCalledOnce()
        fireEvent.click(screen.getByRole('button', { name: 'Keep original quote' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Comment' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
        await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        expect(mocks.prepare.mock.calls[1][0].operation.action).toMatchObject({ bodyRevision: '1', anchor: 'Original passage', body: 'My public reply' })
        view.rerender(<PublicCommentPanel {...view.props} note={{ ...note, stateRevision: '3', bodyRevision: '3' }} />)
        expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Clear quote' }))
        expect(screen.queryByText('Original passage', { selector: 'blockquote' })).toBeNull()
        expect(screen.getByLabelText('Comment')).toHaveValue('My public reply')
    })
    it('keeps unanchored text and reply identity through refresh without moving a quote', async () => {
        const view = setup('member'); fireEvent.click(await screen.findByRole('button', { name: 'Reply' })); await compose()
        view.rerender(<PublicCommentPanel {...view.props} note={{ ...note, stateRevision: '2', bodyRevision: '2' }} />)
        expect(screen.getByLabelText('Comment')).toHaveValue('My public reply')
        await waitFor(() => expect(screen.getByRole('button', { name: 'Comment' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
        await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
        expect(mocks.prepare.mock.calls[0][0].operation.action).toMatchObject({ bodyRevision: '2', parent: cid, anchor: '' })
    })
    it.each(['account', 'network', 'note'])('never shows a draft across the %s boundary, and gives it back on return', async change => {
        const view = setup(); await compose()
        const patch = change === 'account' ? { owner: 'other' } : change === 'network' ? { client: { chainId: 'other-chain', note: vi.fn() } as unknown as NotesReadClient } : { note: { ...note, id: 'ff'.repeat(16) } }
        view.rerender(<PublicCommentPanel {...view.props} {...patch} />)
        expect(screen.getByLabelText('Comment')).toHaveValue('')
        view.rerender(<PublicCommentPanel {...view.props} />)
        expect(screen.getByLabelText('Comment')).toHaveValue('My public reply')
    })
    it('keeps an unsent comment through a lock or reload in this tab only, and forgets it once posted', async () => {
        const view = setup(); await compose(); view.unmount()
        expect(localStorage.length).toBe(0)
        setup(); expect(screen.getByLabelText('Comment')).toHaveValue('My public reply')
        await waitFor(() => expect(screen.getByRole('button', { name: 'Comment' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Comment' })); await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        act(() => mocks.sign.mock.calls[0][0].onSettled('confirmed', undefined))
        expect(screen.getByLabelText('Comment')).toHaveValue(''); expect(sessionStorage.length).toBe(0)
    })
    it('says "Comment posted." for a few seconds only, in a polite status (F15/F24)', async () => {
        setup(); await compose(); await post()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            act(() => mocks.sign.mock.calls[0][0].onSettled('confirmed', undefined))
            expect(screen.getByText('Comment posted.')).toHaveAttribute('role', 'status')
            await act(async () => { await vi.advanceTimersByTimeAsync(5_999) })
            expect(screen.getByText('Comment posted.')).toBeVisible()
            await act(async () => { await vi.advanceTimersByTimeAsync(1) })
            expect(screen.queryByText('Comment posted.')).toBeNull()
        } finally { vi.useRealTimers() }
    })
    it('keeps a message that asks for a step: an unknown outcome stays', async () => {
        setup(); await compose(); await post()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            act(() => mocks.sign.mock.calls[0][0].onSettled('unknown', undefined))
            await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
            expect(screen.getByText(/Outcome unknown\. Check the retained receipt/)).toBeVisible()
        } finally { vi.useRealTimers() }
    })
    it.each(['note refresh', 'window close'])('forgets a posted comment even when a %s happened while it was being signed', async change => {
        const view = setup(); await compose()
        fireEvent.click(screen.getByRole('button', { name: 'Comment' })); await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        if (change === 'note refresh') view.rerender(<PublicCommentPanel {...view.props} note={{ ...note, stateRevision: '2' }} />)
        else view.unmount()
        act(() => mocks.sign.mock.calls[0][0].onSettled('confirmed', undefined))
        expect(sessionStorage.length).toBe(0)
        if (change === 'note refresh') expect(screen.getByLabelText('Comment')).toHaveValue('')
        else { setup(); expect(screen.getByLabelText('Comment')).toHaveValue('') }
    })
    it('never replaces an existing quote on a new selection without an explicit choice', async () => {
        const root = preview('First passage. Second passage.')
        setup('member', note, false, root); await compose()
        select(root, 'First passage')
        expect(screen.getByText('First passage', { selector: 'blockquote' })).toBeVisible()
        select(root, 'Second passage')
        expect(screen.getByText('First passage', { selector: 'blockquote' })).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Keep current quote' }))
        expect(screen.queryByRole('button', { name: 'Replace quote' })).toBeNull()
        select(root, 'Second passage')
        fireEvent.click(screen.getByRole('button', { name: 'Replace quote' }))
        expect(screen.getByText('Second passage', { selector: 'blockquote' })).toBeVisible()
    })
    it('signs once in the wallet sheet, with no confirmation boxes in the composer', async () => {
        setup(); await compose()
        expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByLabelText(/deposit/i)).toBeNull()
    })
    it('keeps newer composer edits after confirmation', async () => {
        setup(); await compose()
        fireEvent.click(screen.getByRole('button', { name: 'Comment' })); await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Newer unsent edit' } })
        act(() => mocks.sign.mock.calls[0][0].onSettled('confirmed', undefined))
        expect(screen.getByLabelText('Comment')).toHaveValue('Newer unsent edit')
    })
})

describe('a sent comment is never offered again', () => {
    it('leaves every composer for the note once broadcast, and stays gone after confirmation', async () => {
        const first = setup(); await compose()
        // A second composer for the same note in this tab (another window, or a remount) restored the text.
        const second = setup(), a = within(first.container), b = within(second.container)
        expect(b.getByLabelText('Comment')).toHaveValue('My public reply')
        fireEvent.click(a.getByRole('button', { name: 'Comment' })); await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        await broadcast()
        expect(a.getByLabelText('Comment')).toHaveValue(''); expect(b.getByLabelText('Comment')).toHaveValue('')
        act(() => mocks.sign.mock.calls[0][0].onSettled('confirmed', undefined))
        expect(a.getByLabelText('Comment')).toHaveValue(''); expect(b.getByLabelText('Comment')).toHaveValue(''); expect(sessionStorage.length).toBe(0)
    })
    it('is not restored by a composer reopened between broadcast and confirmation', async () => {
        const view = setup(); await compose(); await post(); await broadcast(); view.unmount()
        setup(); expect(screen.getByLabelText('Comment')).toHaveValue('')
        act(() => mocks.sign.mock.calls[0][0].onSettled('confirmed', undefined))
        expect(screen.getByLabelText('Comment')).toHaveValue(''); expect(sessionStorage.length).toBe(0)
    })
    it.each(['submitted', 'failed', 'unknown'] as const)('comes back behind its receipt when the sent comment ends %s', async outcome => {
        const view = setup(); await compose(); await post(); await broadcast(); view.unmount()
        setup(); expect(screen.getByLabelText('Comment')).toHaveValue('')
        mocks.list.mockResolvedValue([pending])
        act(() => mocks.sign.mock.calls[0][0].onSettled(outcome, undefined))
        expect(screen.getByLabelText('Comment')).toHaveValue('My public reply')
        expect(await screen.findByRole('button', { name: 'Check comment outcome' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled()
    })
    it('keeps the text when nothing was sent', async () => {
        setup(); await compose(); await post()
        act(() => mocks.sign.mock.calls[0][0].onSettled('cancelled', undefined))
        expect(screen.getByLabelText('Comment')).toHaveValue('My public reply')
    })
    it('keeps a newer edit when the sent comment comes back, with the returned text above it', async () => {
        setup(); await compose(); await post(); await broadcast()
        fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Newer unsent edit' } })
        act(() => mocks.sign.mock.calls[0][0].onSettled('submitted', undefined))
        expect(screen.getByLabelText('Comment')).toHaveValue('My public reply\n\nNewer unsent edit')
        expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).body).toBe('My public reply\n\nNewer unsent edit')
    })
    it('never replaces a quote selected while the comment was out', async () => {
        const root = preview('Intro. First passage. Second passage.')
        setup('member', { ...note, body: text('Intro. First passage. Second passage.') }, false, root); await compose()
        select(root, 'First passage'); await post(); await broadcast()
        expect(screen.queryByText('First passage', { selector: 'blockquote' })).toBeNull()
        select(root, 'Second passage')
        act(() => mocks.sign.mock.calls[0][0].onSettled('submitted', undefined))
        expect(screen.getByLabelText('Comment')).toHaveValue('My public reply')
        expect(screen.getByText('Second passage', { selector: 'blockquote' })).toBeVisible()
    })
    it('ignores a wallet hash that arrives after the outcome was already given', async () => {
        const late = deferred<{ hash: string }>(); mocks.send.mockReturnValueOnce(late.promise)
        const view = setup(); await compose(); await post()
        let sending!: Promise<unknown>
        act(() => { sending = mocks.sign.mock.calls[0][0].send(undefined, async () => {}) })
        act(() => mocks.sign.mock.calls[0][0].onSettled('unknown', undefined))
        await act(async () => { late.resolve({ hash: 'bb'.repeat(32) }); await sending })
        expect(screen.getByLabelText('Comment')).toHaveValue('My public reply')
        view.unmount(); setup(); expect(screen.getByLabelText('Comment')).toHaveValue('My public reply')
    })
    it('keeps the text when sending fails after the wallet returned a hash', async () => {
        mocks.send.mockRejectedValueOnce(new Error('receipt storage refused'))
        setup(); await compose(); await post()
        await act(async () => { await expect(mocks.sign.mock.calls[0][0].send(undefined, async () => {})).rejects.toThrow() })
        mocks.list.mockResolvedValue([pending])
        act(() => mocks.sign.mock.calls[0][0].onSettled('unknown', undefined))
        expect(screen.getByLabelText('Comment')).toHaveValue('My public reply')
    })
    it('forgets held text on an explicit disconnect', async () => {
        setup(); await compose(); await post(); await broadcast()
        clearCommentDrafts()
        act(() => mocks.sign.mock.calls[0][0].onSettled('submitted', undefined))
        expect(screen.getByLabelText('Comment')).toHaveValue(''); expect(sessionStorage.length).toBe(0)
    })
    it('clears the posted text from another composer when Check is used in one holding different text', async () => {
        const first = setup(); await compose(); await post(); await broadcast()
        const second = setup(), a = within(first.container), b = within(second.container)
        fireEvent.change(a.getByLabelText('Comment'), { target: { value: 'A newer edit' } })
        const receipt = { ...pending, action: 'addComment', verification: { kind: 'comment-v1', bodySha256: digest('My public reply'), anchorSha256: digest('') } }
        mocks.list.mockResolvedValue([receipt]); mocks.recover.mockResolvedValue('confirmed')
        act(() => mocks.sign.mock.calls[0][0].onSettled('submitted', undefined))
        expect(b.getByLabelText('Comment')).toHaveValue('My public reply')
        fireEvent.change(a.getByLabelText('Comment'), { target: { value: 'Only my newer edit' } })
        mocks.list.mockResolvedValueOnce([receipt]).mockResolvedValue([])
        fireEvent.click(await a.findByRole('button', { name: 'Check comment outcome' }))
        await waitFor(() => expect(b.getByLabelText('Comment')).toHaveValue(''))
        expect(a.getByLabelText('Comment')).toHaveValue('Only my newer edit')
    })
    it('forgets composer text that a checked receipt shows was posted, and keeps other text', async () => {
        const receipt = { ...pending, action: 'addComment', verification: { kind: 'comment-v1', bodySha256: digest('Keep this thought'), anchorSha256: digest('') } }
        mocks.list.mockResolvedValueOnce([receipt]).mockResolvedValue([]); mocks.recover.mockResolvedValue('confirmed')
        const view = setup(); fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Keep this thought' } })
        fireEvent.click(await screen.findByRole('button', { name: 'Check comment outcome' }))
        await waitFor(() => expect(screen.getByLabelText('Comment')).toHaveValue('')); expect(sessionStorage.length).toBe(0)
        view.unmount(); mocks.list.mockResolvedValueOnce([receipt]).mockResolvedValue([]); setup()
        fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'A different thought' } })
        fireEvent.click(await screen.findByRole('button', { name: 'Check comment outcome' }))
        expect(await screen.findByText(/text in your composer was kept/)).toBeVisible()
        expect(screen.getByLabelText('Comment')).toHaveValue('A different thought')
    })
})

describe('comment freshness', () => {
    it('reloads comments after a confirmed change without blanking the list', async () => {
        setup('member'); await screen.findByText('Public comment')
        const later = deferred<{ items: PublicComment[]; nextCursor: string }>(); mocks.read.mockReturnValueOnce(later.promise)
        act(() => announceNoteChange({ chainId: 'test-chain', noteId }))
        await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2))
        expect(screen.getByText('Public comment')).toBeVisible(); expect(screen.queryByText('Loading comments…')).toBeNull()
        await act(async () => later.resolve({ items: [row(), row({ id: 'ee'.repeat(16), body: 'Another comment' })], nextCursor: '' }))
        expect(screen.getByText('Another comment')).toBeVisible()
    })
    it('anchors a still-present quote to the current body revision after the note changes', async () => {
        const root = preview('Intro. Quoted passage here.')
        const view = setup('member', { ...note, body: text('Intro. Quoted passage here.') }, false, root); await compose()
        select(root, 'Quoted passage')
        view.rerender(<PublicCommentPanel {...view.props} note={{ ...note, stateRevision: '2', bodyRevision: '2', body: text('Edited intro. Quoted passage here.') }} />)
        expect(screen.queryByRole('button', { name: 'Keep original quote' })).toBeNull(); expect(screen.getByText(/Quote from the current text/)).toBeVisible()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Comment' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
        await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
        expect(mocks.prepare.mock.calls[0][0].operation.action).toMatchObject({ bodyRevision: '2', anchor: 'Quoted passage' })
    })
    it('words the composer with the note revision, never the body counter (F20)', async () => {
        const root = preview('Intro. Quoted passage here.')
        setup('member', { ...note, stateRevision: '4', bodyRevision: '2', body: text('Intro. Quoted passage here.') }, false, root); await compose()
        expect(screen.getByText(/Comment on the current text \(revision 4\)/)).toBeVisible()
        select(root, 'Quoted passage')
        expect(screen.getByText(/Quote from the current text/)).toBeVisible()
        expect(screen.queryByText(/revision 2/)).toBeNull()
    })
    it('never anchors a comment to a body revision older than the chain, keeping the composer', async () => {
        const view = setup('member'); vi.mocked(view.props.client.note).mockResolvedValue({ ...note, stateRevision: '3', bodyRevision: '3' })
        await compose(); fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
        expect(await screen.findByText(/note was updated to revision 3\./)).toBeVisible()
        expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled()
        expect(screen.getByLabelText('Comment')).toHaveValue('My public reply')
    })
    it('posts on the current text when only the title or a setting moved on chain: the body revision decides', async () => {
        const view = setup('member'); vi.mocked(view.props.client.note).mockResolvedValue({ ...note, stateRevision: '3', bodyRevision: '1' })
        await compose(); fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
        await waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
        expect(mocks.prepare.mock.calls[0][0].operation.action).toMatchObject({ kind: 'add', bodyRevision: '1', body: 'My public reply' })
        expect(screen.queryByText(/note was updated/)).toBeNull()
    })
})
