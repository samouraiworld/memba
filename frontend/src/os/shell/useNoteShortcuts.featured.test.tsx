/** The real featured Desktop: its removal confirms asynchronously while a shortcut title read is still in flight. */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_NETWORK } from '../../lib/config'
import { bech32Encode } from '../../lib/dao/realmAddress'
import type { ChainNote } from '../../lib/notes/chain/schema'
import type { FeaturedLocks } from '../../lib/notes/featuredNoteStorage'
import { readNoteShortcuts } from './noteShortcuts'
import { useDesk } from './useDesk'
import { useNoteShortcuts } from './useNoteShortcuts'

const mocks = vi.hoisted(() => ({ meta: vi.fn() }))
vi.mock('../../lib/notes/config', async original => ({ ...await original<typeof import('../../lib/notes/config')>(), NOTES_ENABLED: true,
    notesDeployment: () => ({ realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 }) }))
vi.mock('../../lib/rpcFallback', () => ({ getRpcUrlsInOrder: () => ['https://rpc.invalid'] }))
vi.mock('../../lib/notes/chain/client', () => ({ NotesReadClient: class { noteMetadata = mocks.meta } }))

const owner = bech32Encode('g', new Uint8Array(20).fill(1)), chainId = 'test-chain', note = 'ab'.repeat(16)
const meta = (id: string): ChainNote => ({ id, owner, pendingOwner: '', ownerGeneration: '1', mode: 3, stateRevision: '2', titleRevision: '1', bodyRevision: '1', epoch: '0',
    title: new TextEncoder().encode('Sushi'), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '1', operationId: '12'.repeat(16), actor: owner, height: '3' })

/** Serial Web Locks whose next request can be held, so the Desktop's write is still pending on demand. */
function serialLocks() {
    let tail: Promise<unknown> = Promise.resolve(), next: Promise<void> | null = null
    const locks: FeaturedLocks = { request: (_name, _options, work) => {
        const gate = next; next = null
        const result = tail.then(async () => { if (gate) await gate; return work() })
        tail = result.catch(() => {}); return result
    } }
    return { locks, hold: () => { let release!: () => void; next = new Promise<void>(resolve => { release = resolve }); return release }, idle: () => tail }
}
let scheduler: ReturnType<typeof serialLocks>
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); scheduler = serialLocks(); vi.stubGlobal('navigator', { locks: scheduler.locks }) })
afterEach(() => { vi.unstubAllGlobals() })
async function settled() { await act(async () => { await scheduler.idle() }) }

// The Shell's wiring: the desk's note items feed the shortcut labels, and removing one forgets its title first.
function useDesktop() {
    const desk = useDesk(owner, DEFAULT_NETWORK, { chainId, gno: true, adopt: true, releases: [] })
    const shortcuts = useNoteShortcuts({ chainId, owner, ids: desk.items.filter(item => item.ty === 'note').map(item => item.ref), enabled: true })
    const remove = (index: number) => { const item = desk.items[index]; if (item?.ty === 'note') shortcuts.forget(item.ref); desk.unpin(index) }
    return { desk, shortcuts, remove }
}

it('a note shortcut removed from the featured Desktop while its title read is pending leaves no cached title', async () => {
    let resolve!: (value: ChainNote) => void
    mocks.meta.mockReturnValueOnce(new Promise<ChainNote>(done => { resolve = done }))
    const { result } = renderHook(useDesktop)
    await settled()
    expect(result.current.desk.enabled).toBe(true)
    act(() => result.current.desk.pin({ ty: 'note', ref: note }))
    await settled()
    await waitFor(() => expect(mocks.meta).toHaveBeenCalledOnce())
    // The removal waits on the Desktop lock; the title read lands meanwhile.
    const release = scheduler.hold()
    act(() => result.current.remove(result.current.desk.items.findIndex(item => item.ref === note)))
    expect(readNoteShortcuts(chainId, owner)[note]).toBeUndefined()
    await act(async () => resolve(meta(note)))
    await waitFor(() => expect(readNoteShortcuts(chainId, owner)[note]?.title).toBe('Sushi'))
    expect(result.current.desk.items.some(item => item.ref === note)).toBe(true)
    release(); await settled()
    await waitFor(() => expect(result.current.desk.items.some(item => item.ref === note)).toBe(false))
    await waitFor(() => expect(readNoteShortcuts(chainId, owner)[note]).toBeUndefined())
    expect(localStorage.getItem(`memba_os_note_shortcuts:v1:${chainId}:${owner}`)).not.toContain('Sushi')
    expect(mocks.meta).toHaveBeenCalledOnce()
})
