import { describe, expect, it } from 'vitest'
import { apply, init, tick } from './engine'
import { enemyBoxes, position, rayBox, shieldUp, trace, validDirection } from './collision'
import { localStateDigest, replay } from './replay'
import { EYE, FPS_RULESET, FPS_VERSION, MAGAZINE, MAX_ENEMIES, MAX_TICKS, RELOAD_TICKS, WAVE_COUNTS, terminal, type Enemy, type Event, type Replay, type State, type Vec3 } from './types'

const enemy = (overrides: Partial<Enemy> = {}): Enemy => ({ id: 1, axis: 1, kind: 'robot', progress: 6000, speed: 5, hp: 68, ...overrides })
const directionTo = (point: Vec3): Vec3 => {
    const delta = { x: point.x - EYE.x, y: point.y - EYE.y, z: point.z - EYE.z }
    const scale = Math.max(Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.z))
    return { x: Math.round(delta.x * 10_000 / scale), y: Math.round(delta.y * 10_000 / scale), z: Math.round(delta.z * 10_000 / scale) }
}
function log(seed: string, events: Event[], finalTick: number): Replay { return { ruleset: FPS_RULESET, version: FPS_VERSION, seed, events, finalTick } }

describe('FPS integer ray collisions', () => {
    it('accepts bounded forward integers only', () => {
        expect(validDirection({ x: 0, y: 0, z: -10_000 })).toBe(true)
        for (const d of [{ x: NaN, y: 0, z: -1000 }, { x: 0.5, y: 0, z: -1000 }, { x: 10_001, y: 0, z: -1000 }, { x: 0, y: 0, z: 0 }]) expect(validDirection(d)).toBe(false)
    })
    it('handles parallel misses, boundary rays and boxes behind the eye', () => {
        const box = { min: { x: 0, y: 1500, z: -2000 }, max: { x: 100, y: 1800, z: -1000 } }
        expect(rayBox({ x: 0, y: 0, z: -10_000 }, box)).not.toBeNull()
        expect(rayBox({ x: 0, y: 0, z: -10_000 }, { ...box, min: { ...box.min, x: 1 } })).toBeNull()
        expect(rayBox({ x: 0, y: 0, z: -10_000 }, { min: { x: -1, y: 1500, z: 2000 }, max: { x: 1, y: 1800, z: 3000 } })).toBeNull()
    })
    it.each([0, 1, 2] as const)('hits the actual free-aim target on axis %s', axis => {
        const target = enemy({ axis }), p = position(target)
        expect(trace(directionTo({ ...p, y: 1650 }), [target], 0)?.enemy.id).toBe(1)
        expect(trace(directionTo({ ...p, x: p.x + 2000, y: 1650 }), [target], 0)).toBeNull()
    })
    it('resolves the closest hit and stable ID tie independently of iteration order', () => {
        const near = enemy({ id: 2, progress: 8000 }), far = enemy({ id: 1, progress: 2000 })
        expect(trace({ x: 0, y: 0, z: -10_000 }, [far, near], 0)?.enemy.id).toBe(2)
        const same = { ...near, id: 3 }
        expect(trace({ x: 0, y: 0, z: -10_000 }, [same, near], 0)?.enemy.id).toBe(2)
    })
    it('the CRS shield blocks body shots and drops on its deterministic clock', () => {
        const target = enemy({ kind: 'crs', hp: 102 }), p = position(target)
        const d = directionTo({ ...p, y: 1000 })
        expect(shieldUp(target, 0)).toBe(true)
        expect(trace(d, [target], 0)?.part).toBe('shield')
        expect(trace(d, [target], 150)?.part).toBe('body')
        expect(trace(directionTo({ ...p, y: 1650 }), [target], 0)?.part).toBe('weak')
    })
    it('keeps hitbox dimensions stable when health changes', () => {
        expect(enemyBoxes(enemy({ hp: 1 }), 0)).toEqual(enemyBoxes(enemy({ hp: 68 }), 0))
    })
})

