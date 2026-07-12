/**
 * Core engine: initState / applyEvent / tick. Pure — every function returns a
 * new state object and never mutates its input; all arithmetic is integer.
 *
 * Tick order (fixed): spawn due enemies -> advance -> combat -> contact ->
 * wave/phase bookkeeping. Changing this order changes replays: bump SIM_VERSION.
 */

import { seedToState } from "./rng"
import { ARCHETYPES, BOSS_WAVE, type WaveScript } from "./waves"
import {
    BARRICADE_MAX_HP,
    LANE_LENGTH,
    LANES,
    RALLY_FULL,
    RUN_MAX_TICKS,
    type Enemy,
    type FireField,
    type Projectile,
    type SimEvent,
    type SimState,
} from "./types"

// ── tuning (v0, integers only) ───────────────────────────────────────────────
const PLAYER_DPS_PER_TICK = 2_500 // on the front enemy of the player's lane
const TURRET_DPS_PER_TICK = 1_200
const ARMED_DPS_PER_TICK = 600 // crowd allies, every lane
const RALLY_FILL_PER_KILL = 60
const RALLY_CLEAR_PCT = 40 // % of each lane cleared, farthest-first
const NETTER_STUN_TICKS = 45
const CHOICE_PHASE_TICKS = 120
const REPAIR_HP = 18_000
const TURRET_COST = 40
const TURRET_TICKS = 900
const ARM_COST = 30
const ARM_TICKS = 600
const SCORE_PER_SCRAP = 10
const WAVE_CLEAR_BONUS = 5_000
const CLEAN_WAVE_BONUS = 3_000
const WIN_BONUS = 25_000
// ── molotov (v2), integers only ──────────────────────────────────────────────
const MOLOTOV_MAX = 3_000 // charge cap (banks ~3 throws)
const MOLOTOV_COST = 1_000 // charge spent per throw
const MOLOTOV_REGEN = 4 // charge regained per tick (time)
const MOLOTOV_PER_KILL = 80 // charge per kill (skill-fed, so every player has it)
const MOLOTOV_CD = 30 // ticks between throws (can't dump a full bank in one frame)
const MOLOTOV_RADIUS = 12_000 // same-lane burst reach (milli-units)
const MOLOTOV_BURST = 6_000 // burst milli-HP dealt on impact
const FLIGHT_BASE = 12 // min flight ticks (a throw at the barricade)
const FLIGHT_PER_DIST = 18 // extra flight ticks for a max-distance throw
const FIRE_RADIUS = 9_000 // fire-zone half-width (milli-units)
const FIRE_DPS = 500 // burn milli-HP per tick
const FIRE_DURATION = 180 // burn ticks (~3s)
const FIRE_SLOW_NUM = 3 // machines caught in fire move at 3/5 speed (−40%)
const FIRE_SLOW_DEN = 5
// Wave spawn windows come from waves.ts; a wave "ends" when its script is
// exhausted and no enemies remain on the field.

export function initState(seed: string): SimState {
    return {
        tick: 0,
        rngState: seedToState(`engine|${seed}`),
        playerLane: 0,
        stunnedUntil: 0,
        barricadeHp: BARRICADE_MAX_HP,
        rallyMeter: 0,
        scrap: 0,
        wave: 0,
        phase: "wave",
        phaseUntil: 0,
        enemies: [],
        nextEnemyId: 0,
        score: 0,
        cleanWave: true,
        turrets: new Array(LANES).fill(0),
        armed: 0,
        projectiles: [],
        hazards: [],
        molotovCharge: MOLOTOV_MAX,
        molotovReadyAt: 0,
        nextThrowId: 0,
    }
}

