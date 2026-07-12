import { describe, expect, it } from "vitest"
import { applyEvent, initState, MOLOTOV_MAX, tick } from "./engine"
import { hashState, runReplay } from "./replay"
import { BOSS_WAVE, buildWaves } from "./waves"
import { BARRICADE_MAX_HP, type SimEvent } from "./types"
import type { WaveScript } from "./waves"

const NO_SPAWNS: WaveScript[] = [{ wave: 0, spawns: [] }]
// An immortal, stationary machine in an untouched lane keeps the wave open
// after the shop closes (an empty script + empty field would instantly end
// wave 0 and re-enter the next shop).
const DECOY = { id: 99, archetype: "drone" as const, lane: 2, pos: 10_000, hp: 9_999_999, speed: 0 }

/** A state parked in the spend phase with a known purse and a dented barricade. */
function inSpendPhase(scrap: number) {
    return {
        ...initState("econ"),
        phase: "choice" as const,
        phaseUntil: 1_000,
        scrap,
        barricadeHp: 40_000,
    }
}

describe("spend phase (multi-buy economy)", () => {
    it("a purchase no longer ends the phase — several buys fit in one window", () => {
        let s = inSpendPhase(100)
        s = applyEvent(s, { tick: 0, type: "choice", choice: "repair" })
        expect(s.phase).toBe("choice") // still shopping
        expect(s.scrap).toBe(100 - 25)
        expect(s.barricadeHp).toBe(40_000 + 18_000)
        s = applyEvent(s, { tick: 0, type: "choice", choice: "turret" })
        expect(s.phase).toBe("choice")
        expect(s.scrap).toBe(100 - 25 - 40)
    })

    it("repair costs scrap and is a no-op when the purse is short", () => {
        const s = applyEvent(inSpendPhase(24), { tick: 0, type: "choice", choice: "repair" })
        expect(s.barricadeHp).toBe(40_000)
        expect(s.scrap).toBe(24)
    })

    it("the free emergency patch works exactly once per run", () => {
        let s = inSpendPhase(0)
        s = applyEvent(s, { tick: 0, type: "choice", choice: "patch" })
        expect(s.barricadeHp).toBe(40_000 + 8_000)
        expect(s.patchUsed).toBe(true)
        const again = applyEvent(s, { tick: 0, type: "choice", choice: "patch" })
        expect(again.barricadeHp).toBe(s.barricadeHp) // no-op the second time
    })

    it("patch never overheals past max HP", () => {
        const s = applyEvent(
            { ...inSpendPhase(0), barricadeHp: BARRICADE_MAX_HP - 1_000 },
            { tick: 0, type: "choice", choice: "patch" },
        )
        expect(s.barricadeHp).toBe(BARRICADE_MAX_HP)
    })

    it("a molotov refill buys one throw, capped at the charge bank", () => {
        let s = { ...inSpendPhase(50), molotovCharge: 500 }
        s = applyEvent(s, { tick: 0, type: "choice", choice: "refill" })
        expect(s.molotovCharge).toBe(1_500)
        expect(s.scrap).toBe(30)
        const capped = applyEvent(
            { ...inSpendPhase(50), molotovCharge: MOLOTOV_MAX - 100 },
            { tick: 0, type: "choice", choice: "refill" },
        )
        expect(capped.molotovCharge).toBe(MOLOTOV_MAX)
        // …and buying at a FULL bank is a no-op, never a scrap sink.
        const full = applyEvent(
            { ...inSpendPhase(50), molotovCharge: MOLOTOV_MAX },
            { tick: 0, type: "choice", choice: "refill" },
        )
        expect(full.scrap).toBe(50)
    })

    it("'done' leaves the shop on the next tick with the wave clock at its origin", () => {
        // done sets phaseUntil = tick + 1 and stays in "choice": the standard
        // exit path flips next tick with waveLocal starting at 0 — the same
        // clock origin as a timer exit, so early leavers and lingerers face
        // identical spawn timing.
        let s = { ...inSpendPhase(0), tick: 500, enemies: [DECOY] }
        s = applyEvent(s, { tick: 500, type: "choice", choice: "done" })
        expect(s.phase).toBe("choice")
        expect(s.phaseUntil).toBe(501)
        s = tick(s, NO_SPAWNS)
        expect(s.phase).toBe("wave")
    })

    it("the timer still ends the shop without a done event", () => {
        let s = { ...inSpendPhase(0), tick: 999, enemies: [DECOY] } // phaseUntil 1000
        s = tick(s, NO_SPAWNS)
        expect(s.phase).toBe("wave")
    })

    it("the wave before the boss now passes through a spend window too", () => {
        // The 9→boss transition used to jump straight to "boss", silently
        // skipping the run's only pre-boss repair chance (review finding).
        const waves = buildWaves("preboss")
        let s = {
            ...initState("preboss"),
            wave: BOSS_WAVE - 1,
            phase: "wave" as const,
            phaseUntil: 0,
            tick: 8_000, // far past the wave's script window
            enemies: [],
        }
        s = tick(s, waves) // script exhausted + field empty → the wave ends
        expect(s.wave).toBe(BOSS_WAVE)
        expect(s.phase).toBe("choice")
        // …and the shop exit lands on "boss", not "wave". Real play reaches
        // phaseUntil exactly (ticks are +1), so set up one tick before it.
        let t = { ...s, tick: s.phaseUntil - 1 }
        t = tick(t, waves)
        expect(t.phase).toBe("boss")
    })

    it("a forged choice string is a no-op", () => {
        const s = applyEvent(inSpendPhase(100), { tick: 0, type: "choice", choice: "jackpot" } as unknown as SimEvent)
        expect(s.scrap).toBe(100)
        expect(s.phase).toBe("choice")
        expect(s.barricadeHp).toBe(40_000)
    })

    it("hashState covers patchUsed", () => {
        const base = initState("econ")
        expect(hashState({ ...base, patchUsed: true })).not.toBe(hashState(base))
    })

    it("a multi-buy log stays replay-deterministic", () => {
        const seed = "barricade-2026-07-12"
        const events: SimEvent[] = [
            { tick: 60, type: "move", lane: 1 },
            { tick: 700, type: "choice", choice: "repair" },
            { tick: 701, type: "choice", choice: "refill" },
            { tick: 702, type: "choice", choice: "done" },
        ]
        const a = runReplay(seed, events)
        const b = runReplay(seed, events)
        expect(a.stateHash).toBe(b.stateHash)
        expect(a.simVersion).toBe(2)
    })
})
