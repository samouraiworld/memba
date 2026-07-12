/**
 * Presentation-event detector — the bridge from the deterministic sim to the
 * render-only juice layer. `deriveFxEvents(prev, next)` diffs two SimState
 * snapshots and reports what just happened (a kill, a barricade hit, a rally…)
 * so the renderer can react with screenshake, particles, flashes and sound.
 *
 * DETERMINISM: this module is PURE and read-only. It imports only types +
 * constants from sim/, never mutates its inputs, and its output never re-enters
 * the sim. The FX layer therefore cannot change a replay — SIM_VERSION is
 * untouched and the G3 verifier is unaffected (see fx.parity.test.ts).
 */

import {
    BARRICADE_MAX_HP,
    LANES,
    LANE_LENGTH,
    RALLY_FULL,
    type ArchetypeId,
    type SimPhase,
    type SimState,
} from "../sim/types"

export type FxEvent =
    | { kind: "kill"; lane: number; posFrac: number; weight: number; archetype: ArchetypeId }
    | { kind: "barricadeHit"; damageFrac: number }
    | { kind: "rally" }
    | { kind: "rallyReady" }
    | { kind: "move"; lane: number }
    | { kind: "phase"; phase: SimPhase }
    | { kind: "bossSpawn"; lane: number }
    | { kind: "deploy"; lane: number; deploy: "turret" | "arm" }
    | { kind: "stun"; lane: number }

/** Impact weight per archetype (light → heavy) — scales hit-stop and shake. */
export const ARCHETYPE_WEIGHT: Record<ArchetypeId, number> = {
    drone: 1,
    netter: 1,
    walker: 2,
    phalanx: 2,
    siege: 3,
    broadcast: 4,
    testudo: 3,
    swarm: 1,
    rampart: 3,
    charger: 2,
    flanker: 1,
    mortar: 2,
    marshal: 4,
    kettle: 4,
    dampener: 2,
    carrier: 3,
    jammer: 1,
    mender: 1,
    panopticon: 4,
}

/**
 * Diff two sim snapshots (previous rendered frame → current) into FX events.
 * Frame-to-frame diffing collapses any sub-frame ticks into one net delta,
 * which is exactly what the renderer wants. Enemy ids are monotonic (never
 * reused), so a "gone" id is unambiguous.
 */
export function deriveFxEvents(prev: SimState, next: SimState): FxEvent[] {
    const events: FxEvent[] = []

    // Deaths vs. reaching the barricade. An id in prev but not in next either
    // died in combat (kill → particle) or reached the barricade (already covered
    // by the barricadeHit event below). The barricade-HP delta is the authority
    // on whether ANY enemy reached this frame: if it did not drop, every
    // disappeared enemy is a kill — including a front enemy killed in combat right
    // at the line, which would otherwise emit nothing. When it did drop, enemies
    // within one step of the line are the ones that reached. Under a rare
    // multi-tick frame (post tab-sleep, up to ~15 ticks collapse into one) a
    // straggler that truly reached can still be tagged a kill — one stray particle
    // burst, purely cosmetic; it never suppresses a real hit.
    const reachedDamage = prev.barricadeHp - next.barricadeHp
    const nextIds = new Set<number>()
    for (const e of next.enemies) nextIds.add(e.id)
    for (const e of prev.enemies) {
        if (nextIds.has(e.id)) continue
        if (reachedDamage > 0 && e.pos + e.speed >= LANE_LENGTH) continue
        events.push({
            kind: "kill",
            lane: e.lane,
            posFrac: Math.min(1, e.pos / LANE_LENGTH),
            weight: ARCHETYPE_WEIGHT[e.archetype],
            archetype: e.archetype,
        })
    }

    // Barricade damage.
    if (next.barricadeHp < prev.barricadeHp) {
        events.push({ kind: "barricadeHit", damageFrac: (prev.barricadeHp - next.barricadeHp) / BARRICADE_MAX_HP })
    }

    // Rally: full → 0 means the crowd surge fired. Crossing up to full is a
    // distinct "ready" cue.
    if (prev.rallyMeter >= RALLY_FULL && next.rallyMeter === 0) {
        events.push({ kind: "rally" })
    } else if (prev.rallyMeter < RALLY_FULL && next.rallyMeter >= RALLY_FULL) {
        events.push({ kind: "rallyReady" })
    }

    // Player lane change.
    if (next.playerLane !== prev.playerLane) {
        events.push({ kind: "move", lane: next.playerLane })
    }

    // Phase transition (choice / boss / won / lost).
    if (next.phase !== prev.phase) {
        events.push({ kind: "phase", phase: next.phase })
    }

    // Boss entrance: a broadcast id that is new this frame.
    const prevIds = new Set<number>()
    for (const e of prev.enemies) prevIds.add(e.id)
    for (const e of next.enemies) {
        if (e.archetype === "broadcast" && !prevIds.has(e.id)) {
            events.push({ kind: "bossSpawn", lane: e.lane })
        }
    }

    // Netter stun landed on the player.
    if (next.stunnedUntil > prev.stunnedUntil && next.stunnedUntil > next.tick) {
        events.push({ kind: "stun", lane: next.playerLane })
    }

    // Between-wave deploys.
    for (let lane = 0; lane < LANES; lane++) {
        if (prev.turrets[lane] === 0 && next.turrets[lane] > 0) {
            events.push({ kind: "deploy", lane, deploy: "turret" })
        }
    }
    if (prev.armed === 0 && next.armed > 0) {
        events.push({ kind: "deploy", lane: next.playerLane, deploy: "arm" })
    }

    return events
}
