import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { NativeViewProps } from '../../native/types'
import { createNotesStore, type NotesStore } from '../../../lib/notes/drafts'
import { PublicNotesApp } from './publicNative'

// The Notes window around the private panel: who sees the entry, and the key controller's lifetime.
type Controller = { owner: string; chainId: string; dispose: ReturnType<typeof vi.fn>; lock: ReturnType<typeof vi.fn> }
const mocks = vi.hoisted(() => ({ build: true, open: true, controllers: [] as Controller[], loads: 0, store: null as unknown as NotesStore, note: null as unknown }))
const deployment = { realm: 'gno.land/r/samcrew/memba_notes_rc1', version: 1 as const }
vi.mock('../../../lib/notes/config', async original => ({ ...await original<typeof import('../../../lib/notes/config')>(),
    NOTES_ENABLED: true, PRIVATE_CHAINS: ['onyx-1', 'test-chain'], notesDeployment: () => deployment,
    privateNotesDeployment: (chainId: string) => mocks.build && mocks.open && ['onyx-1', 'test-chain'].includes(chainId) ? deployment : null,
    get loadPrivateNotes() {
        return mocks.build ? async () => {
            mocks.loads++
            return {
                createIdentityController: (client: { chainId: string }, owner: string) => { const c = { owner, chainId: client.chainId, dispose: vi.fn(), lock: vi.fn() }; mocks.controllers.push(c); return c },
                PrivateNotesPanel: ({ owner, controller }: { owner: string; controller: Controller }) => <p>Private panel for {owner} on {controller.chainId}</p>,
                PrivateNoteView: ({ note, controller }: { note: { id: string }; controller: Controller }) => <p>Private reader of {note.id.slice(0, 4)} for {controller.owner}</p>,
                SharedWithMe: ({ owner }: { owner: string }) => <p>Shared with {owner}</p>,
            }
        } : null
    },
}))
vi.mock('../../../lib/notes/drafts', async original => {
    const module = await original<typeof import('../../../lib/notes/drafts')>()
    const shared = new Proxy({}, { get: (_, key) => { const value = Reflect.get(mocks.store, key); return typeof value === 'function' ? value.bind(mocks.store) : value } })
    return { ...module, createNotesStore: (options?: Parameters<typeof module.createNotesStore>[0]) => options ? module.createNotesStore(options) : shared }
})
vi.mock('../../../lib/rpcFallback', () => ({ getRpcUrlsInOrder: () => ['https://rpc.invalid'] }))
vi.mock('../../../lib/notes/chain/client', () => ({ NotesReadClient: class {
    chainId: string; realm = deployment.realm; note = async () => mocks.note; commentsRaw = async () => ({ items: [], next_cursor: '' }); byOwner = async () => ({ items: [], nextCursor: '' }); publicNotes = async () => ({ items: [], nextCursor: '' })
    constructor(context: { chainId: string }) { this.chainId = context.chainId }
    assertCurrent() {}
} }))
// A private note on chain: the window hands its reader to the authoring page (the plain placeholder when it hands none).
vi.mock('./PublicAuthoring', () => ({ PublicAuthoring: ({ encrypted }: { encrypted?(note: { id: string; mode: number }): unknown }) =>
    <><p>Public authoring</p>{encrypted ? <>{encrypted({ id: 'ab'.repeat(16), mode: 0 }) as never}</> : <p>Private note placeholder</p>}</> }))
vi.mock('./PublicOperationStatus', () => ({ PublicOperationStatus: () => null }))
vi.mock('../../sign/signerContext', () => ({ useSigner: () => ({ sign: () => false, version: 0 }) }))
const id = 'ab'.repeat(16)
function props(session: Partial<NativeViewProps['session']>, chainId = 'onyx-1') {
    return { session: { status: 'member', address: 'g1owner', network: { chainId }, ...session } as NativeViewProps['session'], section: id, fallback: <p>Fallback</p>, onOpenNote: vi.fn(), onShowList: vi.fn(), active: true }
}
beforeEach(() => { mocks.note = null; mocks.build = true; mocks.open = true; mocks.controllers = []; mocks.loads = 0; mocks.store = createNotesStore({ indexedDB: new IDBFactory() }) })
afterEach(async () => { cleanup(); await mocks.store.close() })

