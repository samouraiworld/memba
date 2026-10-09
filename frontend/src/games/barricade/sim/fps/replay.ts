import { apply, init, tick } from './engine'
import { validDirection } from './collision'
import { FPS_RULESET, FPS_VERSION, MAX_EVENTS, MAX_TICKS, terminal, type Event, type Replay, type State } from './types'

export function hashState(s: State): string {
    const canonical = JSON.stringify([FPS_RULESET, FPS_VERSION, s.seed, s.tick, s.rng, s.phase, s.wave, s.waveStarted,
        s.spawned, s.nextId, s.hp, s.ammo, s.reloadUntil, s.fireAt, s.repairUntil, s.patchAvailable, s.score, s.kills, s.shots,
        s.enemies.map(e => [e.id, e.axis, e.kind, e.progress, e.speed, e.hp])])
    let a = 0x811c9dc5, b = 0x01234567
    for (let i = 0; i < canonical.length; i++) { a = Math.imul(a ^ canonical.charCodeAt(i), 0x01000193); b = Math.imul(b ^ canonical.charCodeAt(i), 0x01000193) }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}
export function validEvent(e: Event): boolean {
    return !!e && Number.isInteger(e.tick) && e.tick >= 0 && e.tick <= MAX_TICKS
        && (e.type === 'fire' ? validDirection(e.direction) : ['reload', 'repair', 'continue'].includes(e.type))
}
export function replay(log: Replay): State {
    if (log.ruleset !== FPS_RULESET || log.version !== FPS_VERSION || typeof log.seed !== 'string' || log.seed.length > 128
        || !Number.isInteger(log.finalTick) || log.finalTick < 0 || log.finalTick > MAX_TICKS + 1
        || !Array.isArray(log.events) || log.events.length > MAX_EVENTS) throw new Error('Unsupported FPS preview replay')
    let last = -1
    for (const event of log.events) {
        if (!validEvent(event) || event.tick < last || event.tick >= log.finalTick) throw new Error('Invalid FPS event order or payload')
        last = event.tick
    }
    let state = init(log.seed), cursor = 0
    while (!terminal(state) && state.tick < log.finalTick) {
        while (cursor < log.events.length && log.events[cursor].tick === state.tick) state = apply(state, log.events[cursor++]).state
        state = tick(state)
    }
    if (cursor !== log.events.length || state.tick !== log.finalTick) throw new Error('FPS replay has trailing input')
    return state
}
