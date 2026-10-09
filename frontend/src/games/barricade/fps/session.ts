import { apply, init, tick } from '../sim/fps/engine'
import { localStateDigest, replay } from '../sim/fps/replay'
import { verifyFpsTranscript } from './freeplay/codec'
import { EYE, FIRE_INTERVAL, FPS_RULESET, FPS_VERSION, MAX_EVENTS, terminal, type Event, type Impact, type Input, type Replay } from '../sim/fps/types'

export type Status = 'ready' | 'playing' | 'paused' | 'done'
export function aimDirection(yaw: number, pitch: number) {
    // Trig is presentation/input conversion only. Replay consumes these integers.
    const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180
    return { x: Math.round(Math.sin(y) * Math.cos(p) * 10_000) + 0, y: Math.round(Math.sin(p) * 10_000) + 0, z: -Math.round(Math.cos(y) * Math.cos(p) * 10_000) }
}

/** Single live advance path; renderer only calls read(). HUD subscribers are throttled. */
export function createSession(seed: string, restored?: Replay) {
    if (restored && (restored.seed !== seed || restored.ruleset !== FPS_RULESET || restored.version !== FPS_VERSION)) throw new Error('invalid_fps_checkpoint')
    const initial = restored && (restored.finalTick !== 0 || restored.events.length) ? verifyFpsTranscript(restored, false).state : init(seed)
    let state = initial, previous = state, status: Status = terminal(state) ? 'done' : state.tick > 0 ? 'paused' : 'ready'
    let yaw = 0, pitch = 0, alpha = 0, firing = false, ready = false, limited = false
    let impact: Impact | undefined, impactId = 0, verified = terminal(state)
    let effects: readonly { id: number; impact: Impact }[] = []
    const events: Event[] = restored ? restored.events.map(e => e.type === 'fire' ? { ...e, direction: { ...e.direction } } : { ...e }) : [], keys = new Set<string>(), listeners = new Set<() => void>()
    const snapshot = () => ({ state, status, ready, limited, verified })
    let hud = snapshot()
    const notify = () => { hud = snapshot(); listeners.forEach(fn => fn()) }
    const clear = () => { firing = false; keys.clear() }
    const record = (input: Input) => {
        if (status !== 'playing' || limited) return
        if (events.length >= MAX_EVENTS) { limited = true; status = 'paused'; clear(); notify(); return }
        const result = apply(state, input)
        if (result.state === state) return // Rejected/no-op commands cannot flood the log.
        events.push(input.type === 'fire' ? { ...input, direction: { x: input.direction.x + 0, y: input.direction.y + 0, z: input.direction.z + 0 }, tick: state.tick } : { ...input, tick: state.tick })
        state = result.state
        if (result.impact) { impact = result.impact; impactId++; effects = [...effects.slice(-23), { id: impactId, impact }] }
    }
    const log = (): Replay => ({ ruleset: FPS_RULESET, version: FPS_VERSION, seed, events: events.map(e => e.type === 'fire' ? { ...e, direction: { ...e.direction } } : { ...e }), finalTick: state.tick })
    return {
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
        getSnapshot: () => hud,
        read: () => ({ state, previous, status, yaw, pitch, direction: aimDirection(yaw, pitch), alpha, impact, impactId, effects, eye: EYE }),
        setReady() { ready = true; notify() },
        start() { if (!ready || limited || terminal(state)) return; status = 'playing'; clear(); notify() },
        pause() { if (status === 'playing') { status = 'paused'; clear(); notify() } },
        clear,
        aim(dx: number, dy: number) { if (status === 'playing' && state.phase === 'wave') { yaw = Math.max(-65, Math.min(65, yaw + dx)); pitch = Math.max(-35, Math.min(35, pitch + dy)) } },
        fire(down: boolean) { firing = down && status === 'playing' && state.phase === 'wave'; if (firing) { record({ type: 'fire', direction: aimDirection(yaw, pitch) }); notify() } },
        key(key: string, down: boolean) { if (down) keys.add(key); else keys.delete(key) },
        command(input: Input) { record(input); notify() },
        frame(value: number) { alpha = value },
        advance(steps: number) {
            if (status !== 'playing') return
            for (let i = 0; i < steps && !terminal(state); i++) {
                const oldPhase = state.phase
                if (state.phase === 'wave') {
                    yaw = Math.max(-65, Math.min(65, yaw + (Number(keys.has('arrowright')) - Number(keys.has('arrowleft'))) * 0.6))
                    pitch = Math.max(-35, Math.min(35, pitch + (Number(keys.has('arrowup')) - Number(keys.has('arrowdown'))) * 0.45))
                    if ((firing || keys.has(' ')) && state.tick >= state.fireAt) record({ type: 'fire', direction: aimDirection(yaw, pitch) })
                    if (limited) break
                }
                previous = state
                state = tick(state)
                if (state.phase !== oldPhase) { clear(); notify() }
            }
            if (terminal(state)) {
                status = 'done'; clear()
                try { verified = localStateDigest(replay(log())) === localStateDigest(state) } catch { verified = false }
                notify()
            } else if (state.tick % 6 < Math.max(1, steps) || state.tick < FIRE_INTERVAL) notify()
        },
        log,
    }
}
export type Session = ReturnType<typeof createSession>
