import { trace, validDirection } from './collision'
import { FIRE_INTERVAL, MAGAZINE, MAX_ENEMIES, MAX_TICKS, RELOAD_TICKS, REPAIR_TICKS, SPAWN_INTERVAL, WAVE_COUNTS, terminal, type Axis, type Impact, type Input, type State } from './types'

// Frozen C1 RNG: do not couple future edits of Classic's rules to these replays.
function nextRng(value: number): number {
    let x = value >>> 0
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    return (x >>> 0) || 0x9e3779b9
}
export function init(seed: string): State {
    let rng = 0x811c9dc5
    for (let i = 0; i < seed.length; i++) rng = Math.imul(rng ^ seed.charCodeAt(i), 0x01000193) >>> 0
    return { tick: 0, seed, rng: rng || 1, phase: 'wave', wave: 0, waveStarted: 0, spawned: 0, nextId: 1,
        enemies: [], hp: 100, ammo: MAGAZINE, reloadUntil: 0, fireAt: 0, repairUntil: 0,
        patchAvailable: true, score: 0, kills: 0, shots: 0 }
}
function nextWave(s: State): State {
    return { ...s, phase: 'wave', wave: s.wave + 1, waveStarted: s.tick, spawned: 0, ammo: MAGAZINE, reloadUntil: 0 }
}
export function apply(s: State, input: Input): { state: State; impact?: Impact } {
    if (terminal(s)) return { state: s }
    if (input.type === 'repair') {
        return { state: s.phase === 'repair' && s.patchAvailable && s.hp < 100
            ? { ...s, hp: Math.min(100, s.hp + 40), patchAvailable: false } : s }
    }
    if (input.type === 'continue') return { state: s.phase === 'repair' ? nextWave(s) : s }
    if (s.phase !== 'wave') return { state: s }
    if (input.type === 'reload') return { state: s.ammo < MAGAZINE && !s.reloadUntil ? { ...s, reloadUntil: s.tick + RELOAD_TICKS } : s }
    if (input.type !== 'fire' || !validDirection(input.direction) || s.tick < s.fireAt || s.reloadUntil || s.ammo === 0) return { state: s }
    const hit = trace(input.direction, s.enemies, s.tick)
    const damage = hit?.part === 'shield' ? 0 : hit?.part === 'weak' ? 68 : 34
    const killed = !!hit && hit.enemy.hp <= damage
    const state = { ...s, ammo: s.ammo - 1, fireAt: s.tick + FIRE_INTERVAL, shots: s.shots + 1,
        score: s.score + (killed ? hit.enemy.kind === 'crs' ? 150 : 100 : 0), kills: s.kills + (killed ? 1 : 0),
        enemies: hit ? s.enemies.flatMap(e => e.id !== hit.enemy.id ? [e] : killed ? [] : [{ ...e, hp: e.hp - damage }]) : s.enemies }
    return { state, impact: { tick: s.tick, point: hit?.point ?? { x: input.direction.x * 4, y: 1650 + input.direction.y * 4, z: 1800 + input.direction.z * 4 }, kind: hit?.part ?? 'miss', killed } }
}
export function tick(s: State): State {
    if (terminal(s)) return s
    if (s.tick >= MAX_TICKS - 1) return { ...s, tick: MAX_TICKS, phase: 'lost' }
    let n: State = { ...s, tick: s.tick + 1 }
    if (n.reloadUntil && n.tick >= n.reloadUntil) n = { ...n, ammo: MAGAZINE, reloadUntil: 0 }
    if (n.phase === 'repair') return n.tick >= n.repairUntil ? nextWave(n) : n
    const count = WAVE_COUNTS[n.wave]
    if (n.spawned < count && n.tick - n.waveStarted >= n.spawned * SPAWN_INTERVAL && n.enemies.length < MAX_ENEMIES) {
        const rng = nextRng(n.rng)
        const kind = n.spawned % 2 === 0 ? 'crs' : 'robot'
        n = { ...n, rng, spawned: n.spawned + 1, nextId: n.nextId + 1, enemies: [...n.enemies, {
            id: n.nextId, axis: ((n.spawned + n.wave) % 3) as Axis, kind, progress: 0,
            speed: 5 + (rng % 2), hp: kind === 'crs' ? 102 : 68,
        }] }
    }
    let damage = 0
    const enemies = n.enemies.flatMap(e => {
        const progress = e.progress + e.speed
        if (progress >= 10_000) { damage += e.kind === 'crs' ? 12 : 16; return [] }
        return [{ ...e, progress }]
    })
    n = { ...n, enemies, hp: Math.max(0, n.hp - damage) }
    if (!n.hp) return { ...n, phase: 'lost' }
    if (n.spawned === count && !n.enemies.length) {
        return n.wave === WAVE_COUNTS.length - 1 ? { ...n, phase: 'won', score: n.score + 500 }
            : { ...n, phase: 'repair', repairUntil: n.tick + REPAIR_TICKS, score: n.score + 200 }
    }
    return n
}
