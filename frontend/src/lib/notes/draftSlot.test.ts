import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createDraftSession, createNotesStore, type NotesStore } from './drafts'
import { readDraftSlot, saveDraftBounded } from './draftSlot'
import { NotesTimeoutError } from './freshness'
import { bech32Encode } from '../dao/realmAddress'
const scope = { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1', owner: bech32Encode('g', new Uint8Array(20).fill(1)), noteId: 'ab'.repeat(16) }
const payload = { kind: 'public' as const, title: 'Draft', body: 'Text' }, stores: NotesStore[] = []
function setup() { const store = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(store); return { store, session: createDraftSession() } }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.close())) })
describe('recreating a deleted draft without reusing its CAS identity', () => {
    it('recreates a public draft against the retained tombstone generation', async () => {
        const { store, session } = setup()
        await store.saveDraft(scope, '0', payload, session); await store.deleteDraft(scope, '1', session)
        const slot = await readDraftSlot(store, scope, session.capture())
        expect(slot).toEqual({ revision: '2', draft: null })
        const saved = await store.saveDraft(scope, slot.revision, { ...payload, body: 'New text' }, session)
        expect(saved).toMatchObject({ status: 'saved', value: { localRevision: '3' } })
        expect((await store.deleteDraft(scope, '1', session)).status).toBe('conflict')
    })
    it('cannot use a revision acquired after an absent read to overwrite an intervening draft', async () => {
        const { store, session } = setup(), original = store.getDraft.bind(store)
        vi.spyOn(store, 'getDraft').mockImplementationOnce(async location => {
            const absent = await original(location)
            await store.saveDraft(scope, '0', { ...payload, body: 'Other tab' }, session)
            return absent
        })
        const slot = await readDraftSlot(store, scope, session.capture())
        expect(slot).toEqual({ revision: '0', draft: null })
        expect((await store.saveDraft(scope, slot.revision, payload, session)).status).toBe('conflict')
        expect((await store.getDraft(scope))?.payload).toMatchObject({ body: 'Other tab' })
    })
    it('rejects an account lifetime change between the two reads', async () => {
        const { store, session } = setup(), guard = session.capture()
        vi.spyOn(store, 'getDraftRevision').mockImplementation(async () => { session.invalidate(); return '0' })
        const read = vi.spyOn(store, 'getDraft')
        await expect(readDraftSlot(store, scope, guard)).rejects.toThrow('session')
        expect(read).not.toHaveBeenCalled()
    })
})

describe('time-limited draft saves', () => {
    const next = { ...payload, body: 'Merged' }
    function stalled(after: (signal: AbortSignal) => Promise<unknown>, revision = '1', stored = payload) {
        return {
            saveDraft: vi.fn((_scope, _expected, _payload, guard: { signal: AbortSignal }) => new Promise(resolve => guard.signal.addEventListener('abort', () => void after(guard.signal).then(resolve), { once: true }))),
            getDraftRevision: vi.fn(async () => revision),
            getDraft: vi.fn(async () => ({ scope, localRevision: revision, payload: stored, schema: 1, updatedAt: 1 })),
        } as unknown as NotesStore
    }
    it('aborts a save that does not finish in time and reports nothing changed when nothing landed', async () => {
        const store = stalled(async () => ({ status: 'session-changed' }))
        await expect(saveDraftBounded(store, scope, '1', next, createDraftSession().capture(), 20)).rejects.toBeInstanceOf(NotesTimeoutError)
        expect(vi.mocked(store.saveDraft).mock.calls[0][3].signal.aborted).toBe(true)
    })
    it('reports a save that committed while it was being aborted as saved', async () => {
        const committed = stalled(async () => ({ status: 'saved', value: { localRevision: '2' } }))
        expect(await saveDraftBounded(committed, scope, '1', next, createDraftSession().capture(), 20)).toMatchObject({ status: 'saved' })
        const ambiguous = stalled(async () => ({ status: 'session-changed' }), '2', next)
        expect(await saveDraftBounded(ambiguous, scope, '1', next, createDraftSession().capture(), 20)).toMatchObject({ status: 'saved', value: { localRevision: '2' } })
        const other = stalled(async () => ({ status: 'session-changed' }), '2', { ...payload, body: 'Another window' })
        expect(await saveDraftBounded(other, scope, '1', next, createDraftSession().capture(), 20)).toEqual({ status: 'conflict' })
    })
    it('never waits forever for storage after the abort', async () => {
        const store = stalled(() => new Promise(() => {}))
        await expect(saveDraftBounded(store, scope, '1', next, createDraftSession().capture(), 20, 20)).rejects.toBeInstanceOf(NotesTimeoutError)
    })
    it('saves normally within the bound', async () => {
        const { store, session } = setup()
        expect(await saveDraftBounded(store, scope, '0', payload, session.capture())).toMatchObject({ status: 'saved', value: { localRevision: '1' } })
    })
})
