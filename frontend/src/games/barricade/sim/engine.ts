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
    }
}

export function applyEvent(state: SimState, ev: SimEvent): SimState {
    if (state.phase === "won" || state.phase === "lost") return state
    switch (ev.type) {
        case "move": {
            if (state.tick < state.stunnedUntil) return state
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

export function tick(state: SimState, waves: WaveScript[]): SimState {
    if (state.phase === "won" || state.phase === "lost") return state
    if (state.tick >= RUN_MAX_TICKS) return { ...state, phase: "lost" }

    let s: SimState = { ...state, tick: state.tick + 1, enemies: state.enemies.slice(), turrets: state.turrets.slice() }

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

    // 2. Advance.
    s.enemies = s.enemies.map((e) => ({ ...e, pos: e.pos + e.speed }))

    // 3. Combat: player lane front target, turret lanes, armed crowd.
    let scrapGain = 0
    let rallyGain = 0
    const applyDamage = (lane: number, dmg: number) => {
        const [next, , sc, ra] = damageFront(s.enemies, lane, dmg)
        s.enemies = next
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
