import { StrictMode, useLayoutEffect } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDraftSession, type DraftRecord, type NotesStore } from '../../../lib/notes/drafts'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { PublicPublish } from './PublicPublish'
import { NotesPaneContext, type NotesPane } from './notesPane'
import { useNoteFreshness } from '../../../lib/notes/freshness'
const calls = vi.hoisted(() => ({ prepare: vi.fn(), sign: vi.fn(), budget: vi.fn() }))
vi.mock('../../sign/signerContext', () => ({ useSigner: () => ({ sign: calls.sign }) }))
vi.mock('../../../lib/notes/chain/request', () => ({ preparePublicNoteRequest: calls.prepare }))
vi.mock('../../../lib/notes/config', () => ({ notesDeployment: () => ({ realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 }), newNoteId: () => crypto.randomUUID().replaceAll('-', '') }))
const owner = 'g1jw76lxvzjafw2kyjhdnzwggcftyhnlfjaer2u0'
const bytes = (value: string) => new TextEncoder().encode(value)
const base = { stateRevision: '7', epoch: '2', ownerGeneration: '1', titleRevision: '5', bodyRevision: '6' }
const draft: DraftRecord = { schema: 1, scope: { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner, noteId: 'cd'.repeat(16) }, localRevision: '4', updatedAt: 1, payload: { kind: 'public', title: 'Field guide', body: 'Saved content' } }
const config = { realm: draft.scope.realm, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '100000', paused: false }
function setup(record = draft, getDraft = vi.fn(async () => record)) {
    const client = { chainId: 'gnoland-1', note: vi.fn(async () => ({ owner, stateRevision: '7', epoch: '2', ownerGeneration: '1', title: bytes('Field guide'), body: bytes('Published content') })), config: vi.fn(async () => config), assertCurrent() {} } as unknown as NotesReadClient
    render(<PublicPublish draft={record} client={client} store={{ getDraft } as unknown as NotesStore} />)
    fireEvent.click(screen.getByText(record.payload.kind === 'public' && record.payload.base ? 'Publish changes' : 'Publish', { selector: 'summary' }))
    return { client, getDraft }
}
beforeEach(() => { vi.clearAllMocks(); calls.prepare.mockResolvedValue({ warns: [] }); calls.sign.mockReturnValue(true) })
describe('public publication review', () => {
    it('keeps its note pane mounted while the publication is verified, then releases it', async () => {
        const hold = vi.fn(), pane = { hold, saved: vi.fn(), deleted: vi.fn(), focusTitle: false, titleFocused: vi.fn() } satisfies NotesPane
        const settled = vi.fn(); calls.prepare.mockResolvedValue({ warns: [], onSettled: settled })
        const client = { chainId: 'gnoland-1', note: vi.fn(async () => null), config: vi.fn(async () => config), assertCurrent() {} } as unknown as NotesReadClient
        const fresh: DraftRecord = { ...draft, payload: { kind: 'public', title: 'Field guide', body: 'Saved content' } }
        render(<NotesPaneContext.Provider value={pane}><PublicPublish draft={fresh} client={client} store={{ getDraft: vi.fn(async () => fresh) } as unknown as NotesStore} /></NotesPaneContext.Provider>)
        fireEvent.click(screen.getByText('Publish', { selector: 'summary' })); fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        expect(hold).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^publishing:/), true)
        const source = hold.mock.calls[0][0]
        act(() => calls.sign.mock.calls[0][0].onSettled('confirmed'))
        expect(settled).toHaveBeenCalledWith('confirmed', undefined); expect(hold).toHaveBeenLastCalledWith(source, false)
    })
    it('requests no signature until review and uses the durable baseline and explicit deposit cap', async () => {
        const record: DraftRecord = { ...draft, payload: { kind: 'public', title: 'Field guide', body: 'Saved content', base: { stateRevision: '7', epoch: '2', ownerGeneration: '1', titleRevision: '5', bodyRevision: '6' } } }
        setup(record)
        expect(calls.sign).not.toHaveBeenCalled()
        fireEvent.change(screen.getByLabelText('Maximum storage deposit (GNOT)'), { target: { value: '5.0' } })
        fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        expect(calls.prepare.mock.calls[0][0]).toMatchObject({ maxDepositUgnot: '5000000', draftLocalRevision: '4', operation: { action: { kind: 'commit', revision: '7', epoch: '2', body: 'Saved content' } } })
    })
    it('publishes only the changed body, priced without the unchanged title', async () => {
        setup({ ...draft, payload: { kind: 'public', title: 'Field guide ', body: 'Saved content', base } })
        fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        const { operation, maxDepositUgnot } = calls.prepare.mock.calls[0][0]
        expect(operation.action).toEqual({ kind: 'commit', revision: '7', epoch: '2', body: 'Saved content' })
        expect(maxDepositUgnot).toBe('2900000')
    })
    it('says there is nothing to publish when the draft matches the published note', async () => {
        const { client } = setup({ ...draft, payload: { kind: 'public', title: 'Field guide', body: 'Published content', base } })
        fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
        expect(await screen.findByText('Nothing to publish: the title and body match the published note.')).toBeVisible()
        expect(client.note).toHaveBeenCalledOnce(); expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.sign).not.toHaveBeenCalled()
    })
    it.each([
        ['Recipes/sushi', 'Titles cannot contain “/”.'],
        ['   ', 'Add a title before publishing.'],
        ['a'.repeat(81), 'The title is too long: use at most 80 characters.'],
    ])('explains the refused title %j before any network or wallet step', async (title, message) => {
        const { client } = setup({ ...draft, payload: { kind: 'public', title, body: 'Saved content' } })
        fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
        expect(await screen.findByText(message)).toBeVisible()
        expect(screen.getByRole('button', { name: 'Review publication' })).toBeEnabled()
        expect(client.config).not.toHaveBeenCalled(); expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.sign).not.toHaveBeenCalled()
    })
    it('trims edge spaces from a new title instead of letting the realm refuse it', async () => {
        setup({ ...draft, payload: { kind: 'public', title: '  Field guide\u00a0', body: 'Saved content' } })
        fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        expect(calls.prepare.mock.calls[0][0].operation.action).toMatchObject({ kind: 'create', title: 'Field guide' })
    })
    it('retains a changed local draft instead of opening a stale review', async () => {
        setup(draft, vi.fn(async () => ({ ...draft, localRevision: '5' })))
        fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
        await screen.findByText(/your draft changed, while the review was prepared/)
        expect(calls.sign).not.toHaveBeenCalled(); expect(calls.prepare).not.toHaveBeenCalled()
    })
    it.each(['0.000001', '2.4'])('rejects the inadequate %s GNOT cap without opening a wallet', async cap => {
        setup()
        fireEvent.change(screen.getByLabelText('Maximum storage deposit (GNOT)'), { target: { value: cap } })
        fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
        await screen.findByText(/deposit cap of at least/)
        expect(calls.sign).not.toHaveBeenCalled()
    })
})