export function applyEvent(state: SimState, ev: SimEvent): SimState {
    if (state.phase === "won" || state.phase === "lost") return state
    switch (ev.type) {
        case "move": {
            if (state.tick < state.stunnedUntil) return state
            // Integer guard: a non-integer/NaN lane slips past magnitude checks and,
            // once the log crosses JSON (NaN→null), diverges the client from the
            // verifier. isInteger rejects NaN/null/float identically on both sides.
            if (!Number.isInteger(ev.lane)) return state
            if (ev.lane < 0 || ev.lane >= LANES || ev.lane === state.playerLane) return state
            return { ...state, playerLane: ev.lane }
        }
        case "rally": {
            if (state.rallyMeter < RALLY_FULL) return state
            // Clear RALLY_CLEAR_PCT% of each lane, farthest-first (closest to
            // the barricade are pushed back hardest by the crowd surge).
            const survivors: Enemy[] = []
            for (let lane = 0; lane < LANES; lane++) {
                const inLane = state.enemies.filter((e) => e.lane === lane).sort((a, b) => b.pos - a.pos)
                const cleared = Math.floor((inLane.length * RALLY_CLEAR_PCT) / 100)
                survivors.push(...inLane.slice(cleared))
            }
            survivors.sort((a, b) => a.id - b.id)
            const killed = state.enemies.length - survivors.length
            let scrapGain = 0
            const kept = new Set(survivors.map((e) => e.id))
            for (const e of state.enemies) {
                if (!kept.has(e.id)) scrapGain += ARCHETYPES[e.archetype].scrap
            }
            return {
                ...state,
                enemies: survivors,
                rallyMeter: 0,
                scrap: state.scrap + scrapGain,
                score: state.score + killed * SCORE_PER_SCRAP + scrapGain * SCORE_PER_SCRAP,
            }
        }
        case "choice": {
            if (state.phase !== "choice") return state
            if (ev.choice === "repair") {
                return {
                    ...state,
                    barricadeHp: Math.min(BARRICADE_MAX_HP, state.barricadeHp + REPAIR_HP),
                    phase: "wave",
                }
            }
            if (ev.choice === "turret" && state.scrap >= TURRET_COST) {
                const turrets = state.turrets.slice()
                turrets[state.playerLane] = TURRET_TICKS
                return { ...state, turrets, scrap: state.scrap - TURRET_COST, phase: "wave" }
            }
            if (ev.choice === "arm" && state.scrap >= ARM_COST) {
                return { ...state, armed: ARM_TICKS, scrap: state.scrap - ARM_COST, phase: "wave" }
            }
            return state
        }
        case "throw": {
            // No-op (state unchanged) if it can't legally fire — exactly like a
            // move-while-stunned — so a spoofed log is rejected by the verifier.
            if (state.phase === "choice") return state // frozen field: no throwing
            if (state.tick < state.molotovReadyAt) return state
            if (state.molotovCharge < MOLOTOV_COST) return state
            // Integer guards (see move): NaN/null/float dist would diverge the
            // client (NaN, projectile dropped) from the verifier (null→0, impacts).
            if (!Number.isInteger(ev.lane) || ev.lane < 0 || ev.lane >= LANES) return state
            if (!Number.isInteger(ev.dist) || ev.dist < 0 || ev.dist > LANE_LENGTH) return state
            // Farther throws hang longer, so you lead more. Integer division.
            const flight = FLIGHT_BASE + Math.floor(((LANE_LENGTH - ev.dist) * FLIGHT_PER_DIST) / LANE_LENGTH)
            return {
                ...state,
                molotovCharge: state.molotovCharge - MOLOTOV_COST,
                molotovReadyAt: state.tick + MOLOTOV_CD,
                projectiles: [
                    ...state.projectiles,
                    { id: state.nextThrowId, lane: ev.lane, dist: ev.dist, impactTick: state.tick + flight },
                ],
                nextThrowId: state.nextThrowId + 1,
            }
        }
    }
}

/** Damage the front (highest pos) enemy of a lane; returns [enemies, kills, scrapGain, rallyGain]. */
function damageFront(
    enemies: Enemy[],
    lane: number,
    dmg: number,
): [Enemy[], number, number, number] {
    let frontIdx = -1
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i]
        if (e.lane !== lane) continue
        if (frontIdx === -1 || e.pos > enemies[frontIdx].pos) frontIdx = i
    }
    if (frontIdx === -1) return [enemies, 0, 0, 0]
    const target = enemies[frontIdx]
    const hp = target.hp - dmg
    if (hp > 0) {
        const next = enemies.slice()
        next[frontIdx] = { ...target, hp }
        return [next, 0, 0, 0]
    }
    const next = enemies.filter((_, i) => i !== frontIdx)
    return [next, 1, ARCHETYPES[target.archetype].scrap, RALLY_FILL_PER_KILL]
}

/**
 * Molotov burst: damage every enemy in `lane` within `radius` of `center`.
 * Per-enemy damage is independent, so iteration order can't change the result
 * (keep it that way — no shared splash pool). Returns [enemies, kills, scrap, rally].
 */
