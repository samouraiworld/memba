import { describe, expect, it } from 'vitest'
import type { FreePlayGame, FreePlayInput } from '../../../lib/arcadeFreePlay'
import { createFreePlaySnapshot, listFreePlaySnapshots, loadFreePlaySnapshot, saveFreePlaySnapshot } from './snapshot'
import vectors from './vectors.json'
const fixture = vectors.runs[0]
const indexKey = 'memba:arcade:freeplay:index:v1'
function setup() {
    const data = new Map<string, string>()
    return { data, storage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } } }
}
function snapshot(n: number, game: FreePlayGame = 'block-party') {
    return createFreePlaySnapshot({ ...fixture.input, game, claimedScore: fixture.score, clientRunId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` } as FreePlayInput)
}

describe('shared saved-run index', () => {
    it('discovers the existing canonical snapshots after reload and filters by game', () => {
        const { data, storage } = setup()
        const first = snapshot(1), second = snapshot(2, 'space-invaders')
        saveFreePlaySnapshot(storage, first); saveFreePlaySnapshot(storage, second)
        const reopened = { getItem: (key: string) => data.get(key) ?? null, setItem: storage.setItem }
        expect(listFreePlaySnapshots(reopened).snapshots).toEqual([second, first])
        expect(listFreePlaySnapshots(reopened, { game: 'block-party' }).snapshots).toEqual([first])
        const index = JSON.parse(data.get(indexKey)!)
        expect(index.entries).toEqual([{ clientRunId: second.input.clientRunId, game: 'space-invaders' }, { clientRunId: first.input.clientRunId, game: 'block-party' }])
        expect(Object.keys(index.entries[0]).sort()).toEqual(['clientRunId', 'game'])
    })

    it('bounds each game independently, paginates, deduplicates and preserves older canonical snapshots', () => {
        const { storage } = setup()
        saveFreePlaySnapshot(storage, snapshot(100, 'space-invaders'))
        saveFreePlaySnapshot(storage, snapshot(200, 'barricade'))
        for (let i = 1; i <= 21; i++) saveFreePlaySnapshot(storage, snapshot(i))
        const first = listFreePlaySnapshots(storage, { game: 'block-party', limit: 10 })
        expect(first.total).toBe(20)
        expect(first.snapshots).toHaveLength(10)
        expect(first.nextOffset).toBe(10)
        expect(first.snapshots[0].input.clientRunId).toBe(snapshot(21).input.clientRunId)
        const last = listFreePlaySnapshots(storage, { game: 'block-party', offset: 10 })
        expect(last.snapshots).toHaveLength(10)
        expect(last.nextOffset).toBeUndefined()
        expect(listFreePlaySnapshots(storage, { game: 'space-invaders' }).total).toBe(1)
        expect(listFreePlaySnapshots(storage, { game: 'barricade' }).total).toBe(1)
        expect(loadFreePlaySnapshot(storage, snapshot(1).input.clientRunId)).toEqual(snapshot(1))
        saveFreePlaySnapshot(storage, snapshot(10))
        expect(listFreePlaySnapshots(storage, { game: 'block-party' }).total).toBe(20)
    })

    it('reports missing/corrupt page entries without hiding intact results', () => {
        const { data, storage } = setup()
        for (let i = 1; i <= 3; i++) saveFreePlaySnapshot(storage, snapshot(i))
        data.delete(`memba:arcade:freeplay:v1:${snapshot(1).input.clientRunId}`)
        data.set(`memba:arcade:freeplay:v1:${snapshot(2).input.clientRunId}`, '{broken')
        expect(listFreePlaySnapshots(storage)).toMatchObject({ total: 3, unavailable: 2, snapshots: [snapshot(3)] })
    })

    it('fails closed on malformed/oversized metadata and invalid pagination', () => {
        const { data, storage } = setup()
        for (const bad of ['{', 'x'.repeat(16385), JSON.stringify({ schemaVersion: 1, entries: [{ clientRunId: 'bad', game: 'block-party' }] })]) {
            data.set(indexKey, bad)
            expect(() => listFreePlaySnapshots(storage)).toThrow('invalid_snapshot_index')
        }
        data.delete(indexKey)
        for (const options of [{ limit: 21 }, { offset: -1 }, { limit: 0 }]) expect(() => listFreePlaySnapshots(storage, options)).toThrow('invalid_snapshot_query')
    })

    it('keeps a snapshot loadable by ID if the index quota write fails', () => {
        const { storage } = setup()
        const save = storage.setItem
        storage.setItem = (key, raw) => { if (key === indexKey) throw new DOMException('full', 'QuotaExceededError'); save(key, raw) }
        expect(() => saveFreePlaySnapshot(storage, snapshot(1))).toThrow('full')
        expect(loadFreePlaySnapshot(storage, snapshot(1).input.clientRunId)).toEqual(snapshot(1))
    })
})
