# Space Invaders — Frontend-Only Arcade Game (Design Spec)

**Date:** 2026-07-08
**Branch:** `feat/store-space-invaders`
**Status:** Design approved (pending spec review)

## Goal

Ship a second Memba Store game — a classic Space Invaders — as a **pure
client-side React feature**, dark and flag-gated, listed in the App Store
alongside Block Party. It exists to grow the Store catalog with a recognizable,
instantly-playable arcade title, with **zero backend, realm, or DB footprint** so
it can be built in a parallel session without colliding with in-flight work
(feed, perf, marketplace, directory, P0 audits).

## Non-Goals (YAGNI)

- **No** byte-identical Go engine, RPC, DB migration, or on-chain leaderboard.
  Real-time action games cannot be server-verified the way turn-based 2048 is
  without input-replay infrastructure; we do not build that here.
- **No** destructible shields/bunkers, bonus UFO, power-ups, or multiple enemy
  types in v1.
- **No** global/social leaderboard. High score is **local (`localStorage`) only**.

## Scope Decisions (locked)

| Decision | Choice |
| --- | --- |
| Integration depth | Frontend-only arcade |
| First game | Space Invaders |
| Gameplay | Lean classic (no shields/UFO/power-ups) |
| Controls | Full touch parity + keyboard |
| Route | `game/space-invaders` |
| Formation | 5 rows × 11 columns |
| Player bullet | One in flight at a time (classic constraint) |
| Ship state | Flag OFF, default false, dark |

## Architecture — Pure Engine / React Shell Split

Mirrors the proven Block Party structure: a **pure, deterministic reducer** that
is fully unit-testable, wrapped by a thin React shell that owns the render loop,
input, and DOM. The engine never touches the DOM, wall-clock time, or
`Math.random`.

```
frontend/src/games/space-invaders/
  engine/
    types.ts        # GameState, Entity, InputIntent, Config, Phase
    config.ts       # tunables (grid, speeds, cadence) — single source of truth
    prng.ts         # seeded mulberry32 (reuse Block Party pattern) for alien fire
    spawn.ts        # wave/formation builders
    collision.ts    # AABB overlap helpers
    step.ts         # step(state, dtMs, input) -> state  ← PURE, deterministic
    index.ts        # public engine surface
  hooks/
    useGameLoop.ts  # requestAnimationFrame + fixed-timestep accumulator
    useKeyboard.ts  # ←/→/space/P → InputIntent
    useTouch.ts     # left-half drag-to-move, right-half tap/hold-to-fire → InputIntent
  render/
    Canvas.tsx      # draws a GameState frame to <canvas> (no game logic)
  lib/
    highScore.ts    # localStorage read/write (namespaced key)
  SpaceInvaders.tsx # shell: wires loop + input + render + HUD/overlays
  space-invaders.css

frontend/src/pages/SpaceInvadersGame.tsx  # thin lazy entry (matches BlockPartyGame.tsx)
frontend/src/components/ui/SpaceInvadersGate.tsx  # ComingSoonGate when flag off
```

### Fixed-timestep determinism

`useGameLoop` accumulates real `dt` and advances the engine in **fixed
timesteps** (e.g. 16.67ms). The engine advances by whole ticks only, so:

- Gameplay is frame-rate independent (same behavior on 60/120/144Hz).
- The reducer is deterministic given `(seed, sequence of InputIntents)`, which is
  exactly what makes it unit-testable and reproducible via golden vectors.

Alien-fire randomness draws from the seeded `prng` carried inside `GameState`,
never from `Math.random`.

## Gameplay Spec (Lean Classic)

- **Player cannon** on a fixed baseline row; moves left/right within bounds.
- **Formation:** 5×11 aliens. Steps horizontally as a block; at either screen
  edge the whole block **drops one row and reverses** direction.
- **Speed-up:** step cadence shortens as living aliens decrease (classic
  accelerate-on-kill). Cadence is a function of `aliveCount` in `config.ts`.
- **Player bullet:** at most **one in flight**; fire spawns it, it travels up,
  despawns on hit or off-screen (frees the next shot).
- **Alien bullets:** eligible (front-row) aliens fire on a seeded cadence;
  bullets travel down.
