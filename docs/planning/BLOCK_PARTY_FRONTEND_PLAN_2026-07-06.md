# Block Party — Sub-plan 3: Frontend UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the playable Block Party UI in the Memba React app: a chain-seeded daily 2048 board (ranked, move-budgeted) + an endless Practice mode, with touch+keyboard controls, wallet-optional score submission, daily leaderboard + streak, and a Wordle-style share — all native to the Kodera design system and shipped dark behind `VITE_ENABLE_GAME`. Opens with a small backend prereq that makes the ranked move budget server-authoritative.

**Architecture:** The pure TS engine (Sub-plan 1, `src/game/engine/`) owns the 2048 rules and determinism. The frontend orchestrates the *game loop* on top of it: fetch the daily challenge (seed, modifier, par, move budget) from the backend, drive `initGame`/`step`, accumulate the move log, enforce the ranked budget, and submit the log (never a score) for server replay. No wallet is needed to play/share/streak-locally; connecting a wallet unlocks the verified public leaderboard.

**Tech Stack:** React 19 + TypeScript, ConnectRPC (`@connectrpc/connect`, `@bufbuild/protobuf` `create()`), `@tanstack/react-query`, vitest + `@testing-library/react`, Playwright. Runs in `Memba/frontend`. Go backend for the prereq task.

## Global Constraints