function publicationProps() {
    return { draft, client: { chainId: 'gnoland-1', assertCurrent() {}, config: vi.fn(async () => config) } as unknown as NotesReadClient,
        store: { getDraft: vi.fn(async () => draft) } as unknown as NotesStore }
}
function openReview() {
    fireEvent.click(screen.getByText('Publish', { selector: 'summary' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
}
describe('public publication view lifetime', () => {
    it.each(['draft', 'client', 'store'] as const)('dismisses a late prepared request when %s changes', async field => {
        let resolve!: (value: object) => void
        calls.prepare.mockImplementationOnce(() => new Promise(done => { resolve = done }))
        const props = publicationProps(), view = render(<PublicPublish {...props} />)
        openReview(); await waitFor(() => expect(calls.prepare).toHaveBeenCalledOnce())
        const signal = calls.prepare.mock.calls[0][0].session.capture().signal as AbortSignal
        const patch = field === 'draft' ? { draft: { ...draft, scope: { ...draft.scope, noteId: 'ef'.repeat(16) } } }
            : field === 'client' ? { client: { ...props.client } } : { store: { ...props.store } }
        view.rerender(<PublicPublish {...props} {...patch} />)
        expect(signal.aborted).toBe(true)
        const dismiss = vi.fn(); await act(async () => resolve({ onDismissed: dismiss }))
        expect(calls.sign).not.toHaveBeenCalled(); expect(dismiss).toHaveBeenCalledOnce()
    })
    it('aborts the old operation before a replacement layout effect runs', async () => {
        const props = publicationProps(), probes: boolean[] = []
        function Probe() { useLayoutEffect(() => { probes.push(signal.aborted) }, []); return null }
        const view = render(<PublicPublish {...props} />); openReview()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        const signal = calls.prepare.mock.calls[0][0].session.capture().signal
        view.rerender(<Probe />)
        expect(probes).toEqual([true])
    })
    it('does not continue from a stale config read and still works under StrictMode', async () => {
        let resolve!: (value: typeof config) => void
        const props = publicationProps()
        vi.mocked(props.client.config).mockImplementationOnce(() => new Promise(done => { resolve = done }))
        const view = render(<PublicPublish {...props} />); openReview()
        view.rerender(<PublicPublish {...props} client={{ ...props.client }} />)
        await act(async () => resolve(config))
        expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.sign).not.toHaveBeenCalled()
        view.unmount()
        render(<StrictMode><PublicPublish {...publicationProps()} /></StrictMode>); openReview()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
    })
    it('dismisses a request refused by the signature sheet and says so', async () => {
        const dismiss = vi.fn(); calls.prepare.mockResolvedValue({ onDismissed: dismiss }); calls.sign.mockReturnValue(false)
        render(<PublicPublish {...publicationProps()} />); openReview()
        await waitFor(() => expect(dismiss).toHaveBeenCalledOnce())
        expect(screen.getByText(/signature window could not open/)).toBeVisible()
    })
    it('lets the editor update a stale draft before any review is prepared', async () => {
        const beforeReview = vi.fn(async () => false)
        render(<PublicPublish {...publicationProps()} beforeReview={beforeReview} />); openReview()
        await waitFor(() => expect(beforeReview).toHaveBeenCalledOnce())
        await waitFor(() => expect(screen.getByRole('button', { name: 'Review publication' })).toBeEnabled())
        expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.sign).not.toHaveBeenCalled()
    })
    it('never stays on Preparing review when a step does not answer', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            const props = publicationProps(); vi.mocked(props.client.config).mockReturnValue(new Promise(() => {}))
            render(<PublicPublish {...props} />); openReview()
            expect(screen.getByRole('button', { name: 'Preparing review…' })).toBeDisabled()
            await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
            expect(screen.getByText(/network did not answer in time/)).toBeVisible()
            expect(screen.getByRole('button', { name: 'Review publication' })).toBeEnabled(); expect(calls.sign).not.toHaveBeenCalled()
        } finally { vi.useRealTimers() }
    })
})

