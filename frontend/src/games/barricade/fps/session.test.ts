import { describe, expect, it } from 'vitest'
import { aimDirection, createSession } from './session'
import { localStateDigest, replay } from '../sim/fps/replay'

function run(frames: number[]) {
    const s = createSession('frame-parity'); s.setReady(); s.start()
    for (const steps of frames) s.advance(steps)
    return s
}
describe('FPS live session', () => {
    it('never starts before scene readiness and freezes while paused', () => {
        const s = createSession('pause'); s.start(); s.advance(20)
        expect(s.read().state.tick).toBe(0)
        s.setReady(); s.start(); s.advance(60); s.fire(true); s.pause()
        const before = localStateDigest(s.read().state); s.advance(200)
        expect(localStateDigest(s.read().state)).toBe(before)
        s.start(); s.advance(60)
        expect(s.read().state.shots).toBe(1)
    })
    it('renders different frame groupings over identical integer ticks', () => {
        const a = run(Array(600).fill(1)), b = run(Array(300).fill(2)), c = run(Array(40).fill(15))
        expect(localStateDigest(a.read().state)).toBe(localStateDigest(b.read().state))
        expect(localStateDigest(a.read().state)).toBe(localStateDigest(c.read().state))
    })
    it('records held manual fire at the rule cadence and locally replays it', () => {
        const s = run([1]); s.fire(true); s.advance(90); s.fire(false)
        expect(s.read().state.shots).toBe(10)
        expect(s.log().events).toHaveLength(10)
        expect(localStateDigest(replay(s.log()))).toBe(localStateDigest(s.read().state))
    })
    it('does not record frame-rate pointer movements or move the player origin', () => {
        const s = run([1]), eye = s.read().eye
        for (let i = 0; i < 1000; i++) s.aim(1, 1)
        expect(s.log().events).toHaveLength(0)
        expect(s.read().yaw).toBe(65); expect(s.read().pitch).toBe(35)
        expect(s.read().eye).toEqual(eye)
        expect(s.read().direction).toEqual(aimDirection(65, 35))
    })
    it('clears keyboard fire on pause, does not replay latent input on resume', () => {
        const s = run([1]); s.key(' ', true); s.advance(1); s.pause(); s.start(); s.advance(100)
        expect(s.read().state.shots).toBe(1)
    })
    it('retains several accepted impacts per frame in a bounded visual queue without changing replay', () => {
        const s = run([1]); s.fire(true); s.advance(90)
        expect(s.read().effects).toHaveLength(10)
        expect(s.read().effects.map(e => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        s.fire(false); s.command({ type: 'reload' }); s.advance(90)
        s.fire(true); s.advance(90); s.fire(false); s.command({ type: 'reload' }); s.advance(90)
        s.fire(true); s.advance(90); s.fire(false)
        expect(s.read().effects).toHaveLength(24)
        expect(localStateDigest(replay(s.log()))).toBe(localStateDigest(s.read().state))
    })
    it('normalizes signed zero at the accepted journal boundary without changing aim or hit semantics', () => {
        const s = run([1]); s.command({ type: 'fire', direction: { x: -0, y: -0, z: -10000 } }); s.advance(1)
        const event = s.log().events[0]
        expect(event.type).toBe('fire')
        if (event.type === 'fire') { expect(Object.is(event.direction.x, -0)).toBe(false); expect(Object.is(event.direction.y, -0)).toBe(false) }
        expect(Object.is(aimDirection(-.00001, -.00001).x, -0)).toBe(false)
        expect(localStateDigest(replay(s.log()))).toBe(localStateDigest(s.read().state))
    })
    it('finishes unattended games with exact local state verification', () => {
        const s = run([1])
        while (s.getSnapshot().status === 'playing') s.advance(15)
        expect(s.getSnapshot().status).toBe('done')
        expect(s.getSnapshot().verified).toBe(true)
    })
})
