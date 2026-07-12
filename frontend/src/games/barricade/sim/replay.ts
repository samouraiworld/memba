/**
 * Replay runner + canonical state hash — the anti-cheat foundation.
 *
 * A submitted score is (seed, simVersion, events[], claimedScore, stateHash).
 * The verifier re-runs runReplay over the same inputs and compares. The hash
 * covers a canonical serialization (fixed field order, enemies sorted by id),
 * so ANY divergence — score, field state, rng — changes it. Changing this
 * serialization or the engine's behavior bumps SIM_VERSION.
 */

import { applyEvent, initState, tick } from "./engine"
import { buildWaves } from "./waves"
import { SIM_VERSION, type SimEvent, type SimState } from "./types"

export type ReplayResult = {
    score: number
    won: boolean
    ticks: number
    stateHash: string
    simVersion: number
}

function fnv1a(input: string, offset: number): number {
    let h = offset >>> 0
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h
}

/** Canonical 16-hex-char digest of a sim state (two FNV-1a lanes). */
export function hashState(state: SimState): string {
    const enemies = state.enemies
        .slice()
        .sort((a, b) => a.id - b.id)
        // speed included as insurance: v2 adds "modifier" machines, and a future
        // mechanic that writes enemy.speed directly must not slip past the hash.
        .map((e) => `${e.id},${e.archetype},${e.lane},${e.pos},${e.hp},${e.speed}`)
        .join(";")
    const projectiles = state.projectiles
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((p) => `${p.id},${p.lane},${p.dist},${p.impactTick}`)
        .join(";")
    const hazards = state.hazards
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((h) => `${h.id},${h.lane},${h.posLo},${h.posHi},${h.dmgPerTick},${h.expiresAtTick}`)
        .join(";")
    const canonical = [
        state.tick,
        state.rngState,
        state.playerLane,
        state.stunnedUntil,
        state.barricadeHp,
        state.rallyMeter,
        state.scrap,
        state.wave,
        state.phase,
        state.phaseUntil,
        state.score,
        state.turrets.join(","),
        state.armed,
        state.cleanWave,
        state.nextEnemyId,
        enemies,
        state.molotovCharge,
        state.molotovReadyAt,
        state.nextThrowId,
        state.shoveReadyAt,
        projectiles,
        hazards,
    ].join("|")
    const a = fnv1a(canonical, 0x811c9dc5)
    const b = fnv1a(canonical, 0x01234567)
    return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")
}

/**
 * Hard ceiling on the events a submission may carry. An honest run is a few
 * hundred taps; the shell stops recording at this same constant, so live play
 * and the (truncated) replay can never disagree. Everything past the cap is
 * ignored, which bounds the verifier's sort + apply cost per submission.
 */
export const MAX_REPLAY_EVENTS = 20_000

const EVENT_TYPES = new Set(["move", "rally", "choice", "throw", "shove"])

/** Run a full game from (seed, events) to its terminal state. */
export function runReplay(seed: string, events: SimEvent[]): ReplayResult {
    const waves = buildWaves(seed)
    // The log is untrusted JSON: cap it first (cost bound), then drop entries
    // that aren't {integer tick >= 0, known type} — a null entry would crash the
    // sort comparator, a NaN tick would stall the cursor and silently disable
    // every later event, and an alien type used to fall off applyEvent's switch.
    // Honest logs pass untouched, so live and replay stay identical.
    const sane = events.slice(0, MAX_REPLAY_EVENTS).filter(
        (e): e is SimEvent =>
            typeof e === "object" &&
            e !== null &&
            Number.isInteger((e as { tick?: unknown }).tick) &&
            (e as { tick: number }).tick >= 0 &&
            EVENT_TYPES.has((e as { type?: string }).type ?? ""),
    )
    // Total order: tick, then original log index — a same-tick tiebreak that does
    // not rely on Array.prototype.sort being stable across JS engines.
    const sorted = sane
        .map((e, i) => ({ e, i }))
        .sort((a, b) => a.e.tick - b.e.tick || a.i - b.i)
        .map((x) => x.e)
    let s = initState(seed)
    let cursor = 0
    // Terminal-phase only — NO tick bound here. tick() itself flips to "lost"
    // at RUN_MAX_TICKS; an outer `s.tick < cap` clause would exit one call
    // early and diverge from the live loop's terminal phase (and thus the
    // stateHash) on every capped run. Found in review; parity test pins it.
    while (s.phase !== "won" && s.phase !== "lost") {
        while (cursor < sorted.length && sorted[cursor].tick === s.tick) {
            s = applyEvent(s, sorted[cursor])
            cursor++
        }
        // Events stamped for a tick we already passed are skipped (cursor
        // advances) — a malformed log can only hurt its own score.
        while (cursor < sorted.length && sorted[cursor].tick < s.tick) cursor++
        s = tick(s, waves)
    }
    return {
        score: s.score,
        won: s.phase === "won",
        ticks: s.tick,
        stateHash: hashState(s),
        simVersion: SIM_VERSION,
    }
}
