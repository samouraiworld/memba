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
import { RUN_MAX_TICKS, SIM_VERSION, type SimEvent, type SimState } from "./types"

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
        .map((e) => `${e.id},${e.archetype},${e.lane},${e.pos},${e.hp}`)
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
        enemies,
    ].join("|")
    const a = fnv1a(canonical, 0x811c9dc5)
    const b = fnv1a(canonical, 0x01234567)
    return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")
}

/** Run a full game from (seed, events) to its terminal state. */
export function runReplay(seed: string, events: SimEvent[]): ReplayResult {
    const waves = buildWaves(seed)
    const sorted = events
        .slice()
        .sort((a, b) => a.tick - b.tick)
    let s = initState(seed)
    let cursor = 0
    while (s.phase !== "won" && s.phase !== "lost" && s.tick < RUN_MAX_TICKS) {
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
