import { StrictMode, useLayoutEffect, useState, type ComponentProps } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDraftSession, type DraftRecord, type NotesStore } from '../../../lib/notes/drafts'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { NotesChainError, type ChainNote } from '../../../lib/notes/chain/schema'
import { PublicDelete, PublicPublish, PublishProgressSheet, type PublishProgress } from './PublicPublish'
import { NoteBanner, type Notice } from './NoteHeader'
import { NotesPaneContext, type NotesPane } from './notesPane'
import { useNoteFreshness } from '../../../lib/notes/freshness'
const calls = vi.hoisted(() => ({ prepare: vi.fn(), sign: vi.fn(), receipts: vi.fn(), balance: vi.fn() }))
vi.mock('../../sign/signerContext', () => ({ useSigner: () => ({ sign: calls.sign }) }))
vi.mock('../../../lib/notes/chain/request', () => ({ preparePublicNoteRequest: calls.prepare }))
vi.mock('../../../lib/notes/intents', () => ({ NotesIntents: class { list = calls.receipts } }))
vi.mock('../../../lib/notes/config', () => ({ notesDeployment: () => ({ realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 }), newNoteId: () => crypto.randomUUID().replaceAll('-', '') }))
// The balance read never reaches a network in tests: unknown by default, which blocks nothing.
vi.mock('../../../lib/dao/packageStatus', () => ({ abciQueryText: calls.balance }))
const owner = 'g1jw76lxvzjafw2kyjhdnzwggcftyhnlfjaer2u0'
const bytes = (value: string) => new TextEncoder().encode(value)
const base = { stateRevision: '7', epoch: '2', ownerGeneration: '1', titleRevision: '5', bodyRevision: '6' }
const draft: DraftRecord = { schema: 1, scope: { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner, noteId: 'cd'.repeat(16) }, localRevision: '4', updatedAt: 1, payload: { kind: 'public', title: 'Field guide', body: 'Saved content' } }
const config = { realm: draft.scope.realm, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '100000', paused: false }
const published = { owner, stateRevision: '7', epoch: '2', ownerGeneration: '1', title: bytes('Field guide'), body: bytes('Published content') } as unknown as ChainNote
/** The page around the control: its banner and progress sheet show what the control reports. */
function Page(props: ComponentProps<typeof PublicPublish>) {
    const [notice, setNotice] = useState<Notice | null>(null), [progress, setProgress] = useState<PublishProgress | null>(null)
    return <><NoteBanner notice={notice} />
        {progress && <PublishProgressSheet progress={progress} onHide={() => setProgress(null)} onView={() => setProgress(null)} />}
        <PublicPublish onNotice={setNotice} onProgress={setProgress} {...props} /></>
}
/** Opens the review; a draft based on a revision is checked by the editor, which here finds it current. */
function setup(record = draft, getDraft = vi.fn(async () => record)) {
    const client = { chainId: 'gnoland-1', note: vi.fn(async () => published), config: vi.fn(async () => config), assertCurrent() {} } as unknown as NotesReadClient
    const beforeReview = vi.fn(() => client.note(record.scope.noteId)), titleProblem = vi.fn()
    render(<Page draft={record} client={client} store={{ getDraft } as unknown as NotesStore} beforeReview={beforeReview} titleProblem={titleProblem} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    return { client, getDraft, beforeReview, titleProblem }
}
const approve = async () => fireEvent.click(await screen.findByRole('button', { name: 'Publish with Adena' }))
beforeEach(() => { vi.clearAllMocks(); calls.prepare.mockResolvedValue({ warns: [] }); calls.sign.mockReturnValue(true); calls.receipts.mockResolvedValue([]); calls.balance.mockRejectedValue(new Error('offline')) })
/** The review sheet, once the latest revision was checked (the checking sheet carries the same name). */
const reviewSheet = async () => (await screen.findByRole('heading', { name: /^Publish/ })).closest('[role="dialog"]') as HTMLElement
describe('public publication review', () => {
    it('keeps its note pane mounted while the publication is verified, then releases it', async () => {
        const hold = vi.fn(), pane = { hold, saved: vi.fn(), deleted: vi.fn(), focusTitle: false, titleFocused: vi.fn() } satisfies NotesPane
        const settled = vi.fn(); calls.prepare.mockResolvedValue({ warns: [], onSettled: settled })
        const client = { chainId: 'gnoland-1', note: vi.fn(async () => null), config: vi.fn(async () => config), assertCurrent() {} } as unknown as NotesReadClient
        const fresh: DraftRecord = { ...draft, payload: { kind: 'public', title: 'Field guide', body: 'Saved content' } }
        render(<NotesPaneContext.Provider value={pane}><Page draft={fresh} client={client} store={{ getDraft: vi.fn(async () => fresh) } as unknown as NotesStore} /></NotesPaneContext.Provider>)
        fireEvent.click(screen.getByRole('button', { name: 'Publish' })); await approve()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        expect(hold).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^publishing:/), true)
        const source = hold.mock.calls[0][0]
        act(() => calls.sign.mock.calls[0][0].onSettled('confirmed'))
        expect(settled).toHaveBeenCalledWith('confirmed', undefined); expect(hold).toHaveBeenLastCalledWith(source, false)
    })
    it('requests no signature until review and uses the durable baseline and the deposit cap it states', async () => {
        setup({ ...draft, payload: { kind: 'public', title: 'Field guide', body: 'Saved content', base } })
        const sheet = await reviewSheet()
        expect(sheet).toHaveTextContent('At most 2.9 GNOT'); expect(sheet).toHaveTextContent('Body: 1 line changed.')
        expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.sign).not.toHaveBeenCalled()
        await approve()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        expect(calls.prepare.mock.calls[0][0]).toMatchObject({ maxDepositUgnot: '2900000', draftLocalRevision: '4', operation: { action: { kind: 'commit', revision: '7', epoch: '2', body: 'Saved content' } } })
    })
    it('publishes only the changed body, priced without the unchanged title', async () => {
        setup({ ...draft, payload: { kind: 'public', title: 'Field guide ', body: 'Saved content', base } })
        expect(await reviewSheet()).toHaveTextContent('Title unchanged, so it is not stored again.')
        await approve()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        const { operation, maxDepositUgnot } = calls.prepare.mock.calls[0][0]
        expect(operation.action).toEqual({ kind: 'commit', revision: '7', epoch: '2', body: 'Saved content' })
        expect(maxDepositUgnot).toBe('2900000')
    })
    it('says there is nothing to publish when the draft matches the published note', async () => {
        const { beforeReview } = setup({ ...draft, payload: { kind: 'public', title: 'Field guide', body: 'Published content', base } })
        expect(await screen.findByText('Nothing to publish: the title and body match the published note.')).toBeVisible()
        expect(beforeReview).toHaveBeenCalledOnce(); expect(screen.queryByRole('dialog')).toBeNull()
        expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.sign).not.toHaveBeenCalled()
    })
    it.each([
        ['Recipes/sushi', 'Titles cannot contain “/”.'],
        ['   ', 'Add a title before publishing.'],
        ['a'.repeat(81), 'The title is too long: use at most 80 characters.'],
    ])('explains the refused title %j before any network or wallet step', async (title, message) => {
        const { client, titleProblem } = setup({ ...draft, payload: { kind: 'public', title, body: 'Saved content' } })
        expect(titleProblem).toHaveBeenCalledExactlyOnceWith(message)
        expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled(); expect(screen.queryByRole('dialog')).toBeNull()
        expect(client.config).not.toHaveBeenCalled(); expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.sign).not.toHaveBeenCalled()
    })
    it('trims edge spaces from a new title instead of letting the realm refuse it', async () => {
        setup({ ...draft, payload: { kind: 'public', title: '  Field guide ', body: 'Saved content' } })
        await approve()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        expect(calls.prepare.mock.calls[0][0].operation.action).toMatchObject({ kind: 'create', title: 'Field guide' })
    })
    it('retains a changed local draft instead of opening a stale review', async () => {
        setup(draft, vi.fn(async () => ({ ...draft, localRevision: '5' })))
        await screen.findByText(/Your draft changed in another window, or the note changed, while the publication was prepared. Nothing was sent./)
        expect(screen.queryByRole('dialog')).toBeNull(); expect(calls.sign).not.toHaveBeenCalled(); expect(calls.prepare).not.toHaveBeenCalled()
    })
    it('writes the cap the review states, never below its estimated deposit, into the transaction', async () => {
        setup()
        const sheet = await reviewSheet()
        // A creation of 23 bytes: ≈ 2.4024 GNOT expected (the old 2.4 GNOT cap would fail it), at most 4.9 GNOT.
        expect(sheet).toHaveTextContent('≈ 2.4024 GNOT storage deposit plus a 0.1 GNOT publication fee'); expect(sheet).toHaveTextContent('At most 4.9 GNOT')
        expect(calls.sign).not.toHaveBeenCalled()
        await approve(); await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        expect(calls.prepare.mock.calls[0][0].maxDepositUgnot).toBe('4900000')
    })
})

