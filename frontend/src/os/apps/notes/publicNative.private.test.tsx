import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { NativeViewProps } from '../../native/types'
import { createNotesStore, type NotesStore } from '../../../lib/notes/drafts'
import { PublicNotesApp } from './publicNative'

// The Notes window around the private panel: who sees the entry, and the key controller's lifetime.
type Controller = { owner: string; chainId: string; dispose: ReturnType<typeof vi.fn>; lock: ReturnType<typeof vi.fn> }
const mocks = vi.hoisted(() => ({ build: true, open: true, controllers: [] as Controller[], loads: 0, store: null as unknown as NotesStore }))
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
    chainId: string; realm = deployment.realm; note = async () => null; byOwner = async () => ({ items: [], nextCursor: '' }); publicNotes = async () => ({ items: [], nextCursor: '' })
    constructor(context: { chainId: string }) { this.chainId = context.chainId }
    assertCurrent() {}
} }))
vi.mock('./PublicAuthoring', () => ({ PublicAuthoring: () => <p>Public authoring</p> }))
vi.mock('./PublicOperationStatus', () => ({ PublicOperationStatus: () => null }))
const id = 'ab'.repeat(16)
function props(session: Partial<NativeViewProps['session']>, chainId = 'onyx-1') {
    return { session: { status: 'member', address: 'g1owner', network: { chainId }, ...session } as NativeViewProps['session'], section: id, fallback: <p>Fallback</p>, onOpenNote: vi.fn(), onShowList: vi.fn(), active: true }
}
beforeEach(() => { mocks.build = true; mocks.open = true; mocks.controllers = []; mocks.loads = 0; mocks.store = createNotesStore({ indexedDB: new IDBFactory() }) })
afterEach(async () => { cleanup(); await mocks.store.close() })

describe('private notes entry in the Notes window', () => {
    it('shows nothing private without the build switch, on a closed network, or to a guest', async () => {
        mocks.build = false
        const view = render(<PublicNotesApp {...props({})} />)
        expect(await screen.findByText('Public authoring')).toBeVisible()
        expect(screen.queryByRole('button', { name: /Private notes/ })).toBeNull(); expect(screen.queryByText('Private')).toBeNull()
        mocks.build = true; mocks.open = false
        view.rerender(<PublicNotesApp {...props({}, 'gnoland-1')} />)
        expect(await screen.findByText('Public authoring')).toBeVisible()
        expect(screen.queryByRole('button', { name: /Private notes/ })).toBeNull()
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
})