describe('FPS combat, repair and replay', () => {
    it('applies manual shots, misses, cooldown and shield impacts without mutation', () => {
        const target = enemy({ kind: 'crs', hp: 102 })
        const s = { ...init('test'), enemies: [target] }, before = structuredClone(s)
        const blocked = apply(s, { type: 'fire', direction: directionTo({ ...position(target), y: 1000 }) })
        expect(blocked.impact?.kind).toBe('shield')
        expect(blocked.state.enemies[0].hp).toBe(102)
        expect(blocked.state.ammo).toBe(MAGAZINE - 1)
        expect(apply(blocked.state, { type: 'fire', direction: { x: 0, y: 0, z: -10_000 } }).state).toBe(blocked.state)
        expect(s).toEqual(before)
    })
    it('cannot fire during reload, and refills only on the scheduled tick', () => {
        const s = apply({ ...init('test'), ammo: 1 }, { type: 'reload' }).state
        expect(apply(s, { type: 'fire', direction: { x: 0, y: 0, z: -10_000 } }).state).toBe(s)
        let n = s
        for (let i = 0; i < RELOAD_TICKS - 1; i++) n = tick(n)
        expect(n.ammo).toBe(1)
        n = tick(n)
        expect(n.ammo).toBe(MAGAZINE)
        expect(n.reloadUntil).toBe(0)
    })
    it('allows one repair only between waves, caps health and cannot waste it at full HP', () => {
        const s = { ...init('test'), hp: 80 }
        expect(apply(s, { type: 'repair' }).state).toBe(s)
        const repaired = apply({ ...s, phase: 'repair' }, { type: 'repair' }).state
        expect(repaired.hp).toBe(100)
        expect(repaired.patchAvailable).toBe(false)
        expect(apply({ ...repaired, hp: 50 }, { type: 'repair' }).state.hp).toBe(50)
        expect(apply({ ...s, phase: 'repair', hp: 100 }, { type: 'repair' }).state.patchAvailable).toBe(true)
    })
    it('requires real hits rather than firing automatically at the current axis', () => {
        const target = enemy(), s = { ...init('test'), enemies: [target], spawned: 1 }
        expect(tick(s).enemies[0].hp).toBe(target.hp)
        const miss = apply(s, { type: 'fire', direction: { x: 9000, y: 4000, z: -1000 } })
        expect(miss.impact?.kind).toBe('miss')
        expect(miss.state.score).toBe(0)
    })
    it('terminates at exactly the cap without an extra unrecorded tick', () => {
        expect(tick({ ...init('test'), tick: MAX_TICKS - 1 }).tick).toBe(MAX_TICKS)
        expect(tick({ ...init('test'), tick: MAX_TICKS - 1 }).phase).toBe('lost')
    })
    it('rejects wrong version, unsorted input, fractional direction and trailing input', () => {
        expect(() => replay({ ...log('test', [], 1), version: 2 } as unknown as Replay)).toThrow()
        expect(() => replay(log('test', [{ type: 'reload', tick: 2 }, { type: 'reload', tick: 1 }], 4))).toThrow()
        expect(() => replay(log('test', [{ type: 'fire', tick: 0, direction: { x: 0.1, y: 0, z: -1000 } }], 1))).toThrow()
        expect(() => replay(log('test', [{ type: 'reload', tick: 1 }], 1))).toThrow()
    })
    it('completes all three axes/waves and verifies the exact free-play journal', () => {
        let s = init('c1-test'), steps = 0
        const events: Event[] = [], axes = new Set<number>()
        function input(event: Event) { events.push(event); s = apply(s, event).state }
        while (!terminal(s) && steps++ <= MAX_TICKS) {
            s.enemies.forEach(e => axes.add(e.axis))
            if (s.phase === 'repair') input({ type: 'continue', tick: s.tick })
            if (s.phase === 'wave' && !s.reloadUntil) {
                if (!s.ammo) input({ type: 'reload', tick: s.tick })
                else if (s.tick >= s.fireAt && s.enemies.length) {
                    const target = s.enemies[0], p = position(target)
                    input({ type: 'fire', tick: s.tick, direction: directionTo({ ...p, y: target.kind === 'crs' ? 1650 : 1300 }) })
                }
            }
            s = tick(s)
            expect(s.enemies.length).toBeLessThanOrEqual(MAX_ENEMIES)
        }
        expect(s.phase).toBe('won')
        expect(s.wave).toBe(WAVE_COUNTS.length - 1)
        expect([...axes].sort()).toEqual([0, 1, 2])
        expect(s.kills).toBe(27)
        expect(localStateDigest(replay(log(s.seed, events, s.tick)))).toBe(localStateDigest(s))
    })
    it('bounds and terminates unattended runs for 100 seeds', () => {
        for (let seed = 0; seed < 100; seed++) {
            let s: State = init(`seed-${seed}`)
            let peak = 0
            while (!terminal(s)) {
                s = tick(s)
                peak = Math.max(peak, s.enemies.length)
            }
            expect(peak).toBeLessThanOrEqual(MAX_ENEMIES)
            expect(s.tick).toBeLessThanOrEqual(MAX_TICKS)
            expect(localStateDigest(replay(log(s.seed, [], s.tick)))).toBe(localStateDigest(s))
        }
    })
})