- **Lives:** 3. Player hit → lose a life, brief invulnerable respawn. 0 lives →
  game over.
- **Lose condition:** lives exhausted, OR any alien reaches the player baseline.
- **Wave clear:** all aliens destroyed → spawn a fresh wave, starting slightly
  lower and faster. Score carries across waves.
- **Scoring:** per-alien points (higher rows worth more, classic). Track score +
  wave number in the HUD.

### Phases (state machine)

`ready → playing → paused → gameover`. Overlays: a start prompt (`ready`), a
pause overlay (`paused`), and a game-over sheet showing score, best (local), and
"Play again". Pattern follows Block Party's `GameOverSheet`.

## Controls — Full Touch Parity

Both input hooks normalize to a single engine-facing intent so the engine is
input-source-agnostic:

```ts
type InputIntent = { move: -1 | 0 | 1; fire: boolean; pause: boolean };
```

- **Keyboard (desktop):** ← / → move, Space fires, `P` pauses. Arrow-key default
  scroll is prevented while playing.
- **Touch (mobile):** left screen half = drag-to-move (track pointer X → move
  direction / target), right half = tap or hold to fire; an on-screen pause
  control. Tuned and playtested at mobile viewport.

Both paths must feel correct; ship note does **not** downgrade mobile.

## Wiring

- **Flag:** add `VITE_ENABLE_SPACE_INVADERS` and
  `isSpaceInvadersEnabled(): boolean` in `frontend/src/lib/config.ts`, following
  `isGameEnabled`. Default/committed **false**. Must remain
  `assertSafeFlags`-safe (no committed `"true"`).
- **Gate:** `SpaceInvadersGate` renders `ComingSoonGate`
  (title "Space Invaders", icon 🛸, feature bullets) when the flag is off;
  otherwise renders children. Same shape as `GameGate`.
- **Route:** lazy `SpaceInvadersGame` at `game/space-invaders` in `App.tsx`,
  wrapped in `<Suspense>` + `<SpaceInvadersGate>`, mirroring the existing
  `game` route for Block Party.
- **App Store catalog:** add a Space Invaders entry to the App Store page so it
  surfaces next to Block Party. (Exact catalog location confirmed during
  implementation — App Store page renders the game list.)
- **`.env.example`:** document `VITE_ENABLE_SPACE_INVADERS=false`.

## Testing (TDD)

Engine reducer is developed **test-first**. Coverage:

- Formation horizontal stepping, edge detection, drop-and-reverse.
- Speed-up curve as `aliveCount` decreases (cadence monotonic).
- Player-bullet vs alien collision → alien removed, score added, bullet freed.
- One-bullet-in-flight constraint (fire ignored while a bullet is live).
- Alien-bullet vs player collision → life lost, respawn/invuln window.
- Lose conditions: lives = 0, and alien-reaches-baseline.
- Wave clear → new wave spawns lower + faster.
- Seeded alien-fire determinism: same seed + input sequence → identical state
  (golden-vector style, like Block Party's corpus test).

React shell gets a **light RTL smoke test**: renders without crashing, a keydown
moves the cannon (observable via an exposed test hook or the HUD), and the
game-over overlay appears on a terminal state. **No canvas pixel testing.**

Local test discipline (per repo norms): run vitest one file at a time via the
bounded self-killing wrapper; use `npm run build` for type-checking (`tsc
--noEmit` is a no-op here). Fresh worktree needs `cd frontend && npm ci`.

## Isolation / Collision Safety

100% net-new files under `frontend/src/games/space-invaders/`, one new lazy page,
one new gate, plus a new flag and two small edits (`App.tsx` route, App Store
catalog entry, `.env.example`). **No backend, no realm, no DB, no shared
component rewrites.** Cannot conflict with the five active worktrees (feed-rich-
text, chunk-error-recovery, sig-verified, perf-be, perf-fe) or the open feature
PRs.

## Deliverable

PR from `feat/store-space-invaders` → main: Space Invaders playable behind
`VITE_ENABLE_SPACE_INVADERS`, dark, flag OFF by default, engine TDD-covered,
keyboard + touch, listed (dark) in the App Store. Enabling the flag is a separate
owner action.
