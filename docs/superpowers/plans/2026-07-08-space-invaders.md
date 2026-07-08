# Space Invaders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a frontend-only, flag-gated Space Invaders game in the Memba Store, built around a pure deterministic engine with keyboard + touch controls.

**Architecture:** A pure, deterministic reducer `step(state, dtMs, input) -> state` (no DOM, no wall-clock, no `Math.random`) holds all game logic and is TDD'd via crafted states and golden vectors. A thin React shell owns a fixed-timestep `requestAnimationFrame` loop, normalizes keyboard/touch into one `InputIntent`, and renders each frame to `<canvas>`. The game ships dark behind a flag and is listed in the App Store like Block Party.

**Tech Stack:** React 18 + TypeScript + Vite, vitest + React Testing Library, HTML5 canvas. No new runtime dependencies.

## Global Constraints

- Frontend-only. No backend, realm, DB, or RPC changes.
- Engine is pure: no DOM, no `Date.now()`, no `Math.random()`. Randomness comes only from the seeded mulberry32 PRNG state carried inside `GameState`.
- Flag `VITE_ENABLE_SPACE_INVADERS` is committed as **false**; game must remain `assertSafeFlags`-safe (never commit `"true"` for a safety-gated flag).
- Route path: `game/space-invaders`. Formation: 5 rows × 11 cols. Player bullet: at most one in flight.
- All new game code lives under `frontend/src/games/space-invaders/`.
- Frontend is standalone npm: fresh worktree needs `cd frontend && npm ci`.
- Type-check via `npm run build` (`tsc --noEmit` is a no-op in this repo).
- Run vitest one file at a time via the repo's bounded self-killing wrapper — never `npx vitest`, never the whole suite at once. Command shown per task uses `node ./node_modules/.bin/vitest run <file>`.
- Commit messages: concise, no co-author trailers, no generator tags.
- All commits happen inside the worktree `/Users/zxxma/Desktop/Code/Gno/memba-wt-invaders` (branch `feat/store-space-invaders`).

## File Structure

```
frontend/src/games/space-invaders/
  engine/
    types.ts        # GameState, Alien, Bullet, InputIntent, Phase
    config.ts       # CONFIG tunables + formationStepMs()
    prng.ts         # seeded mulberry32 (rngNext, rngFloat)
    spawn.ts        # newGame(), spawnWave()
    collision.ts    # aabb() overlap helper
    step.ts         # step(state, dtMs, input) — the reducer
    index.ts        # public engine surface
  hooks/
    useGameLoop.ts  # rAF + fixed-timestep accumulator (pure advance() extracted)
    useKeyboard.ts  # keyboard → InputIntent ref
    useTouch.ts     # pointer → InputIntent ref
  render/
    Canvas.tsx      # draws a GameState frame; no logic
  lib/
    highScore.ts    # localStorage best-score read/write
  SpaceInvaders.tsx # shell: loop + input + render + HUD/overlays
  space-invaders.css

frontend/src/pages/SpaceInvadersGame.tsx          # thin lazy default-export entry
frontend/src/components/ui/SpaceInvadersGate.tsx  # ComingSoonGate when flag off
```

Modified:
- `frontend/src/lib/config.ts` — add `isSpaceInvadersEnabled()`.
- `frontend/src/App.tsx` — lazy import + route.
- `frontend/src/pages/AppStore.tsx` (+ its catalog source) — add catalog entry.
- `.env.example` — document the flag.

---

### Task 1: Engine types, config, and seeded PRNG

**Files:**
- Create: `frontend/src/games/space-invaders/engine/types.ts`
- Create: `frontend/src/games/space-invaders/engine/config.ts`
- Create: `frontend/src/games/space-invaders/engine/prng.ts`
- Test: `frontend/src/games/space-invaders/engine/prng.test.ts`
- Test: `frontend/src/games/space-invaders/engine/config.test.ts`

**Interfaces:**
- Produces:
  - `Phase = "ready" | "playing" | "paused" | "gameover"`
  - `interface Alien { x; y; w; h; alive: boolean; row: number; col: number }`
  - `interface Bullet { x; y; w; h; alive: boolean }`
  - `interface InputIntent { move: -1 | 0 | 1; fire: boolean; pause: boolean }`
  - `interface GameState { phase; rng: number; player: {x;y;w;h}; lives; invulnMs; score; wave; aliens: Alien[]; dir: 1|-1; stepAccumMs; playerBullet: Bullet|null; alienBullets: Bullet[]; alienFireMs }`
  - `CONFIG` object; `formationStepMs(alive: number, total: number): number`
  - `rngNext(state: number): { value: number; state: number }`; `rngFloat(state: number): { value: number; state: number }` where `value ∈ [0,1)`

- [ ] **Step 1: Write `prng.test.ts` (failing)**

```ts
import { describe, it, expect } from "vitest";
import { rngNext, rngFloat } from "./prng";

describe("prng", () => {
  it("is deterministic for a given seed", () => {
    const a = rngNext(12345);
    const b = rngNext(12345);
    expect(a).toEqual(b);
  });

  it("advances state so successive draws differ", () => {
    const first = rngNext(1);
    const second = rngNext(first.state);
    expect(second.value).not.toBe(first.value);
  });

  it("rngFloat returns a value in [0,1)", () => {
    let s = 99;
    for (let i = 0; i < 200; i++) {
      const r = rngFloat(s);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(1);
      s = r.state;
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './prng'`)

Run: `cd frontend && node ./node_modules/.bin/vitest run src/games/space-invaders/engine/prng.test.ts`

- [ ] **Step 3: Implement `prng.ts`**

```ts
// mulberry32 — deterministic uint32 PRNG. Mirrors Block Party's engine prng.
export function rngNext(state: number): { value: number; state: number } {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = (t ^ (t >>> 14)) >>> 0;
  return { value, state: a >>> 0 };
}

export function rngFloat(state: number): { value: number; state: number } {
  const n = rngNext(state);
  return { value: n.value / 0x100000000, state: n.state };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Write `types.ts`**

```ts
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

export interface GameState {
  phase: Phase;
  rng: number;
  player: Rect;
  lives: number;
  invulnMs: number;
  score: number;
  wave: number;
  aliens: Alien[];
  dir: 1 | -1;
  stepAccumMs: number;
  playerBullet: Bullet | null;
  alienBullets: Bullet[];
  alienFireMs: number;
}
```

- [ ] **Step 6: Write `config.test.ts` (failing)**

```ts
import { describe, it, expect } from "vitest";
import { CONFIG, formationStepMs } from "./config";

describe("config", () => {
  it("defines a 5x11 formation", () => {
    expect(CONFIG.alien.rows).toBe(5);
    expect(CONFIG.alien.cols).toBe(11);
  });

  it("formationStepMs is slowest when all alive, fastest when one alive", () => {
    const total = 55;
    const slow = formationStepMs(total, total);
    const fast = formationStepMs(1, total);
    expect(slow).toBeCloseTo(CONFIG.formation.stepMsMax);
    expect(fast).toBeLessThan(slow);
    expect(fast).toBeGreaterThanOrEqual(CONFIG.formation.stepMsMin);
  });

  it("formationStepMs decreases monotonically as aliens die", () => {
    const total = 55;
    let prev = Infinity;
    for (let alive = total; alive >= 1; alive--) {
      const ms = formationStepMs(alive, total);
      expect(ms).toBeLessThanOrEqual(prev);
      prev = ms;
    }
  });
});
```

- [ ] **Step 7: Run — expect FAIL**

- [ ] **Step 8: Implement `config.ts`**

```ts
export const CONFIG = {
  arena: { w: 320, h: 400 },
  player: { w: 22, h: 12, speedPxPerMs: 0.16, baselineY: 380 },
  alien: { w: 16, h: 12, gapX: 12, gapY: 10, rows: 5, cols: 11, marginX: 20, startY: 40 },
  formation: { dropY: 12, stepDx: 8, stepMsMax: 700, stepMsMin: 90 },
  bullet: { w: 3, h: 8, playerSpeedPxPerMs: 0.4, alienSpeedPxPerMs: 0.18 },
  alienFire: { cooldownMs: 900 },
  lives: 3,
  respawnInvulnMs: 1500,
  points: [30, 20, 20, 10, 10] as const, // by row index; top row worth most
} as const;

