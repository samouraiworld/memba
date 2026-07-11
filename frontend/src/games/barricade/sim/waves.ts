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
}

const NORMAL_WAVES = 7
export const BOSS_WAVE = NORMAL_WAVES // 0-based index 7 -> the 8th wave
export const WAVE_TOTAL = NORMAL_WAVES + 1

// Archetype pool widens as waves progress.
function poolFor(wave: number): ArchetypeId[] {
    const pool: ArchetypeId[] = ["drone"]
    if (wave >= 2) pool.push("netter")
    if (wave >= 3) pool.push("walker")
    if (wave >= 4) pool.push("phalanx")
    if (wave >= 5) pool.push("siege")
    return pool
}

export function buildWaves(seed: string): WaveScript[] {
    let s = seedToState(`waves|${seed}`)
    const waves: WaveScript[] = []

    for (let w = 0; w < NORMAL_WAVES; w++) {
        const count = 4 + w * 2
        const window = 240 + w * 30 // ticks the wave's spawns spread across
        const pool = poolFor(w)
        const spawns: Spawn[] = []
        for (let i = 0; i < count; i++) {
            let atTick: number, lane: number, pick: number
            ;[atTick, s] = rngInt(s, window)
            ;[lane, s] = rngInt(s, LANES)
            ;[pick, s] = rngInt(s, pool.length)
            // +1: wave-local time starts at 1 on a wave's first processed tick
            // (the engine increments tick before spawning), so atTick 0 would
            // never fire for wave 0. Boss-wave spawns keep explicit ticks.
            spawns.push({ atTick: atTick + 1, lane, archetype: pool[pick] })
        }
        // Lane-coverage pass (waves >= 1): every lane must appear, so a run can
        // never be decided by an empty lane. Deterministic round-robin reassign
        // of the last spawns.
        if (w >= 1) {
            const used = new Set(spawns.map((sp) => sp.lane))
            let cursor = spawns.length - 1
            for (let lane = 0; lane < LANES; lane++) {
                if (!used.has(lane)) {
                    spawns[cursor] = { ...spawns[cursor], lane }
                    cursor--
                }
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
