# Block Party — Sub-plan 1: Pure TS Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, framework-free TypeScript game engine for Block Party (mulberry32 PRNG + 2048 rules + a pure `replay()`), plus the golden vectors that the Go verifier (Sub-plan 2) and Gno realm (Sub-plan 4) will mirror byte-for-byte.

**Architecture:** A set of pure functions over an immutable `GameState`. No React, no DOM, no `Date`/`Math.random`/floats in game logic. The engine is the single source of truth for "what score does `(seed, modifier, moveLog)` produce"; every other language port is validated against its golden vectors.

**Tech Stack:** TypeScript, Vitest (frontend package). Runs in `Memba/frontend`.

## Global Constraints

- **Determinism is byte-identical across TS ↔ Go ↔ Gno.** No floats in the engine, no `Math.random`, no `Date`, no map/object-iteration-order dependence.
- **PRNG = mulberry32**, state is `uint32`; in JS every 32-bit multiply uses `Math.imul` (never `*`), and every op is normalized with `>>> 0` / `| 0`.
- **Bounded draws use `value % n`** (no 64-bit / multiply-shift).
- **Board is a flat `number[]` of length 16, row-major, index `0..15`, top-left origin.** `0` = empty; non-zero = tile value (power of two).
- **Empty-cell enumeration is strictly ascending index order** in all languages.
- **RNG-call order is pinned:** two initial spawns before any move (position then value each); per move, **only if the move changed the board**, draw position then value for the single new tile. **No RNG consumed and no spawn on a no-op move.**
- **Merge sweep:** per line, tiles resolve toward the move direction, farthest-first; a tile may merge at most once per move. Canonical: `[2,2,2,2]` moved left → `[4,4,0,0]`.
- **Modifier applies to every spawn uniformly, including the two initial spawns.**
- **Score type** is JS `number` (≤ 2^53) / Go `int64` — pinned, unreachable overflow in a 4×4 game.
- **Test runner:** `cd Memba/frontend && node ./node_modules/.bin/vitest run <file>` (one file at a time; never `npx`).
- **Commits:** concise message, no trailers, no Claude attribution. Branch `feat/block-party-game`.

---

### Task 1: mulberry32 PRNG

**Files:**
- Create: `frontend/src/game/engine/prng.ts`
- Test: `frontend/src/game/engine/prng.test.ts`
- Create (generated, committed): `frontend/src/game/engine/vectors/prng_vectors.json`

**Interfaces:**
- Produces: `type RngState = number` (holds a `uint32`); `function rngNext(state: RngState): { value: number; state: RngState }` — `value` is a `uint32` in `[0, 2^32)`, `state` is the next state.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/game/engine/prng.test.ts
import { describe, it, expect } from "vitest";
import { rngNext } from "./prng";

