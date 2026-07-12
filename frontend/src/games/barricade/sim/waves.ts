/**
 * Seed-driven wave scripting. buildWaves(seed) is a pure function: the whole
 * day's content derives from the seed, so every player faces the same script
 * and the verifier can rebuild it from the seed alone.
 */

import { rngInt, seedToState } from "./rng"
import { LANES, PANOPTICON_EVERY, type ArchetypeId } from "./types"

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
    testudo: { hp: 14_000, speed: 280, damage: 8_000, scrap: 40 }, // shielded vs frontal fire
    swarm: { hp: 1_000, speed: 650, damage: 2_000, scrap: 5 }, // fragile + fast, arrives in numbers
    // The rest of the Core six (B2) — each forces a DIFFERENT verb (GDD-v2 §3).
    rampart: { hp: 40_000, speed: 200, damage: 12_000, scrap: 50 }, // HP sponge: soaks single-target fire
    charger: { hp: 7_000, speed: 500, damage: 10_000, scrap: 30 }, // doubles speed past the charge line
    flanker: { hp: 5_000, speed: 550, damage: 6_000, scrap: 25 }, // hops lanes once mid-field
    mortar: { hp: 12_000, speed: 260, damage: 9_000, scrap: 45 }, // halts + shells from standoff (contact damage ~unreachable)
    // Mini-bosses (B3, hand-placed W5/W9) + the anti-molotov governor.
    marshal: { hp: 60_000, speed: 220, damage: 20_000, scrap: 70 }, // windowed frontal shield
    kettle: { hp: 50_000, speed: 180, damage: 15_000, scrap: 60 }, // lane lock + swarm spawner
    dampener: { hp: 18_000, speed: 240, damage: 10_000, scrap: 45 }, // douses lane fire
    // Stretch machines (C1) — siege-pool only: the deep rounds get new problems.
    carrier: { hp: 30_000, speed: 220, damage: 14_000, scrap: 55 }, // marching spawner
    jammer: { hp: 10_000, speed: 320, damage: 5_000, scrap: 35 }, // rally + turret denial
    mender: { hp: 8_000, speed: 140, damage: 4_000, scrap: 40 }, // rear-guard healer: slower than everything it screens
    panopticon: { hp: 120_000, speed: 100, damage: 30_000, scrap: 150 }, // the siege apex (hand-placed)
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
    flanker: 20,
    walker: 22,
    charger: 28,
    phalanx: 35,
    jammer: 30,
    mender: 38,
    mortar: 40,
    dampener: 42,
    testudo: 45,
    rampart: 50,
    carrier: 55,
    siege: 60,
    broadcast: 0, // boss, hand-placed, never budgeted
    marshal: 0, // W5 mini-boss, hand-placed
    kettle: 0, // W9 mini-boss, hand-placed
    panopticon: 0, // siege apex, hand-placed every PANOPTICON_EVERY rounds
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
    if (wave >= 4) pool.push("phalanx", "charger")
    if (wave >= 5) pool.push("testudo")
    if (wave >= 6) pool.push("siege", "flanker")
    if (wave >= 7) pool.push("rampart")
    if (wave >= 8) pool.push("mortar")
    if (wave >= 9) pool.push("dampener")
    // Stretch machines join only PAST the authored arc (wave index ≥ NORMAL_WAVES
    // = overtime pools): the daily arc keeps its tuned roster; the deep siege
    // gets new problems.
    if (wave >= NORMAL_WAVES) pool.push("carrier", "jammer", "mender")
    return pool
}

/**
 * Spend a budget on spawns from a pool (each pick draws archetype + tick +
 * lane from the rng), then guarantee lane coverage. Shared by the core arc
 * and the overtime siege — rng state threads through so buildWaves' cross-wave
 * sequence is byte-identical to the pre-refactor scripts. Returns the spawns
 * plus the advanced rng state.
 */