function publicationProps() {
    return { draft, client: { chainId: 'gnoland-1', assertCurrent() {}, config: vi.fn(async () => config) } as unknown as NotesReadClient,
        store: { getDraft: vi.fn(async () => draft) } as unknown as NotesStore }
}
async function openReview() {
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await approve()
}
describe('public publication view lifetime', () => {
    it.each(['draft', 'client', 'store'] as const)('dismisses a late prepared request when %s changes', async field => {
        let resolve!: (value: object) => void
        calls.prepare.mockImplementationOnce(() => new Promise(done => { resolve = done }))
        const props = publicationProps(), view = render(<Page {...props} />)
        await openReview(); await waitFor(() => expect(calls.prepare).toHaveBeenCalledOnce())
        const signal = calls.prepare.mock.calls[0][0].session.capture().signal as AbortSignal
        const patch = field === 'draft' ? { draft: { ...draft, scope: { ...draft.scope, noteId: 'ef'.repeat(16) } } }
            : field === 'client' ? { client: { ...props.client } } : { store: { ...props.store } }
        view.rerender(<Page {...props} {...patch} />)
        expect(signal.aborted).toBe(true)
        const dismiss = vi.fn(); await act(async () => resolve({ onDismissed: dismiss }))
        expect(calls.sign).not.toHaveBeenCalled(); expect(dismiss).toHaveBeenCalledOnce()
    })
    it('aborts the old operation before a replacement layout effect runs', async () => {
        const props = publicationProps(), probes: boolean[] = []
        function Probe() { useLayoutEffect(() => { probes.push(signal.aborted) }, []); return null }
        const view = render(<Page {...props} />); await openReview()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        const signal = calls.prepare.mock.calls[0][0].session.capture().signal
        view.rerender(<Probe />)
        expect(probes).toEqual([true])
    })
    it('does not continue from a stale config read and still works under StrictMode', async () => {
        let resolve!: (value: typeof config) => void
        const props = publicationProps()
        vi.mocked(props.client.config).mockImplementationOnce(() => new Promise(done => { resolve = done }))
        const view = render(<Page {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
        await waitFor(() => expect(props.client.config).toHaveBeenCalledOnce())
        view.rerender(<Page {...props} client={{ ...props.client }} />)
        await act(async () => resolve(config))
        expect(screen.queryByRole('dialog')).toBeNull(); expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.sign).not.toHaveBeenCalled()
        view.unmount()
        render(<StrictMode><Page {...publicationProps()} /></StrictMode>); await openReview()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
    })
    it('dismisses a request refused by the signature sheet and says so', async () => {
        const dismiss = vi.fn(); calls.prepare.mockResolvedValue({ onDismissed: dismiss }); calls.sign.mockReturnValue(false)
        render(<Page {...publicationProps()} />); await openReview()
        await waitFor(() => expect(dismiss).toHaveBeenCalledOnce())
        expect(screen.getByText(/signature window could not open/)).toBeVisible()
    })
    it('lets the editor update a stale draft before any review is prepared', async () => {
        const beforeReview = vi.fn(async () => null)
        render(<Page {...publicationProps()} draft={{ ...draft, payload: { kind: 'public', title: 'Field guide', body: 'Saved content', base } }} beforeReview={beforeReview} />)
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
        await waitFor(() => expect(beforeReview).toHaveBeenCalledOnce())
        await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled())
        expect(screen.queryByRole('dialog')).toBeNull(); expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.sign).not.toHaveBeenCalled()
    })
    it('never stays on Checking the latest revision when a step does not answer', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            const props = publicationProps(); vi.mocked(props.client.config).mockReturnValue(new Promise(() => {}))
            render(<Page {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
            expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled(); expect(screen.getByRole('dialog', { name: 'Publish' })).toHaveTextContent('Checking the latest revision…')
            await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
            expect(screen.getByText(/network did not answer in time/)).toBeVisible(); expect(screen.queryByRole('dialog')).toBeNull()
            expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled(); expect(calls.sign).not.toHaveBeenCalled()
        } finally { vi.useRealTimers() }
    })
})