- **Client submits `moveLog`, never a score.** The authoritative score is the server replay (Sub-plan 2). The UI's displayed score is the local engine's `state.score` for feedback only.
- **Determinism reuse:** the ranked board comes from `engine.initGame(seed, modifier)` where `seed`/`modifier` are exactly what `GetDailyChallenge` returned. The move log is the concatenation of applied moves as `U|R|D|L` chars, in order, EXCLUDING no-op moves (a move that doesn't change the board is never recorded — it matches the engine's no-spawn-on-no-op and the backend's no-op rejection).
- **Ranked move budget is server-authoritative** (Task 1): `GetDailyChallenge` returns `moveBudget`; the UI stops the ranked run at `moveBudget` moves (or game over); `SubmitScore` rejects logs longer than the budget.
- **Generated types (verified):** methods `getDailyChallenge`/`submitScore`/`getDailyLeaderboard`/`getStreak`. `GetDailyChallengeResponse { date:string, seed:number, blockHeight:bigint, blockHash:string, modifier:string, par:bigint, ready:boolean }` (+`moveBudget:number` after Task 1). `SubmitScoreRequest { authToken?:Token, date:string, moveLog:string }`. `SubmitScoreResponse { score:bigint, percentile:number, par:bigint, streak?:BlockPartyStreak }`. `BlockPartyStreak { current, longest, freezesRemaining }` (numbers). `LeaderboardScore { address, score:bigint, rank }`. `GetDailyLeaderboardRequest { date, limit }`. `GetStreakRequest { address }`, `GetStreakResponse { streak? }`. **`bigint` fields → `Number(x)` for display.**
- **Wallet-optional:** guests get full play + local best + local streak (localStorage) + share. `useAdena().installed === false` (most mobile) → never show a broken Connect button; show a "post later on desktop" note. Connect CTA appears only AFTER a finished run.
- **Touch is make-or-break:** the board element uses `touch-action: none` + `overscroll-behavior: none`, axis-locked Pointer-Events swipe, keeps a left margin (iOS edge-back guard), `user-select: none`. Haptic on merge where supported.
- **A11y:** colorblind/luminance-safe tiers (number always visible + brightness ramp, not hue alone), AA contrast under glow, `prefers-reduced-motion` cuts animations, ARIA grid + `aria-live="polite"` move announcements, focus ring, tap targets ≥ `--mb-touch-min` (44px).
- **Design tokens (Kodera):** bg `--color-k-bg`, surface `--color-k-panel`/`--color-k-elevated`, accent `--color-k-accent` (teal), gold `--color-k-govdao`, text `--color-k-text`, dim `--color-k-dim`, border `--color-k-edge`; spacing `--space-*` (4px grid), radius `--radius-*`, mono `--font-mono`; mobile `--mb-touch-min`, `--mb-safe-bottom`, `--mb-safe-top`. Styling = per-component CSS file with `k-`-prefixed classes using these vars (match `pages/leaderboard.css`).
- **Test runner:** `cd frontend && node ./node_modules/.bin/vitest run <file>` (one file; never npx). Build: `cd frontend && npm run build` (NOT `tsc --noEmit` — it's a no-op here). E2E: `cd frontend && npx playwright test e2e/blockparty.spec.ts`. Backend (Task 1): `cd backend && go test ./... ` + `golangci-lint run`.
- **Commits:** concise, NO trailers, NO Co-Authored-By, NO Claude/Anthropic attribution. Branch `feat/block-party-game`.
- **Do not edit generated code** under `src/gen/` by hand — regenerate via `make proto-gen` (Task 1).

## File structure

```
backend/internal/blockparty/budget.go            // Task 1: MoveBudget(modifier)
api/memba/v1/memba.proto                          // Task 1: + move_budget field
frontend/src/
  lib/config.ts        (+isGameEnabled)           // Task 2
  lib/gameApi.ts                                  // Task 2: thin RPC wrappers
  components/ui/GameGate.tsx                       // Task 2
  App.tsx              (+lazy /game route)         // Task 2
  game/hooks/
    useDailyChallenge.ts                           // Task 3
    useGame.ts                                      // Task 4 (loop over engine)
    useSwipe.ts  useKeyboard.ts                     // Task 5
  game/components/
    Board.tsx  Tile.tsx  ScoreBar.tsx  PeekQueue.tsx  ModifierBadge.tsx  board.css   // Task 6
    GameOverSheet.tsx  gameover.css                 // Task 7
    DailyLeaderboardPanel.tsx  StreakBadge.tsx  panels.css   // Task 8
    ShareCard.tsx                                   // Task 9
  game/lib/
    tiers.ts           // milestone labels + emoji tiers + rank-from-percentile
    localStore.ts      // guest best/streak in localStorage
    shareText.ts       // build the share string
  pages/BlockPartyGame.tsx  blockparty.css          // Task 10 (assembly + practice)
e2e/blockparty.spec.ts                              // Task 11
```

---

### Task 1 (backend prereq): server-authoritative move budget

**Files:**
- Create: `backend/internal/blockparty/budget.go`
- Test: `backend/internal/blockparty/budget_test.go`
- Modify: `api/memba/v1/memba.proto` (add `int32 move_budget` to `GetDailyChallengeResponse`), regenerate.
- Modify: `backend/internal/service/blockparty_rpc.go` (populate `MoveBudget` in `GetDailyChallenge`; enforce in `SubmitScore`).
- Modify: `backend/internal/service/blockparty_rpc_test.go` (add over-budget rejection test).

**Interfaces:**
- Produces: `func MoveBudget(modifier string) int` — `rush → 24`, everything else → `30`.

- [ ] **Step 1: Write the failing budget test**

```go
// backend/internal/blockparty/budget_test.go
package blockparty

import "testing"

func TestMoveBudget(t *testing.T) {
	if MoveBudget("rush") != 24 {
		t.Fatalf("rush budget = %d, want 24", MoveBudget("rush"))
	}
	for _, m := range []string{"standard", "doubles", "unknown"} {
		if MoveBudget(m) != 30 {
			t.Fatalf("%s budget = %d, want 30", m, MoveBudget(m))
		}
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/blockparty/ -run TestMoveBudget -v`
Expected: FAIL — `MoveBudget` undefined.

- [ ] **Step 3: Implement**

```go
// backend/internal/blockparty/budget.go
package blockparty

// MoveBudget is the ranked-daily move cap for a modifier. Server-authoritative:
// SubmitScore rejects logs longer than this, and GetDailyChallenge returns it so
// the client stops the ranked run at the same point.
func MoveBudget(modifier string) int {
	if modifier == "rush" {
		return 24
	}
	return 30
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && go test ./internal/blockparty/ -run TestMoveBudget -v`
Expected: PASS.

- [ ] **Step 5: Add `move_budget` to the proto response and regenerate**

In `api/memba/v1/memba.proto`, add to `GetDailyChallengeResponse` (next free field number — it currently ends at `ready = 7`):
```protobuf
  int32 move_budget = 8;
```
Run: `make proto-gen`
Then verify: `cd backend && go build ./...` (new field compiles).

- [ ] **Step 6: Populate + enforce in the handler**

In `backend/internal/service/blockparty_rpc.go`:
- In `GetDailyChallenge`'s ready response, add `MoveBudget: int32(blockparty.MoveBudget(c.Modifier))`.
- In `SubmitScore`, AFTER `parseMoves` and AFTER `ensureChallenge` (so the modifier is known), before/at the replay, add:
```go
	if len(moves) > blockparty.MoveBudget(c.Modifier) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("move log exceeds the daily move budget"))
	}
```

- [ ] **Step 7: Add the over-budget rejection test**

```go
// append to backend/internal/service/blockparty_rpc_test.go
func TestSubmitScore_RejectsOverBudget(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(true, "")
	c := blockparty.Challenge{Date: todayUTC(), Height: 5, Hash: "hh", Seed: 12345, Modifier: "standard", Par: 1500}
	if err := blockparty.PutChallenge(h.db, c); err != nil { t.Fatal(err) }
	log := legalLog(t, 12345, "standard", 31) // 31 > standard budget 30
	token := h.makeToken(t, "g1alice")
	_, err := h.svc.SubmitScore(context.Background(), connect.NewRequest(&membav1.SubmitScoreRequest{
		AuthToken: token, Date: todayUTC(), MoveLog: log,
	}))
	if err == nil || connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("over-budget submit: got %v, want InvalidArgument", err)
	}
}
```

- [ ] **Step 8: Run tests, build, lint, regenerate frontend gen, commit**

Run: `cd backend && go test ./internal/blockparty/... ./internal/service/... && go build ./...`
Run: `cd backend && golangci-lint run ./internal/blockparty/... ./internal/service/...` → 0 issues.
Run: `make proto-gen` (regenerates BOTH backend/gen AND frontend/src/gen — commit both so proto stays in sync).
```bash
git add api/memba/v1/memba.proto backend/gen/ frontend/src/gen/ backend/internal/blockparty/budget.go backend/internal/blockparty/budget_test.go backend/internal/service/blockparty_rpc.go backend/internal/service/blockparty_rpc_test.go
git commit -m "Block Party: server-authoritative move budget (challenge field + SubmitScore enforcement)"
```

---

### Task 2: feature flag + gate + route + API wrappers

**Files:**
- Modify: `frontend/src/lib/config.ts` (add `isGameEnabled`), `frontend/.env.example` (add `VITE_ENABLE_GAME=false`)
- Create: `frontend/src/lib/gameApi.ts`
- Create: `frontend/src/components/ui/GameGate.tsx`
- Modify: `frontend/src/App.tsx` (lazy `/game` route wrapped in `GameGate`)
- Test: `frontend/src/lib/gameApi.test.ts`

**Interfaces:**
- Produces: `isGameEnabled(): boolean`; `gameApi` with `getDailyChallenge(date?)`, `submitScore(token, date, moveLog)`, `getDailyLeaderboard(date, limit)`, `getStreak(address)` returning typed responses.

- [ ] **Step 1: Write the failing gameApi test (shape only — no network)**

```ts
// frontend/src/lib/gameApi.test.ts
import { describe, it, expect } from "vitest";
import { gameApi } from "./gameApi";

describe("gameApi", () => {
  it("exposes the four game RPC wrappers", () => {
    expect(typeof gameApi.getDailyChallenge).toBe("function");
    expect(typeof gameApi.submitScore).toBe("function");
    expect(typeof gameApi.getDailyLeaderboard).toBe("function");
    expect(typeof gameApi.getStreak).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/lib/gameApi.test.ts`
Expected: FAIL — cannot find module `./gameApi`.

- [ ] **Step 3: Implement config flag + wrappers + gate + route**

```ts
// frontend/src/lib/config.ts  — add near the other isXEnabled() readers
export const isGameEnabled = (): boolean => import.meta.env.VITE_ENABLE_GAME === "true";
```
Add to `frontend/.env.example`: `VITE_ENABLE_GAME=false`

```ts
// frontend/src/lib/gameApi.ts
import { create } from "@bufbuild/protobuf";
import { api } from "./api";
import {
  GetDailyChallengeRequestSchema,
  SubmitScoreRequestSchema,
  GetDailyLeaderboardRequestSchema,
  GetStreakRequestSchema,
  type Token,
} from "../gen/memba/v1/memba_pb";

export const gameApi = {
  getDailyChallenge: (date = "") =>
    api.getDailyChallenge(create(GetDailyChallengeRequestSchema, { date })),
  submitScore: (authToken: Token, date: string, moveLog: string) =>
    api.submitScore(create(SubmitScoreRequestSchema, { authToken, date, moveLog })),
  getDailyLeaderboard: (date: string, limit = 50) =>
    api.getDailyLeaderboard(create(GetDailyLeaderboardRequestSchema, { date, limit })),
  getStreak: (address: string) =>
    api.getStreak(create(GetStreakRequestSchema, { address })),
};
```

```tsx
// frontend/src/components/ui/GameGate.tsx
import type { ReactNode } from "react";
import { isGameEnabled } from "../../lib/config";
import { ComingSoonGate } from "./ComingSoonGate";

export function GameGate({ children }: { children: ReactNode }) {
  if (!isGameEnabled()) {
    return (
      <ComingSoonGate
        title="Block Party"
        icon="🎮"
        description="A daily block puzzle from an unpredictable Gno block — same board for everyone, every day."
        features={["One shared board a day", "Play instantly, no wallet", "Streaks & a daily leaderboard", "Provably un-rigged from a Gno block"]}
      />
    );
  }
  return <>{children}</>;
}
```

In `frontend/src/App.tsx`: add `const BlockPartyGame = lazy(() => import("./pages/BlockPartyGame"));` with the other lazy imports, and inside the network-scoped `<Routes>` (near `/quests`):
```tsx
<Route path="game" element={<Suspense fallback={<PageLoader />}><GameGate><BlockPartyGame /></GameGate></Suspense>} />
```
(Import `GameGate` at the top. Confirm the exact `PageLoader`/`Suspense` idiom already used by neighboring routes and match it.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/lib/gameApi.test.ts`
Expected: PASS. Also `cd frontend && npm run build` → succeeds (route + gate compile).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/config.ts frontend/.env.example frontend/src/lib/gameApi.ts frontend/src/components/ui/GameGate.tsx frontend/src/App.tsx frontend/src/lib/gameApi.test.ts
git commit -m "Block Party UI: feature flag, gate, /game route, RPC wrappers"
```

---

### Task 3: `useDailyChallenge` hook

**Files:**
- Create: `frontend/src/game/hooks/useDailyChallenge.ts`
- Test: `frontend/src/game/hooks/useDailyChallenge.test.tsx`

**Interfaces:**
- Produces: `type DailyChallenge = { date: string; seed: number; modifier: string; par: number; moveBudget: number; blockHeight: number; blockHash: string; ready: boolean }`; `useDailyChallenge(): { data?: DailyChallenge; isLoading: boolean; error: unknown }` — react-query wrapper over `gameApi.getDailyChallenge("")`, caching the result in `localStorage` (key `bp:challenge:<date>`) so a returning player / offline reuse is instant. Converts `bigint` par/height to `number`.

- [ ] **Step 1: Write the failing test (mock gameApi)**

```tsx
// frontend/src/game/hooks/useDailyChallenge.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/gameApi", () => ({
  gameApi: {
    getDailyChallenge: vi.fn().mockResolvedValue({
      date: "2026-07-06", seed: 12345, modifier: "standard",
      par: 1500n, moveBudget: 30, blockHeight: 42n, blockHash: "abc", ready: true,
    }),
  },
}));
import { useDailyChallenge } from "./useDailyChallenge";

const wrap = ({ children }: { children: ReactNode }) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={c}>{children}</QueryClientProvider>;
};

describe("useDailyChallenge", () => {
  beforeEach(() => localStorage.clear());
  it("returns a normalized challenge with number par/height and moveBudget", async () => {
    const { result } = renderHook(() => useDailyChallenge(), { wrapper: wrap });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data).toMatchObject({
      seed: 12345, modifier: "standard", par: 1500, moveBudget: 30, blockHeight: 42, ready: true,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/hooks/useDailyChallenge.test.tsx`
Expected: FAIL — cannot find `./useDailyChallenge`.

- [ ] **Step 3: Implement**

```ts
// frontend/src/game/hooks/useDailyChallenge.ts
import { useQuery } from "@tanstack/react-query";
import { gameApi } from "../../lib/gameApi";

export type DailyChallenge = {
  date: string; seed: number; modifier: string; par: number; moveBudget: number;
  blockHeight: number; blockHash: string; ready: boolean;
};

export function useDailyChallenge() {
  return useQuery<DailyChallenge>({
    queryKey: ["bp", "challenge"],
    queryFn: async () => {
      const r = await gameApi.getDailyChallenge("");
      const c: DailyChallenge = {
        date: r.date, seed: r.seed, modifier: r.modifier,
        par: Number(r.par), moveBudget: r.moveBudget,
        blockHeight: Number(r.blockHeight), blockHash: r.blockHash, ready: r.ready,
      };
      if (c.ready) localStorage.setItem(`bp:challenge:${c.date}`, JSON.stringify(c));
      return c;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/hooks/useDailyChallenge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/hooks/useDailyChallenge.ts frontend/src/game/hooks/useDailyChallenge.test.tsx
git commit -m "Block Party UI: useDailyChallenge hook"
```

---

### Task 4: `useGame` loop hook (engine orchestration)

**Files:**
- Create: `frontend/src/game/hooks/useGame.ts`
- Test: `frontend/src/game/hooks/useGame.test.tsx`

**Interfaces:**
- Consumes: `initGame`, `step`, `type Move`, `type Modifier` from `../engine`.
- Produces: `type GameMode = "ranked" | "practice"`; `useGame(opts: { seed: number; modifier: Modifier; mode: GameMode; moveBudget: number }): { board: number[]; score: number; movesUsed: number; movesLeft: number; over: boolean; moveLog: string; play(m: Move): void; restart(seed?: number): void }`. In `ranked` mode, `play` is a no-op once `movesUsed >= moveBudget` or `over`; in `practice`, only `over` stops it. A move that doesn't change the board (engine `step` returns the same state) is NOT counted and NOT appended to `moveLog`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/game/hooks/useGame.test.tsx
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGame } from "./useGame";

describe("useGame", () => {
  it("records only board-changing moves into the move log", () => {
    const { result } = renderHook(() =>
      useGame({ seed: 12345, modifier: "standard", mode: "ranked", moveBudget: 30 }));
    const before = result.current.moveLog.length;
    act(() => result.current.play("L"));
    // a real move appends exactly one char; a no-op appends none
    expect(result.current.moveLog.length === before || result.current.moveLog.length === before + 1).toBe(true);
    // moveLog chars are only U/R/D/L
    expect(/^[URDL]*$/.test(result.current.moveLog)).toBe(true);
  });

  it("ranked mode stops accepting moves at the budget", () => {
    const { result } = renderHook(() =>
      useGame({ seed: 777, modifier: "standard", mode: "ranked", moveBudget: 3 }));
    const dirs = ["U", "R", "D", "L", "U", "R", "D", "L"] as const;
    act(() => { for (const d of dirs) result.current.play(d); });
    expect(result.current.movesUsed).toBeLessThanOrEqual(3);
    expect(result.current.moveLog.length).toBeLessThanOrEqual(3);
  });

  it("is deterministic: same seed + same moves => same board & log", () => {
    const a = renderHook(() => useGame({ seed: 42, modifier: "standard", mode: "ranked", moveBudget: 30 }));
    const b = renderHook(() => useGame({ seed: 42, modifier: "standard", mode: "ranked", moveBudget: 30 }));
    act(() => { a.result.current.play("U"); a.result.current.play("L"); });
    act(() => { b.result.current.play("U"); b.result.current.play("L"); });
    expect(a.result.current.board).toEqual(b.result.current.board);
    expect(a.result.current.moveLog).toBe(b.result.current.moveLog);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/hooks/useGame.test.tsx`
Expected: FAIL — cannot find `./useGame`.

- [ ] **Step 3: Implement**

```ts
// frontend/src/game/hooks/useGame.ts
// NOTE: game state AND move log live in ONE state object so `play` is a single
// PURE setState updater (no nested setter) — StrictMode-safe (the app is wrapped
// in <StrictMode>, which double-invokes updaters; a nested setMoveLog would
// double-append the move and corrupt the log).
import { useCallback, useRef, useState } from "react";
import { initGame, step, type GameState, type Modifier, type Move } from "../engine";

export type GameMode = "ranked" | "practice";
type Internal = { game: GameState; log: string };

export function useGame(opts: { seed: number; modifier: Modifier; mode: GameMode; moveBudget: number }) {
  const { modifier, mode, moveBudget } = opts;
  const [internal, setInternal] = useState<Internal>(() => ({ game: initGame(opts.seed, modifier), log: "" }));
  const seedRef = useRef(opts.seed);

  const play = useCallback((m: Move) => {
    setInternal((prev) => {
      if (prev.game.over) return prev;
      if (mode === "ranked" && prev.game.moves >= moveBudget) return prev;
      const next = step(prev.game, m);
      if (next === prev.game) return prev; // no-op: unchanged, not counted, not logged
      return { game: next, log: prev.log + m };
    });
  }, [mode, moveBudget]);

  const restart = useCallback((seed?: number) => {
    const s = seed ?? seedRef.current;
    seedRef.current = s;
    setInternal({ game: initGame(s, modifier), log: "" });
  }, [modifier]);

  const game = internal.game;
  const movesUsed = game.moves;
  const budgetReached = mode === "ranked" && movesUsed >= moveBudget;

  return {
    board: game.board,
    score: game.score,
    movesUsed,
    movesLeft: mode === "ranked" ? Math.max(0, moveBudget - movesUsed) : Infinity,
    over: game.over || budgetReached,
    moveLog: internal.log,
    play,
    restart,
  };
}
```

Also add a StrictMode regression test (import `StrictMode` from `react`) asserting a single `play` of a board-changing move appends exactly one char (`before + 1`, never two) when `renderHook` is wrapped in `{ wrapper: StrictMode }`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/hooks/useGame.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/hooks/useGame.ts frontend/src/game/hooks/useGame.test.tsx
git commit -m "Block Party UI: useGame loop hook (budget, no-op-free move log)"
```

---

### Task 5: controls — `useSwipe` + `useKeyboard`

**Files:**
- Create: `frontend/src/game/hooks/useSwipe.ts`, `frontend/src/game/hooks/useKeyboard.ts`
- Test: `frontend/src/game/hooks/useSwipe.test.tsx`

**Interfaces:**
- Produces: `useSwipe(onMove: (m: Move) => void): { onPointerDown; onPointerUp }` — axis-locked Pointer-Events handlers (threshold 24px) mapping a swipe to `U/R/D/L`. `useKeyboard(onMove, enabled)` — arrow keys → moves, attached to `window`, gated by `enabled`.

- [ ] **Step 1: Write the failing test (simulate a horizontal swipe)**

```tsx
// frontend/src/game/hooks/useSwipe.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSwipe } from "./useSwipe";
import type { Move } from "../engine";

function ptr(x: number, y: number) {
  return { clientX: x, clientY: y, preventDefault() {} } as unknown as React.PointerEvent;
}

describe("useSwipe", () => {
  it("maps a rightward drag past threshold to 'R'", () => {
    const onMove = vi.fn<(m: Move) => void>();
    const { result } = renderHook(() => useSwipe(onMove));
    result.current.onPointerDown(ptr(10, 10));
    result.current.onPointerUp(ptr(60, 14)); // dx=50 (>24), dy small => R
    expect(onMove).toHaveBeenCalledWith("R");
  });
  it("ignores a sub-threshold tap", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useSwipe(onMove));
    result.current.onPointerDown(ptr(10, 10));
    result.current.onPointerUp(ptr(15, 12));
    expect(onMove).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/hooks/useSwipe.test.tsx`
Expected: FAIL — cannot find `./useSwipe`.

- [ ] **Step 3: Implement**

```ts
// frontend/src/game/hooks/useSwipe.ts
import { useRef } from "react";
import type { Move } from "../engine";

const THRESHOLD = 24;

export function useSwipe(onMove: (m: Move) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current; start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      if (Math.abs(dx) >= Math.abs(dy)) onMove(dx > 0 ? "R" : "L");
      else onMove(dy > 0 ? "D" : "U");
    },
  };
}
```

```ts
// frontend/src/game/hooks/useKeyboard.ts
import { useEffect } from "react";
import type { Move } from "../engine";

const KEYS: Record<string, Move> = {
  ArrowUp: "U", ArrowRight: "R", ArrowDown: "D", ArrowLeft: "L",
};

export function useKeyboard(onMove: (m: Move) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      const m = KEYS[e.key];
      if (m) { e.preventDefault(); onMove(m); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onMove, enabled]);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/hooks/useSwipe.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/hooks/useSwipe.ts frontend/src/game/hooks/useKeyboard.ts frontend/src/game/hooks/useSwipe.test.tsx
git commit -m "Block Party UI: axis-locked swipe + keyboard controls"
```

---

### Task 6: board rendering — Board, Tile, ScoreBar, PeekQueue, ModifierBadge + CSS

**Files:**
- Create: `frontend/src/game/lib/tiers.ts`
- Create: `frontend/src/game/components/Tile.tsx`, `Board.tsx`, `ScoreBar.tsx`, `PeekQueue.tsx`, `ModifierBadge.tsx`, `board.css`
- Test: `frontend/src/game/components/Board.test.tsx`, `frontend/src/game/lib/tiers.test.ts`

**Interfaces:**
- Produces:
  - `tiers.ts`: `milestoneLabel(value: number): string | null` (128→"Initiate", 512→"Builder", 2048→"Gno Guardian", else null); `tierEmoji(value: number): string` (0→⬛, 2/4→🟩, 8/16/32→🟦, 64/128/256→🟪, ≥512→🟨); `rankFromPercentile(p: number): string` (≥90→"S", ≥70→"A", ≥40→"B", else "C").
  - `Board({ board, onMove, onPointerHandlers })`: renders the 4×4 grid; owns touch (via className `k-bp-board` styled with `touch-action:none`), calls `useSwipe`. ARIA `role="grid"` + an `aria-live="polite"` status node announcing "score N".
  - `Tile({ value })`: glowing block, number in `--font-mono`, milestone label when present, brightness ramp by tier for colorblind safety.
  - `ScoreBar({ score, par, movesLeft })`, `PeekQueue({ next })` (optional next-tile hint), `ModifierBadge({ modifier })`.

- [ ] **Step 1: Write failing tests for tiers + board render**

```ts
// frontend/src/game/lib/tiers.test.ts
import { describe, it, expect } from "vitest";
import { milestoneLabel, tierEmoji, rankFromPercentile } from "./tiers";
describe("tiers", () => {
  it("labels milestone tiles", () => {
    expect(milestoneLabel(2048)).toBe("Gno Guardian");
    expect(milestoneLabel(8)).toBeNull();
  });
  it("maps values to distinct emoji tiers", () => {
    expect(tierEmoji(0)).toBe("⬛");
    expect(tierEmoji(2)).toBe("🟩");
    expect(tierEmoji(2048)).toBe("🟨");
  });
  it("derives a rank letter from percentile", () => {
    expect(rankFromPercentile(95)).toBe("S");
    expect(rankFromPercentile(10)).toBe("C");
  });
});
```

```tsx
// frontend/src/game/components/Board.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Board } from "./Board";

describe("Board", () => {
  it("renders 16 cells and shows tile values", () => {
    const board = [2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2048];
    render(<Board board={board} onMove={vi.fn()} />);
    expect(screen.getByRole("grid")).toBeTruthy();
    expect(screen.getByText("2048")).toBeTruthy();
    expect(screen.getByText("Gno Guardian")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/lib/tiers.test.ts src/game/components/Board.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

```ts
// frontend/src/game/lib/tiers.ts
export function milestoneLabel(v: number): string | null {
  if (v === 128) return "Initiate";
  if (v === 512) return "Builder";
  if (v === 2048) return "Gno Guardian";
  return null;
}
export function tierEmoji(v: number): string {
  if (v === 0) return "⬛";
  if (v <= 4) return "🟩";
  if (v <= 32) return "🟦";
  if (v <= 256) return "🟪";
  return "🟨";
}
export function rankFromPercentile(p: number): string {
  if (p >= 90) return "S";
  if (p >= 70) return "A";
  if (p >= 40) return "B";
  return "C";
}
```

```tsx
// frontend/src/game/components/Tile.tsx
import { milestoneLabel } from "../lib/tiers";
export function Tile({ value }: { value: number }) {
  if (value === 0) return <div className="k-bp-cell k-bp-cell--empty" aria-hidden />;
  const label = milestoneLabel(value);
  // brightness ramp by exponent for colorblind-safe differentiation
  const exp = Math.log2(value);
  return (
    <div className="k-bp-cell k-bp-tile" data-exp={exp} role="gridcell" aria-label={`${value}`}>
      <span className="k-bp-tile-val">{value}</span>
      {label && <span className="k-bp-tile-label">{label}</span>}
    </div>
  );
}
```

```tsx
// frontend/src/game/components/Board.tsx
import { useSwipe } from "../hooks/useSwipe";
import type { Move } from "../engine";
import { Tile } from "./Tile";
import "./board.css";
export function Board({ board, onMove }: { board: number[]; onMove: (m: Move) => void }) {
  const swipe = useSwipe(onMove);
  return (
    <div
      className="k-bp-board"
      role="grid"
      aria-label="Block Party board"
      tabIndex={0}
      onPointerDown={swipe.onPointerDown}
      onPointerUp={swipe.onPointerUp}
    >
      {board.map((v, i) => <Tile key={i} value={v} />)}
    </div>
  );
}
```

```tsx
// frontend/src/game/components/ScoreBar.tsx
export function ScoreBar({ score, par, movesLeft }: { score: number; par: number; movesLeft: number }) {
  return (
    <div className="k-bp-scorebar">
      <div><span className="k-bp-eyebrow">SCORE</span><strong className="k-bp-score">{score.toLocaleString()}</strong></div>
      <div><span className="k-bp-eyebrow">PAR</span><span>{par.toLocaleString()}</span></div>
      {Number.isFinite(movesLeft) && <div><span className="k-bp-eyebrow">MOVES</span><span>{movesLeft}</span></div>}
    </div>
  );
}
```

```tsx
// frontend/src/game/components/ModifierBadge.tsx
const LABELS: Record<string, string> = { standard: "Standard", doubles: "Doubles Day", rush: "Rush" };
export function ModifierBadge({ modifier }: { modifier: string }) {
  return <span className="k-bp-modifier">{LABELS[modifier] ?? modifier}</span>;
}
```

```tsx
// frontend/src/game/components/PeekQueue.tsx
export function PeekQueue({ next }: { next: number | null }) {
  if (next == null) return null;
  return <div className="k-bp-peek"><span className="k-bp-eyebrow">NEXT</span><span>{next}</span></div>;
}
```

```css
/* frontend/src/game/components/board.css */
.k-bp-board {
  touch-action: none;
  overscroll-behavior: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
  width: min(92vw, 420px);
  aspect-ratio: 1 / 1;
  margin: 0 auto;                 /* keeps the board off the iOS edge-back zone */
  padding: var(--space-2);
  background: var(--color-k-panel);
  border: 1px solid var(--color-k-edge);
  border-radius: var(--radius-lg);
  outline: none;
}
.k-bp-board:focus-visible { box-shadow: 0 0 0 2px var(--color-k-accent); }
.k-bp-cell {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  min-height: 44px;
}
.k-bp-cell--empty { background: var(--color-k-elevated); }
.k-bp-tile {
  color: #04120f; font-weight: 700;
  background: var(--color-k-accent);
  box-shadow: 0 0 12px var(--color-k-accent-tint);
}
/* brightness ramp: higher exponents get progressively lighter for colorblind safety */
.k-bp-tile[data-exp="1"] { filter: brightness(0.72); } /* 2 */
.k-bp-tile[data-exp="2"] { filter: brightness(0.80); }
.k-bp-tile[data-exp="3"] { filter: brightness(0.88); }
.k-bp-tile[data-exp="4"] { filter: brightness(0.96); }
.k-bp-tile[data-exp="5"] { filter: brightness(1.04); }
.k-bp-tile[data-exp="6"] { filter: brightness(1.12); }
.k-bp-tile[data-exp="7"] { filter: brightness(1.20); }
.k-bp-tile-val { font-size: clamp(0.9rem, 4vw, 1.4rem); }
.k-bp-tile-label { font-size: 0.55rem; opacity: 0.85; margin-top: 2px; text-align: center; }
.k-bp-scorebar { display: flex; gap: var(--space-6); justify-content: center; margin: var(--space-4) 0; font-family: var(--font-mono); }
.k-bp-eyebrow { display: block; font-size: 0.6rem; color: var(--color-k-muted); letter-spacing: 0.08em; }
.k-bp-score { color: var(--color-k-accent); font-size: 1.4rem; }
.k-bp-modifier { color: var(--color-k-govdao); border: 1px solid var(--color-k-govdao-border); border-radius: var(--radius-full); padding: 2px var(--space-3); font-size: 0.7rem; }
@media (prefers-reduced-motion: reduce) {
  .k-bp-tile { box-shadow: none; }
  .k-bp-board * { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/lib/tiers.test.ts src/game/components/Board.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/lib/tiers.ts frontend/src/game/lib/tiers.test.ts frontend/src/game/components/Tile.tsx frontend/src/game/components/Board.tsx frontend/src/game/components/ScoreBar.tsx frontend/src/game/components/ModifierBadge.tsx frontend/src/game/components/PeekQueue.tsx frontend/src/game/components/board.css frontend/src/game/components/Board.test.tsx
git commit -m "Block Party UI: board, tile (colorblind-safe), scorebar, badges + CSS"
```

---

### Task 7: game-over + wallet-optional submit + result

**Files:**
- Create: `frontend/src/game/lib/localStore.ts`
- Create: `frontend/src/game/components/GameOverSheet.tsx`, `gameover.css`
- Test: `frontend/src/game/lib/localStore.test.ts`, `frontend/src/game/components/GameOverSheet.test.tsx`

**Interfaces:**
- Produces:
  - `localStore.ts`: `getLocalBest(date): number`, `setLocalBest(date, score)`, `getLocalStreak(): { current: number; lastDate: string }`, `bumpLocalStreak(date)` (mirrors the server's consecutive/streak rule locally for guests).
  - `GameOverSheet({ date, score, par, moveLog, board, modifier, wallet, auth, onShare })`: shows score/par-delta; if `wallet.installed && !auth.isAuthenticated` shows a "Connect to post your score" CTA (calls the token flow); if `auth.isAuthenticated` auto-submits via `gameApi.submitScore(auth.token, date, moveLog)` and shows the returned percentile + rank tier + streak; guests see local best + local streak + a "Leaderboard needs the Adena extension (desktop)" note when `!wallet.installed`. Always shows a Share button (never wallet-gated).

- [ ] **Step 1: Write failing tests**

```ts
// frontend/src/game/lib/localStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { getLocalBest, setLocalBest, getLocalStreak, bumpLocalStreak } from "./localStore";
describe("localStore", () => {
  beforeEach(() => localStorage.clear());
  it("tracks a per-day best", () => {
    setLocalBest("2026-07-06", 1200);
    setLocalBest("2026-07-06", 900); // lower ignored
    expect(getLocalBest("2026-07-06")).toBe(1200);
  });
  it("increments streak on consecutive days and resets on a gap", () => {
    bumpLocalStreak("2026-07-06");
    bumpLocalStreak("2026-07-07");
    expect(getLocalStreak().current).toBe(2);
    bumpLocalStreak("2026-07-10"); // gap
    expect(getLocalStreak().current).toBe(1);
  });
});
```

```tsx
// frontend/src/game/components/GameOverSheet.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GameOverSheet } from "./GameOverSheet";

const baseProps = {
  date: "2026-07-06", score: 1200, par: 1500, moveLog: "URDL", board: new Array(16).fill(0),
  modifier: "standard", onShare: vi.fn(),
};

describe("GameOverSheet", () => {
  it("guest without Adena sees a desktop note, still can share, never a broken Connect", () => {
    render(<GameOverSheet {...baseProps}
      wallet={{ installed: false, connect: vi.fn() }}
      auth={{ isAuthenticated: false }} />);
    expect(screen.getByRole("button", { name: /share/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^connect/i })).toBeNull();
    expect(screen.getByText(/adena extension/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/lib/localStore.test.ts src/game/components/GameOverSheet.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

```ts
// frontend/src/game/lib/localStore.ts
export function getLocalBest(date: string): number {
  return Number(localStorage.getItem(`bp:best:${date}`) ?? 0);
}
export function setLocalBest(date: string, score: number) {
  if (score > getLocalBest(date)) localStorage.setItem(`bp:best:${date}`, String(score));
}
type LocalStreak = { current: number; lastDate: string };
export function getLocalStreak(): LocalStreak {
  try { return JSON.parse(localStorage.getItem("bp:streak") ?? "") as LocalStreak; }
  catch { return { current: 0, lastDate: "" }; }
}
function dayGap(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
export function bumpLocalStreak(date: string): LocalStreak {
  const s = getLocalStreak();
  let current = 1;
  if (s.lastDate) {
    const g = dayGap(s.lastDate, date);
    if (g === 0) current = s.current;
    else if (g === 1) current = s.current + 1;
    else current = 1;
  }
  const next = { current, lastDate: date };
  localStorage.setItem("bp:streak", JSON.stringify(next));
  return next;
}
```

```tsx
// frontend/src/game/components/GameOverSheet.tsx
import { useEffect, useState } from "react";
import { rankFromPercentile } from "../lib/tiers";
import { getLocalBest, setLocalBest, bumpLocalStreak } from "../lib/localStore";
import { gameApi } from "../../lib/gameApi";
import type { Token } from "../../gen/memba/v1/memba_pb";
import "./gameover.css";

type WalletLike = { installed: boolean; connect: () => Promise<unknown> };
type AuthLike = { isAuthenticated: boolean; token?: Token; address?: string; authenticate?: () => Promise<void> };

export function GameOverSheet(props: {
  date: string; score: number; par: number; moveLog: string; board: number[]; modifier: string;
  wallet: WalletLike; auth: AuthLike; onShare: () => void;
}) {
  const { date, score, par, moveLog, wallet, auth, onShare } = props;
  const [result, setResult] = useState<{ percentile: number; streak: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // guest local persistence (also runs for connected users as a fallback)
  useEffect(() => { setLocalBest(date, score); }, [date, score]);

  // auto-submit when authenticated
  useEffect(() => {
    if (!auth.isAuthenticated || !auth.token || result) return;
    setSubmitting(true);
    gameApi.submitScore(auth.token, date, moveLog)
      .then((r) => setResult({ percentile: r.percentile, streak: r.streak?.current ?? 0 }))
      .catch(() => setErr("Couldn’t verify your score. Your local best is saved."))
      .finally(() => setSubmitting(false));
  }, [auth.isAuthenticated, auth.token, date, moveLog, result]);

  const localStreak = bumpLocalStreak(date).current;
  const parDelta = score - par;

  return (
    <div className="k-bp-over" role="dialog" aria-label="Round complete">
      <h2 className="k-bp-over-score">{score.toLocaleString()}</h2>
      <p className="k-bp-over-par">{parDelta >= 0 ? `+${parDelta}` : parDelta} vs par</p>

      {result && (
        <p className="k-bp-over-rank">
          Rank {rankFromPercentile(result.percentile)} · beat {result.percentile}% · 🔥{result.streak}
        </p>
      )}
      {submitting && <p className="k-bp-over-note">Verifying your score…</p>}
      {err && <p className="k-bp-over-note">{err}</p>}

      {!auth.isAuthenticated && wallet.installed && (
        <button className="k-bp-btn k-bp-btn--accent" onClick={() => auth.authenticate?.()}>
          Connect to post today’s score
        </button>
      )}
      {!auth.isAuthenticated && !wallet.installed && (
        <p className="k-bp-over-note">
          Best today: {getLocalBest(date).toLocaleString()} · 🔥{localStreak} ·
          Leaderboard needs the Adena extension (desktop).
        </p>
      )}

      <button className="k-bp-btn" onClick={onShare}>Share</button>
    </div>
  );
}
```

```css
/* frontend/src/game/components/gameover.css */
.k-bp-over { text-align: center; padding: var(--space-6) var(--space-4) calc(var(--space-6) + var(--mb-safe-bottom)); font-family: var(--font-mono); }
.k-bp-over-score { color: var(--color-k-accent); font-size: 2.4rem; margin: 0; }
.k-bp-over-par { color: var(--color-k-dim); margin: var(--space-1) 0 var(--space-4); }
.k-bp-over-rank { color: var(--color-k-text); font-size: 1.1rem; }
.k-bp-over-note { color: var(--color-k-muted); font-size: 0.8rem; max-width: 32ch; margin: var(--space-3) auto; }
.k-bp-btn { min-height: var(--mb-touch-min); padding: 0 var(--space-6); border-radius: var(--radius-md); border: 1px solid var(--color-k-edge); background: var(--color-k-elevated); color: var(--color-k-text); font-family: var(--font-mono); margin: var(--space-2); cursor: pointer; }
.k-bp-btn--accent { background: var(--color-k-accent); color: #04120f; border-color: transparent; }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/lib/localStore.test.ts src/game/components/GameOverSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/lib/localStore.ts frontend/src/game/lib/localStore.test.ts frontend/src/game/components/GameOverSheet.tsx frontend/src/game/components/gameover.css frontend/src/game/components/GameOverSheet.test.tsx
git commit -m "Block Party UI: game-over sheet + wallet-optional verified submit + local streak"
```

---

### Task 8: DailyLeaderboardPanel + StreakBadge

**Files:**
- Create: `frontend/src/game/components/DailyLeaderboardPanel.tsx`, `StreakBadge.tsx`, `panels.css`
- Test: `frontend/src/game/components/DailyLeaderboardPanel.test.tsx`

**Interfaces:**
- Produces: `DailyLeaderboardPanel({ date })` (queries `gameApi.getDailyLeaderboard(date, 50)`, renders rank/address/score, `bigint`→`Number`); `StreakBadge({ address, localStreak })` (queries `gameApi.getStreak(address)` when an address is present, else shows `localStreak`).

- [ ] **Step 1: Write the failing test (mock gameApi)**

```tsx
// frontend/src/game/components/DailyLeaderboardPanel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("../../lib/gameApi", () => ({
  gameApi: { getDailyLeaderboard: vi.fn().mockResolvedValue({
    entries: [{ address: "g1winner", score: 9000n, rank: 1 }, { address: "g1second", score: 800n, rank: 2 }],
  }) },
}));
import { DailyLeaderboardPanel } from "./DailyLeaderboardPanel";
const wrap = (ui: React.ReactNode) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={c}>{ui}</QueryClientProvider>);
};
describe("DailyLeaderboardPanel", () => {
  it("renders ranked entries with numeric scores", async () => {
    wrap(<DailyLeaderboardPanel date="2026-07-06" />);
    await waitFor(() => expect(screen.getByText("9,000")).toBeTruthy());
    expect(screen.getByText("#1")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/components/DailyLeaderboardPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/game/components/DailyLeaderboardPanel.tsx
import { useQuery } from "@tanstack/react-query";
import { gameApi } from "../../lib/gameApi";
import "./panels.css";
export function DailyLeaderboardPanel({ date }: { date: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["bp", "leaderboard", date],
    queryFn: () => gameApi.getDailyLeaderboard(date, 50),
    staleTime: 60_000,
  });
  if (isLoading) return <div className="k-bp-panel">Loading…</div>;
  const entries = data?.entries ?? [];
  if (entries.length === 0) return <div className="k-bp-panel k-bp-panel--empty">No scores yet today — be first.</div>;
  return (
    <ol className="k-bp-panel k-bp-lb">
      {entries.map((e) => (
        <li key={e.address} className="k-bp-lb-row">
          <span className="k-bp-lb-rank">#{e.rank}</span>
          <span className="k-bp-lb-addr">{e.address.slice(0, 8)}…</span>
          <span className="k-bp-lb-score">{Number(e.score).toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
```

```tsx
// frontend/src/game/components/StreakBadge.tsx
import { useQuery } from "@tanstack/react-query";
import { gameApi } from "../../lib/gameApi";
export function StreakBadge({ address, localStreak }: { address?: string; localStreak: number }) {
  const { data } = useQuery({
    queryKey: ["bp", "streak", address],
    queryFn: () => gameApi.getStreak(address!),
    enabled: !!address,
  });
  const current = address ? (data?.streak?.current ?? 0) : localStreak;
  return <span className="k-bp-streak">🔥 {current}</span>;
}
```

```css
/* frontend/src/game/components/panels.css */
.k-bp-panel { border: 1px solid var(--color-k-edge); border-radius: var(--radius-lg); padding: var(--space-4); font-family: var(--font-mono); }
.k-bp-panel--empty { color: var(--color-k-muted); text-align: center; }
.k-bp-lb { list-style: none; margin: 0; padding: var(--space-2); }
.k-bp-lb-row { display: grid; grid-template-columns: 3rem 1fr auto; gap: var(--space-3); padding: var(--space-2) 0; border-bottom: 1px solid var(--color-k-edge); }
.k-bp-lb-rank { color: var(--color-k-accent); }
.k-bp-lb-score { color: var(--color-k-text); text-align: right; }
.k-bp-streak { color: var(--color-k-govdao); }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/components/DailyLeaderboardPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/components/DailyLeaderboardPanel.tsx frontend/src/game/components/StreakBadge.tsx frontend/src/game/components/panels.css frontend/src/game/components/DailyLeaderboardPanel.test.tsx
git commit -m "Block Party UI: daily leaderboard panel + streak badge"
```

---

### Task 9: ShareCard (Wordle-style text share)

**Files:**
- Create: `frontend/src/game/lib/shareText.ts`, `frontend/src/game/components/ShareCard.tsx`
- Test: `frontend/src/game/lib/shareText.test.ts`

**Interfaces:**
- Produces: `buildShareText(opts: { date: string; board: number[]; percentile?: number; streak: number; modifier: string; url: string }): string` — hook on line 1 (`Block Party <date> · beat me · <url>`), then a 4×4 emoji mini-grid of the final board via `tierEmoji`, then `modifier` name + rank/percentile + streak. `ShareCard({ ... , onClose })` uses the Web Share API when available, else clipboard with a "Copied!" toast.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/game/lib/shareText.test.ts
import { describe, it, expect } from "vitest";
import { buildShareText } from "./shareText";
describe("buildShareText", () => {
  it("puts the hook + url on line 1 and renders a 4x4 emoji grid", () => {
    const board = [2,4,8,16, 0,0,0,0, 0,0,0,0, 0,0,0,2048];
    const txt = buildShareText({ date: "2026-07-06", board, percentile: 91, streak: 5, modifier: "doubles", url: "https://x/game" });
    const lines = txt.split("\n");
    expect(lines[0]).toContain("beat me");
    expect(lines[0]).toContain("https://x/game");
    // 4 grid rows of 4 emoji each somewhere in the body
    const gridRows = lines.filter((l) => [...l].length === 4 && /[🟩🟦🟪🟨⬛]/u.test(l));
    expect(gridRows.length).toBe(4);
    expect(txt).toContain("Doubles Day");
    expect(txt).toContain("🔥5");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/lib/shareText.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// frontend/src/game/lib/shareText.ts
import { tierEmoji, rankFromPercentile } from "./tiers";
const MOD_LABEL: Record<string, string> = { standard: "Standard", doubles: "Doubles Day", rush: "Rush" };
export function buildShareText(opts: {
  date: string; board: number[]; percentile?: number; streak: number; modifier: string; url: string;
}): string {
  const { date, board, percentile, streak, modifier, url } = opts;
  const grid = [0, 1, 2, 3].map((r) => board.slice(r * 4, r * 4 + 4).map(tierEmoji).join("")).join("\n");
  const verdict = percentile != null ? `${rankFromPercentile(percentile)}-rank · beat ${percentile}%` : "practice";
  return [
    `Block Party ${date} · beat me · ${url}`,
    "",
    grid,
    "",
    `${MOD_LABEL[modifier] ?? modifier} · ${verdict} · 🔥${streak}`,
  ].join("\n");
}
```

```tsx
// frontend/src/game/components/ShareCard.tsx
import { useState } from "react";
import { buildShareText } from "../lib/shareText";
export function ShareCard(props: {
  date: string; board: number[]; percentile?: number; streak: number; modifier: string;
}) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${window.location.pathname}`;
  const text = buildShareText({ ...props, url });
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ text }); return; } catch { /* fall through */ } }
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  return (
    <div className="k-bp-share">
      <button className="k-bp-btn k-bp-btn--accent" onClick={share} aria-label="Share your result">Share</button>
      {copied && <span className="k-bp-share-toast" role="status">Copied!</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/game/lib/shareText.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/lib/shareText.ts frontend/src/game/lib/shareText.test.ts frontend/src/game/components/ShareCard.tsx
git commit -m "Block Party UI: Wordle-style share (emoji grid + beat-me deep link)"
```

---

### Task 10: page assembly + Practice mode

**Files:**
- Create: `frontend/src/pages/BlockPartyGame.tsx`, `frontend/src/pages/blockparty.css`
- Test: `frontend/src/pages/BlockPartyGame.test.tsx`

**Interfaces:** the page composes everything: mode toggle (Daily / Practice), persistent header (`Block Party #<date>`), first-session ghost-swipe hint (dismisses on first move, remembered in localStorage), `Board` + `ScoreBar` + `ModifierBadge`, `useKeyboard` for desktop, `GameOverSheet` (+ `ShareCard`) on end, and `DailyLeaderboardPanel`/`StreakBadge`. Practice uses a client-random seed (`crypto.getRandomValues`), `modifier: "standard"`, `mode: "practice"` (endless), and never submits.

- [ ] **Step 1: Write the failing test (board-first render, no wallet)**

```tsx
// frontend/src/pages/BlockPartyGame.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("../lib/gameApi", () => ({
  gameApi: {
    getDailyChallenge: vi.fn().mockResolvedValue({
      date: "2026-07-06", seed: 12345, modifier: "standard", par: 1500n, moveBudget: 30,
      blockHeight: 42n, blockHash: "abc", ready: true,
    }),
    getDailyLeaderboard: vi.fn().mockResolvedValue({ entries: [] }),
    getStreak: vi.fn().mockResolvedValue({ streak: { current: 0, longest: 0, freezesRemaining: 1 } }),
  },
}));
vi.mock("../hooks/useAdena", () => ({ useAdena: () => ({ installed: false, connected: false, address: "" }) }));
import BlockPartyGame from "./BlockPartyGame";
const wrap = (ui: React.ReactNode) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={c}>{ui}</QueryClientProvider>);
};
describe("BlockPartyGame", () => {
  it("renders the daily header and board without a wallet", async () => {
    wrap(<BlockPartyGame />);
    await waitFor(() => expect(screen.getByRole("grid")).toBeTruthy());
    expect(screen.getByText(/Block Party/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/pages/BlockPartyGame.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the page**

Implement `frontend/src/pages/BlockPartyGame.tsx` composing the pieces per the Interfaces above. Key requirements (the reviewer will check these):
- **Board-first render:** while `useDailyChallenge` loads, show the board frame/skeleton — never block on wallet.
- **Mode state:** `useState<"ranked"|"practice">("ranked")`. Ranked uses the challenge seed/modifier/moveBudget; on "not ready" (`ready===false`) show "Today's board mints shortly" and offer Practice.
- **Wire controls:** `<Board board onMove={play} />` + `useKeyboard(play, !over)`.
- **Ghost-swipe hint:** show an animated hint overlay on the board on first-ever visit (localStorage `bp:hinted`), fade on first `play`.
- **On `over`:** render `GameOverSheet` (ranked) with `wallet`(from `useAdena`) + an `auth` object (wire `useAuth`), passing `moveLog`/`board`/`par`/`modifier`; embed `ShareCard`. Practice over → local best + Share only (no submit).
- **Panels:** `DailyLeaderboardPanel date` + `StreakBadge` below the board.
- **Header:** persistent `Block Party #<date>` + `ModifierBadge`.
Use `blockparty.css` with Kodera tokens; page container respects `--mb-safe-top`/`--mb-safe-bottom`; board is above the fold on a 375-wide viewport.

Create `frontend/src/pages/blockparty.css` with the page layout (centered column, `max-width: 480px`, safe-area padding, mode toggle styling using `--color-k-*`).

- [ ] **Step 4: Run to verify it passes + build**

Run: `cd frontend && node ./node_modules/.bin/vitest run src/pages/BlockPartyGame.test.tsx`
Then: `cd frontend && npm run build` → succeeds.
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/BlockPartyGame.tsx frontend/src/pages/blockparty.css frontend/src/pages/BlockPartyGame.test.tsx
git commit -m "Block Party UI: page assembly + Practice mode + first-session hint"
```

---

### Task 11: E2E happy-path (behind the flag)

**Files:**
- Create: `frontend/e2e/blockparty.spec.ts`

**Interfaces:** a Playwright spec that, with `VITE_ENABLE_GAME=true` in the E2E env, loads `/test13/game`, plays a scripted keyboard game to game-over (or budget), and asserts the result sheet + Share button appear. Guest path only (no wallet) so it needs no Adena.

- [ ] **Step 1: Write the spec**

```ts
// frontend/e2e/blockparty.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Block Party", () => {
  test("guest can play the daily to completion and see a result", async ({ page }) => {
    await page.goto("/test13/game");
    const board = page.getByRole("grid");
    await expect(board).toBeVisible();
    await board.focus();
    // exhaust the ranked budget with a deterministic key cycle
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"][i % 4]);
    }
    await expect(page.getByRole("button", { name: /share/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it (requires the flag on)**

Run: `cd frontend && VITE_ENABLE_GAME=true npx playwright test e2e/blockparty.spec.ts --project=chromium`
Expected: PASS (the dev server auto-launches per `playwright.config.ts`; if `VITE_ENABLE_GAME` must be set in `.env.e2e`, add it there instead and note it).
If it can't run in this environment (no browser), report that and leave the spec committed — CI runs it.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/blockparty.spec.ts
git commit -m "Block Party UI: E2E happy-path (guest plays daily to result)"
```

---

## Self-Review

**Spec coverage (against design spec §3, §8, §9 + the panel requirements):**
- Ranked daily w/ move budget (server-authoritative) → Task 1 + Task 4. ✅
- Peek-ahead: `PeekQueue` component exists (Task 6); wiring an actual next-tile preview is optional polish — the engine exposes it via a peek helper if desired, but v1 can ship the budget+modifier without a live peek. **Noted as a deliberate v1 trim** (the budget + modifier already restore the snackable/harder-to-lookahead properties; a live peek is additive).
- Daily modifier surfaced → `ModifierBadge` (Task 6), share (Task 9). ✅
- Par + percentile + rank tier headline → Task 7 (`rankFromPercentile`), not raw score. ✅
- One ranked run/day (server one-per-day) + Practice mode → Task 10. ✅
- Streak (+local for guests) → Task 7/8. ✅
- Share = final-board emoji grid + beat-me + deep link, hook line 1, never wallet-gated → Task 9. ✅
- Touch: `touch-action:none` + `overscroll-behavior:none` + axis-locked pointer swipe + edge margin → Tasks 5, 6. ✅
- Wallet-optional, capability-detect Adena, guest-first → Task 7/10. ✅
- A11y: colorblind-safe tiers, reduced-motion, ARIA grid, focus ring, 44px targets → Tasks 6, 7. ✅
- Flag/gate/route → Task 2. ✅

**Placeholder scan:** the only non-code prose is Task 10 Step 3 (page assembly), which lists concrete required behaviors + the exact components/props to compose (all defined in Tasks 3–9) rather than pasting one giant JSX blob — every referenced symbol exists. No TBD/TODO.

**Type consistency:** `Move`, `Modifier`, `GameState`, `initGame`, `step` come from Sub-plan 1's `../engine`. `DailyChallenge` (Task 3) feeds `useGame` (Task 4). `gameApi` (Task 2) is used by Tasks 3, 7, 8. `Token` (from `useAuth`/gen) flows into `gameApi.submitScore`. `bigint` fields are `Number()`-converted at every boundary (Tasks 3, 8). Method names match the verified generated client.

**Deferred / v1 trims (not gaps):** live peek-ahead preview (component stubbed, wiring optional); rendered OG image share card (text share ships; image = Phase 2); `haptic on merge` (add `navigator.vibrate(10)` in `useGame.play` on a real move if desired — low-risk addition). Frozen/LockedAxis modifiers await the engine extension (Phase 1.1).

**Backend dependency:** Task 1 must land first (the frontend reads `moveBudget` and relies on server budget enforcement). It regenerates the proto/gen; the rest of the tasks consume the new `moveBudget` field.
