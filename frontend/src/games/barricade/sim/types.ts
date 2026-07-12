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
 *
 * React shell note: repo lint enforces react-hooks/set-state-in-effect —
 * derive from props/state instead of mirroring via useEffect+setState.
 */

export const TICKS_PER_SECOND = 60
export const LANES = 3
export const BARRICADE_MAX_HP = 100_000 // milli-HP
export const RUN_MAX_TICKS = 240 * TICKS_PER_SECOND // v2: the longer Core Arc + ten 4s spend windows
export const LANE_LENGTH = 100_000 // milli-units, spawn (0) -> barricade
export const RALLY_FULL = 1_000
// v2: the "deepening" — adds the molotov (active player verb) + follow-on
// mechanics. A breaking sim-shape change; the verifier routes frozen v1 seasons
// by the tagged build. Stays 2 across the in-development Phase-A PRs (nothing is
// released on v2 until the season-boundary cutover).
export const SIM_VERSION = 2

export type ArchetypeId =
    | "drone"
    | "walker"
    | "phalanx"
    | "netter"
    | "siege"
    | "broadcast"
    | "testudo" // shield-wall: near-immune to frontal fire, full damage from molotov burst/burn
    | "swarm" // fragile fast flyer that arrives in numbers
    | "rampart" // slab tread-crawler: an HP sponge that monopolizes single-target fire
    | "charger" // wedge ram-bot: doubles speed past the charge line — intercept it early
    | "flanker" // vaulting crab-drone: hops once to the least-crowded lane mid-field
    | "mortar" // standoff siege-mortar: halts up-field and shells the barricade on a cadence
    | "marshal" // W5 mini-boss: a frontal shield that only DROPS in timed windows
    | "kettle" // W9 mini-boss: kettles its street (no entry) + deploys swarm on a cadence
    | "dampener" // water-cannon tanker: douses molotov ground-fire in its lane

export type Enemy = {
    id: number
    archetype: ArchetypeId
    lane: number // 0..LANES-1
    pos: number // milli-units from spawn (0) toward barricade (LANE_LENGTH)
    hp: number // milli-HP
    speed: number // milli-units per tick
    bornTick: number // spawn tick — drives cadence behaviors (mortar volleys)
    hasFlanked: boolean // a flanker's lane-hop is one-shot
}

// The between-wave shop verbs (v2 economy): purchases stack inside one window;
// "patch" is the once-per-run free emergency repair; "done" leaves the shop.
export type Choice = "repair" | "patch" | "turret" | "arm" | "refill" | "done"

// A molotov in flight. Resolution needs only the impact tick — the visual arc is
// render-only and never read back into the sim (keeps it float-free).
export type Projectile = {
    id: number
    lane: number
    dist: number // target pos in milli-units (0 = spawn end, LANE_LENGTH = barricade)
    impactTick: number
}

// A lingering fire zone on one lane (left by a molotov impact). Each tick it
// damages and slows any machine whose pos falls in [posLo, posHi], until it
// burns out at expiresAtTick.
export type FireField = {
    id: number
    lane: number
    posLo: number
    posHi: number
    dmgPerTick: number
    expiresAtTick: number
}

export type SimEvent =
    | { tick: number; type: "move"; lane: number }
    | { tick: number; type: "rally" }
    | { tick: number; type: "choice"; choice: Choice }
    | { tick: number; type: "throw"; lane: number; dist: number }
    | { tick: number; type: "shove"; lane: number }

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
    // ── molotov (v2) ──────────────────────────────────────────────────────────
    projectiles: Projectile[] // molotovs in flight, resolved at impactTick
    hazards: FireField[] // active fire zones (burn + slow)
    molotovCharge: number // 0..MOLOTOV_MAX; a throw costs MOLOTOV_COST
    molotovReadyAt: number // tick until which throwing is on cooldown
    nextThrowId: number // monotonic projectile id (never reused)
    shoveReadyAt: number // tick until which shove is on cooldown
    patchUsed: boolean // the free emergency micro-repair is once per run
}
