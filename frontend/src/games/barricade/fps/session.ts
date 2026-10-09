import { apply, init, tick } from '../sim/fps/engine'
import { localStateDigest, replay } from '../sim/fps/replay'
import { EYE, FIRE_INTERVAL, FPS_RULESET, FPS_VERSION, MAX_EVENTS, terminal, type Event, type Impact, type Input, type Replay } from '../sim/fps/types'

export type Status = 'ready' | 'playing' | 'paused' | 'done'
export function aimDirection(yaw: number, pitch: number) {
    // Trig is presentation/input conversion only. Replay consumes these integers.
    const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180
    return { x: Math.round(Math.sin(y) * Math.cos(p) * 10_000), y: Math.round(Math.sin(p) * 10_000), z: -Math.round(Math.cos(y) * Math.cos(p) * 10_000) }
}

/** Single live advance path; renderer only calls read(). HUD subscribers are throttled. */
export function createSession(seed: string) {
    let state = init(seed), previous = state, status: Status = 'ready'
    let yaw = 0, pitch = 0, alpha = 0, firing = false, ready = false, limited = false
    let impact: Impact | undefined, impactId = 0, verified = false
    const events: Event[] = [], keys = new Set<string>(), listeners = new Set<() => void>()
    const snapshot = () => ({ state, status, ready, limited, verified })
    let hud = snapshot()
    const notify = () => { hud = snapshot(); listeners.forEach(fn => fn()) }
    const clear = () => { firing = false; keys.clear() }
    const record = (input: Input) => {
        if (status !== 'playing' || limited) return
        if (events.length >= MAX_EVENTS) { limited = true; status = 'paused'; clear(); notify(); return }
        const result = apply(state, input)
        if (result.state === state) return // Rejected/no-op commands cannot flood the log.
        events.push({ ...input, tick: state.tick })
        state = result.state
        if (result.impact) { impact = result.impact; impactId++ }
    }
    const log = (): Replay => ({ ruleset: FPS_RULESET, version: FPS_VERSION, seed, events: events.slice(), finalTick: state.tick })
    return {
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
        getSnapshot: () => hud,
        read: () => ({ state, previous, status, yaw, pitch, direction: aimDirection(yaw, pitch), alpha, impact, impactId, eye: EYE }),
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
