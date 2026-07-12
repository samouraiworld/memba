import { describe, expect, it } from "vitest"
import { applyEvent, initState, tick } from "./engine"
import { hashState, runReplay } from "./replay"
import { LANE_LENGTH, type Enemy, type SimEvent } from "./types"
import type { WaveScript } from "./waves"

// A wave with no spawns, so a controlled fixture stays put and nothing is added.
const NO_SPAWNS: WaveScript[] = [{ wave: 0, spawns: [] }]
// A stationary, effectively-immortal decoy keeps the wave from clearing (which
// would flip to the choice phase and halt charge regen).
const DECOY: Enemy = { id: 99, archetype: "drone", lane: 2, pos: 10_000, hp: 9_999_999, speed: 0, bornTick: 0, hasFlanked: false }

function drone(id: number, lane: number, pos: number): Enemy {
    return { id, archetype: "drone", lane, pos, hp: 3_000, speed: 0, bornTick: 0, hasFlanked: false }
}

describe("molotov throw", () => {
    it("spends a charge and schedules a projectile with a distance-scaled flight", () => {
        let s = initState("m")
        const charge0 = s.molotovCharge
        s = applyEvent(s, { tick: 0, type: "throw", lane: 1, dist: 50_000 })
        expect(s.molotovCharge).toBe(charge0 - 1_000)
        expect(s.projectiles).toHaveLength(1)
        expect(s.projectiles[0]).toMatchObject({ lane: 1, dist: 50_000, impactTick: 21 }) // 12 + floor(9)
        expect(s.molotovReadyAt).toBe(30)
        expect(s.nextThrowId).toBe(1)
    })

    it("is a no-op on cooldown, out of charge, or out of range", () => {
        const base = initState("m")
        const p = (s: ReturnType<typeof initState>, ev: SimEvent) => applyEvent(s, ev).projectiles.length
        expect(p({ ...base, molotovReadyAt: 5 }, { tick: 0, type: "throw", lane: 0, dist: 0 })).toBe(0)
        expect(p({ ...base, molotovCharge: 0 }, { tick: 0, type: "throw", lane: 0, dist: 0 })).toBe(0)
        expect(p(base, { tick: 0, type: "throw", lane: 9, dist: 0 })).toBe(0)
        expect(p(base, { tick: 0, type: "throw", lane: 0, dist: LANE_LENGTH + 1 })).toBe(0)
    })

    it("bursts every enemy within radius in the target lane, and nothing else, at impact", () => {
        let s = {
            ...initState("m"),
            enemies: [
                drone(0, 1, 50_000), // on target → dies
                drone(1, 1, 61_000), // 11k away ≤ 12k radius → dies
                drone(2, 1, 70_000), // 20k away > radius → lives
                drone(3, 2, 50_000), // wrong lane → lives
                DECOY,
            ],
        }
        s = applyEvent(s, { tick: 0, type: "throw", lane: 1, dist: 50_000 })
        for (let i = 0; i < 21; i++) s = tick(s, NO_SPAWNS)
        const alive = new Set(s.enemies.map((e) => e.id))
        expect(alive.has(0)).toBe(false)
        expect(alive.has(1)).toBe(false)
        expect(alive.has(2)).toBe(true)
        expect(alive.has(3)).toBe(true)
        expect(s.projectiles).toHaveLength(0) // consumed on impact
    })

    it("regenerates charge over time (capped)", () => {
        let s = { ...initState("m"), molotovCharge: 100, enemies: [DECOY] }
        for (let i = 0; i < 10; i++) s = tick(s, NO_SPAWNS)
        expect(s.molotovCharge).toBe(100 + 10 * 4) // +REGEN/tick, no kills

        let capped = { ...initState("m"), molotovCharge: 2_999, enemies: [DECOY] }
        for (let i = 0; i < 10; i++) capped = tick(capped, NO_SPAWNS)
        expect(capped.molotovCharge).toBe(3_000)
    })

    it("is deterministic + replay-verifiable with throws in the log", () => {
        const seed = "barricade-2026-07-12"
        const events: SimEvent[] = [
            { tick: 30, type: "throw", lane: 0, dist: 40_000 },
            { tick: 70, type: "throw", lane: 1, dist: 20_000 },
            { tick: 120, type: "throw", lane: 2, dist: 60_000 },
        ]
        const a = runReplay(seed, events)
        const b = runReplay(seed, events)
        expect(a.stateHash).toBe(b.stateHash)
        expect(a.score).toBe(b.score)
        expect(a.simVersion).toBe(2)
        // throws are actually processed → the run diverges from an empty log
        expect(runReplay(seed, []).stateHash).not.toBe(a.stateHash)
    })

    it("hashState covers every new molotov field", () => {
        const base = initState("m")
        expect(hashState({ ...base, molotovCharge: base.molotovCharge - 1 })).not.toBe(hashState(base))
        expect(hashState({ ...base, molotovReadyAt: 99 })).not.toBe(hashState(base))
        expect(hashState({ ...base, nextThrowId: 5 })).not.toBe(hashState(base))
        expect(hashState({ ...base, projectiles: [{ id: 0, lane: 0, dist: 1, impactTick: 2 }] })).not.toBe(hashState(base))
        expect(hashState({ ...base, cleanWave: !base.cleanWave })).not.toBe(hashState(base))
        expect(hashState({ ...base, nextEnemyId: 7 })).not.toBe(hashState(base))
    })

    it("is a no-op during the choice phase", () => {
        const s = { ...initState("m"), phase: "choice" as const }
        expect(applyEvent(s, { tick: 0, type: "throw", lane: 0, dist: 0 }).projectiles).toHaveLength(0)
    })

    it("rejects a NaN/float throw identically across the JSON submission boundary", () => {
        const seed = "barricade-2026-07-12"
        // A buggy client emits a NaN (and a float) dist; the integer guard no-ops
        // both. Submitting crosses JSON: NaN -> null. The verifier must reach the
        // SAME state, or it would false-reject an honest run.
        const clientLog: SimEvent[] = [
            { tick: 30, type: "throw", lane: 1, dist: NaN },
            { tick: 45, type: "throw", lane: 0, dist: 40_000.5 },
            { tick: 60, type: "throw", lane: 1, dist: 40_000 }, // a legal throw, for signal
        ]
        const submitted = JSON.parse(JSON.stringify(clientLog)) as SimEvent[] // NaN -> null
        const client = runReplay(seed, clientLog)
        const verifier = runReplay(seed, submitted)
        expect(verifier.stateHash).toBe(client.stateHash)
        expect(verifier.score).toBe(client.score)
    })
})
