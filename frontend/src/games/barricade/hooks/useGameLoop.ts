/**
 * Fixed-timestep game loop (house pattern, mirrors space-invaders):
 * wall-clock frames accumulate into an integer number of 60Hz sim steps —
 * the step COUNT crosses into the sim, never fractional milliseconds, so a
 * recorded input log replays tick-perfect regardless of display refresh rate.
 */

import { useEffect, useRef } from "react"

export const FIXED_MS = 1000 / 60
export const MAX_FRAME_MS = 250 // clamp to avoid spiral-of-death after tab sleep

export function useGameLoop(running: boolean, onSteps: (steps: number) => void, onFrame: () => void): void {
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
            cb.current.onFrame()
            raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)
        return () => cancelAnimationFrame(raf)
    }, [running])
}
