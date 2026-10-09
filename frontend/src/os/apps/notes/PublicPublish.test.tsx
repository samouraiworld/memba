import { StrictMode, useLayoutEffect } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftRecord, NotesStore } from '../../../lib/notes/drafts'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { PublicPublish } from './PublicPublish'
const calls = vi.hoisted(() => ({ prepare: vi.fn(), sign: vi.fn(), budget: vi.fn() }))
vi.mock('../../sign/signerContext', () => ({ useSigner: () => ({ sign: calls.sign }) }))
vi.mock('../../../lib/notes/chain/request', () => ({ preparePublicNoteRequest: calls.prepare }))
vi.mock('../../../lib/notes/config', () => ({ notesDeployment: () => ({ realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 }), newNoteId: () => crypto.randomUUID().replaceAll('-', '') }))
const owner = 'g1jw76lxvzjafw2kyjhdnzwggcftyhnlfjaer2u0'
const draft: DraftRecord = { schema: 1, scope: { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner, noteId: 'cd'.repeat(16) }, localRevision: '4', updatedAt: 1, payload: { kind: 'public', title: 'Whitepaper', body: 'Saved content' } }
const config = { realm: draft.scope.realm, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '100000', paused: false }
function setup(record = draft, getDraft = vi.fn(async () => record)) {
    const client = { chainId: 'gnoland-1', note: vi.fn(async () => ({ owner, stateRevision: '7', epoch: '2', ownerGeneration: '1' })), config: vi.fn(async () => config), assertCurrent() {} } as unknown as NotesReadClient
    render(<PublicPublish draft={record} client={client} store={{ getDraft } as unknown as NotesStore} />)
    fireEvent.click(screen.getByText(record.payload.kind === 'public' && record.payload.base ? 'Publish changes' : 'Publish', { selector: 'summary' }))
    return { client, getDraft }
}
beforeEach(() => { vi.clearAllMocks(); calls.prepare.mockResolvedValue({ warns: [] }); calls.sign.mockReturnValue(true) })
describe('public publication review', () => {
    it('requests no signature until review and uses the durable baseline and explicit deposit cap', async () => {
        const record: DraftRecord = { ...draft, payload: { kind: 'public', title: 'Whitepaper', body: 'Saved content', base: { stateRevision: '7', epoch: '2', ownerGeneration: '1', titleRevision: '5', bodyRevision: '6' } } }
        setup(record)
        expect(calls.sign).not.toHaveBeenCalled()
        fireEvent.change(screen.getByLabelText('Maximum storage deposit (GNOT)'), { target: { value: '3.5' } })
        fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        expect(calls.prepare.mock.calls[0][0]).toMatchObject({ maxDepositUgnot: '3500000', draftLocalRevision: '4', operation: { action: { kind: 'commit', revision: '7', epoch: '2', body: 'Saved content' } } })
    })
    it('retains a changed local draft instead of opening a stale review', async () => {
        setup(draft, vi.fn(async () => ({ ...draft, localRevision: '5' })))
        fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
        await screen.findByText(/draft, published note or quote changed/)
        expect(calls.sign).not.toHaveBeenCalled(); expect(calls.prepare).not.toHaveBeenCalled()
    })
    it('rejects an invalid or inadequate user cap without opening a wallet', async () => {
        setup()
        fireEvent.change(screen.getByLabelText('Maximum storage deposit (GNOT)'), { target: { value: '0.000001' } })
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
    it('dismisses a request refused by the signature sheet', async () => {
        const dismiss = vi.fn(); calls.prepare.mockResolvedValue({ onDismissed: dismiss }); calls.sign.mockReturnValue(false)
        render(<PublicPublish {...publicationProps()} />); openReview()
        await waitFor(() => expect(dismiss).toHaveBeenCalledOnce())
    })
})

describe('publication baseline and receipt boundaries', () => {
    it.each(['confirmed', 'unknown'])('retains the durable draft on a %s settlement', async outcome => {
        const props = publicationProps(), saveDraft = vi.fn()
        render(<PublicPublish {...props} store={{ ...props.store, saveDraft } as unknown as NotesStore} />); openReview()
        await waitFor(() => expect(calls.sign).toHaveBeenCalledOnce())
        await act(async () => calls.sign.mock.calls[0][0].onSettled(outcome))
        expect(saveDraft).not.toHaveBeenCalled(); expect(props.client.note).toBeUndefined()
        expect(await screen.findByText(outcome === 'confirmed' ? /baseline was kept/ : /outcome is unknown/)).toBeVisible()
    })
    it('rejects a mismatched network or realm without asking for a signature', async () => {
        const props = publicationProps()
        render(<PublicPublish {...props} draft={{ ...draft, scope: { ...draft.scope, chainId: 'other-chain' } }} />); openReview()
        await screen.findByText(/draft, published note or quote changed/); expect(calls.sign).not.toHaveBeenCalled(); expect(calls.prepare).not.toHaveBeenCalled()
    })
})
