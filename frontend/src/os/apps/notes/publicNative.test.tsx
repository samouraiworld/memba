import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { NativeViewProps } from '../../native/types'
import { createNotesStore, type NotesStore } from '../../../lib/notes/drafts'
import { mayCloseWindow } from '../../shell/closeGuards'
import { LAST_NOTE_PREFIX } from './notesWorkspace'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import type { NotesReadContext } from '../../../lib/notes/chain/client'
import { PublicNotesApp } from './publicNative'
import { DeskShortcutsContext } from '../../shell/deskShortcuts'
const mocks = vi.hoisted(() => ({ enabled: true, available: true, fail: false, note: vi.fn(), list: vi.fn(), owned: vi.fn(), contexts: [] as NotesReadContext[], panel: vi.fn(),
    scopes: [] as object[], publishing: '', unmounted: vi.fn(), deployment: { realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 }, store: null as unknown as NotesStore }))
vi.mock('../../../lib/notes/config', async original => ({ ...await original<typeof import('../../../lib/notes/config')>(), get NOTES_ENABLED() { return mocks.enabled }, notesDeployment: () => mocks.available ? mocks.deployment : null }))
// The workspace keeps one module store; each test gets its own isolated database behind it.
vi.mock('../../../lib/notes/drafts', async original => {
    const module = await original<typeof import('../../../lib/notes/drafts')>()
    const shared = new Proxy({}, { get: (_, key) => { const value = Reflect.get(mocks.store, key); return typeof value === 'function' ? value.bind(mocks.store) : value } })
    return { ...module, createNotesStore: (options?: Parameters<typeof module.createNotesStore>[0]) => options ? module.createNotesStore(options) : shared }
})
vi.mock('../terminal/CodeEditor', () => ({ CodeEditor: ({ value, onChange }: { value: string; onChange(value: string): void }) => <textarea aria-label="Markdown editor" value={value} onChange={event => onChange(event.target.value)} /> }))
vi.mock('../../../lib/rpcFallback', () => ({ getRpcUrlsInOrder: () => ['https://rpc.invalid'] }))
vi.mock('../../../lib/notes/chain/client', () => ({ NotesReadClient: class {
    chainId: string; note = mocks.note; publicNotes = mocks.list; byOwner = mocks.owned
    constructor(context: NotesReadContext) { mocks.contexts.push(context); if (mocks.fail) throw new Error('internal diagnostic'); this.chainId = context.chainId }
} }))
vi.mock('./PublicHistory', () => ({ PublicHistory: () => <p>Public history</p> }))
vi.mock('./PublicOperationStatus', () => ({ PublicOperationStatus: () => <p>Public receipts</p> }))
vi.mock('./PublicAuthoring', async () => {
    const { useEffect } = await import('react'), { useNotesPane } = await import('./notesPane')
    // Stands in for a publication being verified with the authoring workspace's own session.
    function Publishing({ noteId }: { noteId: string }) {
        const pane = useNotesPane()
        // The pane context changes with what is on screen; only a real unmount ends the publication.
        useEffect(() => { pane?.hold('publishing:test', true) }, [pane])
        useEffect(() => () => mocks.unmounted(noteId), [noteId])
        return null
    }
    return { PublicAuthoring: ({ scope }: { scope: { owner: string; noteId: string } }) => { mocks.scopes.push(scope); return <><p>Public authoring for {scope.owner}</p>{mocks.publishing === scope.noteId && <Publishing noteId={scope.noteId} />}</> } }
})
vi.mock('./MarkdownPreview', () => ({ MarkdownPreview: ({ body }: { body: string }) => <article>{body}</article> }))
vi.mock('./PublicCommentPanel', async () => {
    const { useState } = await import('react'), { useUnsavedText } = await import('./notesPane')
    function Composer() { const [text, setText] = useState(''); useUnsavedText(!!text, 'Leave without posting?'); return <input aria-label="Comment" value={text} onChange={event => setText(event.target.value)} /> }
    return { PublicCommentPanel: (props: { owner: string | null; note: ChainNote }) => { mocks.panel(props); return <><p>Comments for {props.owner ?? 'guest'}</p><Composer /></> } }
})
const id = 'ab'.repeat(16)
const note: ChainNote = { id, owner: 'owner', pendingOwner: '', ownerGeneration: '1', mode: 4, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '0', title: new TextEncoder().encode('Public example'), body: new TextEncoder().encode('Readable example body'), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '1', operationId: 'cd'.repeat(16), actor: 'owner', height: '2' }
function props(patch: Partial<NativeViewProps['session']> = {}, section: string | null = id) {
    return { session: { status: 'guest', address: '', network: { chainId: 'test-chain' }, ...patch } as NativeViewProps['session'], section, fallback: <p>Fallback</p>, onOpenNote: vi.fn(), onShowList: vi.fn(), active: true }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const partition = { chainId: 'test-chain', realm: 'gno.land/r/samcrew/memba_notes_v1' }
beforeEach(() => {
    vi.clearAllMocks(); mocks.publishing = ''; mocks.enabled = true; mocks.available = true; mocks.fail = false; mocks.contexts = []; mocks.scopes = []
    mocks.note.mockResolvedValue(note); mocks.list.mockResolvedValue({ items: [note], nextCursor: '' }); mocks.owned.mockResolvedValue({ items: [], nextCursor: '' })
    mocks.store = createNotesStore({ indexedDB: new IDBFactory() })
})
afterEach(async () => { cleanup(); localStorage.clear(); await mocks.store.close() })
describe('dormant public Notes native view', () => {
    it('renders the real public reader for guests without exposing note or private operations', async () => {
        render(<PublicNotesApp {...props()} />)
        expect(await screen.findByRole('heading', { name: 'Public example' })).toBeVisible()
        expect(screen.getByText('Readable example body')).toBeVisible(); expect(screen.getByText('Public history')).toBeVisible()
        fireEvent.click(screen.getByRole('tab', { name: /Comments/ })); expect(screen.getByText('Comments for guest')).toBeVisible()
        expect(screen.getByRole('button', { name: 'Share' })).toBeVisible()
        for (const name of ['Edit', 'Edit note', 'Review deletion', 'Write a note', 'Encryption', 'Publish']) expect(screen.queryByRole('button', { name })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'More actions' })); expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull()
        expect(mocks.contexts[0]).toMatchObject({ chainId: 'test-chain', rpcUrls: ['https://rpc.invalid'] })
    })
    it('gives authoring only to the current member account and retains the guest reader while resuming', async () => {
        const view = render(<PublicNotesApp {...props({ status: 'member', address: 'owner' })} />)
        expect(await screen.findByText('Public authoring for owner')).toBeVisible(); expect(screen.getByText('Public receipts')).toBeVisible()
        view.rerender(<PublicNotesApp {...props({ status: 'resuming', address: 'owner' })} />)
        fireEvent.click(await screen.findByRole('tab', { name: /Comments/ })); expect(await screen.findByText('Comments for guest')).toBeVisible()
    })
    it('keeps a stable authoring scope across unrelated parent renders', async () => {
        const view = render(<PublicNotesApp {...props({ status: 'member', address: 'owner' })} />)
        expect(await screen.findByText('Public authoring for owner')).toBeVisible()
        view.rerender(<PublicNotesApp {...props({ status: 'member', address: 'owner' })} />)
        view.rerender(<PublicNotesApp {...props({ status: 'member', address: 'owner' })} />)
        expect(mocks.scopes.length).toBeGreaterThan(1); expect(new Set(mocks.scopes).size).toBe(1)
    })
    it('opens a public note from Explore through the shell-owned callback', async () => {
        const input = props({}, null); render(<PublicNotesApp {...input} />)
        fireEvent.click(await screen.findByRole('button', { name: /Public notes/ }))
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search notes' }), { target: { value: 'paella' } })
        expect(await screen.findByText('No loaded public note matches this search.')).toBeVisible()
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search notes' }), { target: { value: 'EXAMPLE' } })
        fireEvent.click(await screen.findByRole('button', { name: /Public example/ }))
        expect(input.onOpenNote).toHaveBeenCalledExactlyOnceWith(id)
    })
    it('offers Add to Desktop for the open note only, in its menu', async () => {
        // Members' note views (PublicAuthoring, mocked here) use the same note header menu (NoteHeader.test).
        const desk = { isPinned: vi.fn(() => false), pin: vi.fn(), unpin: vi.fn() }
        const view = render(<DeskShortcutsContext.Provider value={desk}><PublicNotesApp {...props()} /></DeskShortcutsContext.Provider>)
        fireEvent.click(await screen.findByRole('button', { name: 'More actions' })); fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Desktop' }))
        expect(desk.pin).toHaveBeenCalledExactlyOnceWith({ ty: 'note', ref: id })
        // The shown note may be the remembered one (no note in the address); Explore shows no note, so no menu.
        view.rerender(<DeskShortcutsContext.Provider value={desk}><PublicNotesApp {...props({}, null)} /></DeskShortcutsContext.Provider>)
        fireEvent.click(await screen.findByRole('button', { name: 'More actions' })); fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Desktop' }))
        expect(desk.pin).toHaveBeenCalledTimes(2); expect(desk.pin).toHaveBeenLastCalledWith({ ty: 'note', ref: id })
        fireEvent.click(screen.getByRole('button', { name: /Public notes/ }))
        expect(await screen.findByRole('button', { name: /Public example/ })).toBeVisible()
        expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull(); expect(screen.queryByRole('menuitem', { name: 'Add to Desktop' })).toBeNull()
    })

    it('opens ready to write the first time: one blank local draft, caret in the title, nothing signed', async () => {
        const view = render(<PublicNotesApp {...props({}, null)} />)
        const title = await screen.findByRole('textbox', { name: 'Note title' })
        // The caret moves in after the draft is stored and rendered: wait for that commit rather than racing it.
        expect(title).toHaveValue(''); await waitFor(() => expect(title).toHaveFocus())
        // A guest's untouched blank draft is not listed in My notes (F12).
        expect(await screen.findByText('No notes yet.')).toBeVisible(); expect(screen.queryByRole('button', { name: /New note.*Draft/ })).toBeNull()
        const drafts = await mocks.store.listDrafts({ ...partition, owner: 'guest' })
        expect(drafts).toHaveLength(1); expect(drafts[0].payload).toEqual({ kind: 'public', title: '', body: '' })
        view.unmount(); render(<PublicNotesApp {...props({}, null)} />)
        expect(await screen.findByRole('textbox', { name: 'Note title' })).toHaveValue('')
        expect(await mocks.store.listDrafts({ ...partition, owner: 'guest' })).toHaveLength(1)
        expect(mocks.contexts.length).toBeGreaterThan(0)
    })
    it('reopens the last note this account had open, per network and account', async () => {
        const view = render(<PublicNotesApp {...props()} />)
        expect(await screen.findByRole('heading', { name: 'Public example' })).toBeVisible()
        view.unmount(); render(<PublicNotesApp {...props({}, null)} />)
        expect(await screen.findByRole('heading', { name: 'Public example' })).toBeVisible()
        expect(await mocks.store.listDrafts({ ...partition, owner: 'guest' })).toHaveLength(0)
        cleanup(); render(<PublicNotesApp {...props({ status: 'member', address: 'owner' }, null)} />)
        expect(await screen.findByText('Public authoring for owner')).toBeVisible()
        const [blank] = await mocks.store.listDrafts({ ...partition, owner: 'owner' })
        expect(blank.payload).toEqual({ kind: 'public', title: '', body: '' }); expect(mocks.scopes.at(-1)).toMatchObject({ owner: 'owner', noteId: blank.scope.noteId })
    })
    it('New note opens one blank draft through the shell and never navigates after failure', async () => {
        const input = props({ status: 'member', address: 'owner' }); render(<PublicNotesApp {...input} />)
        await screen.findByText('Public authoring for owner')
        fireEvent.click(screen.getByRole('button', { name: 'New note' }))
        await waitFor(() => expect(input.onOpenNote).toHaveBeenCalledOnce())
        const created = input.onOpenNote.mock.calls[0][0]
        expect(await mocks.store.getDraft({ ...partition, owner: 'owner', noteId: created })).toMatchObject({ payload: { kind: 'public', title: '', body: '' } })
        fireEvent.click(screen.getByRole('button', { name: 'New note' }))
        await waitFor(() => expect(input.onOpenNote).toHaveBeenCalledTimes(2)); expect(input.onOpenNote).toHaveBeenLastCalledWith(created)
        vi.spyOn(mocks.store, 'listDrafts').mockResolvedValue([]); vi.spyOn(mocks.store, 'saveDraft').mockResolvedValue({ status: 'unavailable' })
        fireEvent.click(screen.getByRole('button', { name: 'New note' }))
        expect(await screen.findByText(/new note could not be saved/)).toBeVisible(); expect(input.onOpenNote).toHaveBeenCalledTimes(2)
    })
    it('never navigates after a late New note save from a closed window', async () => {
        const input = props({ status: 'member', address: 'owner' }), view = render(<PublicNotesApp {...input} />)
        await screen.findByText('Public authoring for owner')
        const pending = deferred<Awaited<ReturnType<NotesStore['saveDraft']>>>()
        vi.spyOn(mocks.store, 'listDrafts').mockResolvedValue([]); vi.spyOn(mocks.store, 'saveDraft').mockReturnValue(pending.promise)
        fireEvent.click(screen.getByRole('button', { name: 'New note' }))
        await waitFor(() => expect(mocks.store.saveDraft).toHaveBeenCalled()); view.unmount()
        await act(async () => pending.resolve({ status: 'saved', value: {} as never })); expect(input.onOpenNote).not.toHaveBeenCalled()
    })
    it.each(['another note', 'Explore'])('keeps a title typed just before switching to %s', async target => {
        const input = props({}, null), view = render(<PublicNotesApp {...input} />)
        fireEvent.change(await screen.findByRole('textbox', { name: 'Note title' }), { target: { value: 'Shopping list' } })
        if (target === 'Explore') fireEvent.click(screen.getByRole('button', { name: /Public notes/ }))
        else view.rerender(<PublicNotesApp {...input} section={'cd'.repeat(16)} />)
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 1500)) })
        const [draft] = await mocks.store.listDrafts({ ...partition, owner: 'guest' })
        expect(draft.payload).toMatchObject({ kind: 'public', title: 'Shopping list', body: '' })
    })
    it('keeps a note whose edits could not be stored, and asks before the window closes', async () => {
        const input = props({}, null), view = render(<PublicNotesApp {...input} />)
        const title = await screen.findByRole('textbox', { name: 'Note title' })
        vi.spyOn(mocks.store, 'saveDraft').mockResolvedValue({ status: 'unavailable' })
        fireEvent.change(title, { target: { value: 'Shopping list' } })
        expect(await screen.findByText(/This device could not save your edits/)).toBeInTheDocument()
        view.rerender(<PublicNotesApp {...input} section={id} />)
        expect(await screen.findByRole('heading', { name: 'Public example' })).toBeVisible()
        expect(within(screen.getByRole('navigation', { name: 'Notes list' })).getByRole('button', { name: /Unsaved changes/ })).toBeVisible()
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
        expect(mayCloseWindow('app:notes')).toBe(false); expect(confirm).toHaveBeenCalledOnce()
        const [held] = await mocks.store.listDrafts({ ...partition, owner: 'guest' })
        view.rerender(<PublicNotesApp {...input} section={held.scope.noteId} />)
        expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('Shopping list')
        confirm.mockRestore()
    })
    it('keeps a note whose publication is being verified mounted when another note opens', async () => {
        mocks.publishing = id
        const input = props({ status: 'member', address: 'owner' }), view = render(<PublicNotesApp {...input} />)
        await screen.findByText('Public authoring for owner')
        view.rerender(<PublicNotesApp {...input} section={'cd'.repeat(16)} />)
        await waitFor(() => expect(mocks.scopes.at(-1)).toMatchObject({ noteId: 'cd'.repeat(16) }))
        expect(mocks.unmounted).not.toHaveBeenCalled()
        expect(screen.getAllByText('Public authoring for owner')).toHaveLength(2)
        expect(within(screen.getByRole('navigation', { name: 'Notes list' })).queryByText(/Unsaved changes/)).toBeNull()
    })
    it('keeps an unsent comment when another note opens', async () => {
        const input = props(), view = render(<PublicNotesApp {...input} />)
        fireEvent.click(await screen.findByRole('tab', { name: /Comments/ }))
        fireEvent.change(await screen.findByRole('textbox', { name: 'Comment' }), { target: { value: 'Lovely recipe' } })
        view.rerender(<PublicNotesApp {...input} section={'cd'.repeat(16)} />)
        await waitFor(() => expect(mocks.note).toHaveBeenCalledWith('cd'.repeat(16)))
        expect(screen.getByDisplayValue('Lovely recipe')).not.toBeVisible()
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
        expect(mayCloseWindow('app:notes')).toBe(false); confirm.mockRestore()
        view.rerender(<PublicNotesApp {...input} section={id} />)
        expect(screen.getByDisplayValue('Lovely recipe')).toBeVisible()
    })
    it('opens a blank draft instead of a remembered note that no longer exists anywhere', async () => {
        localStorage.setItem(LAST_NOTE_PREFIX + JSON.stringify([partition.chainId, partition.realm, 'guest']), 'ef'.repeat(16)); mocks.note.mockResolvedValue(null)
        render(<PublicNotesApp {...props({}, null)} />)
        expect(await screen.findByRole('textbox', { name: 'Note title' })).toHaveValue('')
        expect(await mocks.store.listDrafts({ ...partition, owner: 'guest' })).toHaveLength(1)
        expect(localStorage.getItem(LAST_NOTE_PREFIX + JSON.stringify([partition.chainId, partition.realm, 'guest']))).not.toBe('ef'.repeat(16))
    })
    it('starts the caret in a new title only while Notes is the front window', async () => {
        const input = { ...props({}, null), active: false }, view = render(<PublicNotesApp {...input} />)
        const title = await screen.findByRole('textbox', { name: 'Note title' })
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
        expect(title).not.toHaveFocus()
        view.rerender(<PublicNotesApp {...input} active />)
        await waitFor(() => expect(title).toHaveFocus())
        title.blur(); view.rerender(<PublicNotesApp {...input} active={false} />); view.rerender(<PublicNotesApp {...input} active />)
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
        expect(title).not.toHaveFocus()
    })
    it('lists my published notes, searches them and goes back to the list on a phone', async () => {
        mocks.owned.mockResolvedValue({ items: [{ ...note, owner: 'owner', title: new TextEncoder().encode('Trip budget') }], nextCursor: '' })
        const input = props({ status: 'member', address: 'owner' }); render(<PublicNotesApp {...input} />)
        const list = screen.getByRole('navigation', { name: 'Notes list' })
        expect(await within(list).findByRole('button', { name: /Trip budget.*Public.*Revision 1/ })).toHaveAttribute('aria-current', 'true')
        fireEvent.change(within(list).getByRole('searchbox', { name: 'Search notes' }), { target: { value: 'sushi' } })
        expect(within(list).queryByRole('button', { name: /Trip budget/ })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Back to notes' }))
        expect(input.onShowList).toHaveBeenCalledOnce()
        expect(mocks.owned).toHaveBeenCalledWith('owner', '', 20)
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
        await waitFor(() => expect(mocks.note).toHaveBeenCalled()); expect(mocks.contexts).toHaveLength(1); const old = mocks.contexts[0]
        const next = change === 'account' ? props({ status: 'member', address: 'member' }) : change === 'network' ? props({ network: { chainId: 'next-chain' } as NativeViewProps['session']['network'] }) : props({}, 'ef'.repeat(16))
        // The window keeps its list across notes; a note change replaces only the note pane.
        view.rerender(<PublicNotesApp {...next} />); expect(old.isCurrent()).toBe(change === 'note')
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
    it.each([[null, 'heading', 'Note not found'], [{ ...note, deleted: true }, 'heading', 'Deleted note'], [{ ...note, mode: 1 }, 'region', 'Private note']] as const)('renders absent/deleted/encrypted state without editing or private controls', async (value, role, name) => {
        mocks.note.mockResolvedValue(value); render(<PublicNotesApp {...props()} />)
        expect(await screen.findByRole(role, { name })).toBeVisible(); expect(screen.queryByText('Readable example body')).toBeNull()
        expect(screen.queryByText(/encryption settings/i)).toBeNull(); expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
        if (name === 'Private note') { expect(screen.getByText(/Opening private notes is not available in this version/)).toBeVisible(); expect(mocks.panel).not.toHaveBeenCalled() }
    })
})
