import { describe, expect, it, vi } from 'vitest'
import { canonicalState } from '../../sim/fps/replay'
import { position } from '../../sim/fps/collision'
import { terminal } from '../../sim/fps/types'
import { createSession } from '../session'
import { createFpsRunConsumer, FPS_ACTIVE_RUN, type FpsRunStorage } from './consumer'
import { canonicalFpsReplay, verifyFpsTerminal } from './codec'
import { createFpsFreePlayBridge, type FpsResultHandle } from './bridge'

const first = 'd22adcc5-32d3-4fe3-85ec-4cb545ca070a', second = '7c2a410e-fd50-4e44-9065-8c20b2d9b720'
function memory(): FpsRunStorage {
    const data = new Map<string, string>()
    return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } }
}
function finishLoss(session: ReturnType<typeof createSession>) { session.setReady(); session.start(); session.advance(10800) }
function finishWin(session: ReturnType<typeof createSession>) {
    session.setReady(); session.start()
    let escaped = 0, hp = 100
    while (!terminal(session.read().state)) {
        const { state, yaw, pitch } = session.read()
        if (state.hp < hp) { escaped++; hp = state.hp }
        session.command({ type: 'repair' }) // Rejected in a wave and after its one valid use.
        if (state.phase === 'repair') {
            session.command({ type: 'repair' }); session.command({ type: 'continue' }); session.command({ type: 'continue' })
        } else if (!state.reloadUntil && escaped >= 2) {
            if (!state.ammo) { session.command({ type: 'reload' }); session.command({ type: 'reload' }) }
            else if (state.tick >= state.fireAt && state.enemies.length) {
                const e = state.enemies[0], p = position(e), y = e.kind === 'crs' ? 1650 : 1315
                const dz = p.z + (e.kind === 'robot' ? 440 : 0) - 1800, dy = y - 1650
                session.aim(Math.atan2(p.x, -dz) * 180 / Math.PI - yaw, Math.atan2(dy, Math.hypot(p.x, dz)) * 180 / Math.PI - pitch)
                session.fire(true); session.fire(true); session.fire(false) // Second same-tick fire is rejected.
            }
        } else if (state.ammo === 12) session.command({ type: 'reload' }) // Full magazine no-op.
        session.advance(1)
    }
    expect(session.read().state.phase).toBe('won')
}
describe('real FPS consumer assembly', () => {
    it('passes the real accepted journal, not attempted no-ops, into the injected A snapshot/session', async () => {
        const snapshot = vi.fn(input => ({ schemaVersion: 1, input })), shared = { dispose: vi.fn() }
        const createShared = vi.fn(() => shared)
        const bridge = createFpsFreePlayBridge({ hashFields: async () => 'a'.repeat(64), createSnapshot: snapshot, createSession: createShared, renderSession: () => null })
        const owner = createFpsRunConsumer({ seed: 'fps-c1-preview', storage: memory(), uuid: () => first, bridge })
        const unmount = owner.mount(), live = owner.getSnapshot().session
        expect(snapshot).not.toHaveBeenCalled()
        finishWin(live)
        await vi.waitFor(() => expect(owner.getSnapshot().preparation).toBe('ready'))
        const log = live.log(), checked = verifyFpsTerminal(log)
        expect(checked.canonicalState).toBe(canonicalState(live.read().state))
        expect(snapshot).toHaveBeenCalledOnce(); expect(createShared).toHaveBeenCalledOnce()
        expect(snapshot.mock.calls[0][0]).toMatchObject({ clientRunId: first, replay: canonicalFpsReplay(log), finishReason: 'won', claimedScore: live.read().state.score })
        expect(log.events.filter(e => e.type === 'repair')).toHaveLength(1)
        expect(log.events.filter(e => e.type === 'fire')).toHaveLength(live.read().state.shots)
        const exported = live.log(); const fire = exported.events.find(e => e.type === 'fire')!
        if (fire.type === 'fire') fire.direction.x = 123
        expect(canonicalFpsReplay(live.log())).toBe(checked.encoded)
        unmount(); expect(shared.dispose).toHaveBeenCalledOnce()
    })
    it('keeps the UUID/checkpoint across reload, resumes paused and forks only on restart', () => {
        const storage = memory(), owner = createFpsRunConsumer({ seed: 'restore', storage, uuid: () => first })
        const unmount = owner.mount(), session = owner.getSnapshot().session
        session.setReady(); session.start(); session.fire(true); session.advance(120); session.fire(false); session.pause()
        const saved = canonicalState(session.read().state); unmount()
        const mint = vi.fn(() => second), restored = createFpsRunConsumer({ seed: 'restore', storage, uuid: mint })
        const close = restored.mount()
        expect(restored.getSnapshot().clientRunId).toBe(first); expect(mint).not.toHaveBeenCalled()
        expect(restored.getSnapshot().session.read().status).toBe('paused')
        expect(canonicalState(restored.getSnapshot().session.read().state)).toBe(saved)
        restored.restart(); expect(restored.getSnapshot().clientRunId).toBe(second); expect(mint).toHaveBeenCalledOnce()
        expect(storage.getItem(FPS_ACTIVE_RUN)).toBe(second); close()
    })
    it('retains the terminal score/export on persistence or API preparation failure; retry keeps identity and payload', async () => {
        const saved = memory(); let unavailable = true
        const storage = { ...saved, setItem(key: string, value: string) { if (unavailable) throw new Error('quota'); saved.setItem(key, value) } }
        const prepare = vi.fn().mockImplementationOnce(() => { throw new Error('api unavailable') }).mockResolvedValue({ dispose: vi.fn(), render: () => null })
        const owner = createFpsRunConsumer({ seed: 'failure', storage, uuid: () => first, bridge: { prepare } })
        const close = owner.mount(), live = owner.getSnapshot().session; finishLoss(live)
        expect(prepare).not.toHaveBeenCalled(); expect(owner.getSnapshot().storageError).toBe(true)
        const log = canonicalFpsReplay(live.log()), score = live.read().state.score
        unavailable = false; owner.retry()
        await vi.waitFor(() => expect(owner.getSnapshot().preparation).toBe('unavailable'))
        owner.retry(); await vi.waitFor(() => expect(owner.getSnapshot().preparation).toBe('ready'))
        expect(prepare.mock.calls.map(c => c[0])).toEqual([first, first])
        expect(prepare.mock.calls.map(c => canonicalFpsReplay(c[1]))).toEqual([log, log])
        expect(live.read().state.score).toBe(score); expect(live.read().status).toBe('done'); close()
    })
    it('restores the same completed run into a fresh shared session without auto verify/publish', async () => {
        const storage = memory(), handles: FpsResultHandle[] = []
        const prepare = vi.fn(async () => { const handle = { dispose: vi.fn(), render: () => null }; handles.push(handle); return handle })
        const a = createFpsRunConsumer({ seed: 'terminal-restore', storage, uuid: () => first, bridge: { prepare } })
        const close = a.mount(); finishLoss(a.getSnapshot().session)
        await vi.waitFor(() => expect(a.getSnapshot().preparation).toBe('ready')); close()
        const b = createFpsRunConsumer({ seed: 'terminal-restore', storage, uuid: () => second, bridge: { prepare } })
        const closeB = b.mount(); await vi.waitFor(() => expect(b.getSnapshot().preparation).toBe('ready'))
        expect(b.getSnapshot().clientRunId).toBe(first); expect(b.getSnapshot().session.read().status).toBe('done')
        expect(prepare.mock.calls).toHaveLength(2); expect(handles[0].dispose).toHaveBeenCalledOnce(); closeB()
    })
    it('disposes late handles after restart/unmount and tolerates effect detach/remount', async () => {
        const resolvers: ((h: FpsResultHandle) => void)[] = []
        let ids = 0
        const owner = createFpsRunConsumer({ seed: 'late', storage: memory(), uuid: () => ids++ ? second : first,
            bridge: { prepare: () => new Promise(resolve => resolvers.push(resolve)) } })
        const close = owner.mount(); finishLoss(owner.getSnapshot().session); owner.restart()
        const old = { dispose: vi.fn(), render: () => null }; resolvers[0](old)
        await vi.waitFor(() => expect(old.dispose).toHaveBeenCalledOnce()); expect(owner.getSnapshot().result).toBeUndefined()
        finishLoss(owner.getSnapshot().session); close()
        const late = { dispose: vi.fn(), render: () => null }; resolvers[1](late)
        await vi.waitFor(() => expect(late.dispose).toHaveBeenCalledOnce())
        const closeAgain = owner.mount(); expect(owner.getSnapshot().clientRunId).toBe(second)
        closeAgain(); const afterRemount = { dispose: vi.fn(), render: () => null }; resolvers[2](afterRemount)
        await vi.waitFor(() => expect(afterRemount.dispose).toHaveBeenCalledOnce())
    })
})
