import { StrictMode, type ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createDraftSession, createNotesStore, type NotesStore } from '../../../lib/notes/drafts'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import type { ChainNote } from '../../../lib/notes/chain/schema'
import { PublicAuthoring } from './PublicAuthoring'
import type { PublishProgress } from './PublicPublish'
import { announceNoteChange } from '../../../lib/notes/freshness'
const mocks = vi.hoisted(() => ({ permission: vi.fn(), note: null as ChainNote | null, plan: vi.fn(), actual: null as null | ((...args: unknown[]) => unknown), timeoutMs: undefined as number | undefined, reviewed: vi.fn(), answered: vi.fn(), publish: null as null | { onPublished?: (note: ChainNote) => void; onProgress?: (progress: PublishProgress | null) => void; requestSession?: { capture(): { signal: AbortSignal } } } }))
vi.mock('../../../lib/notes/chain/publicPermissions', () => ({ readPublicContentWritePermission: mocks.permission }))
vi.mock('../terminal/CodeEditor', () => ({ CodeEditor: ({ value, onChange }: { value: string; onChange(value: string): void }) => <textarea aria-label="Markdown editor" value={value} onChange={e => onChange(e.target.value)} /> }))
vi.mock('./MarkdownPreview', () => ({ MarkdownPreview: () => <span>Preview</span> }))
// The publish control, reduced to its contract: Publish asks the editor whether the saved draft follows the latest revision.
vi.mock('./PublicPublish', async original => ({ ...await original<typeof import('./PublicPublish')>(), PublicPublish: (props: { draft: { payload: { base?: unknown } }; beforeReview?: () => Promise<ChainNote | null>; onPublished?: (note: ChainNote) => void; requestSession?: { capture(): { signal: AbortSignal } } }) => {
    const { draft, beforeReview } = props
    mocks.publish = props
    return <>
    <span>{draft.payload.base ? 'Update controls' : 'Creation controls'}</span>
    {beforeReview && <button onClick={() => void beforeReview().then(note => { mocks.answered(note); if (note) mocks.reviewed() })}>Publish</button>}
</> } }))
vi.mock('../../../lib/notes/freshness', async original => {
    const actual = await original<typeof import('../../../lib/notes/freshness')>()
    return { ...actual, withTimeout: <T,>(promise: Promise<T>, ms?: number) => actual.withTimeout(promise, mocks.timeoutMs ?? ms) }
})
vi.mock('../../../lib/notes/chain/rebase', async original => {
    const actual = await original<typeof import('../../../lib/notes/chain/rebase')>()
    mocks.actual = actual.planDraftRebase as (...args: unknown[]) => unknown
    return { ...actual, planDraftRebase: mocks.plan }
})
vi.mock('./PublicCommentPanel', () => ({ PublicCommentPanel: () => <span>Comments</span> }))
vi.mock('./PublicHistory', () => ({ PublicHistory: ({ onRestore }: { onRestore?: (draft: unknown) => void }) => <button onClick={() => onRestore?.({ noteId: mocks.note!.id, sourceStateRevision: '1', title: 'Archived title', body: 'Archived body' })}>Restore archived draft</button> }))
type Reader = { primary?(note: ChainNote): ReactNode; status?(note: ChainNote): ReactNode; share?(note: ChainNote, refresh: () => void): ReactNode; menu?(note: ChainNote): { label: string; run(): void }[]; banner?: ReactNode; children?(note: ChainNote, refresh: () => void, root: null): ReactNode }
// The reader shows `mocks.note` as read; like the real one, its actions exist only once a note is shown, and its
// banner (the page's message) shows in every state (PublicNote.lifecycle.test covers that).
vi.mock('./PublicNote', () => ({
    NoteSkeleton: ({ label = 'Loading note…' }: { label?: string }) => <p role="status">{label}</p>,
    PublicNote: ({ primary, status, share, menu, banner, children }: Reader) => <section aria-label="Published note"><h1>Published reader</h1>{banner}{mocks.note && <>
        {status?.(mocks.note)}{share?.(mocks.note, () => {})}{primary?.(mocks.note)}{menu?.(mocks.note).map(item => <button key={item.label} onClick={item.run}>{item.label}</button>)}
        {children?.(mocks.note, () => {}, null)}</>}</section>,
}))
const scope = { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner: 'wallet', noteId: 'ab'.repeat(16) }
const utf8 = (value: string) => new TextEncoder().encode(value)
const note = { id: scope.noteId, owner: 'other', actor: 'other', mode: 4, deleted: false, stateRevision: '3', titleRevision: '2', bodyRevision: '3', epoch: '0', ownerGeneration: '1', title: utf8('Published title'), body: utf8('Published body') } as ChainNote
const payload = { kind: 'public' as const, title: 'My title', body: 'My text', base: { stateRevision: '1', epoch: '0', titleRevision: '1', bodyRevision: '1', ownerGeneration: '1' } }
/** Same content revisions as the live note: only a non-content change (for example a permission toggle) happened since. */
const sameContentBase = { stateRevision: '2', epoch: '0', titleRevision: '2', bodyRevision: '3', ownerGeneration: '1' }
const currentBase = { ...sameContentBase, stateRevision: '3' }
const stores: NotesStore[] = []
function setup() { const store = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(store); return { store, session: createDraftSession(), client: { chainId: scope.chainId, assertCurrent: vi.fn(), note: vi.fn(async () => mocks.note) } as unknown as NotesReadClient } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const editor = () => screen.getByRole('region', { name: 'Draft editor' })
/** Edit, once the reader shows the note and this account may publish to it. */
const edit = async () => fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
/** Publish in the mocked control, settled: the editor answered whether the draft follows the latest revision. */
async function publish() { mocks.answered.mockClear(); fireEvent.click(await screen.findByRole('button', { name: 'Publish' })); await waitFor(() => expect(mocks.answered).toHaveBeenCalledOnce()) }
beforeEach(() => { vi.clearAllMocks(); mocks.note = note; mocks.permission.mockResolvedValue(true); mocks.plan.mockImplementation((...args: unknown[]) => mocks.actual!(...args)); mocks.timeoutMs = undefined })
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.close())) })
describe('public authoring durable workspace', () => {
    it('uses an authoritative null to resume a public local draft, but does not infer absence from RPC failure', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', payload, session)
        vi.mocked(client.note).mockRejectedValue(new Error('RPC unavailable')); mocks.note = null
        const view = render(<PublicAuthoring store={store} client={client} scope={scope} />)
        // The start check has settled once the reader replaces the loading skeleton.
        await screen.findByRole('heading', { name: 'Published reader' }); expect(client.note).toHaveBeenCalledOnce()
        expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByText('Creation controls')).toBeNull(); expect(screen.queryByText('Update controls')).toBeNull()
        view.unmount(); vi.mocked(client.note).mockResolvedValue(null)
        render(<PublicAuthoring store={store} client={client} scope={scope} />); expect(await screen.findByLabelText('Note title')).toHaveValue('My title')
    })
    it('keeps a local draft reachable, and says why, while the published note cannot be read', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', payload, session)
        vi.mocked(client.note).mockRejectedValue(new Error('RPC unavailable')); mocks.note = null
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        expect(await screen.findByText(/published note could not be read/)).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: /draft|edit/i })); expect(await screen.findByLabelText('Note title')).toHaveValue('My title')
    })
    it('leaves the loading page when this device does not answer, and says its drafts could not be read', async () => {
        const { store, client } = setup(); vi.spyOn(store, 'getDraft').mockReturnValue(new Promise(() => {})); mocks.timeoutMs = 200
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        expect(await screen.findByText('Drafts on this device could not be read. Their saved copies were kept.')).toBeVisible()
        expect(screen.getByRole('heading', { name: 'Published reader' })).toBeVisible(); expect(screen.queryByText('Loading note…')).toBeNull()
        expect(await screen.findByRole('button', { name: 'Edit' })).toBeEnabled()
    })
    it('keeps the message a confirmation set after Published → View note', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, base: currentBase }, session)
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit(); await screen.findByText('Update controls')
        const signing = mocks.publish!
        // Another window replaced the draft: the baseline cannot move, and the confirmation says so.
        vi.spyOn(store, 'saveDraft').mockResolvedValueOnce({ status: 'conflict' })
        const confirmed = { ...note, stateRevision: '4', bodyRevision: '4', body: utf8('My text') }
        await act(async () => { signing.onPublished!(confirmed); signing.onProgress!({ kind: 'publish', title: 'My title', chainId: scope.chainId, step: 'done', revision: '4' }) })
        const message = /Published as revision 4\. Your draft changed meanwhile/
        expect(await screen.findByText(message)).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'View note' }))
        expect(screen.queryByRole('dialog', { name: 'Published' })).toBeNull(); expect(screen.getByRole('heading', { name: 'Published reader' })).toBeVisible()
        expect(screen.getByText(message)).toBeVisible()
    })
    it('returns to the read page once the publication is confirmed, before View note (F19)', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, base: currentBase }, session)
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit(); await screen.findByText('Update controls')
        expect(editor()).toBeVisible()
        const confirmed = { ...note, stateRevision: '4', bodyRevision: '4', title: utf8('My title'), body: utf8('My text') }
        mocks.note = confirmed
        await act(async () => { mocks.publish!.onPublished!(confirmed); mocks.publish!.onProgress!({ kind: 'publish', title: 'My title', chainId: scope.chainId, step: 'done', revision: '4' }) })
        expect(screen.getByRole('heading', { name: 'Published reader' })).toBeVisible()
        expect(screen.queryByRole('region', { name: 'Draft editor' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'View note' }))
        expect(screen.queryByRole('dialog', { name: 'Published' })).toBeNull(); expect(screen.getByRole('heading', { name: 'Published reader' })).toBeVisible()
    })
    describe('a draft based on an older revision than the published one (F21)', () => {
        it('never calls the newer published text unpublished changes, and offers to open or discard the draft', async () => {
            const { store, session, client } = setup(); await store.saveDraft(scope, '0', payload, session)
            mocks.plan.mockResolvedValue({ kind: 'conflict', latest: note, fields: ['body'], baseRevision: '1', theirs: { title: 'Published title', body: 'Published body' } })
            render(<PublicAuthoring store={store} client={client} scope={scope} />)
            expect(await screen.findByText('Your draft on this device is based on revision 1 — revision 3 is published.')).toBeVisible()
            expect(screen.queryByText(/Unpublished changes/)).toBeNull()
            expect(screen.getByText(/^Draft on this device · based on revision 1$/)).toBeVisible()
            expect(screen.getByRole('button', { name: 'Open my draft' })).toBeEnabled()
            const ask = vi.spyOn(window, 'confirm').mockReturnValue(true)
            fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
            await waitFor(async () => expect(await store.getDraft(scope)).toBeNull()); expect(ask).toHaveBeenCalledOnce()
            await waitFor(() => expect(screen.queryByText(/Your draft on this device is based on revision 1/)).toBeNull())
            expect(screen.queryByText(/Draft on this device/)).toBeNull()
        })
        it('says a deleted note keeps its draft here and offers to remove it (F32)', async () => {
            const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, base: currentBase }, session)
            mocks.note = { ...note, stateRevision: '4', deleted: true, body: new Uint8Array() }
            render(<PublicAuthoring store={store} client={client} scope={scope} />)
            expect(await screen.findByText('This note was deleted. Your draft of it is still on this device.')).toBeVisible()
            expect(screen.queryByText(/Unpublished changes/)).toBeNull()
            vi.spyOn(window, 'confirm').mockReturnValue(true)
            fireEvent.click(screen.getByRole('button', { name: 'Remove my draft' }))
            await waitFor(async () => expect(await store.getDraft(scope)).toBeNull())
            await waitFor(() => expect(screen.queryByText(/This note was deleted/)).toBeNull())
        })
        it('never follows silently over text typed while the comparison ran (another window)', async () => {
            const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, title: 'Old title', body: 'Old body' }, session)
            const compared = deferred<void>()
            mocks.plan.mockImplementation(async () => {
                const stored = await store.getDraft(scope)
                await store.saveDraft(scope, stored!.localRevision, { ...payload, title: 'Old title', body: 'Typed meanwhile' }, session); compared.resolve()
                return { kind: 'replace', latest: note, title: 'Published title', body: 'Published body' }
            })
            render(<PublicAuthoring store={store} client={client} scope={scope} />)
            let done = false; void compared.promise.then(() => { done = true })
            await waitFor(() => expect(done).toBe(true)); await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
            expect((await store.getDraft(scope))?.payload).toMatchObject({ body: 'Typed meanwhile', base: { stateRevision: '1' } })
        })
        it('follows the published text silently when the draft holds nothing of its own', async () => {
            const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, title: 'Old title', body: 'Old body' }, session)
            mocks.plan.mockResolvedValue({ kind: 'replace', latest: note, title: 'Published title', body: 'Published body' })
            render(<PublicAuthoring store={store} client={client} scope={scope} />)
            await waitFor(async () => expect((await store.getDraft(scope))?.payload).toMatchObject({ title: 'Published title', body: 'Published body', base: { stateRevision: '3' } }))
            await screen.findByRole('heading', { name: 'Published reader' })
            expect(screen.queryByText(/Unpublished changes|based on revision 1/)).toBeNull()
        })
    })
    it('opens a draft of the latest revision unchanged and never drops unpublished text when leaving the editor', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, base: currentBase }, session)
        const save = vi.spyOn(store, 'saveDraft')
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit()
        expect(await screen.findByLabelText('Note title')).toHaveValue('My title'); expect(save).not.toHaveBeenCalled()
        expect(await within(editor()).findByText(/^Unpublished changes · .* · based on revision 3$/)).toBeVisible()
        fireEvent.change(screen.getByLabelText('Markdown editor'), { target: { value: 'Unsaved words' } })
        const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' })); expect(ask).toHaveBeenCalledOnce()
        expect(screen.getByLabelText('Markdown editor')).toHaveValue('Unsaved words'); expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
        await waitFor(async () => expect((await store.getDraft(scope))?.payload).toMatchObject({ body: 'Unsaved words', base: currentBase }))
    })
    it('starts from the latest revision when an older draft has no unpublished changes', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, title: 'Published title', body: 'Published body', base: sameContentBase }, session)
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit()
        expect(await screen.findByLabelText('Note title')).toHaveValue('Published title')
        expect(await within(editor()).findByText(/^No unpublished changes · .* · based on revision 3$/)).toBeVisible()
        expect((await store.getDraft(scope))?.payload).toMatchObject({ body: 'Published body', base: { stateRevision: '3' } })
        expect(await screen.findByText('Update controls')).toBeVisible()
    })
    it('rebases an older draft automatically when its changes do not overlap', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, base: sameContentBase }, session)
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit()
        expect(await screen.findByText('Updated to revision 3. other published a change while you were editing; your changes are kept.')).toBeVisible()
        expect(await screen.findByLabelText('Note title')).toHaveValue('My title')
        expect((await store.getDraft(scope))?.payload).toMatchObject({ title: 'My title', body: 'My text', base: { stateRevision: '3' } })
    })
    it('keeps the user text on overlapping changes and explains who published what', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', payload, session)
        const actor = 'g1747xyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzabcd'
        mocks.plan.mockResolvedValue({ kind: 'conflict', latest: { ...note, actor }, fields: ['body'], baseRevision: '1', theirs: { title: 'Published title', body: 'Published body' } })
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit()
        expect(await screen.findByRole('alert')).toHaveTextContent('Someone published a newer version (revision 3 by g1747…abcd) that changes the same lines as you. Your text is kept.')
        expect(await screen.findByLabelText('Note title')).toHaveValue('My title')
        expect((await store.getDraft(scope))?.localRevision).toBe('1')
        // Their version is shown before either choice exists.
        expect(screen.queryByRole('button', { name: 'Use my version' })).toBeNull(); expect(screen.queryByText('Published body')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'See changes' }))
        // Each column shows its own side: their published lines under their revision, the user's lines under "Your version".
        const column = (heading: RegExp) => screen.getByRole('heading', { name: heading }).closest('.os-notes-version') as HTMLElement
        expect(within(column(/^Revision 3 · g1747…abcd$/)).getByText('Published body')).toBeVisible()
        expect(within(column(/^Revision 3 · g1747…abcd$/)).queryByText('My text')).toBeNull()
        expect(within(column(/^Your version$/)).getByText('My text')).toBeVisible()
        expect(within(column(/^Your version$/)).queryByText('Published body')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Use my version' }))
        await waitFor(async () => expect((await store.getDraft(scope))?.payload).toMatchObject({ title: 'My title', body: 'My text', base: { stateRevision: '3' } }))
        expect(await screen.findByText(/Your version now follows revision 3/)).toBeVisible()
        expect(screen.queryByText(/Someone published a newer version/)).toBeNull()
    })
    it('names the overlapping lines of the user text in the banner (F25)', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', payload, session)
        const overlap = [{ line: 3, text: '- nori (B)' }, { line: 5, text: null }, { line: 9, text: 'x'.repeat(50) }, { line: 12, text: '' }]
        mocks.plan.mockResolvedValue({ kind: 'conflict', latest: { ...note, actor: 'other' }, fields: ['body'], baseRevision: '1', theirs: { title: 'Published title', body: 'Published body' }, lines: overlap })
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit()
        expect(await screen.findByRole('alert')).toHaveTextContent(`that changes the same lines as you: your lines 3 “- nori (B)”, 5 (removed), 9 “${'x'.repeat(39)}…” and 1 more. Your text is kept.`)
    })
    it('can start from the latest revision while saving the conflicting text as a separate draft', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', payload, session)
        mocks.plan.mockResolvedValue({ kind: 'conflict', latest: { ...note, actor: 'wallet' }, fields: ['title', 'body'], baseRevision: '1', theirs: { title: 'Published title', body: 'Published body' } })
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit()
        expect(await screen.findByRole('alert')).toHaveTextContent('(revision 3 by you, from another window or device) that changes the title and the text as you. Your text is kept.')
        fireEvent.click(screen.getByRole('button', { name: 'See changes' })); fireEvent.click(screen.getByRole('button', { name: 'Use this version' }))
        await waitFor(async () => expect((await store.getDraft(scope))?.payload).toMatchObject({ title: 'Published title', body: 'Published body', base: { stateRevision: '3' } }))
        const copies = (await store.listDrafts(scope)).filter(draft => draft.scope.noteId !== scope.noteId)
        // F26: the copy is told apart from the note in the list, and its page says where it came from.
        expect(copies).toHaveLength(1); expect(copies[0].payload).toEqual({ kind: 'public', title: 'My title (my version)', body: 'My text', copyOf: { noteId: scope.noteId, title: 'Published title' } })
    })
    it('never offers the creation panel for a note that already exists', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', { kind: 'public', title: 'Draft before creation', body: 'Different text' }, session)
        mocks.plan.mockResolvedValue({ kind: 'conflict', latest: { ...note, actor: 'other' }, fields: ['title', 'body'], baseRevision: null, theirs: { title: 'Published title', body: 'Published body' } })
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit()
        await screen.findByText(/Someone published a newer version/)
        expect(await screen.findByLabelText('Note title')).toHaveValue('Draft before creation')
        expect(screen.queryByText('Creation controls')).toBeNull()
    })
    it('opens a creation draft directly while its note is not published yet', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', { kind: 'public', title: 'New', body: 'Text' }, session); mocks.note = null
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        expect(await screen.findByLabelText('Note title')).toHaveValue('New'); expect(await screen.findByText('Creation controls')).toBeVisible()
    })
    it('ends a stuck preparation with a visible message', async () => {
        const { store, client } = setup(); render(<PublicAuthoring store={store} client={client} scope={scope} />)
        const button = await screen.findByRole('button', { name: 'Edit' }); vi.mocked(client.note).mockReturnValue(new Promise(() => {}))
        mocks.timeoutMs = 200; fireEvent.click(button)
        expect(screen.getByRole('button', { name: 'Opening…' })).toBeDisabled()
        expect(await screen.findByText(/network did not answer in time/)).toBeVisible(); expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
        expect(await store.getDraft(scope)).toBeNull()
    })
    it('permits community editing only after the content guard and saves the exact fresh baseline', async () => {
        const { store, client } = setup(); render(<StrictMode><PublicAuthoring store={store} client={client} scope={scope} /></StrictMode>)
        // The Edit button's own check also asks: only the guard run by preparation counts here.
        const button = await screen.findByRole('button', { name: 'Edit' }); mocks.permission.mockClear(); fireEvent.click(button)
        expect(await screen.findByLabelText('Note title')).toHaveValue('Published title')
        expect((await store.getDraft(scope))?.payload).toMatchObject({ body: 'Published body', base: { stateRevision: '3' } })
        expect(mocks.permission).toHaveBeenCalledWith(client, note, 'wallet')
    })
    it('refuses a capability revoked between Edit visibility and preparation', async () => {
        const { store, client } = setup(); render(<PublicAuthoring store={store} client={client} scope={scope} />)
        const button = await screen.findByRole('button', { name: 'Edit' }); mocks.permission.mockResolvedValue(false); fireEvent.click(button)
        await screen.findByText(/The owner closed editing of this note\. Nothing was saved\./); expect(await store.getDraft(scope)).toBeNull()
        expect(screen.queryByRole('textbox')).toBeNull()
    })
    it('does not overwrite an intervening tab draft between slot read and fresh note read', async () => {
        const { store, session, client } = setup()
        vi.mocked(client.note).mockImplementation(async () => { await store.saveDraft(scope, '0', { ...payload, body: 'Other tab' }, session); return note })
        render(<PublicAuthoring store={store} client={client} scope={scope} />); await edit()
        await screen.findByText(/Another window changed/); expect((await store.getDraft(scope))?.payload).toMatchObject({ body: 'Other tab' })
    })
    it('drops a late edit after scope ABA and never writes into the reopened workspace', async () => {
        const { store, client } = setup(), pending = deferred<ChainNote | null>()
        vi.mocked(client.note).mockReturnValueOnce(pending.promise)
        const view = render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit(); await waitFor(() => expect(client.note).toHaveBeenCalledOnce())
        view.rerender(<PublicAuthoring store={store} client={client} scope={{ ...scope, owner: 'other-wallet' }} />)
        view.rerender(<PublicAuthoring store={store} client={client} scope={scope} />)
        await act(async () => pending.resolve(note)); expect(await store.getDraft(scope)).toBeNull()
    })
    it('restores historical bytes only into a new draft with current baseline, preserving any existing draft', async () => {
        const { store, client } = setup(); const view = render(<PublicAuthoring store={store} client={client} scope={scope} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Restore archived draft' }))
        expect(await screen.findByLabelText('Note title')).toHaveValue('Archived title')
        expect((await store.getDraft(scope))?.payload).toMatchObject({ body: 'Archived body', base: { stateRevision: '3' } })
        view.unmount(); render(<PublicAuthoring store={store} client={client} scope={scope} />)
        // The restored draft now differs from the published note: it is never replaced by another restore.
        fireEvent.click(await screen.findByRole('button', { name: 'Restore archived draft' })); await screen.findByText(/has unpublished changes, so it was not replaced/)
        expect((await store.getDraft(scope))?.localRevision).toBe('1')
    })
    it('restores over a draft that has no unpublished changes', async () => {
        const { store, session, client } = setup()
        await store.saveDraft(scope, '0', { kind: 'public', title: 'Published title', body: 'Published body', base: currentBase }, session)
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Restore archived draft' }))
        expect(await screen.findByLabelText('Note title')).toHaveValue('Archived title')
        await waitFor(async () => expect((await store.getDraft(scope))?.payload).toMatchObject({ title: 'Archived title', body: 'Archived body', base: { stateRevision: '3' } }))
        expect((await store.getDraft(scope))?.localRevision).toBe('2')
    })
    it('rebases a stale draft when its publication is reviewed, without opening a review', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, base: currentBase }, session)
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit(); await screen.findByText('Update controls')
        mocks.note = { ...note, stateRevision: '4' }
        await publish()
        expect(await screen.findByText('Updated to revision 4. other published a change while you were editing; your changes are kept. Check it, then press Publish again.')).toBeVisible()
        expect(mocks.answered).toHaveBeenCalledWith(null); expect(mocks.reviewed).not.toHaveBeenCalled()
        await screen.findByText('Update controls'); await publish()
        expect(mocks.reviewed).toHaveBeenCalledOnce()
    })
    it('explains a conflict found at review time instead of preparing forever', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, base: currentBase }, session)
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit(); await screen.findByText('Update controls')
        mocks.note = { ...note, stateRevision: '5', actor: 'g1747xyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyzabcd' }
        mocks.plan.mockResolvedValue({ kind: 'conflict', latest: mocks.note, fields: ['body'], baseRevision: '3', theirs: { title: 'Published title', body: 'A: buy avocados' } })
        await publish()
        expect(await screen.findByRole('alert')).toHaveTextContent('Someone published a newer version (revision 5 by g1747…abcd) that changes the same lines as you. Your text is kept.')
        expect(screen.getByLabelText('Note title')).toHaveValue('My title'); expect(mocks.answered).toHaveBeenCalledWith(null); expect(mocks.reviewed).not.toHaveBeenCalled()
        expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull(); expect(screen.getByRole('button', { name: 'Choose a version to publish' })).toBeDisabled()
    })
    it('never moves a draft backward when the network answers with an older revision', async () => {
        const { store, session, client } = setup(); const sixth = { ...currentBase, stateRevision: '6' }
        await store.saveDraft(scope, '0', { ...payload, base: sixth }, session); mocks.note = { ...note, stateRevision: '5' }
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit()
        expect(await screen.findByText(/It has not shown revision 6 of your draft yet/)).toBeVisible()
        expect(await screen.findByLabelText('Note title')).toHaveValue('My title')
        expect(await store.getDraft(scope)).toMatchObject({ localRevision: '1', payload: { title: 'My title', body: 'My text', base: sixth } })
        expect(screen.queryByRole('button', { name: /Bring in revision/ })).toBeNull(); expect(screen.queryByRole('button', { name: /Use this version/ })).toBeNull()
        const reads = vi.mocked(client.note).mock.calls.length
        await publish()
        expect(client.note.mock.calls.length).toBeGreaterThan(reads); expect(screen.getByText(/It has not shown revision 6 of your draft yet\. Nothing was changed and your text is kept/)).toBeVisible()
        expect(mocks.answered).toHaveBeenCalledWith(null); expect(mocks.reviewed).not.toHaveBeenCalled(); expect((await store.getDraft(scope))?.localRevision).toBe('1')
    })
    it('opens the saved draft as it is when the latest revision cannot be checked', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', payload, session)
        mocks.plan.mockRejectedValue(new Error('history unavailable'))
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit()
        expect(await screen.findByText(/latest revision could not be checked\. Your draft was opened as it is/)).toBeVisible()
        expect(await screen.findByLabelText('Note title')).toHaveValue('My title'); expect((await store.getDraft(scope))?.localRevision).toBe('1')
    })
    it('confirms a publication and moves the baseline even when typing remounted the publish panel', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, base: currentBase }, session)
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit(); await screen.findByText('Update controls')
        const signing = mocks.publish!, requestSignal = signing.requestSession!.capture().signal
        // The wallet closed and verification runs; the user keeps typing, which unmounts the panel.
        fireEvent.change(screen.getByLabelText('Markdown editor'), { target: { value: 'My text, typed while verifying' } })
        expect(screen.queryByText('Update controls')).toBeNull(); expect(requestSignal.aborted).toBe(false)
        const confirmed = { ...note, stateRevision: '4', bodyRevision: '4', body: utf8('My text') }
        await act(async () => signing.onPublished!(confirmed))
        await waitFor(async () => expect((await store.getDraft(scope))?.payload).toMatchObject({ body: 'My text, typed while verifying', base: { stateRevision: '4', bodyRevision: '4' } }))
        expect(await within(editor()).findByText(/based on revision 4$/)).toBeVisible(); expect(screen.queryByText(/Your draft changed meanwhile|did not confirm the draft update/)).toBeNull()
        expect(screen.getByLabelText('Markdown editor')).toHaveValue('My text, typed while verifying')
    })
    it('keeps the newest answer for the live note: a later lagging read never moves it backward', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, base: currentBase }, session)
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit(); await screen.findByText('Update controls')
        const slow = deferred<ChainNote | null>()
        vi.mocked(client.note).mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ ...note, stateRevision: '5' })
        act(() => announceNoteChange({ chainId: scope.chainId, noteId: scope.noteId }))
        act(() => announceNoteChange({ chainId: scope.chainId, noteId: scope.noteId }))
        expect(await screen.findByText(/Revision 5 was published while you were editing/)).toBeVisible()
        await act(async () => slow.resolve({ ...note, stateRevision: '4' }))
        mocks.note = note
        act(() => announceNoteChange({ chainId: scope.chainId, noteId: scope.noteId }))
        await waitFor(() => expect(vi.mocked(client.note).mock.calls.length).toBeGreaterThanOrEqual(5))
        expect(screen.getByText(/Revision 5 was published while you were editing/)).toBeVisible()
    })
    it('notices a newer revision while editing and updates the draft with one button', async () => {
        const { store, session, client } = setup(); await store.saveDraft(scope, '0', { ...payload, base: currentBase }, session)
        render(<PublicAuthoring store={store} client={client} scope={scope} />)
        await edit(); await screen.findByText('Update controls')
        mocks.note = { ...note, stateRevision: '4' }
        act(() => announceNoteChange({ chainId: scope.chainId, noteId: scope.noteId, stateRevision: '4' }))
        expect(await screen.findByText(/Revision 4 was published while you were editing \(you started from revision 3\)/)).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Bring in revision 4' }))
        expect(await screen.findByText('Updated to revision 4. other published a change while you were editing; your changes are kept.')).toBeVisible()
        expect((await store.getDraft(scope))?.payload).toMatchObject({ title: 'My title', body: 'My text', base: { stateRevision: '4' } })
    })
})
