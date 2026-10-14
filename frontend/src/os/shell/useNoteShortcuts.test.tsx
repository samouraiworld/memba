import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ChainNote } from '../../lib/notes/chain/schema'
import { announceNoteChange } from '../../lib/notes/freshness'
import { readNoteShortcuts, writeNoteShortcuts } from './noteShortcuts'
import { useNoteShortcuts } from './useNoteShortcuts'

const mocks = vi.hoisted(() => ({ meta: vi.fn(), contexts: [] as { isCurrent(): boolean }[], deployed: true, listening: 0 }))
// Counts live change subscriptions, so a test can see the hook let go of its listener.
vi.mock('../../lib/notes/freshness', async original => {
    const real = await original<typeof import('../../lib/notes/freshness')>()
    return { ...real, onNoteChange: (listener: Parameters<typeof real.onNoteChange>[0]) => {
        const stop = real.onNoteChange(listener); mocks.listening++
        return () => { mocks.listening--; stop() }
    } }
})
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

const titled = (id: string, title: string, stateRevision: string, patch: Partial<ChainNote> = {}) => meta(id, { title: new TextEncoder().encode(title), stateRevision, ...patch })
const LAGGING = { timeout: 5000 }

it('follows a note that becomes public once its change is announced, without ever showing a private title', async () => {
    writeNoteShortcuts('test-chain', 'g1me', { [priv]: { title: null, private: true, missing: false } }, [priv])
    const { result } = renderHook(() => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids: [priv], enabled: true }))
    expect(result.current.privateNotes.has(priv)).toBe(true)
    // Another note's change, or the same id on another network, reads nothing; this note's own change does.
    act(() => { announceNoteChange({ chainId: 'test-chain', noteId: pub }); announceNoteChange({ chainId: 'other-chain', noteId: priv }) })
    act(() => announceNoteChange({ chainId: 'test-chain', noteId: priv }))
    await waitFor(() => expect(readNoteShortcuts('test-chain', 'g1me')[priv]).toEqual({ title: null, private: true, missing: false }))
    expect(mocks.meta.mock.calls.map(call => call[0])).toEqual([priv])
    // Still private after that change: the lock stays and no title is shown or stored.
    expect(result.current.privateNotes.has(priv)).toBe(true); expect(result.current.labels[priv]).toBeUndefined()
    expect(localStorage.getItem('memba_os_note_shortcuts:v1:test-chain:g1me')).not.toContain('Sushi')
    // Published: the shortcut takes the public title.
    mocks.meta.mockResolvedValueOnce(titled(priv, 'Now public', '3'))
    act(() => announceNoteChange({ chainId: 'test-chain', noteId: priv, stateRevision: '3' }))
    await waitFor(() => expect(result.current.labels[priv]).toBe('Now public'))
    expect(result.current.privateNotes.has(priv)).toBe(false)
    expect(readNoteShortcuts('test-chain', 'g1me')[priv]).toEqual({ title: 'Now public', private: false, missing: false })
})

it('labels a shortcut pinned before its note was published once the publication is announced, waiting out a lagging node', async () => {
    mocks.meta.mockResolvedValueOnce(null)
    const { result } = renderHook(() => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids: [gone], enabled: true }))
    await waitFor(() => expect(readNoteShortcuts('test-chain', 'g1me')[gone]).toEqual({ title: null, private: false, missing: true }))
    // The first node answer is still behind the announced revision.
    mocks.meta.mockResolvedValueOnce(null).mockResolvedValueOnce(titled(gone, 'Fresh note', '1'))
    act(() => announceNoteChange({ chainId: 'test-chain', noteId: gone, stateRevision: '1' }))
    await waitFor(() => expect(result.current.labels[gone]).toBe('Fresh note'), LAGGING)
    expect(mocks.meta).toHaveBeenCalledTimes(3)
})

it('never lets a lagging node answer older than a title already shown replace it', async () => {
    mocks.meta.mockResolvedValueOnce(titled(pub, 'A', '4'))
    const { result } = renderHook(() => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids: [pub], enabled: true }))
    await waitFor(() => expect(result.current.labels[pub]).toBe('A'))
    mocks.meta.mockResolvedValueOnce(titled(pub, 'B', '5'))
    act(() => announceNoteChange({ chainId: 'test-chain', noteId: pub, stateRevision: '5' }))
    await waitFor(() => expect(result.current.labels[pub]).toBe('B'))
    // A comment is announced without a revision; every node answer is still revision 4.
    mocks.meta.mockResolvedValue(titled(pub, 'A', '4'))
    act(() => announceNoteChange({ chainId: 'test-chain', noteId: pub }))
    await waitFor(() => expect(mocks.meta).toHaveBeenCalledTimes(7), LAGGING)
    await act(async () => { await new Promise(done => setTimeout(done, 0)) })
    expect(result.current.labels[pub]).toBe('B')
    expect(readNoteShortcuts('test-chain', 'g1me')[pub]?.title).toBe('B')
}, 10_000)