export function formationStepMs(alive: number, total: number): number {
  const t = total <= 0 ? 1 : 1 - Math.max(0, Math.min(alive, total)) / total;
  return CONFIG.formation.stepMsMax + (CONFIG.formation.stepMsMin - CONFIG.formation.stepMsMax) * t;
}
```

- [ ] **Step 9: Run — expect PASS**

- [ ] **Step 10: Commit**

```bash
git add frontend/src/games/space-invaders/engine/{types.ts,config.ts,prng.ts,prng.test.ts,config.test.ts}
git commit -m "Add Space Invaders engine types, config, and seeded PRNG"
```

---

### Task 2: Formation spawn and new-game factory

**Files:**
- Create: `frontend/src/games/space-invaders/engine/spawn.ts`
- Test: `frontend/src/games/space-invaders/engine/spawn.test.ts`

**Interfaces:**
- Consumes: `CONFIG`, `GameState`, `Alien` (Task 1).
- Produces:
  - `spawnWave(wave: number): { aliens: Alien[] }` — builds a 5×11 grid, positioned by `CONFIG.alien`, shifted down by wave.
  - `newGame(seed: number): GameState` — full initial `GameState` in `phase: "ready"`.

- [ ] **Step 1: Write `spawn.test.ts` (failing)**

```ts
import { describe, it, expect } from "vitest";
import { spawnWave, newGame } from "./spawn";
import { CONFIG } from "./config";

describe("spawnWave", () => {
  it("creates rows*cols living aliens", () => {
    const { aliens } = spawnWave(1);
    expect(aliens.length).toBe(CONFIG.alien.rows * CONFIG.alien.cols);
    expect(aliens.every((a) => a.alive)).toBe(true);
  });

  it("assigns row/col and non-overlapping x positions per row", () => {
    const { aliens } = spawnWave(1);
    const row0 = aliens.filter((a) => a.row === 0).sort((a, b) => a.col - b.col);
    for (let i = 1; i < row0.length; i++) {
      expect(row0[i].x).toBeGreaterThan(row0[i - 1].x);
    }
  });

  it("spawns lower on later waves", () => {
    const y1 = Math.min(...spawnWave(1).aliens.map((a) => a.y));
    const y3 = Math.min(...spawnWave(3).aliens.map((a) => a.y));
    expect(y3).toBeGreaterThan(y1);
  });
});

