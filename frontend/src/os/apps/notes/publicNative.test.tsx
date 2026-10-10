import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeViewProps } from '../../native/types'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import type { NotesReadContext } from '../../../lib/notes/chain/client'
import { PublicNotesApp } from './publicNative'
const mocks = vi.hoisted(() => ({ enabled: true, available: true, fail: false, note: vi.fn(), list: vi.fn(), contexts: [] as NotesReadContext[], panel: vi.fn(),
    scopes: [] as object[], deployment: { realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 } }))
vi.mock('../../../lib/notes/config', () => ({ get NOTES_ENABLED() { return mocks.enabled }, NOTE_ID: /^[0-9a-f]{32}$/, notesDeployment: () => mocks.available ? mocks.deployment : null }))
vi.mock('../../../lib/rpcFallback', () => ({ getRpcUrlsInOrder: () => ['https://rpc.invalid'] }))
vi.mock('../../../lib/notes/chain/client', () => ({ NotesReadClient: class {
    chainId: string; note = mocks.note; publicNotes = mocks.list
    constructor(context: NotesReadContext) { mocks.contexts.push(context); if (mocks.fail) throw new Error('internal diagnostic'); this.chainId = context.chainId }
} }))
vi.mock('./PublicHistory', () => ({ PublicHistory: () => <p>Public history</p> }))
vi.mock('./PublicOperationStatus', () => ({ PublicOperationStatus: () => <p>Public receipts</p> }))
vi.mock('./PublicDraftLibrary', () => ({ PublicDraftLibrary: () => <button>New note</button> }))
vi.mock('./PublicAuthoring', () => ({ PublicAuthoring: ({ scope }: { scope: { owner: string; noteId: string } }) => { mocks.scopes.push(scope); return <p>Public authoring for {scope.owner}</p> } }))
vi.mock('./MarkdownPreview', () => ({ MarkdownPreview: ({ body }: { body: string }) => <article>{body}</article> }))
vi.mock('./PublicCommentPanel', () => ({ PublicCommentPanel: (props: { owner: string | null; note: ChainNote }) => { mocks.panel(props); return <p>Comments for {props.owner ?? 'guest'}</p> } }))
const id = 'ab'.repeat(16)
const note: ChainNote = { id, owner: 'owner', pendingOwner: '', ownerGeneration: '1', mode: 4, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '0', title: new TextEncoder().encode('Public example'), body: new TextEncoder().encode('Readable example body'), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '1', operationId: 'cd'.repeat(16), actor: 'owner', height: '2' }
function props(patch: Partial<NativeViewProps['session']> = {}, section: string | null = id) {
    return { session: { status: 'guest', address: '', network: { chainId: 'test-chain' }, ...patch } as NativeViewProps['session'], section, fallback: <p>Fallback</p>, onOpenNote: vi.fn() }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
    vi.clearAllMocks(); mocks.enabled = true; mocks.available = true; mocks.fail = false; mocks.contexts = []; mocks.scopes = []
    mocks.note.mockResolvedValue(note); mocks.list.mockResolvedValue({ items: [note], nextCursor: '' })
})
describe('dormant public Notes native view', () => {
    it('renders the real public reader for guests without exposing note or private operations', async () => {
        render(<PublicNotesApp {...props()} />)
        expect(await screen.findByRole('heading', { name: 'Public example' })).toBeVisible()
        expect(screen.getByText('Readable example body')).toBeVisible(); expect(screen.getByText('Comments for guest')).toBeVisible()
        for (const name of ['Edit note', 'Review deletion', 'Write a note', 'Encryption', 'Publish']) expect(screen.queryByRole('button', { name })).toBeNull()
        expect(mocks.contexts[0]).toMatchObject({ chainId: 'test-chain', rpcUrls: ['https://rpc.invalid'] })
    })
    it('gives authoring only to the current member account and retains the guest reader while resuming', async () => {
        const view = render(<PublicNotesApp {...props({ status: 'member', address: 'owner' })} />)
        expect(await screen.findByText('Public authoring for owner')).toBeVisible(); expect(screen.getByText('Public receipts')).toBeVisible()
        view.rerender(<PublicNotesApp {...props({ status: 'resuming', address: 'owner' })} />)
        expect(await screen.findByText('Comments for guest')).toBeVisible()
    })
    it('keeps a stable authoring scope across unrelated parent renders', async () => {
        const view = render(<PublicNotesApp {...props({ status: 'member', address: 'owner' })} />)
        expect(await screen.findByText('Public authoring for owner')).toBeVisible()
        view.rerender(<PublicNotesApp {...props({ status: 'member', address: 'owner' })} />)
        view.rerender(<PublicNotesApp {...props({ status: 'member', address: 'owner' })} />)
        expect(mocks.scopes.length).toBeGreaterThan(1); expect(new Set(mocks.scopes).size).toBe(1)
    })
    it('opens a listed public note through the shell-owned callback', async () => {
        const input = props({}, null); render(<PublicNotesApp {...input} />)
        fireEvent.click(await screen.findByRole('button', { name: /Public example/ }))
        expect(input.onOpenNote).toHaveBeenCalledExactlyOnceWith(id)
    })
    it('stays dormant or unavailable without instantiating a client', () => {
        mocks.enabled = false; const view = render(<PublicNotesApp {...props()} />)
        expect(screen.getByText('Fallback')).toBeVisible(); expect(mocks.contexts).toHaveLength(0)
        mocks.enabled = true; mocks.available = false; view.rerender(<PublicNotesApp {...props()} />)
        expect(screen.getByText('Notes are not available on this network yet.')).toBeVisible(); expect(mocks.contexts).toHaveLength(0)
    })
    it('rejects malformed note routes before any note read', () => {
        render(<PublicNotesApp {...props({}, '../not-a-note')} />)
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid note address.'); expect(mocks.note).not.toHaveBeenCalled()
    })
    it('offers a bounded connection retry with no raw error details', async () => {
        mocks.fail = true; render(<PublicNotesApp {...props()} />)
        expect(screen.getByRole('alert')).toHaveTextContent('Notes could not connect'); expect(screen.queryByText('internal diagnostic')).toBeNull()
        mocks.fail = false; fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }))
        expect(await screen.findByRole('heading', { name: 'Public example' })).toBeVisible()
    })
    it.each(['account', 'network', 'note'])('invalidates the previous client before a %s route replacement can render stale content', async change => {
        const delayed = deferred<ChainNote>(); mocks.note.mockReturnValueOnce(delayed.promise)
        const input = props(), view = render(<PublicNotesApp {...input} />)
        await waitFor(() => expect(mocks.contexts).toHaveLength(1)); const old = mocks.contexts[0]
        const next = change === 'account' ? props({ status: 'member', address: 'member' }) : change === 'network' ? props({ network: { chainId: 'next-chain' } as NativeViewProps['session']['network'] }) : props({}, 'ef'.repeat(16))
        view.rerender(<PublicNotesApp {...next} />); expect(old.isCurrent()).toBe(false)
        if (change === 'account') expect(await screen.findByText('Public authoring for member')).toBeVisible()
        else expect(await screen.findByRole('heading', { name: 'Public example' })).toBeVisible()
        await act(async () => delayed.resolve({ ...note, title: new TextEncoder().encode('Stale content') }))
        expect(screen.queryByText('Stale content')).toBeNull()
        view.unmount(); expect(mocks.contexts.at(-1)!.isCurrent()).toBe(false)
    })
    it('uses a fresh client lease for StrictMode effect replay', async () => {
        render(<StrictMode><PublicNotesApp {...props()} /></StrictMode>)
        expect(await screen.findByRole('heading', { name: 'Public example' })).toBeVisible()
        expect(mocks.contexts.length).toBeGreaterThan(1); expect(mocks.contexts[0].isCurrent()).toBe(false); expect(mocks.contexts.at(-1)!.isCurrent()).toBe(true)
    })
    it.each([[null, 'Note not found'], [{ ...note, deleted: true }, 'Deleted note'], [{ ...note, mode: 1 }, 'Encrypted note']] as const)('renders absent/deleted/encrypted state without editing or private controls', async (value, heading) => {
        mocks.note.mockResolvedValue(value); render(<PublicNotesApp {...props()} />)
        expect(await screen.findByRole('heading', { name: heading })).toBeVisible(); expect(screen.queryByText('Readable example body')).toBeNull()
        expect(screen.queryByText(/encryption settings/i)).toBeNull()
        if (heading === 'Encrypted note') { expect(screen.getByText('Encrypted notes are not available in this public view.')).toBeVisible(); expect(mocks.panel).not.toHaveBeenCalled() }
    })
})
