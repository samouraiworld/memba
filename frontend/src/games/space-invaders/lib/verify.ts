import { newGame, step, type GameState } from "../engine";
import { FIXED_MS } from "../hooks/useGameLoop";
import { inputAtTick, type ReplayLog } from "./replay";

// Deterministic replay verification — the anti-cheat backbone. The server (and,
// later, a Gno realm) re-simulate a game from its recorded input log and derive
// the AUTHORITATIVE score; a client-submitted number is never trusted. Kept
// integer-only (FNV-1a over rounded fields) so a Go/Gno port reproduces the
// exact same hash — the cross-language corpus pins this equivalence.

function fnv1a(nums: number[]): number {
  let h = 0x811c9dc5;
  for (const n of nums) {
    let v = (n | 0) >>> 0;
    for (let i = 0; i < 4; i++) {
      h = Math.imul(h ^ (v & 0xff), 0x01000193) >>> 0;
      v >>>= 8;
    }
  }
  return h >>> 0;
}

const PHASE_CODE: Record<GameState["phase"], number> = { ready: 0, playing: 1, paused: 2, gameover: 3 };

/** A stable, integer-only digest of the scored state — catches any divergence
 *  between the player's client and the verifier. Positions are rounded so the
 *  hash is portable across languages (the score is the exact-match anchor). */
export function hashState(s: GameState): number {
  const nums: number[] = [
    s.score,
    s.tick,
    s.lives,
    s.wave,
    s.combo,
    s.shots,
    s.hits,
    PHASE_CODE[s.phase],
    Math.round(s.player.x),
    s.playerBullets.length,
    s.alienBullets.length,
    s.aliens.reduce((n, a) => n + (a.alive ? 1 : 0), 0),
    s.ufo && s.ufo.alive ? Math.round(s.ufo.x) : -1,
    s.bunkers.reduce((n, b) => n + b.hp, 0),
  ];
  for (const a of s.aliens) if (a.alive) nums.push(Math.round(a.x), Math.round(a.y));
  return fnv1a(nums);
}

/** Re-run the engine from the log's seed, applying the recorded input at every
 *  tick, and return the authoritative final state, score, and hash. */
export function simulateReplay(log: ReplayLog): { state: GameState; score: number; hash: number } {
  let s = newGame(log.seed);
  for (let i = 0; i < log.finalTick; i++) {
    s = step(s, FIXED_MS, inputAtTick(log, i));
  }
  return { state: s, score: s.score, hash: hashState(s) };
}
