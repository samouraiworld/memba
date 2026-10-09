import { Box3, Euler, Matrix4, Ray, Vector3, BoxGeometry, SphereGeometry, CylinderGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { AXIS_START, AXIS_END, SPAWN_Z, CONTACT_Z, EYE } from '../../../sim/fps/types'
import { actorKit, batchKey, streetKit, weaponKit } from './art'
import { groupParts, surfacePixels } from './Batches'

describe('C3 original art structure (not a rendered performance claim)', () => {
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
    it('keeps sight lines to all three paths clear of the decorative streetscape', () => {
        const eye = new Vector3(EYE.x / 1000, EYE.y / 1000, EYE.z / 1000)
        const box = new Box3(new Vector3(-.5, -.5, -.5), new Vector3(.5, .5, .5))
        const shapes = streetKit().map(p => {
            const matrix = new Matrix4().makeRotationFromEuler(new Euler(...(p.rotate ?? [0, 0, 0]), p.rotationOrder ?? 'XYZ'))
            matrix.scale(new Vector3(...p.size)); matrix.setPosition(...p.at)
            return { part: p, matrix, inverse: matrix.clone().invert() }
        })
        for (let axis = 0; axis < 3; axis++) for (let t = 0; t <= 20; t++) for (const y of [1.315, 1.67]) {
            const target = new Vector3((AXIS_START[axis] + (AXIS_END[axis] - AXIS_START[axis]) * t / 20) / 1000, y, (SPAWN_Z + (CONTACT_Z - SPAWN_Z) * t / 20) / 1000)
            const ray = new Ray(eye, target.clone().sub(eye).normalize())
            for (const { part, matrix, inverse } of shapes) {
                const hit = ray.clone().applyMatrix4(inverse).intersectBox(box, new Vector3())
                if (hit) expect(hit.applyMatrix4(matrix).distanceTo(eye), JSON.stringify({ axis, t, part })).toBeGreaterThan(target.distanceTo(eye))
            }
        }
    })
    it('reports a bounded source triangle estimate at the sixteen-enemy renderer cap', () => {
        const geometries = { box: new BoxGeometry(1, 1, 1), sphere: new SphereGeometry(.5, 10, 6), cylinder: new CylinderGeometry(.5, .5, 1, 8) }
        const triangles = (parts: ReturnType<typeof streetKit>) => parts.reduce((n, p) => n + geometries[p.shape].index!.count / 3, 0)
        const street = streetKit(), staticTriangles = triangles(street), actorTriangles = Math.max(triangles(actorKit('crs', 0, true)), triangles(actorKit('robot', 0, false)))
        const total = staticTriangles + actorTriangles * 16 + triangles(weaponKit)
        console.info(JSON.stringify({ sourceOnly: true, staticInstances: street.length, staticTriangles, actorTriangles, worst16Triangles: total }))
        expect(street.length).toBeLessThan(2600); expect(total).toBeLessThan(60000)
        for (const geometry of Object.values(geometries)) geometry.dispose()
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
