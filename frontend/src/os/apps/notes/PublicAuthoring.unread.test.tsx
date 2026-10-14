import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createDraftSession, createNotesStore, type NotesStore } from '../../../lib/notes/drafts'
import type { NotesReadClient } from '../../../lib/notes/chain/client'
import { PublicAuthoring } from './PublicAuthoring'
// The real reader: what the page shows while the published note cannot be read.
const bound = vi.hoisted(() => ({ ms: 200 }))
vi.mock('../../../lib/notes/chain/publicPermissions', () => ({ readPublicContentWritePermission: vi.fn(async () => true) }))
vi.mock('../terminal/CodeEditor', () => ({ CodeEditor: ({ value, onChange }: { value: string; onChange(value: string): void }) => <textarea aria-label="Markdown editor" value={value} onChange={e => onChange(e.target.value)} /> }))
vi.mock('./MarkdownPreview', () => ({ MarkdownPreview: () => <span>Preview</span> }))
vi.mock('./PublicCommentPanel', () => ({ PublicCommentPanel: () => <span>Comments</span> }))
vi.mock('./PublicHistory', () => ({ PublicHistory: () => <span>History</span> }))
vi.mock('../../../lib/notes/freshness', async original => {
    const actual = await original<typeof import('../../../lib/notes/freshness')>()
    return { ...actual, withTimeout: <T,>(promise: Promise<T>) => actual.withTimeout(promise, bound.ms) }
})
const scope = { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner: 'wallet', noteId: 'ab'.repeat(16) }
const payload = { kind: 'public' as const, title: 'My title', body: 'My text', base: { stateRevision: '3', epoch: '0', titleRevision: '2', bodyRevision: '3', ownerGeneration: '1' } }
const stores: NotesStore[] = []
async function setup() {
    const store = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(store)
    await store.saveDraft(scope, '0', payload, createDraftSession())
    const client = { chainId: scope.chainId, assertCurrent: vi.fn(), note: vi.fn(async () => { throw new Error('RPC unavailable') }) } as unknown as NotesReadClient
    render(<PublicAuthoring store={store} client={client} scope={scope} />)
    expect(await screen.findByText(/This note could not be read/)).toBeVisible()
    return { store, client }
}
beforeEach(() => { vi.clearAllMocks() })
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.close())) })
describe('authoring while the published note cannot be read', () => {
    it('shows why Open my draft did not open the draft', async () => {
        const { store } = await setup()
        vi.spyOn(store, 'getDraftRevision').mockRejectedValue(new Error('storage busy'))
        fireEvent.click(screen.getByRole('button', { name: 'Open my draft' }))
        expect(await screen.findByText('The latest revision could not be checked. Nothing was changed. Try again.')).toBeVisible()
        expect(screen.queryByRole('textbox')).toBeNull()
    })
    it('Cancel goes back to the page, keeping the draft and asking nothing', async () => {
        const { store } = await setup()
        fireEvent.click(screen.getByRole('button', { name: 'Open my draft' }))
        expect(await screen.findByLabelText('Note title')).toHaveValue('My title')
        const ask = vi.spyOn(window, 'confirm')
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull()); expect(ask).not.toHaveBeenCalled()
        expect(screen.getByText(/This note could not be read/)).toBeVisible()
        expect((await store.getDraft(scope))?.payload).toEqual(payload)
        fireEvent.click(screen.getByRole('button', { name: 'Open my draft' })); expect(await screen.findByLabelText('Note title')).toHaveValue('My title')
    })
})
