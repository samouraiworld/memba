import { describe, expect, it } from "vitest"
import { RUN_MAX_TICKS, type SimEvent } from "./types"
import { initState, tick } from "./engine"
import { BOSS_WAVE, buildWaves } from "./waves"
import { hashState, MAX_REPLAY_EVENTS, runReplay } from "./replay"

const events: SimEvent[] = [
    { tick: 60, type: "move", lane: 1 },
    { tick: 400, type: "move", lane: 2 },
    { tick: 1200, type: "rally" },
    { tick: 2000, type: "choice", choice: "repair" },
]

describe("replay determinism", () => {
    it("same (seed, events) -> identical hash and score", () => {
        const a = runReplay("daily-2026-07-11", events)
        const b = runReplay("daily-2026-07-11", events)
        expect(a.stateHash).toEqual(b.stateHash)
        expect(a.score).toEqual(b.score)
        expect(a.simVersion).toBe(2)
    })

    it("hash discriminates every state field the verifier relies on", () => {
        // Two runs may legitimately converge to the same terminal state (a
        // no-consequence tamper), so the anti-cheat contract is on hashState:
        // ANY difference in the canonical state must change the digest.
        const base = initState("hash")
        const h = hashState(base)
        expect(hashState({ ...base, score: base.score + 1 })).not.toEqual(h)
        expect(hashState({ ...base, scrap: base.scrap + 1 })).not.toEqual(h)
        expect(hashState({ ...base, barricadeHp: base.barricadeHp - 1 })).not.toEqual(h)
        expect(hashState({ ...base, phase: "lost" })).not.toEqual(h)
        expect(hashState({ ...base, playerLane: 2 })).not.toEqual(h)
        expect(
            hashState({
                ...base,
                enemies: [{ id: 0, archetype: "drone", lane: 0, pos: 1, hp: 1, speed: 1, bornTick: 0, hasFlanked: false }],
            }),
        ).not.toEqual(h)
    })

    it("a consequential tamper changes the replay hash", () => {
        // Guaranteed-consequential divergence: an empty log vs a log whose
        // final surviving state differs in score. If the two terminal states
        // differ at all, their hashes must differ.
        const a = runReplay("daily", [])
        const b = runReplay("daily", events)
        const statesDiffer = a.score !== b.score || a.ticks !== b.ticks || a.won !== b.won
        if (statesDiffer) {
            expect(a.stateHash).not.toEqual(b.stateHash)
        } else {
            expect(a.stateHash).toEqual(b.stateHash)
        }
    })

    it("terminates: never exceeds RUN_MAX_TICKS", () => {
        const r = runReplay("stall", [])
        expect(r.ticks).toBeLessThanOrEqual(RUN_MAX_TICKS)
    })

    it("treats a forged unknown-type event as a no-op, not a crash", () => {
        // The verifier re-runs untrusted JSON. "A malformed log can only hurt its
        // own score" only holds if an alien event type can't blow up the replay —
        // applyEvent must return the state unchanged instead of falling off the
        // switch (undefined → TypeError on the next tick).
        const forged = [
            { tick: 0, type: "boom" },
            { tick: 5, type: "" },
            null, // a null entry must not crash the sort comparator
            { type: "rally" }, // missing tick
            { tick: NaN, type: "rally" }, // NaN tick must not stall the cursor…
            { tick: 60, type: "move", lane: 1 }, // …and this legal event must still apply
        ] as unknown as SimEvent[]
        const withLegalOnly = runReplay("daily", [{ tick: 60, type: "move", lane: 1 }])
        const result = runReplay("daily", forged)
        expect(result.stateHash).toBe(withLegalOnly.stateHash)
        expect(result.score).toBe(withLegalOnly.score)
    })

    it("ignores everything past MAX_REPLAY_EVENTS (verifier cost bound)", () => {
        // A crafted submission with a huge events[] must not buy unbounded
        // verifier work: the log is truncated at a cap no honest run can reach
        // (the shell stops recording at the same constant, so live and replay
        // stay identical).
        const spam: SimEvent[] = []
        for (let i = 0; i < MAX_REPLAY_EVENTS; i++) spam.push({ tick: 0, type: "rally" }) // empty-meter no-ops
        spam.push({ tick: 0, type: "move", lane: 2 }) // just past the cap → must be dropped
        expect(runReplay("daily", spam).stateHash).toBe(runReplay("daily", []).stateHash)
    })

    it("matches a live-style loop exactly, including the terminal phase", () => {
        // Review finding: an outer `s.tick < RUN_MAX_TICKS` clause made
        // runReplay exit one call before tick() flips phase to "lost" at the
        // cap — a different terminal phase (and hash) than the live loop for
        // identical inputs. The replay must rely on tick()'s own termination.
        for (const seed of ["stall", "daily-2026-07-11"]) {
            const waves = buildWaves(seed)
            let live = initState(seed)
            while (live.phase !== "lost") {
                live = tick(live, waves)
            }
            expect(runReplay(seed, []).stateHash).toEqual(hashState(live))
        }
    })

    it("tick() at the cap flips to a terminal lost state", () => {
        const waves = buildWaves("cap")
        const capped = { ...initState("cap"), tick: RUN_MAX_TICKS }
        expect(tick(capped, waves).phase).toBe("lost")
    })

    it("surfaces the terminal wave the realm ledger stores as Waves", () => {
        // The on-chain Entry stores `Waves` (and the results poster shows
        // `wave N/…`). The attester's verify worker must read that from the
        // authoritative replay, not recompute it — so runReplay exposes the
        // terminal `s.wave` directly. overtimeRound already derives from it
        // (wave − BOSS_WAVE), but during the arc the wave isn't recoverable
        // from overtimeRound alone (it's clamped to 0), so waves is its own field.
        for (const seed of ["stall", "daily-2026-07-11"]) {
            const waves = buildWaves(seed)
            let live = initState(seed)
            while (live.phase !== "lost") {
                live = tick(live, waves)
            }
            const r = runReplay(seed, [])
            expect(r.waves).toBe(live.wave)
            expect(r.overtimeRound).toBe(Math.max(0, live.wave - BOSS_WAVE))
        }
    })
})
