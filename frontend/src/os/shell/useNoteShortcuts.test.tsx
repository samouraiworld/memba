import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ChainNote } from '../../lib/notes/chain/schema'
import { readNoteShortcuts, writeNoteShortcuts } from './noteShortcuts'
import { useNoteShortcuts } from './useNoteShortcuts'

const mocks = vi.hoisted(() => ({ meta: vi.fn(), contexts: [] as { isCurrent(): boolean }[], deployed: true }))
vi.mock('../../lib/notes/config', () => ({ NOTE_ID: /^[0-9a-f]{32}$/, notesDeployment: () => mocks.deployed ? { realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 } : null }))
vi.mock('../../lib/rpcFallback', () => ({ getRpcUrlsInOrder: () => ['https://rpc.invalid'] }))
vi.mock('../../lib/notes/chain/client', () => ({ NotesReadClient: class {
    noteMetadata = mocks.meta
    constructor(context: { isCurrent(): boolean }) { mocks.contexts.push(context) }
} }))

const pub = 'ab'.repeat(16), priv = 'cd'.repeat(16), gone = 'ef'.repeat(16)
const meta = (id: string, patch: Partial<ChainNote> = {}): ChainNote => ({ id, owner: 'g1owner', pendingOwner: '', ownerGeneration: '1', mode: 3, stateRevision: '2', titleRevision: '1', bodyRevision: '1', epoch: '0',
    title: new TextEncoder().encode('Sushi'), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '1', operationId: '12'.repeat(16), actor: 'g1owner', height: '3', ...patch })

beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks(); mocks.contexts = []; mocks.deployed = true
    mocks.meta.mockImplementation(async (id: string) => id === pub ? meta(pub) : id === priv ? meta(priv, { mode: 1 }) : null)
})

it('labels public shortcuts from the chain and marks private ones', async () => {
    const { result } = renderHook(() => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids: [pub, priv, gone], enabled: true }))
    await waitFor(() => expect(result.current.labels[pub]).toBe('Sushi'))
    await waitFor(() => expect(result.current.privateNotes.has(priv)).toBe(true))
    expect(result.current.labels[priv]).toBeUndefined(); expect(result.current.labels[gone]).toBeUndefined()
    expect(mocks.meta).toHaveBeenCalledTimes(3)
})

it('shows the cached title at once and reads each shortcut only once per desk', async () => {
    writeNoteShortcuts('test-chain', 'g1me', { [pub]: { title: 'Cached sushi', private: false, missing: false } }, [pub])
    let resolve!: (value: ChainNote) => void
    mocks.meta.mockReturnValueOnce(new Promise<ChainNote>(done => { resolve = done }))
    const { result, rerender } = renderHook(({ ids }) => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids, enabled: true }), { initialProps: { ids: [pub] } })
    expect(result.current.labels[pub]).toBe('Cached sushi')
    await act(async () => resolve(meta(pub, { title: new TextEncoder().encode('Fresh sushi') })))
    await waitFor(() => expect(result.current.labels[pub]).toBe('Fresh sushi'))
    rerender({ ids: [pub, priv] })
    await waitFor(() => expect(result.current.privateNotes.has(priv)).toBe(true))
    expect(mocks.meta.mock.calls.map(call => call[0])).toEqual([pub, priv])
})

it('never re-reads a note already cached as private', async () => {
    writeNoteShortcuts('test-chain', 'g1me', { [priv]: { title: null, private: true, missing: false } }, [priv, pub])
    const { result } = renderHook(() => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids: [priv, pub], enabled: true }))
    expect(result.current.privateNotes.has(priv)).toBe(true)
    await waitFor(() => expect(result.current.labels[pub]).toBe('Sushi'))
    expect(mocks.meta.mock.calls.map(call => call[0])).toEqual([pub])
})

it('reads nothing when Notes is off for this network or the desk owner is unknown', async () => {
    renderHook(() => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids: [pub], enabled: false }))
    renderHook(() => useNoteShortcuts({ chainId: 'test-chain', owner: undefined, ids: [pub], enabled: true }))
    mocks.deployed = false
    renderHook(() => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids: [pub], enabled: true }))
    await new Promise(done => setTimeout(done, 20))
    expect(mocks.meta).not.toHaveBeenCalled()
})

it('drops a late answer after the wallet changes', async () => {
    let resolve!: (value: ChainNote) => void
    mocks.meta.mockReturnValueOnce(new Promise<ChainNote>(done => { resolve = done }))
    const { result, rerender } = renderHook(({ owner }) => useNoteShortcuts({ chainId: 'test-chain', owner, ids: [pub], enabled: true }), { initialProps: { owner: 'g1me' as string | null } })
    await waitFor(() => expect(mocks.contexts).toHaveLength(1))
    rerender({ owner: 'g1other' })
    expect(mocks.contexts[0].isCurrent()).toBe(false)
    await act(async () => resolve(meta(pub, { title: new TextEncoder().encode('Stale') })))
    await waitFor(() => expect(result.current.labels[pub]).toBe('Sushi'))
})

it('forgets a removed shortcut again once the desk confirms the removal, even if a read landed in between', async () => {
    let resolve!: (value: ChainNote) => void
    mocks.meta.mockReturnValueOnce(new Promise<ChainNote>(done => { resolve = done }))
    const { result, rerender } = renderHook(({ ids }) => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids, enabled: true }), { initialProps: { ids: [pub, priv] } })
    await waitFor(() => expect(mocks.meta).toHaveBeenCalledOnce())
    // Unpinning forgets the title at once; a featured desk confirms the removal only later, and the read lands in between.
    act(() => result.current.forget(pub))
    expect(readNoteShortcuts('test-chain', 'g1me')[pub]).toBeUndefined()
    await act(async () => resolve(meta(pub)))
    await waitFor(() => expect(readNoteShortcuts('test-chain', 'g1me')[pub]).toBeDefined())
    rerender({ ids: [priv] })
    await waitFor(() => expect(readNoteShortcuts('test-chain', 'g1me')[pub]).toBeUndefined())
    expect(readNoteShortcuts('test-chain', 'g1me')[priv]).toEqual({ title: null, private: true, missing: false })
})