describe('publication baseline and receipt boundaries', () => {
    it('retains the durable draft on an unknown settlement', async () => {
        const props = publicationProps(), saveDraft = vi.fn(), onPublished = vi.fn()
        render(<Page {...props} onPublished={onPublished} store={{ ...props.store, saveDraft } as unknown as NotesStore} />); await openReview()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        await act(async () => calls.sign.mock.calls[0][0].onSettled('unknown'))
        expect(saveDraft).not.toHaveBeenCalled(); expect(onPublished).not.toHaveBeenCalled()
        expect(await screen.findByText(/Do not publish again: check whether revision 1 exists first/)).toBeVisible()
        expect(screen.queryByRole('dialog', { name: 'Publishing' })).toBeNull()
    })
    it('keeps a signed publication confirmable after the panel unmounts when the workspace owns the request', async () => {
        const props = publicationProps(), onPublished = vi.fn(), requestSession = createDraftSession()
        const view = render(<Page {...props} requestSession={requestSession} onPublished={onPublished} />); await openReview()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        const input = calls.prepare.mock.calls[0][0]; expect(input.session).toBe(requestSession)
        // The guard the request holds is taken before unmounting: capture() after an invalidation returns a fresh, never-aborted signal.
        const signal = input.session.capture().signal as AbortSignal
        view.unmount()
        expect(signal.aborted).toBe(false)
        const confirmed = { id: draft.scope.noteId, stateRevision: '8' }
        await act(async () => { input.onConfirmed(confirmed); calls.sign.mock.calls[0][0].onSettled('confirmed') })
        expect(onPublished).toHaveBeenCalledExactlyOnceWith(confirmed)
    })
    it('hands the confirmed revision to the editor and refreshes every view of the note', async () => {
        const props = publicationProps(), onPublished = vi.fn(), announced = vi.fn()
        function Listener() { useNoteFreshness('gnoland-1', draft.scope.noteId, announced); return null }
        render(<><Listener /><Page {...props} onPublished={onPublished} /></>); await openReview()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        const confirmed = { id: draft.scope.noteId, stateRevision: '8' }
        await act(async () => { calls.prepare.mock.calls[0][0].onConfirmed(confirmed); calls.sign.mock.calls[0][0].onSettled('confirmed') })
        expect(onPublished).toHaveBeenCalledExactlyOnceWith(confirmed); expect(announced).toHaveBeenCalledWith({ stateRevision: '8' })
        expect(screen.getByRole('heading', { name: 'Published · revision 8' })).toBeVisible()
    })
    it('rejects a mismatched network or realm without asking for a signature', async () => {
        const props = publicationProps()
        render(<Page {...props} draft={{ ...draft, scope: { ...draft.scope, chainId: 'other-chain' } }} />); fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
        await screen.findByText(/belongs to another network/); expect(screen.queryByRole('dialog')).toBeNull(); expect(calls.sign).not.toHaveBeenCalled(); expect(calls.prepare).not.toHaveBeenCalled()
    })
})