describe("mulberry32 rngNext", () => {
  it("is deterministic for a given seed", () => {
    const a1 = rngNext(12345);
    const a2 = rngNext(12345);
    expect(a1.value).toBe(a2.value);
    expect(a1.state).toBe(a2.state);
  });

  it("returns uint32 values in [0, 2^32)", () => {
    let state = 987654321 >>> 0;
    for (let i = 0; i < 1000; i++) {
      const r = rngNext(state);
      expect(Number.isInteger(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(2 ** 32);
      expect(r.state).toBeGreaterThanOrEqual(0);
      expect(r.state).toBeLessThan(2 ** 32);
      state = r.state;
    }
  });

  it("advances state (not a constant stream)", () => {
    const a = rngNext(1);
    const b = rngNext(a.state);
    expect(a.value).not.toBe(b.value);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/prng.test.ts`
Expected: FAIL — cannot find module `./prng`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/game/engine/prng.ts
export type RngState = number;

// mulberry32 — returns a uint32 value and the next state.
// Every 32-bit multiply uses Math.imul; every op normalized to uint32.
// Go/Gno mirror: a := state + 0x6D2B79F5; t := (a ^ (a>>15)) * (1|a); ...
export function rngNext(state: RngState): { value: number; state: RngState } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = (t ^ (t >>> 14)) >>> 0;
  return { value, state: a >>> 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/prng.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Generate and commit the golden PRNG vectors**

Generate the first 20 outputs for seed `12345` and write them to the vectors file (this becomes the cross-language known-answer test that Sub-plans 2 & 4 assert against):

```bash
cd Memba/frontend && node -e '
const { rngNext } = require("./src/game/engine/prng.ts");
' 2>/dev/null || true
```

Because the engine is TS, generate via a tiny throwaway vitest or ts runner. Simplest reliable path — add a one-shot test that writes the file, run it, then delete it:

```ts
// frontend/src/game/engine/_gen_prng_vectors.test.ts  (TEMPORARY)
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { rngNext } from "./prng";
it("gen", () => {
  const seed = 12345;
  const outputs: number[] = [];
  let s = seed >>> 0;
  for (let i = 0; i < 20; i++) { const r = rngNext(s); outputs.push(r.value); s = r.state; }
  writeFileSync(
    "src/game/engine/vectors/prng_vectors.json",
    JSON.stringify({ seed, outputs }, null, 2) + "\n"
  );
});
```

Run: `cd Memba/frontend && mkdir -p src/game/engine/vectors && node ./node_modules/.bin/vitest run src/game/engine/_gen_prng_vectors.test.ts`
Then delete the generator: `rm src/game/engine/_gen_prng_vectors.test.ts`

- [ ] **Step 6: Add a test that pins the committed vectors**

```ts
// append to frontend/src/game/engine/prng.test.ts
import prngVectors from "./vectors/prng_vectors.json";

it("matches the committed golden vectors", () => {
  let s = prngVectors.seed >>> 0;
  for (const expected of prngVectors.outputs) {
    const r = rngNext(s);
    expect(r.value).toBe(expected);
    s = r.state;
  }
});
```

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/prng.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/game/engine/prng.ts frontend/src/game/engine/prng.test.ts frontend/src/game/engine/vectors/prng_vectors.json
git commit -m "Block Party engine: mulberry32 PRNG + golden vectors"
```

---

### Task 2: Types + board helpers (empty cells, spawn)

**Files:**
- Create: `frontend/src/game/engine/types.ts`
- Create: `frontend/src/game/engine/board.ts`
- Test: `frontend/src/game/engine/board.test.ts`

**Interfaces:**
- Consumes: `rngNext`, `RngState` from `./prng`.
- Produces:
  - `type Move = "U" | "R" | "D" | "L"`
  - `type Modifier = "standard" | "doubles" | "rush"`
  - `type Board = number[]` (length 16)
  - `interface GameState { board: Board; score: number; rng: RngState; rngCallCount: number; modifier: Modifier; moves: number; over: boolean }`
  - `function emptyCells(board: Board): number[]`
  - `function spawnTile(board: Board, rng: RngState, rngCallCount: number, modifier: Modifier): { board: Board; rng: RngState; rngCallCount: number }`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/game/engine/board.test.ts
import { describe, it, expect } from "vitest";
import { emptyCells, spawnTile } from "./board";

describe("emptyCells", () => {
  it("lists empty indices in ascending order", () => {
    const board = [0, 2, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(emptyCells(board)).toEqual([0, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
  it("returns empty array for a full board", () => {
    expect(emptyCells(new Array(16).fill(2))).toEqual([]);
  });
});

describe("spawnTile", () => {
  it("places exactly one 2-or-4 tile in a previously empty cell", () => {
    const before = new Array(16).fill(0);
    const r = spawnTile(before, 12345, 0, "standard");
    const placed = r.board.filter((v) => v !== 0);
    expect(placed.length).toBe(1);
    expect([2, 4]).toContain(placed[0]);
    expect(r.rngCallCount).toBe(2); // one draw for position, one for value
  });

  it("is deterministic for a given (board, rng, modifier)", () => {
    const before = new Array(16).fill(0);
    const a = spawnTile(before, 999, 0, "standard");
    const b = spawnTile(before, 999, 0, "standard");
    expect(a.board).toEqual(b.board);
    expect(a.rng).toBe(b.rng);
  });

  it("doubles modifier spawns 4-or-8 instead of 2-or-4", () => {
    const before = new Array(16).fill(0);
    const r = spawnTile(before, 12345, 0, "doubles");
    const placed = r.board.filter((v) => v !== 0);
    expect([4, 8]).toContain(placed[0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/board.test.ts`
Expected: FAIL — cannot find module `./board`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/game/engine/types.ts
import type { RngState } from "./prng";

export type Move = "U" | "R" | "D" | "L";
export type Modifier = "standard" | "doubles" | "rush";
export type Board = number[]; // length 16, row-major

export interface GameState {
  board: Board;
  score: number;
  rng: RngState;
  rngCallCount: number;
  modifier: Modifier;
  moves: number;
  over: boolean;
}
```

```ts
// frontend/src/game/engine/board.ts
import { rngNext, type RngState } from "./prng";
import type { Board, Modifier } from "./types";

export function emptyCells(board: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < 16; i++) if (board[i] === 0) out.push(i);
  return out;
}

export function spawnTile(
  board: Board,
  rng: RngState,
  rngCallCount: number,
  modifier: Modifier
): { board: Board; rng: RngState; rngCallCount: number } {
  const empties = emptyCells(board);
  // position draw
  let r = rngNext(rng);
  const pos = empties[r.value % empties.length];
  rng = r.state;
  // value draw
  r = rngNext(rng);
  let value = r.value % 10 === 0 ? 4 : 2;
  rng = r.state;
  if (modifier === "doubles") value *= 2;

  const next = board.slice();
  next[pos] = value;
  return { board: next, rng, rngCallCount: rngCallCount + 2 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/board.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/engine/types.ts frontend/src/game/engine/board.ts frontend/src/game/engine/board.test.ts
git commit -m "Block Party engine: types + empty-cell + spawn helpers"
```

---

### Task 3: Slide + merge a single line

**Files:**
- Create: `frontend/src/game/engine/slide.ts`
- Test: `frontend/src/game/engine/slide.test.ts`

**Interfaces:**
- Produces: `function slideLineLeft(line: number[]): { line: number[]; gained: number }` — collapses a length-4 line toward index 0, merging each pair at most once, returning the new line (length 4) and the score gained.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/game/engine/slide.test.ts
import { describe, it, expect } from "vitest";
import { slideLineLeft } from "./slide";

describe("slideLineLeft", () => {
  it("compacts toward index 0", () => {
    expect(slideLineLeft([0, 2, 0, 4])).toEqual({ line: [2, 4, 0, 0], gained: 0 });
  });
  it("merges a single pair once", () => {
    expect(slideLineLeft([2, 2, 0, 0])).toEqual({ line: [4, 0, 0, 0], gained: 4 });
  });
  it("merges two pairs, farthest-first, no double-merge", () => {
    expect(slideLineLeft([2, 2, 2, 2])).toEqual({ line: [4, 4, 0, 0], gained: 8 });
  });
  it("does not merge into a triple as an 8", () => {
    expect(slideLineLeft([4, 4, 2, 0])).toEqual({ line: [8, 2, 0, 0], gained: 8 });
  });
  it("leaves an unmergeable line only compacted", () => {
    expect(slideLineLeft([2, 4, 8, 16])).toEqual({ line: [2, 4, 8, 16], gained: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/slide.test.ts`
Expected: FAIL — cannot find module `./slide`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/game/engine/slide.ts
export function slideLineLeft(line: number[]): { line: number[]; gained: number } {
  const nonZero = line.filter((v) => v !== 0);
  const result: number[] = [];
  let gained = 0;
  let i = 0;
  while (i < nonZero.length) {
    if (i + 1 < nonZero.length && nonZero[i] === nonZero[i + 1]) {
      const merged = nonZero[i] * 2;
      result.push(merged);
      gained += merged;
      i += 2;
    } else {
      result.push(nonZero[i]);
      i += 1;
    }
  }
  while (result.length < 4) result.push(0);
  return { line: result, gained };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/slide.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/engine/slide.ts frontend/src/game/engine/slide.test.ts
git commit -m "Block Party engine: single-line slide+merge"
```

---

### Task 4: Apply a move (all four directions, no-op detection, spawn)

**Files:**
- Create: `frontend/src/game/engine/move.ts`
- Test: `frontend/src/game/engine/move.test.ts`

**Interfaces:**
- Consumes: `slideLineLeft` from `./slide`; `spawnTile` from `./board`; `GameState`, `Move` from `./types`.
- Produces:
  - `const LINE_INDICES: Record<Move, number[][]>` — the four lines (each 4 indices) in pull order per direction.
  - `function applyMove(state: GameState, move: Move): GameState` — returns a new state; on a no-op returns the input state unchanged (no spawn, no RNG).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/game/engine/move.test.ts
import { describe, it, expect } from "vitest";
import { applyMove, LINE_INDICES } from "./move";
import type { GameState } from "./types";

function stateWith(board: number[]): GameState {
  return { board, score: 0, rng: 555, rngCallCount: 0, modifier: "standard", moves: 0, over: false };
}

describe("LINE_INDICES", () => {
  it("has 4 lines of 4 indices for each direction", () => {
    for (const dir of ["U", "R", "D", "L"] as const) {
      expect(LINE_INDICES[dir].length).toBe(4);
      for (const line of LINE_INDICES[dir]) expect(line.length).toBe(4);
    }
  });
});

describe("applyMove", () => {
  it("moves left and merges a row", () => {
    // row 0 = [2,2,0,0]; expect it to become [4,0,0,0] before spawn
    const s = stateWith([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const next = applyMove(s, "L");
    expect(next.board[0]).toBe(4);
    expect(next.score).toBe(4);
    expect(next.moves).toBe(1);
    // a spawn happened => exactly one new tile appeared somewhere in indices 1..15
    expect(next.rngCallCount).toBe(2);
    expect(next.board.filter((v) => v !== 0).length).toBe(2);
  });

  it("moves right (tiles pull toward the high index of each row)", () => {
    const s = stateWith([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const next = applyMove(s, "R");
    expect(next.board[3]).toBe(4);
  });

  it("moves up (tiles pull toward row 0 of each column)", () => {
    // column 0 = indices 0,4,8,12 = [0,2,2,0]; up => [4,...]
    const s = stateWith([0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]);
    const next = applyMove(s, "U");
    expect(next.board[0]).toBe(4);
  });

  it("returns the SAME state (no spawn, no rng) on a no-op move", () => {
    // full-left-packed row cannot move further left; whole board is a no-op for L
    const s = stateWith([2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128]);
    const next = applyMove(s, "L");
    expect(next).toBe(s); // identity — unchanged
    expect(next.rngCallCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/move.test.ts`
Expected: FAIL — cannot find module `./move`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/game/engine/move.ts
import { slideLineLeft } from "./slide";
import { spawnTile } from "./board";
import type { GameState, Move } from "./types";

// Each entry lists the 4 lines; each line lists its 4 board indices in the
// order tiles are pulled toward the move direction (leading index first).
export const LINE_INDICES: Record<Move, number[][]> = {
  L: [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]],
  R: [[3, 2, 1, 0], [7, 6, 5, 4], [11, 10, 9, 8], [15, 14, 13, 12]],
  U: [[0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15]],
  D: [[12, 8, 4, 0], [13, 9, 5, 1], [14, 10, 6, 2], [15, 11, 7, 3]],
};

export function applyMove(state: GameState, move: Move): GameState {
  const before = state.board;
  const after = before.slice();
  let gained = 0;

  for (const line of LINE_INDICES[move]) {
    const vals = line.map((idx) => before[idx]);
    const { line: slid, gained: g } = slideLineLeft(vals);
    gained += g;
    line.forEach((idx, k) => {
      after[idx] = slid[k];
    });
  }

  const changed = after.some((v, i) => v !== before[i]);
  if (!changed) return state; // no-op: unchanged, no spawn, no RNG

  const spawned = spawnTile(after, state.rng, state.rngCallCount, state.modifier);
  return {
    ...state,
    board: spawned.board,
    score: state.score + gained,
    rng: spawned.rng,
    rngCallCount: spawned.rngCallCount,
    moves: state.moves + 1,
    over: false, // set by initGame/replay via isGameOver in Task 6 wiring
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/move.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/engine/move.ts frontend/src/game/engine/move.test.ts
git commit -m "Block Party engine: applyMove for all directions + no-op guard"
```

---

### Task 5: Game-over detection

**Files:**
- Create: `frontend/src/game/engine/gameover.ts`
- Test: `frontend/src/game/engine/gameover.test.ts`

**Interfaces:**
- Produces: `function isGameOver(board: Board): boolean` — true iff no empty cell and no orthogonally-adjacent equal pair.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/game/engine/gameover.test.ts
import { describe, it, expect } from "vitest";
import { isGameOver } from "./gameover";

describe("isGameOver", () => {
  it("is false when an empty cell exists", () => {
    expect(isGameOver([2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 0])).toBe(false);
  });
  it("is false when a horizontal merge is available", () => {
    expect(isGameOver([2, 2, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128])).toBe(false);
  });
  it("is false when a vertical merge is available", () => {
    expect(isGameOver([2, 4, 8, 16, 2, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128])).toBe(false);
  });
  it("is true for a full board with no adjacent equals", () => {
    expect(isGameOver([2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/gameover.test.ts`
Expected: FAIL — cannot find module `./gameover`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/game/engine/gameover.ts
import type { Board } from "./types";

export function isGameOver(board: Board): boolean {
  for (let i = 0; i < 16; i++) if (board[i] === 0) return false;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = board[r * 4 + c];
      if (c < 3 && board[r * 4 + c + 1] === v) return false;
      if (r < 3 && board[(r + 1) * 4 + c] === v) return false;
    }
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/gameover.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/engine/gameover.ts frontend/src/game/engine/gameover.test.ts
git commit -m "Block Party engine: game-over detection"
```

---

### Task 6: initGame + replay (with `over` wiring and rngCallCount)

**Files:**
- Create: `frontend/src/game/engine/game.ts`
- Create: `frontend/src/game/engine/index.ts`
- Test: `frontend/src/game/engine/game.test.ts`

**Interfaces:**
- Consumes: `spawnTile` (`./board`), `applyMove` (`./move`), `isGameOver` (`./gameover`), `GameState`/`Move`/`Modifier` (`./types`).
- Produces:
  - `function initGame(seed: number, modifier: Modifier): GameState` — two seeded spawns, `moves = 0`, `score = 0`.
  - `function step(state: GameState, move: Move): GameState` — `applyMove` then recompute `over`.
  - `function replay(seed: number, modifier: Modifier, moves: Move[]): { board: Board; score: number; rngCallCount: number; over: boolean }`.
  - `index.ts` re-exports the public surface: `rngNext`, `initGame`, `step`, `replay`, `isGameOver`, and all types.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/game/engine/game.test.ts
import { describe, it, expect } from "vitest";
import { initGame, step, replay } from "./game";
import type { Move } from "./types";

describe("initGame", () => {
  it("starts with exactly two tiles and score 0", () => {
    const s = initGame(12345, "standard");
    expect(s.board.filter((v) => v !== 0).length).toBe(2);
    expect(s.score).toBe(0);
    expect(s.moves).toBe(0);
    expect(s.rngCallCount).toBe(4); // two spawns * (pos+value)
  });

  it("is deterministic for a given seed+modifier", () => {
    expect(initGame(777, "standard")).toEqual(initGame(777, "standard"));
  });
});

describe("replay", () => {
  it("equals folding step() over the moves", () => {
    const moves: Move[] = ["L", "U", "R", "D", "L", "L", "U"];
    let s = initGame(4242, "standard");
    for (const m of moves) s = step(s, m);
    const r = replay(4242, "standard", moves);
    expect(r.board).toEqual(s.board);
    expect(r.score).toBe(s.score);
    expect(r.rngCallCount).toBe(s.rngCallCount);
    expect(r.over).toBe(s.over);
  });

  it("is fully deterministic (same inputs => same result)", () => {
    const moves: Move[] = ["U", "D", "L", "R", "U", "U", "L", "D"];
    expect(replay(9, "standard", moves)).toEqual(replay(9, "standard", moves));
  });

  it("no-op moves change nothing and consume no RNG", () => {
    const moves: Move[] = ["L", "L", "L", "L", "L", "L"]; // repeated L eventually no-ops
    const r1 = replay(123, "standard", moves);
    const r2 = replay(123, "standard", [...moves, "L", "L"]);
    // extra trailing no-op Ls must not change the result
    expect(r2).toEqual(r1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/game.test.ts`
Expected: FAIL — cannot find module `./game`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/game/engine/game.ts
import { spawnTile } from "./board";
import { applyMove } from "./move";
import { isGameOver } from "./gameover";
import type { Board, GameState, Modifier, Move } from "./types";

export function initGame(seed: number, modifier: Modifier): GameState {
  const empty: Board = new Array(16).fill(0);
  const first = spawnTile(empty, seed >>> 0, 0, modifier);
  const second = spawnTile(first.board, first.rng, first.rngCallCount, modifier);
  return {
    board: second.board,
    score: 0,
    rng: second.rng,
    rngCallCount: second.rngCallCount,
    modifier,
    moves: 0,
    over: isGameOver(second.board),
  };
}

export function step(state: GameState, move: Move): GameState {
  const next = applyMove(state, move);
  if (next === state) return state; // no-op passthrough
  return { ...next, over: isGameOver(next.board) };
}

export function replay(
  seed: number,
  modifier: Modifier,
  moves: Move[]
): { board: Board; score: number; rngCallCount: number; over: boolean } {
  let s = initGame(seed, modifier);
  for (const m of moves) s = step(s, m);
  return { board: s.board, score: s.score, rngCallCount: s.rngCallCount, over: s.over };
}
```

```ts
// frontend/src/game/engine/index.ts
export { rngNext, type RngState } from "./prng";
export { emptyCells, spawnTile } from "./board";
export { slideLineLeft } from "./slide";
export { applyMove, LINE_INDICES } from "./move";
export { isGameOver } from "./gameover";
export { initGame, step, replay } from "./game";
export type { Board, Move, Modifier, GameState } from "./types";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/game.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/engine/game.ts frontend/src/game/engine/index.ts frontend/src/game/engine/game.test.ts
git commit -m "Block Party engine: initGame, step, replay"
```

---

### Task 7: Property tests (invariants)

**Files:**
- Test: `frontend/src/game/engine/properties.test.ts`

**Interfaces:**
- Consumes: `initGame`, `step`, `isGameOver` from `./index`; `LINE_INDICES` for random legal-move generation.

- [ ] **Step 1: Write the failing test (it will fail only if an invariant is broken)**

```ts
// frontend/src/game/engine/properties.test.ts
import { describe, it, expect } from "vitest";
import { initGame, step, isGameOver, rngNext } from "./index";
import type { GameState, Move } from "./types";

const MOVES: Move[] = ["U", "R", "D", "L"];

function tileMass(s: GameState): number {
  // number of tiles on the board
  return s.board.filter((v) => v !== 0).length;
}

describe("engine invariants (pseudo-random games)", () => {
  it("score never decreases; tile count grows only by spawns; over is consistent", () => {
    let rngState = 20260706;
    for (let game = 0; game < 200; game++) {
      let s = initGame(rngState, "standard");
      let prevScore = s.score;
      for (let m = 0; m < 60 && !s.over; m++) {
        const draw = rngNext(rngState);
        rngState = draw.state;
        const move = MOVES[draw.value % 4];
        const before = s;
        s = step(s, move);
        // score monotonic
        expect(s.score).toBeGreaterThanOrEqual(prevScore);
        prevScore = s.score;
        // A real move nets AT MOST one new tile (the single spawn). Merges
        // remove tiles, so a multi-merge move can net 0 or negative; a no-op
        // nets 0. The invariant is therefore delta <= 1 (never > +1).
        const delta = tileMass(s) - tileMass(before);
        expect(delta).toBeLessThanOrEqual(1);
      }
      // over flag matches the detector
      expect(s.over).toBe(isGameOver(s.board));
      rngState = rngNext(rngState).state;
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/properties.test.ts`
Expected: PASS (invariants hold). If it fails, the failure pinpoints a broken invariant in an earlier task — fix there, do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/game/engine/properties.test.ts
git commit -m "Block Party engine: property/invariant tests"
```

---

### Task 8: Golden game vectors (the cross-language contract)

**Files:**
- Create (generated, committed): `frontend/src/game/engine/vectors/game_vectors.json`
- Test: `frontend/src/game/engine/vectors.test.ts`

**Interfaces:**
- Produces: `game_vectors.json` — an array of `{ seed, modifier, moves, expectedBoard[16], expectedScore, expectedRngCallCount, expectedOver }`. This file is the canonical contract Sub-plan 2 (Go) and Sub-plan 4 (Gno) assert against byte-for-byte.

- [ ] **Step 1: Generate the vectors from the reference engine**

Add a temporary generator that runs a fixed set of scripted games and writes the file:

```ts
// frontend/src/game/engine/_gen_game_vectors.test.ts  (TEMPORARY)
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { replay } from "./game";
import type { Modifier, Move } from "./types";

it("gen", () => {
  const cases: { seed: number; modifier: Modifier; moves: Move[] }[] = [
    { seed: 1, modifier: "standard", moves: ["L", "U", "R", "D"] },
    { seed: 12345, modifier: "standard", moves: ["U", "U", "L", "L", "D", "R", "U", "L"] },
    { seed: 777, modifier: "doubles", moves: ["L", "L", "U", "R", "D", "D", "L"] },
    { seed: 424242, modifier: "rush", moves: ["R", "D", "R", "D", "L", "U", "L", "U", "R"] },
    { seed: 20260706, modifier: "standard", moves: Array(40).fill(0).map((_, i) => (["U", "R", "D", "L"] as Move[])[i % 4]) },
  ];
  const vectors = cases.map((c) => {
    const r = replay(c.seed, c.modifier, c.moves);
    return {
      seed: c.seed,
      modifier: c.modifier,
      moves: c.moves,
      expectedBoard: r.board,
      expectedScore: r.score,
      expectedRngCallCount: r.rngCallCount,
      expectedOver: r.over,
    };
  });
  writeFileSync("src/game/engine/vectors/game_vectors.json", JSON.stringify(vectors, null, 2) + "\n");
});
```

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/_gen_game_vectors.test.ts`
Then delete the generator: `rm src/game/engine/_gen_game_vectors.test.ts`

- [ ] **Step 2: Write the test that pins the committed vectors**

```ts
// frontend/src/game/engine/vectors.test.ts
import { describe, it, expect } from "vitest";
import { replay } from "./game";
import gameVectors from "./vectors/game_vectors.json";
import type { Modifier, Move } from "./types";

describe("golden game vectors", () => {
  it("replay reproduces every committed vector exactly", () => {
    for (const v of gameVectors as Array<{
      seed: number; modifier: Modifier; moves: Move[];
      expectedBoard: number[]; expectedScore: number; expectedRngCallCount: number; expectedOver: boolean;
    }>) {
      const r = replay(v.seed, v.modifier, v.moves);
      expect(r.board).toEqual(v.expectedBoard);
      expect(r.score).toBe(v.expectedScore);
      expect(r.rngCallCount).toBe(v.expectedRngCallCount);
      expect(r.over).toBe(v.expectedOver);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine/vectors.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the whole engine suite once**

Run: `cd Memba/frontend && node ./node_modules/.bin/vitest run src/game/engine`
Expected: PASS (all engine test files).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/engine/vectors/game_vectors.json frontend/src/game/engine/vectors.test.ts
git commit -m "Block Party engine: golden game vectors (cross-language contract)"
```

---

## Self-Review

**Spec coverage (against §5 of the design spec):**
- mulberry32 / `Math.imul` / uint32 → Task 1. ✅
- All-integer, `value % n` bounded draws → Tasks 1–2. ✅
- Row-major board, ascending empty-cell order → Task 2. ✅
- RNG-call order (two initial spawns pos-then-value; per-move pos-then-value; no RNG on no-op) → Tasks 2, 4, 6; asserted by `rngCallCount` in Tasks 5–8. ✅
- Merge sweep farthest-first, one merge per move, `[2,2,2,2]→[4,4,0,0]` → Task 3. ✅
- Modifier applies to every spawn (incl. initial) → Tasks 2 (`doubles`), 6 (initGame uses same `spawnTile`). ✅
- Score type / no overflow → covered by JS `number`; documented in Global Constraints. ✅
- Golden vectors incl. `rngCallCount` → Tasks 1 (prng), 8 (game). ✅ (Differential fuzzing across TS↔Go is intentionally deferred to **Sub-plan 2**, where the Go engine exists to fuzz against — noted here so it is not lost.)

**Placeholder scan:** none — every code step contains complete code.

**Type consistency:** `RngState`, `Board`, `Move`, `Modifier`, `GameState`, `rngNext`, `spawnTile`, `slideLineLeft`, `applyMove`, `LINE_INDICES`, `isGameOver`, `initGame`, `step`, `replay` are defined once and referenced consistently across tasks. `rush` is engine-identical to `standard` at the tile level (it only changes the move budget, which is a caller/validation concern in Sub-plans 2–3) — this is intentional and stated.

**Deferred to later sub-plans (not gaps):** SHA256→uint32 seed derivation (Sub-plan 2), move-budget/peek-ahead/daily-modifier-selection (Sub-plans 2–3), moveLog 2-bit packing (Sub-plans 2–3), TS↔Go differential fuzzing harness (Sub-plan 2), `Frozen`/`LockedAxis` modifiers (Phase 1.1 — the `Modifier` union is extended then, with matching vectors).
