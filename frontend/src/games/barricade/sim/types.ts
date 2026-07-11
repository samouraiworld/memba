/**
 * MEMBA: BARRICADE — deterministic sim types and constants.
 *
 * DETERMINISM RULES (every file under sim/ must obey):
 *  - integers only: positions, HP, meters are milli-units — never floats
 *  - no Math.random (seeded rng.ts only), no Date/performance reads
 *  - fixed iteration order (arrays, never object-key iteration)
 *  - sim never imports from render/, hooks/, React, or the DOM
 * The server-side verifier (G3) re-runs this exact code over an input log;
 * any behavior change must bump SIM_VERSION.
 */

export const TICKS_PER_SECOND = 60
export const LANES = 3
export const BARRICADE_MAX_HP = 100_000 // milli-HP
export const RUN_MAX_TICKS = 120 * TICKS_PER_SECOND
export const LANE_LENGTH = 100_000 // milli-units, spawn (0) -> barricade
export const RALLY_FULL = 1_000
export const SIM_VERSION = 1

export type ArchetypeId = "drone" | "walker" | "phalanx" | "netter" | "siege" | "broadcast"

export type Enemy = {
    id: number
    archetype: ArchetypeId
    lane: number // 0..LANES-1
    pos: number // milli-units from spawn (0) toward barricade (LANE_LENGTH)
    hp: number // milli-HP
    speed: number // milli-units per tick
}

export type Choice = "repair" | "turret" | "arm"

export type SimEvent =
    | { tick: number; type: "move"; lane: number }
    | { tick: number; type: "rally" }
    | { tick: number; type: "choice"; choice: Choice }

export type SimPhase = "wave" | "choice" | "boss" | "won" | "lost"

export type SimState = {
    tick: number
    rngState: number
    playerLane: number
    stunnedUntil: number // tick until which lane-moves are ignored (netter hit)
    barricadeHp: number
    rallyMeter: number // 0..RALLY_FULL
    scrap: number
    wave: number
    phase: SimPhase
    phaseUntil: number // tick when a timed phase (choice) ends
    enemies: Enemy[]
    nextEnemyId: number
    score: number
    cleanWave: boolean // no barricade damage so far this wave
    turrets: number[] // remaining ticks per lane, 0 = none
    armed: number // crowd-allies ticks remaining (all lanes)
}
