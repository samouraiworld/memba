import { describe, it, expect } from "vitest";
import { newGame, step, type GameEvent, type GameState, type InputIntent } from "../engine";
import { createChainTracker, isNewBest, summarizeRun, trackChain } from "./results";

const kill: GameEvent = { type: "alienKilled", x: 0, y: 0, row: 0 };
const miss: GameEvent = { type: "shotMissed" };
const ufo: GameEvent = { type: "ufoKilled", x: 0, y: 0, points: 100 };

describe("trackChain", () => {
  it("extends on alien kills, breaks on misses, and remembers the longest chain", () => {
    let t = createChainTracker();
    t = trackChain(t, [kill, kill, kill]);
    expect(t).toEqual({ chain: 3, best: 3 });
    t = trackChain(t, [miss, kill]);
    expect(t).toEqual({ chain: 1, best: 3 });
    // A peak and a break inside ONE frame's events still counts.
    t = trackChain(t, [kill, kill, kill, kill, miss]);
    expect(t).toEqual({ chain: 0, best: 5 });
  });

  it("ignores UFO kills and unrelated events, returning the same object when nothing changed", () => {
    const t = createChainTracker(2);
    expect(trackChain(t, [ufo, { type: "playerHit" }, { type: "waveCleared" }])).toBe(t);
  });

  it("mirrors the engine's live combo step-for-step over a real run", () => {
    // Hold fire and sweep: plenty of kills AND misses, so both rules fire.
    let s: GameState = { ...newGame(12345), phase: "playing" };
    let t = createChainTracker();
    let peak = 0;
    let kills = 0;
    let misses = 0;
    for (let i = 0; i < 6000 && s.phase !== "gameover"; i++) {
      const input: InputIntent = { move: Math.sin(i / 40) > 0 ? 1 : -1, fire: true, pause: false };
      s = step(s, 1000 / 60, input);
      t = trackChain(t, s.events);
      kills += s.events.filter((e) => e.type === "alienKilled").length;
      misses += s.events.filter((e) => e.type === "shotMissed").length;
      expect(t.chain).toBe(s.combo);
      peak = Math.max(peak, s.combo);
    }
    expect(kills).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
    expect(t.best).toBe(peak);
  });
});

describe("summarizeRun", () => {
  const base = { score: 4210, wave: 3, lives: 1, shots: 40, hits: 33, combo: 0 };

  it("derives accuracy, bonuses and the combat share from the final state", () => {
    const r = summarizeRun(base, 9);
    expect(r.accuracyPct).toBe(82); // floor(3300 / 40) = 82.5 → 82
    expect(r.accuracyBonus).toBe(412); // floor(33 * 500 / 40)
    expect(r.relayBonus).toBe(500);
    expect(r.combatScore).toBe(4210 - 412 - 500);
    expect(r.bestChain).toBe(9);
    expect(r.livesLeft).toBe(1);
  });

  it("never rounds a miss up to 100% and treats no shots as 0%", () => {
    expect(summarizeRun({ ...base, shots: 200, hits: 199 }).accuracyPct).toBe(99);
    const none = summarizeRun({ ...base, shots: 0, hits: 0 });
    expect(none.accuracyPct).toBe(0);
    expect(none.accuracyBonus).toBe(0);
  });

  it("clamps impossible inputs instead of showing negatives", () => {
    const r = summarizeRun({ ...base, score: 10, lives: -1, hits: 50 });
    expect(r.livesLeft).toBe(0);
    expect(r.hits).toBe(40);
    expect(r.combatScore).toBe(0);
  });

  it("falls back to the live combo when no tracked chain is known", () => {
    expect(summarizeRun({ ...base, combo: 4 }).bestChain).toBe(4);
    expect(summarizeRun({ ...base, combo: 4 }, 2).bestChain).toBe(4);
  });
});

describe("isNewBest", () => {
  it("is true only when the run beats the best as it stood before saving", () => {
    expect(isNewBest(500, 400)).toBe(true);
    expect(isNewBest(400, 400)).toBe(false); // a tie is not a new best
    expect(isNewBest(300, 400)).toBe(false);
    expect(isNewBest(10, 0)).toBe(true); // first score on record
  });

  it("never celebrates a zero score or an unknown previous best", () => {
    expect(isNewBest(0, 0)).toBe(false);
    expect(isNewBest(900, null)).toBe(false);
  });
});
