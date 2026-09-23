// Presentation-only run summary for the game-over results card. Everything
// here is DERIVED from the finished GameState (or from the step events the
// shell already receives) — nothing feeds back into the simulation, the
// replay log, or the certify payload.
import { CONFIG, comboMultiplier10, type GameEvent, type GameState } from "../engine";

/** The live no-miss chain and the longest one reached this run. */
export interface ChainTracker {
  chain: number;
  best: number;
}

export function createChainTracker(startChain = 0): ChainTracker {
  const chain = Math.max(0, Math.floor(startChain));
  return { chain, best: chain };
}

/** Fold a frame's step events into the tracker, mirroring the engine's combo
 *  rule event-for-event: an alien kill extends the chain, a shot that leaves
 *  the top breaks it (UFO kills neither extend nor break it). The engine only
 *  exposes the current combo, so sub-step peaks inside one frame would be
 *  lost if we sampled state instead. */
export function trackChain(tracker: ChainTracker, events: readonly GameEvent[]): ChainTracker {
  let { chain, best } = tracker;
  for (const e of events) {
    if (e.type === "alienKilled") {
      chain += 1;
      if (chain > best) best = chain;
    } else if (e.type === "shotMissed") {
      chain = 0;
    }
  }
  return chain === tracker.chain && best === tracker.best ? tracker : { chain, best };
}

/** A cosmetic cue derived from the chain: a jump to a higher multiplier tier
 *  (×1.5, ×2, ×3, ×4) at the kill that produced it, or a miss that broke a
 *  chain worth at least ×1.5. Read-only over the step events. */
export type ChainCue =
  | { type: "tierUp"; mult10: number; x: number; y: number }
  | { type: "broken"; mult10: number };

/** A miss only reads as a broken chain once the chain was paying ×1.5. */
export const CHAIN_BREAK_MIN_MULT10 = 15;

/** Walk a frame's events from the chain length before the frame, applying the
 *  same rule as trackChain, and report tier jumps and notable breaks. */
export function chainCues(chainBefore: number, events: readonly GameEvent[]): ChainCue[] {
  let chain = Math.max(0, Math.floor(chainBefore));
  const out: ChainCue[] = [];
  for (const e of events) {
    if (e.type === "alienKilled") {
      const before = comboMultiplier10(chain);
      chain += 1;
      const after = comboMultiplier10(chain);
      if (after > before) {
        out.push({ type: "tierUp", mult10: after, x: e.x + CONFIG.alien.w / 2, y: e.y + CONFIG.alien.h / 2 });
      }
    } else if (e.type === "shotMissed") {
      const mult10 = comboMultiplier10(chain);
      if (mult10 >= CHAIN_BREAK_MIN_MULT10) out.push({ type: "broken", mult10 });
      chain = 0;
    }
  }
  return out;
}

export interface RunSummary {
  score: number;
  wave: number;
  livesLeft: number;
  shots: number;
  hits: number;
  /** Whole-percent hit rate, floored (never rounds a miss up to 100%). */
  accuracyPct: number;
  bestChain: number;
  /** End-of-run bonuses the engine added on game over (same integer maths). */
  accuracyBonus: number;
  relayBonus: number;
  /** Points earned in combat — the final score minus the end-of-run bonuses. */
  combatScore: number;
}

export function summarizeRun(
  state: Pick<GameState, "score" | "wave" | "lives" | "shots" | "hits" | "combo">,
  bestChain?: number,
): RunSummary {
  const shots = Math.max(0, state.shots);
  const hits = Math.min(Math.max(0, state.hits), shots);
  const livesLeft = Math.max(0, state.lives);
  const accuracyBonus = shots > 0 ? Math.floor((hits * CONFIG.scoring.accuracyBonusK) / shots) : 0;
  const relayBonus = livesLeft * CONFIG.scoring.livesBonus;
  return {
    score: state.score,
    wave: state.wave,
    livesLeft,
    shots,
    hits,
    accuracyPct: shots > 0 ? Math.floor((hits * 100) / shots) : 0,
    bestChain: Math.max(bestChain ?? 0, state.combo, 0),
    accuracyBonus,
    relayBonus,
    combatScore: Math.max(0, state.score - accuracyBonus - relayBonus),
  };
}

/** A run is a new best only when it beats the best as it stood BEFORE the run
 *  was saved (the saved best already includes this run). Zero never counts. */
export function isNewBest(score: number, previousBest: number | null): boolean {
  if (previousBest == null) return false;
  return score > 0 && score > previousBest;
}