it('keeps a publication pending when the node is still behind after every retry, and reads it again on the next announcement or visit', async () => {
    writeNoteShortcuts('test-chain', 'g1me', { [priv]: { title: null, private: true, missing: false } }, [priv])
    const view = renderHook(() => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids: [priv], enabled: true }))
    // Every answer is the private revision 2, below the published revision 3.
    act(() => announceNoteChange({ chainId: 'test-chain', noteId: priv, stateRevision: '3' }))
    await waitFor(() => expect(mocks.meta).toHaveBeenCalledTimes(5), LAGGING)
    await act(async () => { await new Promise(done => setTimeout(done, 0)) })
    // Nothing older than the announcement is stored, and the private mark no longer stops a later read.
    expect(readNoteShortcuts('test-chain', 'g1me')[priv]).toEqual({ title: null, private: false, missing: false })
    expect(view.result.current.labels[priv]).toBeUndefined()
    // The next announcement (a comment, no revision) still waits for revision 3.
    mocks.meta.mockResolvedValueOnce(titled(priv, 'Published', '3'))
    act(() => announceNoteChange({ chainId: 'test-chain', noteId: priv }))
    await waitFor(() => expect(view.result.current.labels[priv]).toBe('Published'))
    // A later visit reads it too, even if this tab never saw the answer.
    view.unmount()
    writeNoteShortcuts('test-chain', 'g1me', { [priv]: { title: null, private: false, missing: false } }, [priv])
    mocks.meta.mockResolvedValueOnce(titled(priv, 'Published', '3'))
    const again = renderHook(() => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids: [priv], enabled: true }))
    await waitFor(() => expect(again.result.current.labels[priv]).toBe('Published'))
}, 10_000)

it('lets a newer announcement win over a read still in flight', async () => {
    let resolve!: (value: ChainNote) => void
    mocks.meta.mockReturnValueOnce(new Promise<ChainNote>(done => { resolve = done }))
    const { result } = renderHook(() => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids: [pub], enabled: true }))
    await waitFor(() => expect(mocks.meta).toHaveBeenCalledOnce())
    mocks.meta.mockResolvedValueOnce(titled(pub, 'New', '5'))
    act(() => announceNoteChange({ chainId: 'test-chain', noteId: pub, stateRevision: '5' }))
    await waitFor(() => expect(result.current.labels[pub]).toBe('New'))
    await act(async () => resolve(titled(pub, 'Old', '3')))
    expect(result.current.labels[pub]).toBe('New'); expect(readNoteShortcuts('test-chain', 'g1me')[pub]?.title).toBe('New')
})

it('drops the title of a note that is private after its announced change', async () => {
    writeNoteShortcuts('test-chain', 'g1me', { [pub]: { title: 'Sushi', private: false, missing: false } }, [pub])
    const { result } = renderHook(() => useNoteShortcuts({ chainId: 'test-chain', owner: 'g1me', ids: [pub], enabled: true }))
    await waitFor(() => expect(mocks.meta).toHaveBeenCalledOnce())
    mocks.meta.mockResolvedValueOnce(meta(pub, { mode: 1, stateRevision: '3' }))
    act(() => announceNoteChange({ chainId: 'test-chain', noteId: pub, stateRevision: '3' }))
    await waitFor(() => expect(result.current.privateNotes.has(pub)).toBe(true))
    expect(result.current.labels[pub]).toBeUndefined()
    expect(localStorage.getItem('memba_os_note_shortcuts:v1:test-chain:g1me')).not.toContain('Sushi')
})

it('ignores announcements from the network or account it left, and stops listening when unmounted', async () => {
    mocks.meta.mockResolvedValueOnce(titled(pub, 'Nine', '9'))
    writeNoteShortcuts('test-chain', 'g1me', { [pub]: { title: 'Sushi', private: false, missing: false } }, [pub])
    const view = renderHook(({ chainId, owner }) => useNoteShortcuts({ chainId, owner, ids: [pub], enabled: true }), { initialProps: { chainId: 'test-chain', owner: 'g1me' } })
    await waitFor(() => expect(view.result.current.labels[pub]).toBe('Nine'))
    act(() => announceNoteChange({ chainId: 'test-chain', noteId: pub, stateRevision: '9' }))
    // (Let that read start first: the test runner can hand a concurrent dynamic import the unmocked client.)
    await waitFor(() => expect(mocks.meta).toHaveBeenCalledTimes(2))
    // Another account on the same network: the revision seen by the first account does not hold its reads back.
    view.rerender({ chainId: 'test-chain', owner: 'g1other' })
    await waitFor(() => expect(view.result.current.labels[pub]).toBe('Sushi'))
    // Another network: the old network's announcement reads nothing; this network's does.
    view.rerender({ chainId: 'other-chain', owner: 'g1other' })
    await waitFor(() => expect(view.result.current.labels[pub]).toBe('Sushi'))
    const before = mocks.meta.mock.calls.length
    mocks.meta.mockResolvedValueOnce(titled(pub, 'Elsewhere', '2'))
    act(() => { announceNoteChange({ chainId: 'test-chain', noteId: pub, stateRevision: '10' }); announceNoteChange({ chainId: 'other-chain', noteId: pub, stateRevision: '2' }) })
    await waitFor(() => expect(view.result.current.labels[pub]).toBe('Elsewhere'))
    expect(mocks.meta.mock.calls.length).toBe(before + 1)
    expect(mocks.listening).toBe(1)
    view.unmount()
    expect(mocks.listening).toBe(0)
})