describe('publication baseline and receipt boundaries', () => {
    it('retains the durable draft on an unknown settlement', async () => {
        const props = publicationProps(), saveDraft = vi.fn(), onPublished = vi.fn()
        render(<PublicPublish {...props} onPublished={onPublished} store={{ ...props.store, saveDraft } as unknown as NotesStore} />); openReview()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        await act(async () => calls.sign.mock.calls[0][0].onSettled('unknown'))
        expect(saveDraft).not.toHaveBeenCalled(); expect(onPublished).not.toHaveBeenCalled()
        expect(await screen.findByText(/outcome is unknown/)).toBeVisible()
    })
    it('keeps a signed publication confirmable after the panel unmounts when the workspace owns the request', async () => {
        const props = publicationProps(), onPublished = vi.fn(), requestSession = createDraftSession()
        const view = render(<PublicPublish {...props} requestSession={requestSession} onPublished={onPublished} />); openReview()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        const input = calls.prepare.mock.calls[0][0]; expect(input.session).toBe(requestSession)
        view.unmount()
        expect(input.session.capture().signal.aborted).toBe(false)
        const confirmed = { id: draft.scope.noteId, stateRevision: '8' }
        await act(async () => { input.onConfirmed(confirmed); calls.sign.mock.calls[0][0].onSettled('confirmed') })
        expect(onPublished).toHaveBeenCalledExactlyOnceWith(confirmed)
    })
    it('hands the confirmed revision to the editor and refreshes every view of the note', async () => {
        const props = publicationProps(), onPublished = vi.fn(), announced = vi.fn()
        function Listener() { useNoteFreshness('gnoland-1', draft.scope.noteId, announced); return null }
        render(<><Listener /><PublicPublish {...props} onPublished={onPublished} /></>); openReview()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        const confirmed = { id: draft.scope.noteId, stateRevision: '8' }
        await act(async () => { calls.prepare.mock.calls[0][0].onConfirmed(confirmed); calls.sign.mock.calls[0][0].onSettled('confirmed') })
        expect(onPublished).toHaveBeenCalledExactlyOnceWith(confirmed); expect(announced).toHaveBeenCalledWith({ stateRevision: '8' })
        expect(screen.getByText('Published as revision 8.')).toBeVisible()
    })
    it('rejects a mismatched network or realm without asking for a signature', async () => {
        const props = publicationProps()
        render(<PublicPublish {...props} draft={{ ...draft, scope: { ...draft.scope, chainId: 'other-chain' } }} />); openReview()
        await screen.findByText(/belongs to another network/); expect(calls.sign).not.toHaveBeenCalled(); expect(calls.prepare).not.toHaveBeenCalled()
    })
})
