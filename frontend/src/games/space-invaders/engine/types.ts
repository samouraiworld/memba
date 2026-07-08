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

// Mystery UFO drifting across the top of the arena.
export interface Ufo extends Rect {
  dir: 1 | -1;
  alive: boolean;
}

// A destructible bunker block (a shield segment). hp hits before it's gone.
export interface Block extends Rect {
  hp: number;
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
  | { type: "alienStep"; dir: 1 | -1 }
  | { type: "ufoSpawned" }
  | { type: "ufoKilled"; x: number; y: number; points: number };

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
  // Player shots in flight (rapid fire, capped at CONFIG.player.maxBullets);
  // fireCd is the remaining fire-rate cooldown in ms.
  playerBullets: Bullet[];
  fireCd: number;
  alienBullets: Bullet[];
  alienFireMs: number;
  // Mystery UFO (null when none on screen) and the countdown to the next spawn.
  ufo: Ufo | null;
  ufoTimerMs: number;
  // Destructible bunker blocks (refresh each wave).
  bunkers: Block[];
  // Events produced by the step that yielded this state (reset each step).
  events: GameEvent[];
}
