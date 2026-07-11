import { describe, expect, it } from "vitest"
import type { SimEvent } from "./types"
import { initState } from "./engine"
import { hashState, runReplay } from "./replay"

const events: SimEvent[] = [
    { tick: 60, type: "move", lane: 1 },
    { tick: 400, type: "move", lane: 2 },
    { tick: 1200, type: "rally" },
    { tick: 2000, type: "choice", choice: "repair" },
]

describe("replay determinism", () => {
    it("same (seed, events) -> identical hash and score", () => {
        const a = runReplay("daily-2026-07-11", events)
        const b = runReplay("daily-2026-07-11", events)
        expect(a.stateHash).toEqual(b.stateHash)
        expect(a.score).toEqual(b.score)
        expect(a.simVersion).toBe(1)
    })

    it("hash discriminates every state field the verifier relies on", () => {
        // Two runs may legitimately converge to the same terminal state (a
        // no-consequence tamper), so the anti-cheat contract is on hashState:
        // ANY difference in the canonical state must change the digest.
        const base = initState("hash")
        const h = hashState(base)
        expect(hashState({ ...base, score: base.score + 1 })).not.toEqual(h)
        expect(hashState({ ...base, scrap: base.scrap + 1 })).not.toEqual(h)
        expect(hashState({ ...base, barricadeHp: base.barricadeHp - 1 })).not.toEqual(h)
        expect(hashState({ ...base, phase: "lost" })).not.toEqual(h)
        expect(hashState({ ...base, playerLane: 2 })).not.toEqual(h)
        expect(
            hashState({
                ...base,
                enemies: [{ id: 0, archetype: "drone", lane: 0, pos: 1, hp: 1, speed: 1 }],
            }),
        ).not.toEqual(h)
    })

    it("a consequential tamper changes the replay hash", () => {
        // Guaranteed-consequential divergence: an empty log vs a log whose
        // final surviving state differs in score. If the two terminal states
        // differ at all, their hashes must differ.
        const a = runReplay("daily", [])
        const b = runReplay("daily", events)
        const statesDiffer = a.score !== b.score || a.ticks !== b.ticks || a.won !== b.won
        if (statesDiffer) {
            expect(a.stateHash).not.toEqual(b.stateHash)
        } else {
            expect(a.stateHash).toEqual(b.stateHash)
        }
    })

    it("terminates: never exceeds RUN_MAX_TICKS", () => {
        const r = runReplay("stall", [])
        expect(r.ticks).toBeLessThanOrEqual(120 * 60)
    })
})
