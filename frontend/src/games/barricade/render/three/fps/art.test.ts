import { describe, expect, it } from 'vitest'
import { actorKit, batchKey, streetKit, weaponKit } from './art'
import { groupParts, surfacePixels } from './Batches'

describe('C2 original art structure (not a rendered performance claim)', () => {
    it('bounds instances and geometry/material batches rather than one draw per part', () => {
        const street = streetKit(), actors = [...actorKit('crs', 0, true), ...actorKit('crs', 0, false), ...actorKit('robot', 0, false)]
        const batches = groupParts(street).size + new Set(actors.map(batchKey)).size + groupParts(weaponKit).size
        expect(street.length).toBeGreaterThan(600); expect(batches).toBeLessThanOrEqual(32)
        for (const parts of [street, actors, weaponKit]) for (const p of parts) {
            expect([...p.at, ...p.size, ...(p.rotate ?? [])].every(Number.isFinite)).toBe(true)
            expect(p.size.every(n => n > 0)).toBe(true)
        }
        for (const kind of ['crs', 'robot'] as const) for (const bucket of groupParts(actorKit(kind, 0, true)).values()) expect(bucket.length).toBeLessThanOrEqual(32)
    })
    it('keeps the sensor fixed across poses and removes the frontal shield when open', () => {
        for (const walk of [0, 1, 2, 3]) {
            const sensor = actorKit('robot', walk, false).find(p => p.finish === 'light')!
            expect(sensor.at).toEqual([0, 1.315, .44]); expect(sensor.size).toEqual([.36, .33, .06])
        }
        const shield = (open: boolean) => actorKit('crs', 0, !open).find(p => p.size[0] === .94 && p.size[1] === .92)
        expect(shield(false)?.at).toEqual([0, .96, .42]); expect(shield(true)).toBeUndefined()
    })
    it('creates deterministic original texture data with a small fixed memory budget', () => {
        const a = surfacePixels('stone'), b = surfacePixels('stone')
        expect(a.byteLength).toBe(64 * 64 * 4); expect(a).toEqual(b)
        expect(a).not.toEqual(surfacePixels('wood'))
    })
})