function burstDamage(
    enemies: Enemy[],
    lane: number,
    center: number,
    radius: number,
    dmg: number,
): [Enemy[], number, number, number] {
    let kills = 0
    let scrap = 0
    let rally = 0
    const next: Enemy[] = []
    for (const e of enemies) {
        if (e.lane !== lane || Math.abs(e.pos - center) > radius) {
            next.push(e)
            continue
        }
        const hp = e.hp - dmg
        if (hp > 0) {
            next.push({ ...e, hp })
        } else {
            kills++
            scrap += ARCHETYPES[e.archetype].scrap
            rally += RALLY_FILL_PER_KILL
        }
    }
    return [next, kills, scrap, rally]
}

/**
 * Fire tick: every machine takes the SUM of the fire fields covering it (so
 * overlapping fields and iteration order can't change the result). Returns
 * [enemies, kills, scrap, rally].
 */
function burnTick(enemies: Enemy[], hazards: FireField[]): [Enemy[], number, number, number] {
    let kills = 0
    let scrap = 0
    let rally = 0
    const next: Enemy[] = []
    for (const e of enemies) {
        let dmg = 0
        for (const h of hazards) {
            if (h.lane === e.lane && e.pos >= h.posLo && e.pos <= h.posHi) dmg += h.dmgPerTick
        }
        if (dmg === 0) {
            next.push(e)
            continue
        }
        const hp = e.hp - dmg
        if (hp > 0) {
            next.push({ ...e, hp })
        } else {
            kills++
            scrap += ARCHETYPES[e.archetype].scrap
            rally += RALLY_FILL_PER_KILL
        }
    }
    return [next, kills, scrap, rally]
}

