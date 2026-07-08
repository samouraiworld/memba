export type Phase = "ready" | "playing" | "paused" | "gameover";

export interface Rect { x: number; y: number; w: number; h: number }

export interface Alien extends Rect {
  alive: boolean;
  row: number; // 0 = top row (worth most)
  col: number;
}

export interface Bullet extends Rect {
  alive: boolean;
}

export interface InputIntent {
  move: -1 | 0 | 1;
  fire: boolean;
  pause: boolean;
}

// Deterministic events emitted by step() — a pure function of (state, input).
// The single seam that feeds the cosmetic juice layer, audio, and the
// verification hash. Consumers must never write back into the simulation.
export type GameEvent =
  | { type: "playerFired"; x: number }
  | { type: "alienKilled"; x: number; y: number; row: number }
  | { type: "shotMissed" }
  | { type: "playerHit" }
  | { type: "lifeLost" }
  | { type: "waveCleared" }
  | { type: "alienStep"; dir: 1 | -1 };

export interface GameState {
  phase: Phase;
  // Immutable seed passed to newGame — retained for certification/replay
  // (rng mutates every alien-fire; seed does not).
  seed: number;
  rng: number;
  // Monotonic count of step() calls — the canonical replay timeline.
  tick: number;
  player: Rect;
  lives: number;
  invulnMs: number;
  score: number;
  // No-miss streak (consecutive hits without a missed shot) — drives the score
  // multiplier. shots/hits accumulate for the end-of-game accuracy bonus.
  combo: number;
  shots: number;
  hits: number;
  wave: number;
  aliens: Alien[];
  dir: 1 | -1;
  stepAccumMs: number;
  playerBullet: Bullet | null;
  alienBullets: Bullet[];
  alienFireMs: number;
  // Events produced by the step that yielded this state (reset each step).
  events: GameEvent[];
}
