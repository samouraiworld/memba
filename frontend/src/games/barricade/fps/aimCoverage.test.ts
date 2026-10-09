import { describe, expect, it } from 'vitest'
import { position, trace } from '../sim/fps/collision'
import { EYE, type Axis, type Enemy } from '../sim/fps/types'
import { createSession } from './session'

/** Mathematical coverage of existing controls; actual touch still needs the browser recipe. */
describe('existing FPS aim coverage, unchanged projection and controls', () => {
    it('can target every axis through its full travel within the current yaw/pitch limits', () => {
        let maxYaw = 0, maxPitch = 0
        for (const axis of [0, 1, 2] as Axis[]) for (let progress = 0; progress <= 10000; progress += 250) for (const kind of ['crs', 'robot'] as const) {
            const enemy: Enemy = { id: 1, axis, kind, progress, speed: 1, hp: 100 }
            const p = position(enemy), x = p.x - EYE.x, y = (kind === 'robot' ? 1315 : 1650) - EYE.y, z = p.z + (kind === 'robot' ? 440 : 0) - EYE.z
            const yaw = Math.atan2(x, -z) * 180 / Math.PI, pitch = Math.atan2(y, Math.hypot(x, z)) * 180 / Math.PI
            maxYaw = Math.max(maxYaw, Math.abs(yaw)); maxPitch = Math.max(maxPitch, Math.abs(pitch))
            const session = createSession('aim-coverage'); session.setReady(); session.start(); session.aim(yaw, pitch)
            expect(session.read().yaw).toBeCloseTo(yaw); expect(session.read().pitch).toBeCloseTo(pitch)
            expect(trace(session.read().direction, [enemy], 0)).toMatchObject({ enemy: { id: 1 }, part: 'weak' })
            // Existing touch sensitivity: .16 degrees/px. From centre to either
            // axis fits one <200px swipe; repeated drags can switch both sides.
            expect(Math.abs(yaw) / .16).toBeLessThan(200)
        }
        console.info(JSON.stringify({ sourceOnly: true, maxYawDegrees: maxYaw, maxPitchDegrees: maxPitch, maxSwipePixelsFromCentre: maxYaw / .16 }))
    })
})