describe("newGame", () => {
  it("starts ready with full lives, zero score, wave 1, one formation, no bullets", () => {
    const s = newGame(42);
    expect(s.phase).toBe("ready");
    expect(s.lives).toBe(CONFIG.lives);
    expect(s.score).toBe(0);
    expect(s.wave).toBe(1);
    expect(s.aliens.length).toBe(CONFIG.alien.rows * CONFIG.alien.cols);
    expect(s.playerBullet).toBeNull();
    expect(s.alienBullets).toEqual([]);
    expect(s.rng).toBe(42);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `spawn.ts`**

```ts
import { CONFIG } from "./config";
import type { Alien, GameState } from "./types";

export function spawnWave(wave: number): { aliens: Alien[] } {
  const { rows, cols, w, h, gapX, gapY, marginX, startY } = CONFIG.alien;
  const dropPerWave = 10;
  const yBase = startY + (wave - 1) * dropPerWave;
  const aliens: Alien[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      aliens.push({
        x: marginX + col * (w + gapX),
        y: yBase + row * (h + gapY),
        w,
        h,
        alive: true,
        row,
        col,
      });
    }
  }
  return { aliens };
}

export function newGame(seed: number): GameState {
  const { aliens } = spawnWave(1);
  return {
    phase: "ready",
    rng: seed,
    player: {
      x: CONFIG.arena.w / 2 - CONFIG.player.w / 2,
      y: CONFIG.player.baselineY,
      w: CONFIG.player.w,
      h: CONFIG.player.h,
    },
    lives: CONFIG.lives,
    invulnMs: 0,
    score: 0,
    wave: 1,
    aliens,
    dir: 1,
    stepAccumMs: 0,
    playerBullet: null,
    alienBullets: [],
    alienFireMs: CONFIG.alienFire.cooldownMs,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/games/space-invaders/engine/spawn.ts frontend/src/games/space-invaders/engine/spawn.test.ts
git commit -m "Add Space Invaders wave spawn and new-game factory"
```

---

### Task 3: Collision helper + step scaffold (pause, ready→playing, player movement)

**Files:**
- Create: `frontend/src/games/space-invaders/engine/collision.ts`
- Create: `frontend/src/games/space-invaders/engine/step.ts`
- Test: `frontend/src/games/space-invaders/engine/collision.test.ts`
- Test: `frontend/src/games/space-invaders/engine/step.movement.test.ts`

**Interfaces:**
- Consumes: `CONFIG`, `GameState`, `InputIntent`, `Rect` (Task 1); `newGame` (Task 2).
- Produces:
  - `aabb(a: Rect, b: Rect): boolean`
  - `step(state: GameState, dtMs: number, input: InputIntent): GameState` — pure; returns a new state. In this task it handles: pause toggle, `ready`→`playing` on first movement/fire, and player horizontal movement clamped to the arena.

- [ ] **Step 1: Write `collision.test.ts` (failing)**

```ts
import { describe, it, expect } from "vitest";
import { aabb } from "./collision";

describe("aabb", () => {
  it("detects overlap", () => {
    expect(aabb({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });
  it("returns false when separated", () => {
    expect(aabb({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(false);
  });
  it("treats edge-touching as non-overlap", () => {
    expect(aabb({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `collision.ts`**

```ts
import type { Rect } from "./types";

export function aabb(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Write `step.movement.test.ts` (failing)**

```ts
import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import { CONFIG } from "./config";
import type { InputIntent } from "./types";

const idle: InputIntent = { move: 0, fire: false, pause: false };
const left: InputIntent = { move: -1, fire: false, pause: false };
const right: InputIntent = { move: 1, fire: false, pause: false };

describe("step — movement & phase", () => {
  it("transitions ready→playing when the player moves", () => {
    const s = step(newGame(1), 16, right);
    expect(s.phase).toBe("playing");
  });

  it("moves the player right by speed*dt while playing", () => {
    let s = newGame(1);
    s = step(s, 16, right); // ready→playing + move
    const s2 = step(s, 16, right);
    expect(s2.player.x).toBeGreaterThan(s.player.x);
  });

  it("clamps the player to the left arena edge", () => {
    let s = newGame(1);
    s = step(s, 16, left);
    for (let i = 0; i < 500; i++) s = step(s, 16, left);
    expect(s.player.x).toBeGreaterThanOrEqual(0);
  });

  it("clamps the player to the right arena edge", () => {
    let s = newGame(1);
    s = step(s, 16, right);
    for (let i = 0; i < 500; i++) s = step(s, 16, right);
    expect(s.player.x + s.player.w).toBeLessThanOrEqual(CONFIG.arena.w);
  });

  it("toggles pause on a pause intent edge and freezes movement while paused", () => {
    let s = step(newGame(1), 16, right); // playing
    const paused = step(s, 16, { move: 0, fire: false, pause: true });
    expect(paused.phase).toBe("paused");
    const stillPaused = step(paused, 16, right); // pause held / move ignored
    expect(stillPaused.player.x).toBe(paused.player.x);
  });
});
```

- [ ] **Step 6: Run — expect FAIL** (`Cannot find module './step'`)

- [ ] **Step 7: Implement `step.ts` (scaffold: pause + movement only)**

```ts
import { CONFIG } from "./config";
import type { GameState, InputIntent } from "./types";

// Tracks whether the previous frame's pause was held, to detect a rising edge.
// Encoded in phase transitions rather than extra state: we treat any frame with
// pause:true as a toggle request and debounce via a module-free approach —
// callers send pause:true for a single frame (the keyboard/touch hooks below
// emit an edge). To stay pure, we toggle whenever pause is true.
export function step(state: GameState, dtMs: number, input: InputIntent): GameState {
  let s = { ...state };

  // Pause toggle (edge is produced by the input layer; here pause:true flips).
  if (input.pause) {
    if (s.phase === "playing") return { ...s, phase: "paused" };
    if (s.phase === "paused") return { ...s, phase: "playing" };
  }
  if (s.phase === "paused" || s.phase === "gameover") return s;

  // Start on first meaningful input.
  if (s.phase === "ready") {
    if (input.move !== 0 || input.fire) s = { ...s, phase: "playing" };
    else return s;
  }

  // Player movement, clamped.
  if (input.move !== 0) {
    const dx = input.move * CONFIG.player.speedPxPerMs * dtMs;
    const maxX = CONFIG.arena.w - s.player.w;
    const x = Math.max(0, Math.min(maxX, s.player.x + dx));
    s = { ...s, player: { ...s.player, x } };
  }

  return s;
}
```

- [ ] **Step 8: Run — expect PASS**

- [ ] **Step 9: Commit**

```bash
git add frontend/src/games/space-invaders/engine/{collision.ts,collision.test.ts,step.ts,step.movement.test.ts}
git commit -m "Add Space Invaders collision helper and step movement/pause scaffold"
```

---

### Task 4: Formation march — horizontal step, edge drop-and-reverse, speed-up

**Files:**
- Modify: `frontend/src/games/space-invaders/engine/step.ts`
- Test: `frontend/src/games/space-invaders/engine/step.formation.test.ts`

**Interfaces:**
- Consumes: `formationStepMs` (Task 1), `step` (Task 3).
- Produces: `step` now advances `stepAccumMs`; when it reaches `formationStepMs(alive,total)` the formation moves `dir*stepDx`, and if any alien would cross an arena edge the whole formation drops `dropY` and flips `dir`.

- [ ] **Step 1: Write `step.formation.test.ts` (failing)**

```ts
import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import { CONFIG } from "./config";
import type { GameState, InputIntent } from "./types";

const idle: InputIntent = { move: 0, fire: false, pause: false };

function playing(seed = 1): GameState {
  return { ...newGame(seed), phase: "playing" };
}

describe("step — formation march", () => {
  it("does not move the formation before the cadence elapses", () => {
    const s = playing();
    const x0 = s.aliens[0].x;
    const s1 = step(s, 16, idle);
    expect(s1.aliens[0].x).toBe(x0);
  });

  it("marches horizontally once accumulated time passes the cadence", () => {
    let s = playing();
    const x0 = s.aliens[0].x;
    for (let i = 0; i < 60; i++) s = step(s, 16, idle); // ~960ms > stepMsMax
    expect(s.aliens[0].x).not.toBe(x0);
  });

  it("drops and reverses at the right edge", () => {
    let s = playing();
    const y0 = Math.max(...s.aliens.map((a) => a.y));
    // Force many marches to hit the right wall.
    for (let i = 0; i < 4000; i++) s = step(s, 16, idle);
    const y1 = Math.max(...s.aliens.map((a) => a.y));
    expect(y1).toBeGreaterThan(y0); // dropped at least once
  });

  it("marches faster when few aliens remain", () => {
    const many = playing();
    const few: GameState = {
      ...playing(),
      aliens: playing().aliens.map((a, i) => ({ ...a, alive: i < 2 })),
    };
    // With fewer alive, cadence is shorter → same elapsed time yields more moves.
    // Assert via formationStepMs indirectly: fewer alive ⇒ smaller cadence.
    const cadenceMany = require("./config").formationStepMs(
      many.aliens.filter((a) => a.alive).length,
      many.aliens.length
    );
    const cadenceFew = require("./config").formationStepMs(2, few.aliens.length);
    expect(cadenceFew).toBeLessThan(cadenceMany);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (formation does not yet march)

- [ ] **Step 3: Extend `step.ts` — add formation march before the `return s`**

Insert after the movement block, before `return s;`:

```ts
  // ── Formation march (fixed-cadence, accelerating as ranks thin) ──
  const living = s.aliens.filter((a) => a.alive);
  if (living.length > 0) {
    const cadence = formationStepMs(living.length, s.aliens.length);
    let accum = s.stepAccumMs + dtMs;
    if (accum >= cadence) {
      accum -= cadence;
      const minX = Math.min(...living.map((a) => a.x));
      const maxX = Math.max(...living.map((a) => a.x + a.w));
      const dx = s.dir * CONFIG.formation.stepDx;
      const hitsEdge = minX + dx < 0 || maxX + dx > CONFIG.arena.w;
      if (hitsEdge) {
        s = {
          ...s,
          dir: (s.dir * -1) as 1 | -1,
          aliens: s.aliens.map((a) => (a.alive ? { ...a, y: a.y + CONFIG.formation.dropY } : a)),
          stepAccumMs: accum,
        };
      } else {
        s = {
          ...s,
          aliens: s.aliens.map((a) => (a.alive ? { ...a, x: a.x + dx } : a)),
          stepAccumMs: accum,
        };
      }
    } else {
      s = { ...s, stepAccumMs: accum };
    }
  }
```

Add the import at the top of `step.ts`:

```ts
import { CONFIG, formationStepMs } from "./config";
```

(remove the old `import { CONFIG } from "./config";`).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/games/space-invaders/engine/step.ts frontend/src/games/space-invaders/engine/step.formation.test.ts
git commit -m "Add Space Invaders formation march with edge drop-reverse and speed-up"
```

---

### Task 5: Player bullet — fire (one in flight), travel, despawn, alien collision + score

**Files:**
- Modify: `frontend/src/games/space-invaders/engine/step.ts`
- Test: `frontend/src/games/space-invaders/engine/step.playerbullet.test.ts`

**Interfaces:**
- Consumes: `aabb` (Task 3), `CONFIG`, `step`.
- Produces: `step` spawns a player bullet on `fire` when none is live; moves it up each frame; despawns off-screen; on overlap with a living alien removes the alien, frees the bullet, and adds `CONFIG.points[row]` to score.

- [ ] **Step 1: Write `step.playerbullet.test.ts` (failing)**

```ts
import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import { CONFIG } from "./config";
import type { GameState, InputIntent } from "./types";

const fire: InputIntent = { move: 0, fire: true, pause: false };
const idle: InputIntent = { move: 0, fire: false, pause: false };

function playing(seed = 1): GameState {
  return { ...newGame(seed), phase: "playing" };
}

describe("step — player bullet", () => {
  it("spawns a bullet on fire when none is in flight", () => {
    const s = step(playing(), 16, fire);
    expect(s.playerBullet).not.toBeNull();
  });

  it("does not spawn a second bullet while one is live", () => {
    let s = step(playing(), 16, fire);
    const firstY = s.playerBullet!.y;
    s = step(s, 16, fire);
    // still exactly one bullet, and it moved (not replaced at spawn Y)
    expect(s.playerBullet).not.toBeNull();
    expect(s.playerBullet!.y).toBeLessThan(firstY);
  });

  it("moves the bullet upward and despawns it off the top", () => {
    let s = step(playing(), 16, fire);
    for (let i = 0; i < 200; i++) s = step(s, 16, idle);
    expect(s.playerBullet).toBeNull();
  });

  it("kills an alien on contact, frees the bullet, and scores", () => {
    let s = playing();
    // Place a lone alien directly above the player and fire.
    const target = { ...s.aliens[0], x: s.player.x, y: s.player.y - 40, alive: true, row: 0 };
    s = { ...s, aliens: [target] };
    s = step(s, 16, fire);
    for (let i = 0; i < 20; i++) s = step(s, 16, idle);
    expect(s.aliens[0].alive).toBe(false);
    expect(s.playerBullet).toBeNull();
    expect(s.score).toBe(CONFIG.points[0]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Extend `step.ts` — add bullet spawn/move/collision**

Add `import { aabb } from "./collision";` at the top.

Insert this block after the movement block and before the formation march (spawn), and add bullet-advance + collision after the march, before `return s;`:

```ts
  // Fire: spawn one bullet if none is live.
  if (input.fire && !s.playerBullet) {
    s = {
      ...s,
      playerBullet: {
        x: s.player.x + s.player.w / 2 - CONFIG.bullet.w / 2,
        y: s.player.y - CONFIG.bullet.h,
        w: CONFIG.bullet.w,
        h: CONFIG.bullet.h,
        alive: true,
      },
    };
  }
```

Then, after the formation march block (before `return s;`):

```ts
  // Advance the player bullet and resolve alien hits.
  if (s.playerBullet) {
    const b = { ...s.playerBullet, y: s.playerBullet.y - CONFIG.bullet.playerSpeedPxPerMs * dtMs };
    if (b.y + b.h < 0) {
      s = { ...s, playerBullet: null };
    } else {
      let hitScore = 0;
      let hit = false;
      const aliens = s.aliens.map((a) => {
        if (!hit && a.alive && aabb(b, a)) {
          hit = true;
          hitScore = CONFIG.points[a.row] ?? CONFIG.points[CONFIG.points.length - 1];
          return { ...a, alive: false };
        }
        return a;
      });
      s = hit
        ? { ...s, aliens, playerBullet: null, score: s.score + hitScore }
        : { ...s, playerBullet: b };
    }
  }
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/games/space-invaders/engine/step.ts frontend/src/games/space-invaders/engine/step.playerbullet.test.ts
git commit -m "Add Space Invaders player bullet firing, travel, and alien hits"
```

---

### Task 6: Alien fire (seeded) + player hit → life loss + respawn invulnerability

**Files:**
- Modify: `frontend/src/games/space-invaders/engine/step.ts`
- Test: `frontend/src/games/space-invaders/engine/step.alienbullet.test.ts`

**Interfaces:**
- Consumes: `rngFloat` (Task 1), `aabb`, `CONFIG`.
- Produces: `step` decrements `alienFireMs`; on reaching 0 it picks a front-most living alien via seeded PRNG and spawns a downward bullet, resetting the cooldown and advancing `rng`. Alien bullets travel down, despawn off-bottom. A bullet overlapping the player (when `invulnMs<=0`) removes a life, clears alien bullets, and sets `invulnMs = respawnInvulnMs`. `invulnMs` counts down by `dtMs`.

- [ ] **Step 1: Write `step.alienbullet.test.ts` (failing)**

```ts
import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import { CONFIG } from "./config";
import type { GameState, InputIntent } from "./types";

const idle: InputIntent = { move: 0, fire: false, pause: false };

function playing(seed = 7): GameState {
  return { ...newGame(seed), phase: "playing" };
}

describe("step — alien fire & player damage", () => {
  it("eventually spawns an alien bullet (seeded, deterministic)", () => {
    let a = playing(7);
    let b = playing(7);
    for (let i = 0; i < 120; i++) {
      a = step(a, 16, idle);
      b = step(b, 16, idle);
    }
    expect(a.alienBullets.length).toBeGreaterThan(0);
    expect(a.alienBullets).toEqual(b.alienBullets); // determinism
  });

  it("removes a life and grants invulnerability when a bullet hits the player", () => {
    let s = playing();
    // Craft a bullet just above the player.
    s = {
      ...s,
      alienBullets: [
        { x: s.player.x + 2, y: s.player.y - CONFIG.bullet.h + 1, w: CONFIG.bullet.w, h: CONFIG.bullet.h, alive: true },
      ],
    };
    const before = s.lives;
    s = step(s, 16, idle);
    expect(s.lives).toBe(before - 1);
    expect(s.invulnMs).toBeGreaterThan(0);
    expect(s.alienBullets).toEqual([]);
  });

  it("is immune to damage while invulnerable", () => {
    let s = { ...playing(), invulnMs: 1000 };
    s = {
      ...s,
      alienBullets: [
        { x: s.player.x + 2, y: s.player.y + 1, w: CONFIG.bullet.w, h: CONFIG.bullet.h, alive: true },
      ],
    };
    const before = s.lives;
    s = step(s, 16, idle);
    expect(s.lives).toBe(before);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Extend `step.ts`**

Add `import { rngFloat } from "./prng";` at the top.

After the player-bullet block, before `return s;`, add:

```ts
  // Invulnerability countdown.
  if (s.invulnMs > 0) {
    s = { ...s, invulnMs: Math.max(0, s.invulnMs - dtMs) };
  }

  // Alien fire on cooldown (seeded).
  {
    const living = s.aliens.filter((a) => a.alive);
    let fireMs = s.alienFireMs - dtMs;
    if (fireMs <= 0 && living.length > 0) {
      const pick = rngFloat(s.rng);
      const shooter = living[Math.floor(pick.value * living.length)];
      const bullet = {
        x: shooter.x + shooter.w / 2 - CONFIG.bullet.w / 2,
        y: shooter.y + shooter.h,
        w: CONFIG.bullet.w,
        h: CONFIG.bullet.h,
        alive: true,
      };
      s = {
        ...s,
        rng: pick.state,
        alienBullets: [...s.alienBullets, bullet],
        alienFireMs: CONFIG.alienFire.cooldownMs,
      };
    } else {
      s = { ...s, alienFireMs: fireMs };
    }
  }

  // Advance alien bullets; resolve player damage.
  if (s.alienBullets.length > 0) {
    const moved = s.alienBullets
      .map((b) => ({ ...b, y: b.y + CONFIG.bullet.alienSpeedPxPerMs * dtMs }))
      .filter((b) => b.y < CONFIG.arena.h);
    const struck = s.invulnMs <= 0 && moved.some((b) => aabb(b, s.player));
    if (struck) {
      s = { ...s, alienBullets: [], lives: s.lives - 1, invulnMs: CONFIG.respawnInvulnMs };
    } else {
      s = { ...s, alienBullets: moved };
    }
  }
```

Note: the invulnerability countdown is placed *before* the damage check so a fresh hit still yields `invulnMs > 0` this frame; the immunity test uses a pre-set `invulnMs` large enough to survive one decrement.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/games/space-invaders/engine/step.ts frontend/src/games/space-invaders/engine/step.alienbullet.test.ts
git commit -m "Add Space Invaders seeded alien fire and player damage/invulnerability"
```

---

### Task 7: Lose conditions + wave clear

**Files:**
- Modify: `frontend/src/games/space-invaders/engine/step.ts`
- Test: `frontend/src/games/space-invaders/engine/step.endgame.test.ts`

**Interfaces:**
- Consumes: `CONFIG`, `spawnWave` (Task 2), `step`.
- Produces: `step` sets `phase: "gameover"` when `lives <= 0` OR any living alien's bottom reaches `player.y`. When all aliens are dead, increments `wave`, spawns a lower/faster wave via `spawnWave(wave+1)`, and resets `dir`/`stepAccumMs`.

- [ ] **Step 1: Write `step.endgame.test.ts` (failing)**

```ts
import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame, spawnWave } from "./spawn";
import { CONFIG } from "./config";
import type { GameState, InputIntent } from "./types";

const idle: InputIntent = { move: 0, fire: false, pause: false };

function playing(seed = 1): GameState {
  return { ...newGame(seed), phase: "playing" };
}

describe("step — end conditions", () => {
  it("game over when lives reach zero", () => {
    let s = { ...playing(), lives: 1, invulnMs: 0 };
    s = {
      ...s,
      alienBullets: [
        { x: s.player.x + 2, y: s.player.y - CONFIG.bullet.h + 1, w: CONFIG.bullet.w, h: CONFIG.bullet.h, alive: true },
      ],
    };
    s = step(s, 16, idle);
    expect(s.phase).toBe("gameover");
  });

  it("game over when an alien reaches the player baseline", () => {
    let s = playing();
    s = { ...s, aliens: [{ x: 50, y: s.player.y, w: 16, h: 12, alive: true, row: 0, col: 0 }] };
    s = step(s, 16, idle);
    expect(s.phase).toBe("gameover");
  });

  it("advances to the next wave when all aliens are dead", () => {
    let s = playing();
    s = { ...s, aliens: s.aliens.map((a) => ({ ...a, alive: false })), wave: 1 };
    s = step(s, 16, idle);
    expect(s.wave).toBe(2);
    expect(s.aliens.length).toBe(CONFIG.alien.rows * CONFIG.alien.cols);
    expect(s.aliens.every((a) => a.alive)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Extend `step.ts` — add end-of-frame resolution**

Add `import { spawnWave } from "./spawn";` at the top. Just before the final `return s;`, add:

```ts
  // ── Resolve end-of-frame conditions ──
  if (s.lives <= 0) {
    return { ...s, phase: "gameover" };
  }
  const alive = s.aliens.filter((a) => a.alive);
  if (alive.some((a) => a.y + a.h >= s.player.y)) {
    return { ...s, phase: "gameover" };
  }
  if (alive.length === 0) {
    const nextWave = s.wave + 1;
    s = {
      ...s,
      wave: nextWave,
      aliens: spawnWave(nextWave).aliens,
      dir: 1,
      stepAccumMs: 0,
      playerBullet: null,
      alienBullets: [],
    };
  }
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/games/space-invaders/engine/step.ts frontend/src/games/space-invaders/engine/step.endgame.test.ts
git commit -m "Add Space Invaders lose conditions and wave progression"
```

---

### Task 8: Engine public surface + golden-vector determinism test

**Files:**
- Create: `frontend/src/games/space-invaders/engine/index.ts`
- Test: `frontend/src/games/space-invaders/engine/determinism.test.ts`

**Interfaces:**
- Consumes: everything in `engine/`.
- Produces: `index.ts` re-exporting `newGame`, `step`, `CONFIG`, and all types — the only import surface the React shell uses.

- [ ] **Step 1: Write `determinism.test.ts` (failing)**

```ts
import { describe, it, expect } from "vitest";
import { newGame, step } from "./index";
import type { InputIntent } from "./index";

// A fixed scripted input sequence; same seed must yield identical final state.
function run(seed: number) {
  const script: InputIntent[] = [];
  for (let i = 0; i < 300; i++) {
    script.push({ move: (i % 3) - 1 as -1 | 0 | 1, fire: i % 7 === 0, pause: false });
  }
  let s = newGame(seed);
  for (const input of script) s = step(s, 16, input);
  return s;
}

describe("engine determinism", () => {
  it("same seed + same inputs → identical state", () => {
    expect(run(2026)).toEqual(run(2026));
  });

  it("different seeds diverge", () => {
    expect(run(1)).not.toEqual(run(2));
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './index'`)

- [ ] **Step 3: Implement `index.ts`**

```ts
export { newGame, spawnWave } from "./spawn";
export { step } from "./step";
export { CONFIG, formationStepMs } from "./config";
export { aabb } from "./collision";
export type { GameState, Alien, Bullet, InputIntent, Phase, Rect } from "./types";
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/games/space-invaders/engine/index.ts frontend/src/games/space-invaders/engine/determinism.test.ts
git commit -m "Add Space Invaders engine public surface and determinism golden test"
```

---

### Task 9: High-score persistence

**Files:**
- Create: `frontend/src/games/space-invaders/lib/highScore.ts`
- Test: `frontend/src/games/space-invaders/lib/highScore.test.ts`

**Interfaces:**
- Produces:
  - `loadBest(): number` — reads `localStorage["memba.space-invaders.best"]`, returns 0 if absent/invalid.
  - `saveBest(score: number): number` — writes only if `score > loadBest()`, returns the new best.

- [ ] **Step 1: Write `highScore.test.ts` (failing)**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadBest, saveBest } from "./highScore";

beforeEach(() => localStorage.clear());

describe("highScore", () => {
  it("returns 0 when nothing stored", () => {
    expect(loadBest()).toBe(0);
  });
  it("persists a new best", () => {
    saveBest(120);
    expect(loadBest()).toBe(120);
  });
  it("does not lower an existing best", () => {
    saveBest(200);
    saveBest(50);
    expect(loadBest()).toBe(200);
  });
  it("ignores corrupt values", () => {
    localStorage.setItem("memba.space-invaders.best", "not-a-number");
    expect(loadBest()).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `highScore.ts`**

```ts
const KEY = "memba.space-invaders.best";

export function loadBest(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw == null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveBest(score: number): number {
  const best = Math.max(loadBest(), Math.max(0, Math.floor(score)));
  try {
    localStorage.setItem(KEY, String(best));
  } catch {
    /* storage unavailable — best-effort only */
  }
  return best;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/games/space-invaders/lib/highScore.ts frontend/src/games/space-invaders/lib/highScore.test.ts
git commit -m "Add Space Invaders local high-score persistence"
```

---

### Task 10: Fixed-timestep loop advance (pure) + input hooks

**Files:**
- Create: `frontend/src/games/space-invaders/hooks/useGameLoop.ts`
- Create: `frontend/src/games/space-invaders/hooks/useKeyboard.ts`
- Create: `frontend/src/games/space-invaders/hooks/useTouch.ts`
- Test: `frontend/src/games/space-invaders/hooks/advance.test.ts`

**Interfaces:**
- Consumes: `step`, `GameState`, `InputIntent` (engine).
- Produces:
  - Pure `advance(state, frameMs, input, fixedMs?): GameState` in `useGameLoop.ts` — splits a variable frame into whole fixed steps (clamped to avoid spiral-of-death), calling `step` per fixed tick.
  - `useGameLoop(getInput, onFrame)` React hook — rAF loop calling `advance`.
  - `useKeyboard(): () => InputIntent` — returns a getter reading a live keyboard intent ref; emits `pause:true` for exactly one frame per keypress (edge).
  - `useTouch(ref): () => InputIntent` — pointer handlers on `ref` produce move/fire; single-frame pause edge.

Only `advance` is unit-tested; the rAF hooks are exercised by the shell smoke test in Task 13.

- [ ] **Step 1: Write `advance.test.ts` (failing)**

```ts
import { describe, it, expect } from "vitest";
import { advance } from "./useGameLoop";
import { newGame } from "../engine";
import type { InputIntent } from "../engine";

const idle: InputIntent = { move: 0, fire: false, pause: false };

describe("advance (fixed timestep)", () => {
  it("applies multiple fixed steps for a long frame", () => {
    const one = advance({ ...newGame(1), phase: "playing" }, 16.67, { move: 1, fire: false, pause: false });
    const many = advance({ ...newGame(1), phase: "playing" }, 100, { move: 1, fire: false, pause: false });
    expect(many.player.x).toBeGreaterThan(one.player.x);
  });

  it("clamps huge frames to avoid spiral-of-death", () => {
    const s = advance({ ...newGame(1), phase: "playing" }, 100000, idle);
    // Should not throw / hang; state remains valid.
    expect(s.aliens.length).toBeGreaterThan(0);
  });

  it("is a no-op for a zero-length frame", () => {
    const start = { ...newGame(1), phase: "playing" as const };
    expect(advance(start, 0, idle)).toEqual(start);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `useGameLoop.ts`**

```ts
import { useEffect, useRef } from "react";
import { step, type GameState, type InputIntent } from "../engine";

const FIXED_MS = 1000 / 60;
const MAX_FRAME_MS = 250; // clamp to avoid spiral-of-death

export function advance(
  state: GameState,
  frameMs: number,
  input: InputIntent,
  fixedMs: number = FIXED_MS
): GameState {
  let remaining = Math.min(Math.max(0, frameMs), MAX_FRAME_MS);
  let s = state;
  while (remaining >= fixedMs) {
    s = step(s, fixedMs, input);
    remaining -= fixedMs;
  }
  return s;
}

export function useGameLoop(
  getState: () => GameState,
  setState: (s: GameState) => void,
  getInput: () => InputIntent
): void {
  const raf = useRef(0);
  const last = useRef<number | null>(null);
  useEffect(() => {
    const tick = (t: number) => {
      if (last.current == null) last.current = t;
      const frameMs = t - last.current;
      last.current = t;
      setState(advance(getState(), frameMs, getInput()));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Implement `useKeyboard.ts`**

```ts
import { useEffect, useRef } from "react";
import type { InputIntent } from "../engine";

export function useKeyboard(): () => InputIntent {
  const left = useRef(false);
  const right = useRef(false);
  const fire = useRef(false);
  const pauseEdge = useRef(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { left.current = true; e.preventDefault(); }
      else if (e.key === "ArrowRight") { right.current = true; e.preventDefault(); }
      else if (e.key === " " || e.key === "Spacebar") { fire.current = true; e.preventDefault(); }
      else if (e.key === "p" || e.key === "P") { pauseEdge.current = true; }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") left.current = false;
      else if (e.key === "ArrowRight") right.current = false;
      else if (e.key === " " || e.key === "Spacebar") fire.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return () => {
    const move = (right.current ? 1 : 0) - (left.current ? 1 : 0);
    const pause = pauseEdge.current;
    pauseEdge.current = false; // consume edge
    return { move: move as -1 | 0 | 1, fire: fire.current, pause };
  };
}
```

- [ ] **Step 6: Implement `useTouch.ts`**

```ts
import { useEffect, useRef, type RefObject } from "react";
import type { InputIntent } from "../engine";

// Left half of the play area = steer (pointer left/right of its start),
// right half = fire (tap or hold). Pause handled by an on-screen button in the shell.
export function useTouch(ref: RefObject<HTMLElement>): () => InputIntent {
  const move = useRef<-1 | 0 | 1>(0);
  const fire = useRef(false);
  const steerStartX = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rectHalf = () => el.getBoundingClientRect().left + el.clientWidth / 2;

    const onDown = (e: PointerEvent) => {
      if (e.clientX < rectHalf()) { steerStartX.current = e.clientX; move.current = 0; }
      else { fire.current = true; }
    };
    const onMove = (e: PointerEvent) => {
      if (steerStartX.current != null) {
        const dx = e.clientX - steerStartX.current;
        move.current = dx > 6 ? 1 : dx < -6 ? -1 : 0;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.clientX < rectHalf()) { steerStartX.current = null; move.current = 0; }
      else { fire.current = false; }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [ref]);

  return () => ({ move: move.current, fire: fire.current, pause: false });
}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/games/space-invaders/hooks/
git commit -m "Add Space Invaders fixed-timestep loop and keyboard/touch input hooks"
```

---

### Task 11: Canvas renderer

**Files:**
- Create: `frontend/src/games/space-invaders/render/Canvas.tsx`
- Test: `frontend/src/games/space-invaders/render/Canvas.test.tsx`

**Interfaces:**
- Consumes: `GameState`, `CONFIG`.
- Produces: `<Canvas state={GameState} />` — draws player, living aliens, and bullets to a `<canvas>` sized to `CONFIG.arena`. Pure presentation; a blinking player while invulnerable. Colors from CSS vars via inline fallback (dark theme).

- [ ] **Step 1: Write `Canvas.test.tsx` (failing)**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { Canvas } from "./Canvas";
import { newGame } from "../engine";

// jsdom canvas has no 2d context; stub it so the draw path runs without throwing.
beforeEach(() => {
  const ctx = {
    clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    fillStyle: "", set globalAlpha(_v: number) {},
  } as unknown as CanvasRenderingContext2D;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
});

describe("Canvas", () => {
  it("renders a canvas and draws without throwing", () => {
    const { container } = render(<Canvas state={{ ...newGame(1), phase: "playing" }} />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/games/space-invaders/render/Canvas.test.tsx`

- [ ] **Step 3: Implement `Canvas.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { CONFIG, type GameState } from "../engine";

const COLORS = { bg: "#04120f", player: "#4ff0c0", alien: "#e6f7ef", bullet: "#ffd24d" };

export function Canvas({ state }: { state: GameState }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const { w, h } = CONFIG.arena;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = COLORS.alien;
    for (const a of state.aliens) if (a.alive) ctx.fillRect(a.x, a.y, a.w, a.h);

    ctx.fillStyle = COLORS.bullet;
    if (state.playerBullet) {
      const b = state.playerBullet;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    for (const b of state.alienBullets) ctx.fillRect(b.x, b.y, b.w, b.h);

    // Player blinks while invulnerable.
    const blink = state.invulnMs > 0 && Math.floor(state.invulnMs / 120) % 2 === 0;
    if (!blink) {
      ctx.fillStyle = COLORS.player;
      ctx.fillRect(state.player.x, state.player.y, state.player.w, state.player.h);
    }
  }, [state]);

  return (
    <canvas
      ref={ref}
      width={CONFIG.arena.w}
      height={CONFIG.arena.h}
      className="si-canvas"
      aria-label="Space Invaders play area"
    />
  );
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/games/space-invaders/render/
git commit -m "Add Space Invaders canvas renderer"
```

---

### Task 12: Game shell (loop + input + render + HUD/overlays) and CSS

**Files:**
- Create: `frontend/src/games/space-invaders/SpaceInvaders.tsx`
- Create: `frontend/src/games/space-invaders/space-invaders.css`
- Test: `frontend/src/games/space-invaders/SpaceInvaders.test.tsx`

**Interfaces:**
- Consumes: `newGame`, `GameState`, `advance`, `useKeyboard`, `useTouch`, `Canvas`, `loadBest`, `saveBest`.
- Produces: default-exported `<SpaceInvaders />` component. Holds `GameState` in a ref (loop mutates a ref; a lightweight React state mirror drives HUD re-render at frame rate via the loop's setState). Renders HUD (score/best/wave/lives), the `Canvas`, a ready prompt, a pause button + overlay, and a game-over sheet with "Play again". Persists best on game over.

- [ ] **Step 1: Write `SpaceInvaders.test.tsx` (failing)**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpaceInvaders from "./SpaceInvaders";

beforeEach(() => {
  const ctx = {
    clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    fillStyle: "", set globalAlpha(_v: number) {},
  } as unknown as CanvasRenderingContext2D;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
  // deterministic rAF: run one frame then stop
  let called = false;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    if (!called) { called = true; setTimeout(() => cb(16), 0); }
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  localStorage.clear();
});

describe("SpaceInvaders shell", () => {
  it("renders the HUD and a start prompt", () => {
    render(<SpaceInvaders />);
    expect(screen.getByText(/score/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/space invaders play area/i)).toBeInTheDocument();
  });

  it("shows a game-over sheet when the game ends", () => {
    render(<SpaceInvaders initialState={{ phase: "gameover", score: 90 } as never} />);
    expect(screen.getByText(/game over/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play again/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `SpaceInvaders.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { newGame, type GameState } from "./engine";
import { advance } from "./hooks/useGameLoop";
import { useKeyboard } from "./hooks/useKeyboard";
import { useTouch } from "./hooks/useTouch";
import { Canvas } from "./render/Canvas";
import { loadBest, saveBest } from "./lib/highScore";
import "./space-invaders.css";

// A fixed seed keeps runs reproducible; vary if a daily hook is added later.
const SEED = 0x5eed;

export default function SpaceInvaders({ initialState }: { initialState?: GameState }) {
  const [state, setState] = useState<GameState>(() => initialState ?? newGame(SEED));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [best, setBest] = useState(() => loadBest());

  const areaRef = useRef<HTMLDivElement>(null);
  const getKeyInput = useKeyboard();
  const getTouchInput = useTouch(areaRef);

  const getInput = useCallback(() => {
    const k = getKeyInput();
    const t = getTouchInput();
    return {
      move: (k.move || t.move) as -1 | 0 | 1,
      fire: k.fire || t.fire,
      pause: k.pause,
    };
  }, [getKeyInput, getTouchInput]);

  // rAF loop (inline so tests can stub rAF).
  const last = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = (time: number) => {
      if (last.current == null) last.current = time;
      const frameMs = time - last.current;
      last.current = time;
      const next = advance(stateRef.current, frameMs, getInput());
      stateRef.current = next;
      setState(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getInput]);

  // Persist best on game over.
  useEffect(() => {
    if (state.phase === "gameover") setBest(saveBest(state.score));
  }, [state.phase, state.score]);

  const restart = () => {
    const fresh = newGame(SEED);
    stateRef.current = fresh;
    last.current = null;
    setState(fresh);
  };

  const togglePause = () => {
    const p = stateRef.current.phase;
    if (p === "playing") setState({ ...stateRef.current, phase: "paused" });
    else if (p === "paused") setState({ ...stateRef.current, phase: "playing" });
  };

  return (
    <div className="si-root">
      <div className="si-hud">
        <span>Score {state.score}</span>
        <span>Best {best}</span>
        <span>Wave {state.wave}</span>
        <span>Lives {"◈".repeat(Math.max(0, state.lives))}</span>
        <button type="button" className="si-pause" onClick={togglePause} aria-label="Pause">
          {state.phase === "paused" ? "▶" : "⏸"}
        </button>
      </div>

      <div className="si-stage" ref={areaRef}>
        <Canvas state={state} />
        {state.phase === "ready" && (
          <div className="si-overlay">
            <p>◀ ▶ move · Space fire</p>
            <p className="si-hint">On mobile: steer on the left, tap right to fire</p>
          </div>
        )}
        {state.phase === "paused" && <div className="si-overlay"><p>Paused</p></div>}
        {state.phase === "gameover" && (
          <div className="si-overlay si-gameover">
            <h2>Game Over</h2>
            <p>Score {state.score} · Best {best}</p>
            <button type="button" onClick={restart}>Play again</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `space-invaders.css`**

```css
.si-root { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 16px; color: #e6f7ef; }
.si-hud { display: flex; gap: 16px; align-items: center; font-variant-numeric: tabular-nums; font-size: 14px; }
.si-pause { background: transparent; border: 1px solid #2f5c50; color: inherit; border-radius: 6px; padding: 2px 8px; cursor: pointer; }
.si-stage { position: relative; width: 320px; max-width: 100%; touch-action: none; user-select: none; }
.si-canvas { width: 100%; height: auto; display: block; background: #04120f; border: 1px solid #2f5c50; border-radius: 8px; image-rendering: pixelated; }
.si-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; background: rgba(4,18,15,0.72); border-radius: 8px; }
.si-overlay button { padding: 8px 16px; border-radius: 8px; border: 1px solid #4ff0c0; background: transparent; color: #4ff0c0; cursor: pointer; }
.si-hint { font-size: 12px; opacity: 0.7; }
.si-gameover h2 { margin: 0; }
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add frontend/src/games/space-invaders/SpaceInvaders.tsx frontend/src/games/space-invaders/space-invaders.css frontend/src/games/space-invaders/SpaceInvaders.test.tsx
git commit -m "Add Space Invaders game shell, HUD/overlays, and styles"
```

---

### Task 13: Config flag + gate

**Files:**
- Modify: `frontend/src/lib/config.ts` (add near `isGameEnabled`, line ~645)
- Create: `frontend/src/components/ui/SpaceInvadersGate.tsx`
- Modify: `.env.example`
- Test: `frontend/src/lib/config.spaceInvaders.test.ts`

**Interfaces:**
- Consumes: existing `ComingSoonGate`.
- Produces: `isSpaceInvadersEnabled(): boolean`; `<SpaceInvadersGate>` renders `ComingSoonGate` when disabled.

- [ ] **Step 1: Write `config.spaceInvaders.test.ts` (failing)**

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { isSpaceInvadersEnabled } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("isSpaceInvadersEnabled", () => {
  it("is false by default", () => {
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS", "");
    expect(isSpaceInvadersEnabled()).toBe(false);
  });
  it("is true only when exactly 'true'", () => {
    vi.stubEnv("VITE_ENABLE_SPACE_INVADERS", "true");
    expect(isSpaceInvadersEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Add to `config.ts` (immediately after `isGameEnabled`)**

```ts
export const isSpaceInvadersEnabled = (): boolean =>
  import.meta.env.VITE_ENABLE_SPACE_INVADERS === "true";
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Implement `SpaceInvadersGate.tsx`**

```tsx
import type { ReactNode } from "react";
import { isSpaceInvadersEnabled } from "../../lib/config";
import { ComingSoonGate } from "./ComingSoonGate";

export function SpaceInvadersGate({ children }: { children: ReactNode }) {
  if (!isSpaceInvadersEnabled()) {
    return (
      <ComingSoonGate
        title="Space Invaders"
        icon="🛸"
        description="Defend the baseline. A classic arcade shooter, playable instantly in your browser."
        features={["Keyboard & touch controls", "Play instantly, no wallet", "Escalating waves", "Local high score"]}
      />
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 6: Add to `.env.example`** (near the other `VITE_ENABLE_*` flags)

```
# Space Invaders arcade game (Store). Leave false; owner flips to enable.
VITE_ENABLE_SPACE_INVADERS=false
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/config.ts frontend/src/lib/config.spaceInvaders.test.ts frontend/src/components/ui/SpaceInvadersGate.tsx .env.example
git commit -m "Add Space Invaders feature flag and coming-soon gate"
```

---

### Task 14: Lazy page + route wiring

**Files:**
- Create: `frontend/src/pages/SpaceInvadersGame.tsx`
- Modify: `frontend/src/App.tsx` (lazy import near line ~85; route near line ~309)

**Interfaces:**
- Consumes: `SpaceInvaders` default export, `SpaceInvadersGate`.
- Produces: default-exported page; route `game/space-invaders`.

- [ ] **Step 1: Implement `SpaceInvadersGame.tsx`**

```tsx
import SpaceInvaders from "../games/space-invaders/SpaceInvaders";

export default function SpaceInvadersGame() {
  return <SpaceInvaders />;
}
```

- [ ] **Step 2: Add lazy import to `App.tsx`** (below the Block Party lazy import, ~line 85)

```tsx
// ── Space Invaders game (lazy — gated behind VITE_ENABLE_SPACE_INVADERS) ──
const SpaceInvadersGame = lazy(() => import("./pages/SpaceInvadersGame"));
```

- [ ] **Step 3: Add the route to `App.tsx`** (immediately after the `game` route, ~line 309)

```tsx
{/* Space Invaders — arcade game (gated behind VITE_ENABLE_SPACE_INVADERS) */}
<Route
  path="game/space-invaders"
  element={
    <Suspense fallback={<PageLoader />}>
      <SpaceInvadersGate>
        <SpaceInvadersGame />
      </SpaceInvadersGate>
    </Suspense>
  }
/>
```

Add the import for the gate at the top of `App.tsx` (near the `GameGate` import, ~line 12):

```tsx
import { SpaceInvadersGate } from "./components/ui/SpaceInvadersGate";
```

- [ ] **Step 4: Verify build compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds; no type errors referencing the new files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SpaceInvadersGame.tsx frontend/src/App.tsx
git commit -m "Wire Space Invaders lazy route at game/space-invaders"
```

---

### Task 15: App Store catalog entry

**Files:**
- Modify: `frontend/src/pages/AppStore.tsx` (and/or its catalog data source — locate the array that lists Block Party)

**Interfaces:**
- Consumes: the existing App Store catalog shape (discover by reading how Block Party is listed).
- Produces: a Space Invaders catalog card linking to `/game/space-invaders`, marked so it only surfaces the "open" action when `isSpaceInvadersEnabled()` (mirror how Block Party respects `isGameEnabled`; if Block Party always shows with a coming-soon state, match that).

- [ ] **Step 1: Locate the catalog**

Run: `cd frontend && grep -rn "Block Party\|/game\|isGameEnabled" src/pages/AppStore.tsx src/data 2>/dev/null`
Read the file(s) to learn the exact entry shape (title, icon, href, enabled flag, description).

- [ ] **Step 2: Add the Space Invaders entry**

Following the discovered shape, add an entry mirroring Block Party's, e.g.:

```tsx
{
  title: "Space Invaders",
  icon: "🛸",
  href: "/game/space-invaders",
  description: "Classic arcade shooter — defend the baseline across escalating waves.",
  enabled: isSpaceInvadersEnabled(),
}
```

Import `isSpaceInvadersEnabled` from `../lib/config` if not already imported. Match the surrounding entries' field names exactly (adjust keys to the real shape).

- [ ] **Step 3: Verify build + existing App Store test**

Run: `cd frontend && npm run build`
Then, if an AppStore test exists: `node ./node_modules/.bin/vitest run src/pages/AppStore.test.tsx`
Expected: build succeeds; existing App Store tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/AppStore.tsx
git commit -m "List Space Invaders in the App Store catalog"
```

---

### Task 16: Full-suite type/lint gate + manual playtest + PR

**Files:** none (verification + PR).

- [ ] **Step 1: Type-check and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: both succeed. Fix any issues (common: unused imports, `RefObject` nullability).

- [ ] **Step 2: Run all new engine + unit tests once, file by file**

Run each:
```
cd frontend
for f in $(git diff --name-only main -- 'src/games/space-invaders/**/*.test.ts*' 'src/**/config.spaceInvaders.test.ts'); do node ./node_modules/.bin/vitest run "$f"; done
```
Expected: all pass.

- [ ] **Step 3: Manual playtest with the flag on (preview)**

Temporarily run the dev server with the flag enabled (do NOT commit a `.env` with `true`):
```
cd frontend && VITE_ENABLE_SPACE_INVADERS=true npm run dev
```
Verify at `/game/space-invaders`, desktop viewport: move with ←/→, fire with Space, `P` pauses, aliens march + speed up, wave advances, lives decrement, game over + "Play again" + best persists. Then at a mobile viewport (responsive/dev-tools): steer on the left half, tap/hold right half to fire, pause button works. Stop the server.

- [ ] **Step 4: Confirm flag ships OFF**

Run: `cd frontend && grep -n "VITE_ENABLE_SPACE_INVADERS" ../.env.example && git grep -n "VITE_ENABLE_SPACE_INVADERS" -- ':!*.md'`
Expected: `.env.example` has `=false`; no committed `=true` anywhere. Confirm `/game/space-invaders` shows the ComingSoonGate when the flag is unset.

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin feat/store-space-invaders
gh pr create --title "Add Space Invaders arcade game to the Store (flag-gated, dark)" --body "$(cat <<'EOF'
## Summary
Adds a frontend-only Space Invaders game to the Memba Store, built on a pure deterministic engine (TDD) with keyboard + full touch controls. Ships dark behind `VITE_ENABLE_SPACE_INVADERS` (OFF by default) and is listed in the App Store like Block Party. No backend, realm, or DB changes.

## Design
- Pure `step(state, dt, input)` reducer, fixed-timestep loop, seeded PRNG for alien fire — fully unit-tested incl. a determinism golden test.
- Lean classic ruleset: 5×11 formation, march + drop-reverse + accelerate-on-kill, one player bullet in flight, 3 lives, escalating waves, local high score.
- Keyboard (←/→/Space/P) and touch (steer left / tap-hold right) parity.

## Test plan
- All engine + unit tests pass (run file-by-file).
- `npm run build` and `npm run lint` clean.
- Manual playtest at desktop + mobile viewport with the flag on.
- Confirmed the game is gated OFF by default (ComingSoonGate) and no `=true` is committed.
EOF
)"
```

---

## Self-Review

**1. Spec coverage**

- Frontend-only, no backend/realm/DB → Tasks 1–15 touch only frontend; Task 16 verifies. ✓
- Pure engine (no DOM/clock/`Math.random`) → Tasks 1–8; determinism test Task 8. ✓
- Lean classic ruleset (formation, march/drop/reverse, speed-up, one bullet, alien fire, 3 lives, waves, lose conditions, scoring) → Tasks 4–7. ✓
- Full touch parity + keyboard → Task 10 hooks; playtest Task 16. ✓
- Fixed-timestep determinism → Task 10 `advance`. ✓
- Local high score → Task 9; persisted on game over in Task 12. ✓
- Flag `VITE_ENABLE_SPACE_INVADERS` false + `assertSafeFlags`-safe → Task 13; verified Task 16 step 4. ✓
- Gate/ComingSoon → Task 13. ✓
- Route `game/space-invaders` → Task 14. ✓
- App Store listing → Task 15. ✓
- `.env.example` → Task 13. ✓
- Phases/overlays/game-over sheet → Task 12. ✓

**2. Placeholder scan:** Task 15 intentionally defers the exact catalog field names to implementation because the shape must be read from the live file; the step gives the discovery command and a representative entry. All other steps contain full code. Acceptable — it is a "match the existing shape" instruction, not a missing implementation.

**3. Type consistency:** `GameState`/`Alien`/`Bullet`/`InputIntent` defined in Task 1 are used verbatim thereafter. `step(state, dtMs, input)`, `advance(state, frameMs, input, fixedMs?)`, `newGame(seed)`, `spawnWave(wave)`, `formationStepMs(alive,total)`, `rngNext`/`rngFloat`, `loadBest`/`saveBest`, `isSpaceInvadersEnabled` are consistent across all tasks and the index re-export.

**Note on pause edge:** the engine toggles pause whenever `input.pause` is true; the keyboard hook emits `pause:true` for exactly one frame per keypress (consumes the edge), so holding doesn't thrash. The shell also exposes a pause button that sets phase directly (mobile). Both paths are consistent.
