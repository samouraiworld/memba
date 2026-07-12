import { describe, expect, it } from "vitest"
import { applyEvent, initState, tick } from "./engine"
import { buildWaves } from "./waves"
import { BARRICADE_MAX_HP, RALLY_FULL, type SimEvent } from "./types"

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

    it("rally is frozen during the choice phase like every other verb", () => {
        // The field is always empty between waves (a wave only ends clear), so a
        // choice-phase rally would burn the full meter for zero kills. The button
        // is live in the DOM — the sim must protect the meter, same as throw/shove.
        const s = { ...initState("x"), phase: "choice" as const, rallyMeter: RALLY_FULL }
        const after = applyEvent(s, { tick: 0, type: "rally" })
        expect(after.rallyMeter).toBe(RALLY_FULL)
    })

    it("the broadcast tower reaching the barricade ends the run — the boss cannot be tanked", () => {
        // Contact used to despawn the boss like any mob (25k damage) and the wave
        // then paid WAVE_CLEAR + WIN_BONUS: the maximum boss-wave damage (boss +
        // 6 escorts = 49k) is structurally unable to kill a half-repaired
        // barricade, so parking in one lane SKIPPED the boss and won. The act
        // boss must be existential: it reaches the line → the line falls.
        const waves = buildWaves("boss-contact")
        const s = {
            ...initState("boss-contact"),
            wave: waves.length - 1,
            phase: "boss" as const,
            enemies: [
                { id: 0, archetype: "broadcast" as const, lane: 1, pos: 100_000, hp: 144_000, speed: 144, bornTick: 0, hasFlanked: false },
            ],
        }
        const after = tick(s, waves)
        expect(after.phase).toBe("lost")
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
