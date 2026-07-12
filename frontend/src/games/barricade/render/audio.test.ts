import { describe, expect, it } from "vitest"
import { BASE_FREQ, comboToFreq, detuneCents, GameAudio } from "./audio"

describe("game audio", () => {
    it("combo pitch ladder rises then caps", () => {
        expect(comboToFreq(0)).toBeCloseTo(BASE_FREQ, 5)
        expect(comboToFreq(5)).toBeGreaterThan(comboToFreq(0))
        expect(comboToFreq(50)).toBe(comboToFreq(18)) // capped at 18 steps
        expect(comboToFreq(-3)).toBe(BASE_FREQ) // clamped at 0
    })

    it("detune stays within +/-25 cents", () => {
        for (const r of [0, 0.5, 1]) {
            const d = detuneCents(() => r)
            expect(Math.abs(d)).toBeLessThanOrEqual(25)
        }
    })

    it("constructs muted and never throws without an AudioContext", () => {
        const a = new GameAudio(true)
        expect(a.muted).toBe(true)
        expect(() => a.onFxEvent({ kind: "kill", lane: 0, posFrac: 0.2, weight: 1, archetype: "drone" }, 3)).not.toThrow()
        expect(() => a.onFxEvent({ kind: "barricadeHit", damageFrac: 0.1 }, 0)).not.toThrow()
        expect(() => a.setMuted(false)).not.toThrow()
        expect(() => a.resume()).not.toThrow()
    })
})