export function tick(state: SimState, waves: WaveScript[]): SimState {
    if (state.phase === "won" || state.phase === "lost") return state
    if (state.tick >= RUN_MAX_TICKS) return { ...state, phase: "lost" }

    let s: SimState = {
        ...state,
        tick: state.tick + 1,
        enemies: state.enemies.slice(),
        turrets: state.turrets.slice(),
        projectiles: state.projectiles.slice(),
        hazards: state.hazards.slice(),
    }

    // Choice phase: frozen field, waiting for the player (or the timer).
    if (s.phase === "choice") {
        if (s.tick >= s.phaseUntil) s = { ...s, phase: "wave" }
        else return s
    }

    const script = waves[s.wave]
    const bossAlive = s.enemies.some((e) => e.archetype === "broadcast")

    // 1. Spawn: this wave's script entries due at the wave-local tick.
    //    waveStartTick is tracked via phaseUntil when a wave begins (see below);
    //    we store wave-local time as (global tick - phaseUntil).
    const waveLocal = s.tick - s.phaseUntil
    for (const sp of script.spawns) {
        if (sp.atTick === waveLocal) {
            const a = ARCHETYPES[sp.archetype]
            s.enemies.push({
                id: s.nextEnemyId++,
                archetype: sp.archetype,
                lane: sp.lane,
                pos: 0,
                hp: a.hp,
                speed: a.speed,
            })
        }
    }

    // Fire zones: drop burnt-out fields, then flag machines caught inside one so
    // they advance slowed this tick (computed on pre-advance positions; a field
    // spawned by this tick's impact only slows from next tick).
    s.hazards = s.hazards.filter((h) => s.tick < h.expiresAtTick)
    const slowed = new Set<number>()
    for (const e of s.enemies) {
        for (const h of s.hazards) {
            if (h.lane === e.lane && e.pos >= h.posLo && e.pos <= h.posHi) {
                slowed.add(e.id)
                break
            }
        }
    }

    // 2. Advance (fire slows any machine caught in a burn zone).
    s.enemies = s.enemies.map((e) => ({
        ...e,
        pos: e.pos + (slowed.has(e.id) ? Math.floor((e.speed * FIRE_SLOW_NUM) / FIRE_SLOW_DEN) : e.speed),
    }))

    let scrapGain = 0
    let rallyGain = 0
    let killCount = 0 // burst + combat kills this tick → feeds the molotov charge

    // 2b. Molotov impacts due this tick — same-lane integer burst AoE (resolved
    // after advance, before combat, per the fixed tick order).
    if (s.projectiles.length > 0) {
        const flying: Projectile[] = []
        for (const p of s.projectiles) {
            if (p.impactTick !== s.tick) {
                if (p.impactTick > s.tick) flying.push(p) // still airborne (drop stale past-due)
                continue
            }
            const [next, k, sc, ra] = burstDamage(s.enemies, p.lane, p.dist, MOLOTOV_RADIUS, MOLOTOV_BURST)
            s.enemies = next
            killCount += k
            scrapGain += sc
            rallyGain += ra
            // Leave a lingering fire zone at the impact point.
            s.hazards.push({
                id: p.id,
                lane: p.lane,
                posLo: p.dist - FIRE_RADIUS,
                posHi: p.dist + FIRE_RADIUS,
                dmgPerTick: FIRE_DPS,
                expiresAtTick: s.tick + FIRE_DURATION,
            })
        }
        s.projectiles = flying
    }

    // 2c. Burn: fire zones damage every machine caught in them (after impacts,
    // before combat), so a burn-lethal machine dies before it can contact-damage.
    if (s.hazards.length > 0) {
        const [next, k, sc, ra] = burnTick(s.enemies, s.hazards)
        s.enemies = next
        killCount += k
        scrapGain += sc
        rallyGain += ra
    }

    // 3. Combat: player lane front target, turret lanes, armed crowd.
    const applyDamage = (lane: number, dmg: number) => {
        const [next, k, sc, ra] = damageFront(s.enemies, lane, dmg)
        s.enemies = next
        killCount += k
        scrapGain += sc
        rallyGain += ra
    }
    applyDamage(s.playerLane, PLAYER_DPS_PER_TICK)
    for (let lane = 0; lane < LANES; lane++) {
        if (s.turrets[lane] > 0) {
            s.turrets[lane]--
            applyDamage(lane, TURRET_DPS_PER_TICK)
        }
        if (s.armed > 0) applyDamage(lane, ARMED_DPS_PER_TICK)
    }
    if (s.armed > 0) s.armed--

    // 4. Contact: enemies reaching the barricade deal damage and despawn.
    let hp = s.barricadeHp
    let stunnedUntil = s.stunnedUntil
    let cleanWave = s.cleanWave
    const remaining: Enemy[] = []
    for (const e of s.enemies) {
        if (e.pos >= LANE_LENGTH) {
            hp -= ARCHETYPES[e.archetype].damage
            cleanWave = false
            if (e.archetype === "netter" && e.lane === s.playerLane) {
                stunnedUntil = s.tick + NETTER_STUN_TICKS
            }
        } else {
            remaining.push(e)
        }
    }
    s.enemies = remaining

    // 5. Meters + score.
    const bossFactor = bossAlive ? 2 : 1 // broadcast tower jams the rally signal
    s = {
        ...s,
        barricadeHp: hp,
        stunnedUntil,
        cleanWave,
        scrap: s.scrap + scrapGain,
        rallyMeter: Math.min(RALLY_FULL, s.rallyMeter + Math.floor(rallyGain / bossFactor)),
        molotovCharge: Math.min(MOLOTOV_MAX, s.molotovCharge + MOLOTOV_REGEN + killCount * MOLOTOV_PER_KILL),
        score: s.score + scrapGain * SCORE_PER_SCRAP,
    }

    // 6. Terminal + wave bookkeeping.
    if (s.barricadeHp <= 0) return { ...s, barricadeHp: 0, phase: "lost" }

    const scriptDone = script.spawns.every((sp) => sp.atTick < waveLocal)
    if (scriptDone && s.enemies.length === 0) {
        const waveBonus = WAVE_CLEAR_BONUS + (s.cleanWave ? CLEAN_WAVE_BONUS : 0)
        if (s.wave === BOSS_WAVE) {
            return { ...s, score: s.score + waveBonus + WIN_BONUS, phase: "won" }
        }
        // Between waves: a short choice window, then the next wave. phaseUntil
        // doubles as the next wave's start tick (wave-local time origin).
        return {
            ...s,
            wave: s.wave + 1,
            phase: s.wave + 1 === BOSS_WAVE ? "boss" : "choice",
            phaseUntil: s.tick + CHOICE_PHASE_TICKS,
            score: s.score + waveBonus,
            cleanWave: true,
        }
    }

    // The boss "wave" phase label is cosmetic-plus (renderer uses it); once the
    // boss wave's field opens we keep phase as "wave"-like behavior via "boss".
    return s
}
