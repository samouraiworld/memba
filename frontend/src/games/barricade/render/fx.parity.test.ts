import { describe, expect, it } from "vitest"
import { applyEvent, initState, tick } from "../sim/engine"
import { buildWaves } from "../sim/waves"
import { SIM_VERSION, type SimEvent, type SimState } from "../sim/types"
import { deriveFxEvents } from "./fxEvents"
import { initFx, layout, pushFxEvents, stepFx, type Rng } from "./fx"
import { interpPositions } from "./interp"
import { laneThreats } from "./telegraph"

// The whole point of the FX layer: it is render-only and can NEVER change a
// replay. This drives a full daily run twice — once bare, once with the entire
// FX pipeline (derive → push → step) running every tick — and asserts the sim
// trajectory is byte-identical. If it ever diverges, the verifier (G3) would
// reject legitimate scores, so this test is load-bearing.

function seededRng(seed = 1): Rng {
    let s = seed >>> 0
    return () => {
        s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff
        return s / 0x7fffffff
    }
}

// A fixed input script so the parity run exercises the PLAYER verbs too —
// molotov flight/impact/fire, a shove, lane moves — not just an idle field.
// (Review found the original parity run never threw a single molotov.)
const SCRIPT: SimEvent[] = [
    { tick: 30, type: "throw", lane: 0, dist: 40_000 },
    { tick: 90, type: "move", lane: 1 },
    { tick: 105, type: "shove", lane: 1 },
    { tick: 150, type: "throw", lane: 1, dist: 20_000 },
    { tick: 400, type: "move", lane: 2 },
    { tick: 430, type: "throw", lane: 2, dist: 70_000 },
]

function runSim(seed: string, withFx: boolean): { final: SimState; checksum: number } {
    let s = initState(seed)
    const waves = buildWaves(seed)
    const fx = initFx(false)
    const lay = layout(390, 650)
    const rng = seededRng(99)
    let checksum = 0
    let guard = 0
    while (s.phase !== "won" && s.phase !== "lost" && guard++ < 20_000) {
        for (const ev of SCRIPT) if (ev.tick === s.tick) s = applyEvent(s, ev)
        const prev = s
        s = tick(s, waves)
        checksum = (Math.imul(checksum, 31) + s.score + s.barricadeHp + s.tick + s.enemies.length) | 0
        if (withFx) {
            pushFxEvents(fx, deriveFxEvents(prev, s), lay, rng)
            stepFx(fx, rng)
            // The interpolation render model must be side-effect-free on the sim
            // too: exercise it every tick with a varying alpha. If it ever mutated
            // an enemy's pos, the next tick would read the corrupted value and the
            // trajectory would diverge from the bare run below.
            interpPositions(prev, s, (s.tick % 4) / 4)
            // Same contract for the telegraph selection: pure + read-only.
            laneThreats(s.enemies.map((e) => ({ lane: e.lane, pos: e.pos })))
        }
    }
    return { final: s, checksum }
}

describe("fx determinism parity", () => {
    it("is pinned to the current SIM_VERSION", () => {
        expect(SIM_VERSION).toBe(2)
    })

    it("produces an identical sim trajectory with FX on vs off (multiple seeds)", () => {
        for (const seed of ["barricade-2026-07-12", "practice-1", "barricade-2026-12-25"]) {
            const bare = runSim(seed, false)
            const juiced = runSim(seed, true)
            expect(juiced.checksum).toBe(bare.checksum)
            expect(JSON.stringify(juiced.final)).toBe(JSON.stringify(bare.final))
        }
    })
})