const live = { id: draft.scope.noteId, owner, mode: 4, deleted: false, stateRevision: '7', epoch: '2', ownerGeneration: '1', title: bytes('Whitepaper'), body: bytes('Published content') } as unknown as ChainNote
/** The page that opens the delete sheet: closing it unmounts it, as the authoring workspace does. */
function DeletePage({ requestSession = createDraftSession(), walletChainId, order = [] as string[] }: { requestSession?: ReturnType<typeof createDraftSession>; walletChainId?: string; order?: string[] }) {
    const [open, setOpen] = useState(true), [notice, setNotice] = useState<Notice | null>(null)
    const client = useState(() => ({ chainId: 'gnoland-1', assertCurrent() {} }) as unknown as NotesReadClient)[0]
    return <><NoteBanner notice={notice} />{open && <PublicDelete note={live} client={client} store={{} as NotesStore} owner={owner} title="Whitepaper" requestSession={requestSession}
        walletChainId={walletChainId} onClose={() => { order.push('close'); setOpen(false) }} onNotice={setNotice} />}</>
}
describe('published note deletion', () => {
    it('states the deposit it keeps and the cap it writes, then closes the sheet before signing', async () => {
        const order: string[] = []; calls.sign.mockImplementation(() => { order.push('sign'); return true })
        render(<DeletePage order={order} />)
        const sheet = screen.getByRole('dialog', { name: 'Delete note' })
        expect(sheet).toHaveTextContent('≈ 0.85 GNOT storage deposit, not returned'); expect(sheet).toHaveTextContent('At most 1.7 GNOT')
        expect(calls.prepare).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Delete with Adena' }))
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce()); expect(order).toEqual(['close', 'sign'])
        expect(calls.prepare.mock.calls[0][0]).toMatchObject({ maxDepositUgnot: '1700000', operation: { noteId: live.id, action: { kind: 'delete', revision: '7' } } })
        expect(calls.sign.mock.calls[0][0].summary).toBe('Delete “Whitepaper”')
    })
    it('prepares its request in the page session, so closing the sheet never aborts it', async () => {
        const requestSession = createDraftSession()
        render(<DeletePage requestSession={requestSession} />)
        fireEvent.click(screen.getByRole('button', { name: 'Delete with Adena' }))
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        const input = calls.prepare.mock.calls[0][0]; expect(input.session).toBe(requestSession)
        // Taken before the sheet closed: capture() after an invalidation would hand out a fresh signal.
        const signal = input.session.capture().signal as AbortSignal
        expect(screen.queryByRole('dialog', { name: 'Delete note' })).toBeNull(); expect(signal.aborted).toBe(false)
    })
    it('refuses to start while Adena is on another network', async () => {
        render(<DeletePage walletChainId="other-1" />)
        expect(screen.getByRole('alert')).toHaveTextContent('Adena is on other-1, this note lives on gnoland-1.')
        const remove = screen.getByRole('button', { name: 'Delete with Adena' }); expect(remove).toBeDisabled(); fireEvent.click(remove)
        await act(async () => {}); expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.sign).not.toHaveBeenCalled()
    })
    it('refuses to start when the balance does not cover the deposit', async () => {
        calls.balance.mockResolvedValue(JSON.stringify('100000ugnot'))
        render(<DeletePage />)
        expect(await screen.findByRole('alert')).toHaveTextContent('This costs ≈ 0.85 GNOT; your balance is 0.1 GNOT.')
        const remove = screen.getByRole('button', { name: 'Delete with Adena' }); expect(remove).toBeDisabled(); fireEvent.click(remove)
        await act(async () => {}); expect(calls.prepare).not.toHaveBeenCalled()
    })
    it('uses a fresh operation id for each attempt', async () => {
        calls.prepare.mockRejectedValueOnce(new Error('offline'))
        // The same sheet, kept open by its page, tries twice.
        const client = { chainId: 'gnoland-1', assertCurrent() {} } as unknown as NotesReadClient, onClose = vi.fn()
        render(<PublicDelete note={live} client={client} store={{} as NotesStore} owner={owner} title="Whitepaper" requestSession={createDraftSession()} onClose={onClose} />)
        fireEvent.click(screen.getByRole('button', { name: 'Delete with Adena' })); await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
        await waitFor(() => expect(screen.getByRole('button', { name: 'Delete with Adena' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Delete with Adena' })); await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        const [first, second] = calls.prepare.mock.calls.map(call => call[0].operation.operationId)
        expect(first).toMatch(/^[0-9a-f]{32}$/); expect(second).toMatch(/^[0-9a-f]{32}$/); expect(second).not.toBe(first)
    })
    it.each([
        [new NotesChainError('stale'), 'The note changed meanwhile. Nothing was sent; read the latest revision first.'],
        [new Error('offline'), 'The publication could not be prepared. Nothing was sent. Try again.'],
    ])('closes and explains a preparation that fails (%s)', async (error, message) => {
        calls.prepare.mockRejectedValueOnce(error)
        render(<DeletePage />)
        fireEvent.click(screen.getByRole('button', { name: 'Delete with Adena' }))
        expect(await screen.findByText(message)).toBeVisible()
        expect(screen.queryByRole('dialog', { name: 'Delete note' })).toBeNull(); expect(calls.sign).not.toHaveBeenCalled()
    })
})
