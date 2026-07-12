import { describe, expect, it } from "vitest"
import type { FxEvent } from "./fxEvents"
import { initFx, layout, pushFxEvents, stepFx, type Rng } from "./fx"

// Deterministic LCG so particle spawns are reproducible in tests.
function seededRng(seed = 1): Rng {
    let s = seed >>> 0
    return () => {
        s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff
        return s / 0x7fffffff
    }
}

const lay = layout(390, 650)
const kill: FxEvent = { kind: "kill", lane: 1, posFrac: 0.5, weight: 2, archetype: "walker" }

describe("fx presentation layer", () => {
    it("a kill spawns particles, adds shake, and bumps the combo", () => {
        const fx = initFx(false)
        pushFxEvents(fx, [kill], lay, seededRng())
        expect(fx.particles.length).toBeGreaterThan(0)
        expect(fx.shakeMag).toBeGreaterThan(0)
        expect(fx.combo).toBe(1)
    })

    it("reduced motion keeps combo bookkeeping but emits no motion", () => {
        const fx = initFx(true)
        pushFxEvents(fx, [kill, kill], lay, seededRng())
        expect(fx.combo).toBe(2)
        expect(fx.particles.length).toBe(0)
        expect(fx.shakeMag).toBe(0)
        expect(fx.flash).toBe(0)
        expect(fx.deaths.length).toBe(0)
    })

    it("a kill spawns a squashed death animation that arcs away and expires", () => {
        const fx = initFx(false)
        pushFxEvents(fx, [kill], lay, seededRng())
        expect(fx.deaths.length).toBe(1)
        expect(fx.deaths[0].sy).toBeLessThan(1) // squashed on the impact frame
        const rng = seededRng(3)
        for (let i = 0; i < 30; i++) stepFx(fx, rng)
        expect(fx.deaths.length).toBe(0) // fully expired
    })

    it("a barricade hit resets the combo and shakes", () => {
        const fx = initFx(false)
        fx.combo = 7
        pushFxEvents(fx, [{ kind: "barricadeHit", damageFrac: 0.09 }], lay, seededRng())
        expect(fx.combo).toBe(0)
        expect(fx.shakeMag).toBeGreaterThan(0)
    })

    it("rally sets a full flash", () => {
        const fx = initFx(false)
        pushFxEvents(fx, [{ kind: "rally" }], lay, seededRng())
        expect(fx.flash).toBe(1)
    })

    it("caps particles no matter how many kills arrive", () => {
        const fx = initFx(false)
        const many: FxEvent[] = Array.from({ length: 400 }, () => kill)
        pushFxEvents(fx, many, lay, seededRng())
        expect(fx.particles.length).toBeLessThanOrEqual(220)
    })

    it("every fifth kill drops an onomatopoeia floater", () => {
        const fx = initFx(false)
        pushFxEvents(fx, [kill, kill, kill, kill, kill], lay, seededRng())
        expect(fx.floaters.length).toBe(1)
    })

    it("stepFx decays shake to zero and expires particles", () => {
        const fx = initFx(false)
        pushFxEvents(fx, [kill], lay, seededRng())
        const rng = seededRng(2)
        for (let i = 0; i < 200; i++) stepFx(fx, rng)
        expect(fx.shakeMag).toBe(0)
        expect(fx.shakeX).toBe(0)
        expect(fx.particles.length).toBe(0)
        expect(fx.floaters.length).toBe(0)
    })
})