describe('private notes entry in the Notes window', () => {
    it('a guest on a private note sees its encrypted comments as placeholders where the gate is open, and nothing where it is closed', async () => {
        mocks.note = { id, owner: 'g1owner', pendingOwner: '', ownerGeneration: '1', mode: 1, stateRevision: '3', titleRevision: '1', bodyRevision: '1', epoch: '1', title: new Uint8Array(99), body: new Uint8Array(99),
            commitment: new Uint8Array(32), deleted: false, listed: false, createdHeight: '1', operationId: '22'.repeat(16), actor: 'g1owner', height: '2' }
        const view = render(<PublicNotesApp {...props({ status: 'guest', address: '' })} />)
        expect(await screen.findByRole('region', { name: 'Encrypted comments' })).toBeVisible(); expect(screen.getByRole('tab', { name: /Comments/ })).toBeVisible()
        expect(screen.queryByRole('tab', { name: 'History' })).toBeNull()
        cleanup(); mocks.open = false
        view.unmount(); render(<PublicNotesApp {...props({ status: 'guest', address: '' })} />)
        expect(await screen.findByText(/This private note is encrypted/)).toBeVisible(); expect(screen.queryByRole('tab', { name: /Comments/ })).toBeNull()
    })
    it('shows nothing private without the build switch, on a closed network, or to a guest', async () => {
        mocks.build = false
        const view = render(<PublicNotesApp {...props({})} />)
        expect(await screen.findByText('Public authoring')).toBeVisible()
        expect(screen.queryByRole('button', { name: /Private notes/ })).toBeNull(); expect(screen.queryByText('Private')).toBeNull()
        expect(screen.getByText('Private note placeholder')).toBeVisible(); expect(screen.queryByText(/Shared with/)).toBeNull()
        mocks.build = true; mocks.open = false
        view.rerender(<PublicNotesApp {...props({}, 'gnoland-1')} />)
        expect(await screen.findByText('Public authoring')).toBeVisible()
        expect(screen.queryByRole('button', { name: /Private notes/ })).toBeNull(); expect(screen.getByText('Private note placeholder')).toBeVisible()
        mocks.open = true
        view.rerender(<PublicNotesApp {...props({ status: 'guest', address: '' })} />)
        await waitFor(() => expect(screen.queryByText('Public authoring')).toBeNull())
        expect(screen.queryByRole('button', { name: /Private notes/ })).toBeNull()
        expect(mocks.loads).toBe(0); expect(mocks.controllers).toHaveLength(0)
    })
    it('opens the panel from the sidebar and keeps one key controller per account and network, disposed when either changes or the window closes', async () => {
        const view = render(<PublicNotesApp {...props({})} />)
        fireEvent.click(await screen.findByRole('button', { name: /Private notes/ }))
        expect(await screen.findByText('Private panel for g1owner on onyx-1')).toBeVisible()
        expect(mocks.controllers).toHaveLength(1)
        view.rerender(<PublicNotesApp {...props({})} />)
        expect(mocks.controllers).toHaveLength(1); expect(mocks.controllers[0].dispose).not.toHaveBeenCalled()
        // Another account: the first key is disposed (zeroed) and the panel closes.
        view.rerender(<PublicNotesApp {...props({ address: 'g1other' })} />)
        await waitFor(() => expect(mocks.controllers[0].dispose).toHaveBeenCalledTimes(1))
        expect(screen.queryByText(/Private panel for g1owner/)).toBeNull()
        await waitFor(() => expect(mocks.controllers.map(c => c.owner)).toEqual(['g1owner', 'g1other']))
        // Another network.
        view.rerender(<PublicNotesApp {...props({ address: 'g1other' }, 'test-chain')} />)
        await waitFor(() => expect(mocks.controllers[1].dispose).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(mocks.controllers).toHaveLength(3))
        // Window closed (Memba's lock closes every window too).
        view.unmount()
        expect(mocks.controllers[2].dispose).toHaveBeenCalledTimes(1)
        expect(mocks.controllers.every(c => c.dispose.mock.calls.length === 1)).toBe(true)
    })
    it('locks the key when the page is hidden or left, even while another note is on screen', async () => {
        const view = render(<PublicNotesApp {...props({})} />)
        fireEvent.click(await screen.findByRole('button', { name: /Private notes/ }))
        expect(await screen.findByText('Private panel for g1owner on onyx-1')).toBeVisible()
        // Explore: the private panel unmounts, the controller stays with the window.
        fireEvent.click(screen.getByRole('button', { name: /Public notes/ }))
        await waitFor(() => expect(screen.queryByText(/Private panel/)).toBeNull())
        act(() => { window.dispatchEvent(new Event('pagehide')) })
        expect(mocks.controllers[0].lock).toHaveBeenCalledTimes(1)
        // A disposed controller no longer listens.
        view.unmount(); act(() => { window.dispatchEvent(new Event('pagehide')) })
        expect(mocks.controllers[0].lock).toHaveBeenCalledTimes(1)
    })
    it('opens a private note in the private reader with the window\'s key controller, and lists notes shared with this account', async () => {
        render(<PublicNotesApp {...props({})} />)
        expect(await screen.findByText('Private reader of abab for g1owner')).toBeVisible()
        expect(screen.queryByText('Private note placeholder')).toBeNull()
        expect(screen.getByText('Shared with g1owner')).toBeVisible()
        expect(mocks.controllers).toHaveLength(1)
    })
})