function buildSpawns(
    rng: number,
    budget: number,
    pool: ArchetypeId[],
    window: number,
    coverage: boolean,
): [Spawn[], number] {
    let s = rng
    const spawns: Spawn[] = []
    // Guard bounds the loop (cheapest cost is 8); cost > 0 keeps a hand-placed
    // archetype (cost 0: broadcast, marshal, kettle) from becoming an infinite
    // free pick if one is ever added to a pool.
    for (let guard = 0; guard < 400; guard++) {
        const affordable = pool.filter((a) => THREAT_COST[a] > 0 && THREAT_COST[a] <= budget)
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
    // Lane-coverage pass: every lane must appear, so a run can never be decided
    // by an empty lane. Deterministic reassign of the last spawns — but only
    // from a DONOR lane that keeps another occupant, or the pass vacates the
    // very lane it robs (review finding: a sole-occupant donor emptied a lane
    // on ~2.4% of real daily seeds, incl. the served barricade-2026-07-04).
    if (coverage) {
        const counts = new Array(LANES).fill(0)
        for (const sp of spawns) counts[sp.lane]++
        let cursor = spawns.length - 1
        for (let lane = 0; lane < LANES; lane++) {
            if (counts[lane] > 0) continue
            while (cursor >= 0 && counts[spawns[cursor].lane] < 2) cursor--
            if (cursor < 0) break // no safe donor left → stop, never emit a malformed spawn
            counts[spawns[cursor].lane]--
            counts[lane]++
            spawns[cursor] = { ...spawns[cursor], lane }
            cursor--
        }
    }
    return [spawns, s]
}

/**
 * Synchrony clamp + final ordering (shared): spread same-lane spawns so a
 * shared seed can never hand the player an unsurvivable burst in one reaction
 * window (>= SYNC_GAP ticks apart; original-index tiebreak keeps equal-atTick
 * pairs total), then sort on the (atTick, lane) total key.
 */
function spreadAndSort(spawns: Spawn[]): void {
    for (let lane = 0; lane < LANES; lane++) {
        const inLane = spawns
            .map((sp, i) => ({ sp, i }))
            .filter((x) => x.sp.lane === lane)
            .sort((a, b) => a.sp.atTick - b.sp.atTick || a.i - b.i)
        let prev = -SYNC_GAP
        for (const { sp } of inLane) {
            if (sp.atTick < prev + SYNC_GAP) sp.atTick = prev + SYNC_GAP
            prev = sp.atTick
        }
    }
    spawns.sort((a, b) => a.atTick - b.atTick || a.lane - b.lane)
}

export function buildWaves(seed: string): WaveScript[] {
    let s = seedToState(`waves|${seed}`)
    const waves: WaveScript[] = []

    for (let w = 0; w < NORMAL_WAVES; w++) {
        const window = 240 + w * 30 // ticks the wave's spawns spread across
        let spawns: Spawn[]
        ;[spawns, s] = buildSpawns(s, waveBudget(w), poolFor(w), window, w >= 1)
        // Mini-bosses are hand-placed (never budgeted), center lane, mid-window —
        // BEFORE the synchrony clamp so they partake in the spacing and the final
        // sort's (atTick, lane) key stays a total order.
        if (w === 4) spawns.push({ atTick: 180, lane: 1, archetype: "marshal" })
        if (w === 8) spawns.push({ atTick: 240, lane: 1, archetype: "kettle" })
        spreadAndSort(spawns)
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

// Each siege round's spawns land inside this window — short, relentless rounds.
const OVERTIME_WINDOW = 600

// Pure-function cache: a round's script is asked for every tick it runs, and
// its content is a pure function of (seed, round), so caching is safe. Cleared
// wholesale when it grows silly (test sweeps touch many seeds).
const overtimeCache = new Map<string, WaveScript>()

/**
 * The Overtime Siege (v2): once the Broadcast Tower falls, rounds keep coming —
 * each seeded independently (`overtime|seed|round`, so generation is
 * call-count-independent), budgeted by the SAME compounding curve continuing
 * past the arc, drawing from the FULL pool. The engine lifts the hp/speed
 * escalation caps out here, so difficulty out-scales any clear rate: death —
 * and thus termination — is guaranteed by design (GDD-v2 §1/§6). The share
 * card headlines how deep you stood.
 */
export function overtimeWave(seed: string, round: number): WaveScript {
    const key = seed + "|" + round
    const hit = overtimeCache.get(key)
    if (hit) return hit
    if (overtimeCache.size > 4_096) overtimeCache.clear()
    const rng = seedToState(`overtime|${seed}|${round}`)
    const [spawns] = buildSpawns(rng, waveBudget(BOSS_WAVE + round), poolFor(NORMAL_WAVES), OVERTIME_WINDOW, true)
    // Every PANOPTICON_EVERY-th round, the apex walks in — hand-placed like the
    // mini-bosses, center lane, before the clamp so ordering stays total.
    if (round % PANOPTICON_EVERY === 0) spawns.push({ atTick: 1, lane: 1, archetype: "panopticon" })
    spreadAndSort(spawns)
    const w: WaveScript = { wave: BOSS_WAVE + round, spawns }
    // Frozen: the cache hands the SAME object to every caller (live loop AND
    // the in-browser replay). An in-place tweak would corrupt later runs — and
    // the self-check would share the corruption while a fresh-process verifier
    // diverged. Freezing turns that future bug into an immediate throw.
    for (const sp of spawns) Object.freeze(sp)
    Object.freeze(spawns)
    Object.freeze(w)
    overtimeCache.set(key, w)
    return w
}
