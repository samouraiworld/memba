import { describe, expect, it } from "vitest"
import { applyEvent, initState, tick } from "./engine"
import { hashState, runReplay } from "./replay"
import { ARCHETYPES } from "./waves"
import type { ArchetypeId, Enemy, SimEvent } from "./types"
import type { WaveScript } from "./waves"

const NO_SPAWNS: WaveScript[] = [{ wave: 0, spawns: [] }]
const DECOY: Enemy = { id: 99, archetype: "drone", lane: 2, pos: 10_000, hp: 9_999_999, speed: 0 }
const enemy = (id: number, archetype: ArchetypeId, lane: number, pos: number, hp: number, speed = 0): Enemy => ({
    id,
    archetype,
    lane,
    pos,
    hp,
    speed,
})

describe("shove", () => {
    it("knocks the front machine of a lane back and goes on cooldown", () => {
        let s: ReturnType<typeof initState> = {
            ...initState("a2"),
            enemies: [enemy(0, "drone", 1, 40_000, 3_000), enemy(1, "drone", 1, 70_000, 3_000)],
        }
        s = applyEvent(s, { tick: 0, type: "shove", lane: 1 })
        expect(s.enemies.find((e) => e.id === 1)?.pos).toBe(70_000 - 15_000) // front (higher pos) pushed back
        expect(s.enemies.find((e) => e.id === 0)?.pos).toBe(40_000) // the one behind untouched
        expect(s.shoveReadyAt).toBe(180)
    })

    it("clamps knockback at the spawn end", () => {
        let s: ReturnType<typeof initState> = { ...initState("a2"), enemies: [enemy(0, "drone", 0, 5_000, 3_000)] }
        s = applyEvent(s, { tick: 0, type: "shove", lane: 0 })
        expect(s.enemies[0].pos).toBe(0)
    })

    it("no-ops on cooldown / during choice / bad lane / empty lane (no cooldown spent on a whiff)", () => {
        const base: ReturnType<typeof initState> = { ...initState("a2"), enemies: [enemy(0, "drone", 0, 50_000, 3_000)] }
        expect(applyEvent({ ...base, shoveReadyAt: 5 }, { tick: 0, type: "shove", lane: 0 }).enemies[0].pos).toBe(50_000)
        expect(applyEvent({ ...base, phase: "choice" as const }, { tick: 0, type: "shove", lane: 0 }).enemies[0].pos).toBe(
            50_000,
        )
        expect(applyEvent(base, { tick: 0, type: "shove", lane: 9 }).enemies[0].pos).toBe(50_000)
        expect(applyEvent(base, { tick: 0, type: "shove", lane: 2 }).shoveReadyAt).toBe(0) // whiff → no CD
    })
})

describe("testudo shield + swarm", () => {
    it("blunts frontal fire on a testudo, but molotov burst + burn ignore the shield", () => {
        // Frontal auto-fire 2500 → 60% = 1500 on the shield.
        let front: ReturnType<typeof initState> = { ...initState("a2"), enemies: [enemy(0, "testudo", 0, 50_000, 14_000), DECOY] }
        front = tick(front, NO_SPAWNS)
        expect(front.enemies.find((e) => e.id === 0)?.hp).toBe(14_000 - 1_500)

        // Molotov: full burst (6000) + a burn (500) at impact — no reduction.
        let molo: ReturnType<typeof initState> = { ...initState("a2"), enemies: [enemy(0, "testudo", 1, 50_000, 14_000), DECOY] }
        molo = applyEvent(molo, { tick: 0, type: "throw", lane: 1, dist: 50_000 })
        for (let i = 0; i < 21; i++) molo = tick(molo, NO_SPAWNS)
        expect(molo.enemies.find((e) => e.id === 0)?.hp).toBe(14_000 - 6_000 - 500)
    })

    it("a swarm unit dies to a single auto-fire tick (fragile by design)", () => {
        expect(ARCHETYPES.swarm.hp).toBeLessThan(2_500) // below PLAYER_DPS_PER_TICK
        let s: ReturnType<typeof initState> = {
            ...initState("a2"),
            enemies: [enemy(0, "swarm", 0, 50_000, ARCHETYPES.swarm.hp), DECOY],
        }
        s = tick(s, NO_SPAWNS)
        expect(s.enemies.some((e) => e.id === 0)).toBe(false)
    })

    it("shoveReadyAt is in the replay hash; a shove that lands changes the run and replays deterministically", () => {
        const base = initState("a2")
        expect(hashState({ ...base, shoveReadyAt: 42 })).not.toBe(hashState(base))

        // A shove only changes state when it LANDS on a machine (a whiff is a
        // no-op), so drive to a tick with a front enemy, then shove all lanes to
        // guarantee a hit — the run must diverge from the un-shoved one and stay
        // deterministic on re-sim.
        const seed = "barricade-2026-07-12"
        const shoveEvery: SimEvent[] = []
        for (let t = 40; t <= 120; t += 10) for (let lane = 0; lane < 3; lane++) shoveEvery.push({ tick: t, type: "shove", lane })
        const a = runReplay(seed, shoveEvery)
        expect(a.stateHash).toBe(runReplay(seed, shoveEvery).stateHash) // deterministic
        expect(a.stateHash).not.toBe(runReplay(seed, []).stateHash) // shoves actually landed + mattered
        expect(a.simVersion).toBe(2)
    })
})
