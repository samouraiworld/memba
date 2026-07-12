/**
 * Seed-driven wave scripting. buildWaves(seed) is a pure function: the whole
 * day's content derives from the seed, so every player faces the same script
 * and the verifier can rebuild it from the seed alone.
 */

import { rngInt, seedToState } from "./rng"
import { LANES, type ArchetypeId } from "./types"

export type Spawn = { atTick: number; lane: number; archetype: ArchetypeId }
export type WaveScript = { wave: number; spawns: Spawn[] }

// v1 tuning. All milli-units, integers only. damage = barricade milli-HP lost
// on contact; scrap = in-run currency dropped. Speeds are sized so the WHOLE
// script provably fits RUN_MAX_TICKS (see the makespan test in waves.test.ts):
// review round found the v0 numbers made winning mathematically unreachable.
export const ARCHETYPES: Record<ArchetypeId, { hp: number; speed: number; damage: number; scrap: number }> = {
    drone: { hp: 3_000, speed: 700, damage: 4_000, scrap: 10 },
    walker: { hp: 8_000, speed: 420, damage: 9_000, scrap: 25 },
    phalanx: { hp: 16_000, speed: 300, damage: 7_000, scrap: 35 },
    netter: { hp: 5_000, speed: 600, damage: 3_000, scrap: 20 },
    siege: { hp: 26_000, speed: 250, damage: 18_000, scrap: 60 },
    broadcast: { hp: 90_000, speed: 120, damage: 25_000, scrap: 0 },
    // v2 machines (not yet scripted into waves — the threat-budget model in a
    // following PR schedules them; behaviours live in engine.ts).
    testudo: { hp: 14_000, speed: 280, damage: 8_000, scrap: 40 }, // shielded vs frontal fire
    swarm: { hp: 1_000, speed: 650, damage: 2_000, scrap: 5 }, // fragile + fast, arrives in numbers
}

const NORMAL_WAVES = 10 // v2: a longer Core Arc (was 7)
const SYNC_GAP = 15 // min ticks between same-lane spawns (synchrony clamp)
export const BOSS_WAVE = NORMAL_WAVES // 0-based index -> the last wave
export const WAVE_TOTAL = NORMAL_WAVES + 1

// v2 threat-budget model: each wave gets a budget and spends it buying spawns
// from its pool (each archetype costs its threat value). Replaces the flat
// count = 4 + 2w — cleaner to tune and it gates archetype density by cost.
export const THREAT_COST: Record<ArchetypeId, number> = {
    swarm: 8,
    drone: 10,
    netter: 14,
    walker: 22,
    phalanx: 35,
    testudo: 45,
    siege: 60,
    broadcast: 0, // boss, hand-placed, never budgeted
}

/** Per-wave threat budget (0-indexed): modest floor, compounds ~+18%/wave. */
export function waveBudget(wave: number): number {
    let b = 40
    for (let i = 0; i < wave; i++) b = b + 12 + Math.floor((b * 15) / 100)
    return b
}

// Archetype pool widens as waves progress (new machines introduced over time).
function poolFor(wave: number): ArchetypeId[] {
    const pool: ArchetypeId[] = ["drone"]
    if (wave >= 1) pool.push("swarm")
    if (wave >= 2) pool.push("netter")
    if (wave >= 3) pool.push("walker")
    if (wave >= 4) pool.push("phalanx")
    if (wave >= 5) pool.push("testudo")
    if (wave >= 6) pool.push("siege")
    return pool
}

export function buildWaves(seed: string): WaveScript[] {
    let s = seedToState(`waves|${seed}`)
    const waves: WaveScript[] = []

    for (let w = 0; w < NORMAL_WAVES; w++) {
        const window = 240 + w * 30 // ticks the wave's spawns spread across
        const pool = poolFor(w)
        const spawns: Spawn[] = []
        // Spend the wave budget on affordable spawns; each pick also draws a
        // tick + lane. Guard bounds the loop (cheapest cost is 8).
        let budget = waveBudget(w)
        for (let guard = 0; guard < 400; guard++) {
            const affordable = pool.filter((a) => THREAT_COST[a] <= budget)
            if (affordable.length === 0) break
            let atTick: number, lane: number, pick: number
            ;[pick, s] = rngInt(s, affordable.length)
            const archetype = affordable[pick]
            budget -= THREAT_COST[archetype]
            ;[atTick, s] = rngInt(s, window)
            ;[lane, s] = rngInt(s, LANES)
            // +1: wave-local time starts at 1 on a wave's first processed tick
            // (the engine increments tick before spawning), so atTick 0 would
            // never fire for wave 0. Boss-wave spawns keep explicit ticks.
            spawns.push({ atTick: atTick + 1, lane, archetype })
        }
        // Lane-coverage pass (waves >= 1): every lane must appear, so a run can
        // never be decided by an empty lane. Deterministic round-robin reassign
        // of the last spawns.
        if (w >= 1) {
            const used = new Set(spawns.map((sp) => sp.lane))
            let cursor = spawns.length - 1
            for (let lane = 0; lane < LANES; lane++) {
                if (!used.has(lane)) {
                    if (cursor < 0) break // fewer spawns than lanes → stop, never emit a malformed spawn
                    spawns[cursor] = { ...spawns[cursor], lane }
                    cursor--
                }
            }
        }
        // Synchrony clamp: spread same-lane spawns so a shared seed can never hand
        // the player an unsurvivable burst in one reaction window. Deterministically
        // push clustered same-lane spawns later (>= SYNC_GAP ticks apart).
        for (let lane = 0; lane < LANES; lane++) {
            const inLane = spawns.filter((sp) => sp.lane === lane).sort((a, b) => a.atTick - b.atTick)
            let prev = -SYNC_GAP
            for (const sp of inLane) {
                if (sp.atTick < prev + SYNC_GAP) sp.atTick = prev + SYNC_GAP
                prev = sp.atTick
            }
        }
        spawns.sort((a, b) => a.atTick - b.atTick || a.lane - b.lane)
        waves.push({ wave: w, spawns })
    }

    // Boss wave: the Broadcast Tower plus a drone escort.
    const bossSpawns: Spawn[] = [{ atTick: 0, lane: 1, archetype: "broadcast" }]
    for (let i = 0; i < 6; i++) {
        bossSpawns.push({ atTick: 90 * (i + 1), lane: i % LANES, archetype: "drone" })
    }
    waves.push({ wave: BOSS_WAVE, spawns: bossSpawns })

    return waves
}
