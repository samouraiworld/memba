/**
 * Fixed-timestep game loop (house pattern, mirrors space-invaders):
 * wall-clock frames accumulate into an integer number of 60Hz sim steps —
 * the step COUNT crosses into the sim, never fractional milliseconds, so a
 * recorded input log replays tick-perfect regardless of display refresh rate.
 *
 * `onFrame` receives `alpha` — the leftover accumulator as a fraction of one
 * fixed step (0..1) — so the renderer can interpolate between the last two ticks
 * and stay smooth on high-refresh displays. It is a pure display value: the sim
 * only ever advances by whole steps, so replays are unaffected.
 */

import { useEffect, useRef } from "react"

export const FIXED_MS = 1000 / 60
export const MAX_FRAME_MS = 250 // clamp to avoid spiral-of-death after tab sleep

export function useGameLoop(
    running: boolean,
    onSteps: (steps: number) => void,
    onFrame: (alpha: number) => void,
): void {
    const cb = useRef({ onSteps, onFrame })
    useEffect(() => {
        cb.current = { onSteps, onFrame }
    })

    useEffect(() => {
        if (!running) return
        let raf = 0
        let last = performance.now()
        let acc = 0
        const frame = (now: number) => {
            const dt = Math.min(Math.max(0, now - last), MAX_FRAME_MS)
            last = now
            acc += dt
            const steps = Math.floor(acc / FIXED_MS)
            if (steps > 0) {
                acc -= steps * FIXED_MS
                cb.current.onSteps(steps)
            }
            // acc < FIXED_MS here, so alpha is the sub-tick fraction in [0,1).
            cb.current.onFrame(acc / FIXED_MS)
            raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)
        return () => cancelAnimationFrame(raf)
    }, [running])
}
