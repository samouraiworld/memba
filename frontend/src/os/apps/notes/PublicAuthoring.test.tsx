import { StrictMode, type ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createDraftSession, createNotesStore, type NotesStore } from '../../../lib/notes/drafts'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import { PublicAuthoring } from './PublicAuthoring'
import { PublicDraftLibrary } from './PublicDraftLibrary'
const mocks = vi.hoisted(() => ({ permission: vi.fn(), note: null as ChainNote | null }))
vi.mock('../../../lib/notes/chain/publicPermissions', () => ({ readPublicContentWritePermission: mocks.permission }))
vi.mock('../terminal/CodeEditor', () => ({ CodeEditor: ({ value, onChange }: { value: string; onChange(value: string): void }) => <textarea aria-label="Markdown editor" value={value} onChange={e => onChange(e.target.value)} /> }))
vi.mock('./MarkdownPreview', () => ({ MarkdownPreview: () => <span>Preview</span> }))
vi.mock('./PublicPublish', () => ({ PublicPublish: () => <span>Publication controls</span> }))
vi.mock('./PublicCollaborationControls', () => ({ PublicCollaborationControls: () => <span>Community editing controls</span> }))
vi.mock('./PublicCommentPanel', () => ({ PublicCommentPanel: () => <span>Comments</span> }))
vi.mock('./PublicHistory', () => ({ PublicHistory: ({ onRestore }: { onRestore?: (draft: unknown) => void }) => <button onClick={() => onRestore?.({ noteId: mocks.note!.id, sourceStateRevision: '1', title: 'Archived title', body: 'Archived body' })}>Restore archived draft</button> }))
vi.mock('./PublicNote', () => ({ PublicNote: ({ editAction, children }: { editAction?: (note: ChainNote) => ReactNode; children?: (note: ChainNote) => ReactNode }) => <section aria-label="Published note"><h1>Published reader</h1>{mocks.note && <>{editAction?.(mocks.note)}{children?.(mocks.note)}</>}</section> }))
const scope = { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner: 'wallet', noteId: 'ab'.repeat(16) }
const utf8 = (value: string) => new TextEncoder().encode(value)
const note = { id: scope.noteId, owner: 'other', mode: 4, deleted: false, stateRevision: '3', titleRevision: '2', bodyRevision: '3', epoch: '0', ownerGeneration: '1', title: utf8('Published title'), body: utf8('Published body') } as ChainNote
const payload = { kind: 'public' as const, title: 'My title', body: 'My text', base: { stateRevision: '1', epoch: '0', titleRevision: '1', bodyRevision: '1', ownerGeneration: '1' } }
const stores: NotesStore[] = []
function setup() { const store = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(store); return { store, session: createDraftSession(), client: { chainId: scope.chainId, assertCurrent: vi.fn(), note: vi.fn(async () => mocks.note) } as unknown as NotesReadClient } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => { vi.clearAllMocks(); mocks.note = note; mocks.permission.mockResolvedValue(true) })
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.close())) })
describe('public authoring durable workspace', () => {
    it('creates only after durable revision0 save and resumes the same ID after reload', async () => {
        const { store } = setup(), open = vi.fn()
        const view = render(<PublicDraftLibrary store={store} partition={scope} onOpen={open} />)
        fireEvent.click(screen.getByRole('button', { name: 'New note' })); await waitFor(() => expect(open).toHaveBeenCalledOnce())
        const id = open.mock.calls[0][0], saved = await store.getDraft({ ...scope, noteId: id })
        expect(saved).toMatchObject({ localRevision: '1', payload: { kind: 'public' } })
        view.unmount(); render(<PublicDraftLibrary store={store} partition={scope} onOpen={open} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Untitled note' })); expect(open).toHaveBeenLastCalledWith(id)
    })
    it('never navigates after failed creation or a late save from a closed generation', async () => {
        const { store } = setup(), open = vi.fn(), pending = deferred<Awaited<ReturnType<NotesStore['saveDraft']>>>()
        vi.spyOn(store, 'saveDraft').mockReturnValue(pending.promise)
        const view = render(<PublicDraftLibrary store={store} partition={scope} onOpen={open} />)
        fireEvent.click(screen.getByRole('button', { name: 'New note' })); view.unmount()
        await act(async () => pending.resolve({ status: 'conflict' })); expect(open).not.toHaveBeenCalled()
        vi.mocked(store.saveDraft).mockResolvedValue({ status: 'unavailable' })
        render(<PublicDraftLibrary store={store} partition={scope} onOpen={open} />)
        fireEvent.click(screen.getByRole('button', { name: 'New note' })); await screen.findByText(/new draft was not saved/); expect(open).not.toHaveBeenCalled()
    })
    it('uses an authoritative null to resume a public local draft, but does not infer absence from RPC failure', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', payload, session)
        vi.mocked(client.note).mockRejectedValue(new Error('RPC unavailable'))
        const view = render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await screen.findByText(/published note could not be read/); expect(screen.queryByRole('textbox')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Open local draft' })); expect(await screen.findByLabelText('Note title')).toHaveValue('My title')
        view.unmount(); vi.mocked(client.note).mockResolvedValue(null)
        render(<PublicAuthoring store={store} client={client} scope={scope} />); expect(await screen.findByLabelText('Note title')).toHaveValue('My title')
    })
    it('opens an existing draft without replacing its text/base and preserves unsaved text on reader switches', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', payload, session)
        const save = vi.spyOn(store, 'saveDraft')
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
        expect(await screen.findByLabelText('Note title')).toHaveValue('My title'); expect(save).not.toHaveBeenCalled()
        fireEvent.change(screen.getByLabelText('Markdown editor'), { target: { value: 'Unsaved words' } })
        fireEvent.click(screen.getByRole('button', { name: 'Read published note' })); expect(screen.getByText('Community editing controls')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: 'Open local draft' }))
        expect(screen.getByLabelText('Markdown editor')).toHaveValue('Unsaved words'); expect(screen.queryByText('Community editing controls')).toBeNull()
        expect((await store.getDraft(scope))?.payload).toMatchObject({ base: payload.base })
    })
    it('permits community editing only after the content guard and saves the exact fresh baseline', async () => {
        const { store, client } = setup(); render(<StrictMode><PublicAuthoring store={store} client={client} scope={scope} /></StrictMode>)
        fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
        expect(await screen.findByLabelText('Note title')).toHaveValue('Published title')
        expect((await store.getDraft(scope))?.payload).toMatchObject({ body: 'Published body', base: { stateRevision: '3' } })
        expect(mocks.permission).toHaveBeenCalledWith(client, note, 'wallet')
    })
    it('refuses a capability revoked between Edit visibility and preparation', async () => {
        const { store, client } = setup(); render(<PublicAuthoring store={store} client={client} scope={scope} />)
        const button = await screen.findByRole('button', { name: 'Edit note' }); mocks.permission.mockResolvedValue(false); fireEvent.click(button)
        await screen.findByText(/safe editing baseline could not/); expect(await store.getDraft(scope)).toBeNull()
    })
    it('does not overwrite an intervening tab draft between slot read and fresh note read', async () => {
        const { store, session, client } = setup()
        vi.mocked(client.note).mockImplementation(async () => { await store.saveDraft(scope, '0', { ...payload, body: 'Other tab' }, session); return note })
        render(<PublicAuthoring store={store} client={client} scope={scope} />); fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
        await screen.findByText(/Another window changed/); expect((await store.getDraft(scope))?.payload).toMatchObject({ body: 'Other tab' })
    })
    it('drops a late edit after scope ABA and never writes into the reopened workspace', async () => {
        const { store, client } = setup(), pending = deferred<ChainNote | null>()
        vi.mocked(client.note).mockReturnValueOnce(pending.promise)
        const view = render(<PublicAuthoring store={store} client={client} scope={scope} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Edit note' })); await waitFor(() => expect(client.note).toHaveBeenCalledOnce())
        view.rerender(<PublicAuthoring store={store} client={client} scope={{ ...scope, owner: 'other-wallet' }} />)
        view.rerender(<PublicAuthoring store={store} client={client} scope={scope} />)
        await act(async () => pending.resolve(note)); expect(await store.getDraft(scope)).toBeNull()
    })
    it('restores historical bytes only into a new draft with current baseline, preserving any existing draft', async () => {
        const { store, client } = setup(); const view = render(<PublicAuthoring store={store} client={client} scope={scope} />)
        fireEvent.click(screen.getByRole('button', { name: 'Restore archived draft' }))
        expect(await screen.findByLabelText('Note title')).toHaveValue('Archived title')
        expect((await store.getDraft(scope))?.payload).toMatchObject({ body: 'Archived body', base: { stateRevision: '3' } })
        view.unmount(); render(<PublicAuthoring store={store} client={client} scope={scope} />)
        fireEvent.click(screen.getByRole('button', { name: 'Restore archived draft' })); await screen.findByText(/already exists/)
        expect((await store.getDraft(scope))?.localRevision).toBe('1')
    })
    it('advances the baseline only after explicit comparison and CAS, keeping saved local text', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', payload, session)
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Open local draft' })); await screen.findByLabelText('Note title')
        fireEvent.click(screen.getByText('Compare with published revision')); fireEvent.click(screen.getByRole('button', { name: 'Load comparison' }))
        await screen.findByText('Published revision 3'); expect((await store.getDraft(scope))?.payload).toMatchObject({ base: payload.base })
        fireEvent.click(screen.getByRole('button', { name: 'Keep my saved text against revision 3' }))
        await waitFor(async () => expect((await store.getDraft(scope))?.localRevision).toBe('2'))
        expect((await store.getDraft(scope))?.payload).toMatchObject({ title: 'My title', body: 'My text', base: { stateRevision: '3' } })
    })
    it('keeps the original baseline when the published revision moves after comparison', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', payload, session)
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Open local draft' })); await screen.findByLabelText('Note title')
        fireEvent.click(screen.getByText('Compare with published revision')); fireEvent.click(screen.getByRole('button', { name: 'Load comparison' }))
        await screen.findByText('Published revision 3'); vi.mocked(client.note).mockResolvedValue({ ...note, stateRevision: '4' })
        fireEvent.click(screen.getByRole('button', { name: 'Keep my saved text against revision 3' }))
        await screen.findByText(/Comparison or baseline save failed/)
        expect((await store.getDraft(scope))?.payload).toEqual(payload); expect((await store.getDraft(scope))?.localRevision).toBe('1')
    })

})
