/**
 * Core engine: initState / applyEvent / tick. Pure — every function returns a
 * new state object and never mutates its input; all arithmetic is integer.
 *
 * Tick order (fixed): spawn due enemies -> kettle litters -> flanker lane-hops
 * -> drop expired fire + flag slowed (post-hop lanes) -> advance (charger
 * doubling, mortar standoff cap) -> molotov impacts due -> burn -> dampener
 * douse -> mortar shelling accrues -> combat (marshal window) -> contact
 * (+ shell damage) -> meters/score -> terminal + wave bookkeeping.
 * Changing this order changes replays: bump SIM_VERSION.
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
const SPEND_PHASE_TICKS = 240 // the between-wave shop window (4s, leavable via "done")
// v2 economy: repairs cost scrap (the free safe-pick is dead) with ONE free
// emergency patch per run as the anti-death-spiral valve; scrap also buys a
// molotov refill, so the purse competes across repair/turret/arm/refill.
export const REPAIR_COST = 25
const REPAIR_HP = 18_000
export const PATCH_HP = 8_000
export const REFILL_COST = 20
export const TURRET_COST = 40
const TURRET_TICKS = 900
export const ARM_COST = 30
const ARM_TICKS = 600
const SCORE_PER_SCRAP = 10
const WAVE_CLEAR_BONUS = 5_000
const CLEAN_WAVE_BONUS = 3_000
const WIN_BONUS = 25_000
// ── molotov (v2), integers only ──────────────────────────────────────────────
export const MOLOTOV_MAX = 3_000 // charge cap (banks ~3 throws)
export const MOLOTOV_COST = 1_000 // charge spent per throw
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
// ── shove + shield (v2) ──────────────────────────────────────────────────────
const SHOVE_DISTANCE = 15_000 // knock the front machine back this far (milli-units)
const SHOVE_CD = 180 // ticks between shoves (~3s)
const SHIELD_REDUCT_PCT = 40 // testudo takes (100−40)% from frontal fire; molotov ignores it
// ── B2 machine behaviors (v2), integers only ─────────────────────────────────
export const CHARGE_AT = 60_000 // a charger past this pos moves at double speed
export const FLANK_AT = 50_000 // a flanker at/past this pos hops lanes (once)
export const MORTAR_STANDOFF = 60_000 // a mortar halts here and shells from range
export const MORTAR_PERIOD = 150 // ticks between volleys, phased by bornTick
export const MORTAR_SHELL = 3_000 // barricade milli-HP per volley
// ── B3 mini-bosses + governor (v2), integers only ────────────────────────────
export const MARSHAL_CYCLE = 135 // shield cycle length in ticks, phased by bornTick
export const MARSHAL_UP = 90 // shield raised for this slice of the cycle …
export const MARSHAL_REDUCT_PCT = 85 // … blunting frontal fire this hard (window teaches timing)
export const KETTLE_PERIOD = 120 // ticks between swarm deployments, phased by bornTick
export const KETTLE_LITTER = 2 // swarm children per deployment
export const ENEMY_CAP = 80 // global live-enemy cap: spawners refuse to mint past it (verifier cost)
// ── per-wave escalation (v2): machines get tougher + faster as waves climb.
// Speed is capped so travel-time never outruns kill-time (the winnability guard).
const ESCALATE_HP_PER_WAVE = 6 // +6% HP per wave …
const ESCALATE_HP_CAP = 160 // … up to +60%
const ESCALATE_SPD_PER_WAVE = 2 // +2% speed per wave …
const ESCALATE_SPD_CAP = 130 // … up to +30% (the guardrail)
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
        shoveReadyAt: 0,
        patchUsed: false,
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
            // A kettle on the field "kettles" its street: entry is blocked
            // while it stands (leaving is always allowed) — counter it from
            // outside with a lob or a turret. Presence-based: kills leave the
            // array immediately, so present ⇒ standing.
            for (const e of state.enemies) {
                if (e.archetype === "kettle" && e.lane === ev.lane) return state
            }
            return { ...state, playerLane: ev.lane }
        }
        case "rally": {
            if (state.phase === "choice") return state // frozen field: the wave only ends clear, so this would waste the meter
            if (state.rallyMeter < RALLY_FULL) return state
            // Clear RALLY_CLEAR_PCT% of each lane, farthest-first (closest to
            // the barricade are pushed back hardest by the crowd surge). The id
            // tiebreak keeps pos ties total — which of two stacked machines
            // survives must come from the state, not from sort stability
            // (shove/fire-slow make same-pos pairs reachable in honest play).
            const survivors: Enemy[] = []
            for (let lane = 0; lane < LANES; lane++) {
                const inLane = state.enemies.filter((e) => e.lane === lane).sort((a, b) => b.pos - a.pos || a.id - b.id)
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
            // The between-wave shop (v2 economy): a purchase no longer ends the
            // phase — the player buys until the purse runs dry, the timer
            // lapses, or they leave via "done". Unaffordable / forged choices
            // are no-ops, exactly like every other verb.
            if (state.phase !== "choice") return state
            switch (ev.choice) {
                case "repair": {
                    if (state.scrap < REPAIR_COST) return state
                    return {
                        ...state,
                        barricadeHp: Math.min(BARRICADE_MAX_HP, state.barricadeHp + REPAIR_HP),
                        scrap: state.scrap - REPAIR_COST,
                    }
                }
                case "patch": {
                    // The one free emergency micro-repair per run — the
                    // anti-spiral valve now that real repairs cost scrap.
                    if (state.patchUsed) return state
                    return {
                        ...state,
                        barricadeHp: Math.min(BARRICADE_MAX_HP, state.barricadeHp + PATCH_HP),
                        patchUsed: true,
                    }
                }
                case "turret": {
                    if (state.scrap < TURRET_COST) return state
                    const turrets = state.turrets.slice()
                    turrets[state.playerLane] = TURRET_TICKS
                    return { ...state, turrets, scrap: state.scrap - TURRET_COST }
                }
                case "arm": {
                    if (state.scrap < ARM_COST) return state
                    return { ...state, armed: ARM_TICKS, scrap: state.scrap - ARM_COST }
                }
                case "refill": {
                    // One molotov's worth of charge; a no-op at a full bank so
                    // the button can never be a pure scrap sink.
                    if (state.scrap < REFILL_COST) return state
                    if (state.molotovCharge >= MOLOTOV_MAX) return state
                    return {
                        ...state,
                        molotovCharge: Math.min(MOLOTOV_MAX, state.molotovCharge + MOLOTOV_COST),
                        scrap: state.scrap - REFILL_COST,
                    }
                }
                case "done":
                    // Leave the shop: hand control to the standard timer exit on
                    // the NEXT tick, so early leavers and lingerers get the same
                    // wave-local clock origin (spawn timing identical).
                    return { ...state, phaseUntil: state.tick + 1 }
                default:
                    return state // forged choice string: no-op
            }
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
        case "shove": {
            if (state.phase === "choice") return state
            if (state.tick < state.shoveReadyAt) return state
            // The UI can only shove the player's own lane (Barricade.tsx). An
            // off-lane shove is a forged-log-only capability — two-lane defense
            // from one lane, and the only verb a netter stun couldn't pin — so
            // anything else, including NaN/float junk, is a no-op. Equality
            // against playerLane subsumes the integer/range guards.
            if (ev.lane !== state.playerLane) return state
            // Knock the front (nearest-barricade) machine of the lane back — no
            // damage, just tempo to buy a throw. A whiff (empty lane) is a no-op
            // with no cooldown spent.
            let frontIdx = -1
            for (let i = 0; i < state.enemies.length; i++) {
                const e = state.enemies[i]
                if (e.lane !== ev.lane) continue
                if (frontIdx === -1 || e.pos > state.enemies[frontIdx].pos) frontIdx = i
            }
            if (frontIdx === -1) return state
            const enemies = state.enemies.slice()
            enemies[frontIdx] = { ...enemies[frontIdx], pos: Math.max(0, enemies[frontIdx].pos - SHOVE_DISTANCE) }
            return { ...state, enemies, shoveReadyAt: state.tick + SHOVE_CD }
        }
        default:
            // The log is untrusted JSON on the verifier path: an unknown event
            // type must be a no-op (a malformed submission can only hurt its own
            // score), never fall off the switch and return undefined.
            return state
    }
}

/** Damage the front (highest pos) enemy of a lane; returns [enemies, kills, scrapGain, rallyGain]. */
function damageFront(
    enemies: Enemy[],
    lane: number,
    dmg: number,
    tick: number,
): [Enemy[], number, number, number] {
    let frontIdx = -1
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i]
        if (e.lane !== lane) continue
        if (frontIdx === -1 || e.pos > enemies[frontIdx].pos) frontIdx = i
    }
    if (frontIdx === -1) return [enemies, 0, 0, 0]
    const target = enemies[frontIdx]
    // Raised shields blunt frontal fire (auto-fire / turret / crowd); molotov
    // burst + burn go through burstDamage/burnTick and ignore them. Testudo's
    // shield is permanent; the Marshal's cycles on its born-tick clock — full
    // damage only lands in the open window (timing is the counterplay).
    let eff = dmg
    if (target.archetype === "testudo") {
        eff = Math.floor((dmg * (100 - SHIELD_REDUCT_PCT)) / 100)
    } else if (target.archetype === "marshal" && (tick - target.bornTick) % MARSHAL_CYCLE < MARSHAL_UP) {
        eff = Math.floor((dmg * (100 - MARSHAL_REDUCT_PCT)) / 100)
    }
    const hp = target.hp - eff
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

    // Choice phase: frozen field while the shop is open (or until the timer).
    // The exit decides the next phase: the shop before the last wave hands off
    // to the boss entrance, every other one to a normal wave.
    if (s.phase === "choice") {
        if (s.tick >= s.phaseUntil) s = { ...s, phase: s.wave === BOSS_WAVE ? "boss" : "wave" }
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
            const hpMul = Math.min(100 + ESCALATE_HP_PER_WAVE * s.wave, ESCALATE_HP_CAP)
            const spdMul = Math.min(100 + ESCALATE_SPD_PER_WAVE * s.wave, ESCALATE_SPD_CAP)
            s.enemies.push({
                id: s.nextEnemyId++,
                archetype: sp.archetype,
                lane: sp.lane,
                pos: 0,
                hp: Math.floor((a.hp * hpMul) / 100),
                speed: Math.floor((a.speed * spdMul) / 100),
                bornTick: s.tick,
                hasFlanked: false,
            })
        }
    }

    // 1b. Kettles deploy swarm children into their lane on their born-tick
    // cadence (snapshot iteration: a newborn child never litters its own tick).
    // NOTE the cadence INCLUDES the kettle's own spawn tick (0 % PERIOD === 0):
    // it arrives deploying its first escort — deliberate, pinned by test.
    // The global cap bounds the field — spawners refuse to mint past it, so the
    // verifier's per-tick cost stays bounded no matter the log (GDD §6).
    if (s.enemies.some((e) => e.archetype === "kettle")) {
        const hpMul = Math.min(100 + ESCALATE_HP_PER_WAVE * s.wave, ESCALATE_HP_CAP)
        const spdMul = Math.min(100 + ESCALATE_SPD_PER_WAVE * s.wave, ESCALATE_SPD_CAP)
        for (const e of s.enemies.slice()) {
            if (e.archetype !== "kettle") continue
            if ((s.tick - e.bornTick) % KETTLE_PERIOD !== 0) continue
            const a = ARCHETYPES.swarm
            for (let i = 0; i < KETTLE_LITTER && s.enemies.length < ENEMY_CAP; i++) {
                s.enemies.push({
                    id: s.nextEnemyId++,
                    archetype: "swarm",
                    lane: e.lane,
                    pos: e.pos,
                    hp: Math.floor((a.hp * hpMul) / 100),
                    speed: Math.floor((a.speed * spdMul) / 100),
                    bornTick: s.tick,
                    hasFlanked: false,
                })
            }
        }
    }

    // 1c. Flankers hop lanes — BEFORE the fire-slow flags and advance, in array
    // order, so an earlier flanker's hop counts in the next one's crowd math
    // (pure function of state: least-crowded lane, lowest index on ties,
    // one-shot per machine). Hopping first also means the slow flag below
    // reflects the lane a machine actually advances in (review finding: the
    // old order let a hop carry a one-tick-stale slow flag across lanes).
    if (s.enemies.some((e) => e.archetype === "flanker" && !e.hasFlanked && e.pos >= FLANK_AT)) {
        const next: Enemy[] = []
        const counts = new Array(LANES).fill(0)
        for (const e of s.enemies) counts[e.lane]++
        for (const e of s.enemies) {
            if (e.archetype !== "flanker" || e.hasFlanked || e.pos < FLANK_AT) {
                next.push(e)
                continue
            }
            let target = 0
            for (let lane = 1; lane < LANES; lane++) if (counts[lane] < counts[target]) target = lane
            counts[e.lane]--
            counts[target]++
            next.push({ ...e, lane: target, hasFlanked: true })
        }
        s.enemies = next
    }

    // Fire zones: drop burnt-out fields, then flag machines caught inside one so
    // they advance slowed this tick (computed on pre-advance positions, post-hop
    // lanes; a field spawned by this tick's impact only slows from next tick).
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

    // 2. Advance. Fire slows any machine caught in a burn zone; a charger past
    // the charge line moves at double speed (the slow composes on top); a
    // mortar never advances past its standoff line.
    s.enemies = s.enemies.map((e) => {
        let speed = e.speed
        if (e.archetype === "charger" && e.pos >= CHARGE_AT) speed *= 2
        if (slowed.has(e.id)) speed = Math.floor((speed * FIRE_SLOW_NUM) / FIRE_SLOW_DEN)
        let pos = e.pos + speed
        // Cap the mortar's MARCH at the standoff line. NOTE: this also clamps a
        // mortar somehow past the line BACK to it — unreachable today (spawn 0,
        // capped every tick, shove only reduces pos), but a future forward-
        // displacement mechanic must not silently rewind mortars through here.
        if (e.archetype === "mortar" && pos > MORTAR_STANDOFF) pos = MORTAR_STANDOFF
        return { ...e, pos }
    })

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
        // 2c'. Dampeners douse their lane AFTER the burn: a field gets exactly
        // one last burn tick (the flash), then dies — the water-cannon is the
        // molotov's governor, not a retroactive shield.
        if (s.enemies.some((e) => e.archetype === "dampener")) {
            const doused = new Set<number>()
            for (const e of s.enemies) if (e.archetype === "dampener") doused.add(e.lane)
            s.hazards = s.hazards.filter((h) => !doused.has(h.lane))
        }
    }

    // 2d. Standoff shelling: every halted mortar volleys the barricade on its
    // own born-tick cadence (after burn — a burn-killed mortar never fires;
    // before combat, matching the burn-before-contact discipline).
    let shellDamage = 0
    for (const e of s.enemies) {
        if (e.archetype !== "mortar" || e.pos < MORTAR_STANDOFF) continue
        if ((s.tick - e.bornTick) % MORTAR_PERIOD === 0) shellDamage += MORTAR_SHELL
    }

    // 3. Combat: player lane front target, turret lanes, armed crowd.
    const applyDamage = (lane: number, dmg: number) => {
        const [next, k, sc, ra] = damageFront(s.enemies, lane, dmg, s.tick)
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

    // 4. Contact: enemies reaching the barricade deal damage and despawn. The
    // act boss is existential: if the Broadcast Tower reaches the line, the
    // stand is over — otherwise contact would despawn it like any mob (25k
    // damage, max boss-wave total 49k) and parking in one lane would SKIP the
    // boss and still collect WAVE_CLEAR + WIN_BONUS (review finding).
    let hp = s.barricadeHp
    let stunnedUntil = s.stunnedUntil
    let cleanWave = s.cleanWave
    let bossReached = false
    if (shellDamage > 0) {
        hp -= shellDamage
        cleanWave = false
    }
    const remaining: Enemy[] = []
    for (const e of s.enemies) {
        if (e.pos >= LANE_LENGTH) {
            hp -= ARCHETYPES[e.archetype].damage
            cleanWave = false
            if (e.archetype === "broadcast") bossReached = true
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
    if (bossReached) return { ...s, phase: "lost" }

    const scriptDone = script.spawns.every((sp) => sp.atTick < waveLocal)
    if (scriptDone && s.enemies.length === 0) {
        const waveBonus = WAVE_CLEAR_BONUS + (s.cleanWave ? CLEAN_WAVE_BONUS : 0)
        if (s.wave === BOSS_WAVE) {
            return { ...s, score: s.score + waveBonus + WIN_BONUS, phase: "won" }
        }
        // Between waves: the spend window, then the next wave (the choice-exit
        // path routes to "boss" before the last wave, so the pre-boss shop is a
        // real window too — it used to be silently skipped). phaseUntil doubles
        // as the next wave's start tick (wave-local time origin).
        return {
            ...s,
            wave: s.wave + 1,
            phase: "choice",
            phaseUntil: s.tick + SPEND_PHASE_TICKS,
            score: s.score + waveBonus,
            cleanWave: true,
        }
    }

    // The boss "wave" phase label is cosmetic-plus (renderer uses it); once the
    // boss wave's field opens we keep phase as "wave"-like behavior via "boss".
    return s
}
