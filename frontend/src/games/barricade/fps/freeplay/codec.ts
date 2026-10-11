/** Dormant FPS publication codec. Does not alter the C1 simulation or its debug replay. */
import { apply, init, tick } from '../../sim/fps/engine'
import { validDirection } from '../../sim/fps/collision'
import { canonicalState } from '../../sim/fps/replay'
import { FPS_RULESET, FPS_VERSION, MAX_EVENTS, MAX_TICKS, terminal, type Event, type Replay, type State } from '../../sim/fps/types'

export const FPS_REPLAY_CODEC = 'barricade-fps-inputs-v1' as const
export const FPS_STATE_DOMAIN = 'memba:barricade-fps-state:v1' as const
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && !Object.is(n, -0)
const seedPattern = /^[a-zA-Z0-9:_-]{1,128}$/
const codes = { reload: 'R', repair: 'P', continue: 'C' } as const

/** Wire transcript is [finalTick, [[tick,"F",x,y,z], [tick,"R"], ...]]. Seed is in the envelope. */
export function decodeFpsReplay(seed: string, encoded: string): Replay {
    if (typeof seed !== 'string' || !seedPattern.test(seed) || typeof encoded !== 'string' || encoded.length > 1_000_000) throw new Error('invalid_fps_replay')
    let wire: unknown
    try { wire = JSON.parse(encoded) } catch { throw new Error('invalid_fps_replay') }
    if (!Array.isArray(wire) || wire.length !== 2 || !integer(wire[0]) || wire[0] <= 0 || wire[0] > MAX_TICKS
        || !Array.isArray(wire[1]) || wire[1].length > MAX_EVENTS) throw new Error('invalid_fps_replay')
    const events: Event[] = []; let last = -1
    for (const row of wire[1]) {
        if (!Array.isArray(row) || !integer(row[0]) || row[0] < last || row[0] < 0 || row[0] >= wire[0]) throw new Error('invalid_fps_event_order')
        last = row[0]
        if (row[1] === 'F' && row.length === 5 && row.slice(2).every(integer)) {
            const direction = { x: row[2], y: row[3], z: row[4] }
            if (!validDirection(direction)) throw new Error('invalid_fps_direction')
            events.push({ tick: row[0], type: 'fire', direction })
        } else if (row.length === 2 && ['R', 'P', 'C'].includes(row[1])) {
            events.push({ tick: row[0], type: row[1] === 'R' ? 'reload' : row[1] === 'P' ? 'repair' : 'continue' })
        } else throw new Error('invalid_fps_event')
    }
    return { ruleset: FPS_RULESET, version: FPS_VERSION, seed, finalTick: wire[0], events }
}

/** Re-encode parsed primitives; never commit arbitrary JSON property order or whitespace. */
export function canonicalFpsReplay(log: Replay): string {
    if (log.ruleset !== FPS_RULESET || log.version !== FPS_VERSION || !Array.isArray(log.events) || log.events.length > MAX_EVENTS) throw new Error('unsupported_fps_rules')
    const rows = log.events.map(e => e.type === 'fire' ? [e.tick, 'F', e.direction.x, e.direction.y, e.direction.z] : [e.tick, codes[e.type]])
    const encoded = JSON.stringify([log.finalTick, rows])
    // Validate before returning a string; JSON.stringify alone can hide invalid numbers.
    for (const e of log.events) {
        if (!integer(e.tick) || e.type === 'fire' && ![e.direction.x, e.direction.y, e.direction.z].every(integer)) throw new Error('invalid_fps_event')
    }
    if (!integer(log.finalTick)) throw new Error('invalid_fps_replay')
    decodeFpsReplay(log.seed, encoded)
    return encoded
}

/** Certification accepts only actions the engine accepted and a complete terminal run. */
export function verifyFpsTranscript(log: Replay, requireTerminal = true): { state: State; encoded: string; canonicalState: string } {
    const encoded = canonicalFpsReplay(log)
    // Detach from the caller before replaying, including nested direction objects.
    const captured = decodeFpsReplay(log.seed, encoded)
    let state = init(captured.seed), cursor = 0
    while (!terminal(state) && state.tick < captured.finalTick) {
        while (cursor < captured.events.length && captured.events[cursor].tick === state.tick) {
            const result = apply(state, captured.events[cursor++])
            if (result.state === state) throw new Error('rejected_fps_action')
            state = result.state
        }
        state = tick(state)
    }
    if (cursor !== captured.events.length || state.tick !== captured.finalTick) throw new Error('trailing_fps_input')
    if (requireTerminal && !terminal(state)) throw new Error('fps_not_terminal')
    return { state, encoded, canonicalState: canonicalState(state) }
}

export const verifyFpsTerminal = (log: Replay) => verifyFpsTranscript(log, true)
