import { AXIS_END, AXIS_START, CONTACT_Z, EYE, SPAWN_Z, type Enemy, type Vec3 } from './types'

/** Millimetres and integer rational comparisons. No Three, trig or GPU raycast. */
export type Box = { min: Vec3; max: Vec3 }
type Fraction = { n: number; d: number }
const compare = (a: Fraction, b: Fraction) => a.n * b.d - b.n * a.d

export function position(e: Enemy): Vec3 {
    return {
        x: AXIS_START[e.axis] + Math.trunc((AXIS_END[e.axis] - AXIS_START[e.axis]) * e.progress / 10_000),
        y: 0,
        z: SPAWN_Z + Math.trunc((CONTACT_Z - SPAWN_Z) * e.progress / 10_000),
    }
}

export function validDirection(v: Vec3): boolean {
    return !!v && [v.x, v.y, v.z].every(n => Number.isInteger(n) && Math.abs(n) <= 10_000)
        && v.z <= -1000
}

/** Slabs stay rational until the display-only impact point. Products <= 6e8 here. */
export function rayBox(direction: Vec3, box: Box): Fraction | null {
    let near: Fraction = { n: 0, d: 1 }
    let far: Fraction = { n: 60_000, d: 1 }
    for (const axis of ['x', 'y', 'z'] as const) {
        const d = direction[axis]
        if (d === 0) {
            if (EYE[axis] < box.min[axis] || EYE[axis] > box.max[axis]) return null
            continue
        }
        const sign = d > 0 ? 1 : -1
        const lo = { n: ((d > 0 ? box.min[axis] : box.max[axis]) - EYE[axis]) * sign, d: Math.abs(d) }
        const hi = { n: ((d > 0 ? box.max[axis] : box.min[axis]) - EYE[axis]) * sign, d: Math.abs(d) }
        if (compare(lo, near) > 0) near = lo
        if (compare(hi, far) < 0) far = hi
        if (compare(near, far) > 0) return null
    }
    return near
}

export function shieldUp(e: Enemy, tick: number): boolean {
    return e.kind === 'crs' && (tick + e.id * 23) % 240 < 150
}

export function enemyBoxes(e: Enemy, tick: number): { box: Box; part: 'body' | 'weak' | 'shield' }[] {
    const p = position(e)
    const at = (x: number, y: number, z: number): Vec3 => ({ x: p.x + x, y, z: p.z + z })
    if (e.kind === 'robot') return [
        { part: 'weak', box: { min: at(-180, 1150, 410), max: at(180, 1480, 470) } },
        { part: 'body', box: { min: at(-470, 300, -400), max: at(470, 1900, 400) } },
    ]
    return [
        ...(shieldUp(e, tick) ? [{ part: 'shield' as const, box: { min: at(-470, 500, 380), max: at(470, 1420, 460) } }] : []),
        { part: 'weak', box: { min: at(-240, 1420, -240), max: at(240, 1870, 300) } },
        { part: 'body', box: { min: at(-350, 250, -280), max: at(350, 1420, 280) } },
    ]
}

export function trace(direction: Vec3, enemies: Enemy[], tick: number) {
    let closest: { distance: Fraction; enemy: Enemy; part: 'body' | 'weak' | 'shield' } | null = null
    for (const enemy of enemies) {
        for (const { box, part } of enemyBoxes(enemy, tick)) {
            const distance = rayBox(direction, box)
            if (!distance) continue
            const order = closest ? compare(distance, closest.distance) : -1
            if (!closest || order < 0 || (order === 0 && enemy.id < closest.enemy.id)) closest = { distance, enemy, part }
        }
    }
    if (!closest) return null
    const { n, d } = closest.distance
    return { enemy: closest.enemy, part: closest.part, point: {
        x: EYE.x + Math.trunc(direction.x * n / d),
        y: EYE.y + Math.trunc(direction.y * n / d),
        z: EYE.z + Math.trunc(direction.z * n / d),
    } }
}
