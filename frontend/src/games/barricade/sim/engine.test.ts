import { describe, expect, it } from "vitest"
import { applyEvent, initState, tick } from "./engine"
import { buildWaves } from "./waves"
import { BARRICADE_MAX_HP, type SimEvent } from "./types"

const run = (seed: string, ticks: number, events: SimEvent[] = []) => {
    const waves = buildWaves(seed)
    let s = initState(seed)
    for (let t = 0; t < ticks; t++) {
        for (const ev of events) if (ev.tick === t) s = applyEvent(s, ev)
        s = tick(s, waves)
    }
    return s
}

describe("engine", () => {
    it("initState starts full and at wave 0", () => {
        const s = initState("x")
        expect(s.barricadeHp).toBe(BARRICADE_MAX_HP)
        expect(s.wave).toBe(0)
        expect(s.phase).toBe("wave")
    })

    it("enemies reach the barricade and damage it when undefended", () => {
        // Player parked on lane 0, never moves: other lanes leak through.
        const s = run("leak", 3000)
        expect(s.barricadeHp).toBeLessThan(BARRICADE_MAX_HP)
    })

    it("kills grant scrap and fill the rally meter", () => {
        // 4000 ticks: by wave 1+ the lane-coverage pass guarantees spawns on
        // the player's lane regardless of seed, so kills must have happened.
        const s = run("scrap", 4000)
        expect(s.scrap).toBeGreaterThan(0)
        expect(s.rallyMeter).toBeGreaterThan(0)
    })

    it("is a pure function of (seed, events): identical replays converge", () => {
        const evs: SimEvent[] = [
            { tick: 100, type: "move", lane: 2 },
            { tick: 900, type: "rally" },
        ]
        const a = run("pure", 4000, evs)
        const b = run("pure", 4000, evs)
        expect(a).toEqual(b)
    })

    it("diverges when events differ", () => {
        const a = run("div", 4000, [{ tick: 100, type: "move", lane: 2 }])
        const b = run("div", 4000, [{ tick: 100, type: "move", lane: 1 }])
        expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b))
    })

    it("tick and applyEvent never mutate their input", () => {
        const waves = buildWaves("frozen")
        const s0 = initState("frozen")
        const snapshot = JSON.stringify(s0)
        tick(s0, waves)
        applyEvent(s0, { tick: 0, type: "move", lane: 2 })
        expect(JSON.stringify(s0)).toEqual(snapshot)
    })
})
