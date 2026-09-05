# Block Party v1 — Gameplay fairness and deterministic compatibility

Date: 2026-09-04
Scope: ranked move budgets, scoring reachability, modifier balance, TypeScript/Go parity, and replay compatibility

## Outcome

The current `DerivePar` range of 1000–2999 is not a valid target for the ranked game as shipped.

- Standard has 30 accepted moves and an absolute score ceiling of **640**.
- Rush has 24 accepted moves and an absolute score ceiling of **360**.
- Doubles has 30 accepted moves and an absolute score ceiling of **1280**, but that assumes every one of 32 deterministic spawns is the maximum-value tile and that every abstract merge can be realized on the board.
- A tighter ceiling using each seed's actual spawn values was below the legacy par for every one of the first 1,000,000 seeds. The observed maxima were 336 Standard, 672 Doubles, and 296 Rush.

No scoring, RNG, move-budget, replay, hash, challenge, or stored-score semantic was changed in this lane. That is deliberate: the current wire/storage model has no ruleset version, so a silent rule change could make clients and the authoritative replay disagree during a rollout.

The v1-safe action is to stop presenting a mathematically impossible legacy par as an attainable goal. `seedScoreCeiling` (TypeScript) and `blockparty.SeedScoreCeiling` (Go) now provide a deterministic guard. A target-formula change should start on a UTC day boundary and be versioned or otherwise deployed atomically only after product approval.

## Verified rules baseline

### State and scoring

- The board is 4×4 and row-major.
- A run starts with two spawned tiles.
- An accepted move slides all four lines, merges equal adjacent values once, adds the resulting merged value to score, and spawns one tile.
- A no-op consumes no RNG, increments no move count, and creates no log entry in the client. The submission handler also rejects no-op entries.
- Standard and Rush spawn 2 with 90% of value draws and 4 with 10%. Doubles multiplies those spawn values to 4 and 8. Rush does not change engine scoring or spawn behavior; its gameplay distinction is the shorter budget.
- Each successful spawn consumes exactly two Mulberry32 draws: position, then value. Consequently the sequence of tile values depends only on seed, modifier, and accepted-move count—not on move direction.
- Ranked budgets are server-authoritative: 30 for Standard/Doubles and 24 for Rush. The client counts the same successful moves that it logs.

### Replay boundary

- The service accepts only `U`, `R`, `D`, `L`, caps the log, checks the modifier budget, rejects no-ops, and derives score from a Go replay. It never trusts a client-supplied score.
- The engine itself is budget-agnostic; long Practice replays and test vectors remain valid.
- Invalid move strings are outside the engine's typed contract. The submission parser rejects them before engine entry.
- First-write-wins submission and public deterministic seeds mean “Ranked” is a common-puzzle leaderboard, not a cryptographically enforced one-attempt mode. A player can rehearse or solve a public seed before submitting. Product copy should not imply a single blind attempt.

## Reachability proof

Let `M` be the number of accepted moves and `N = M + 2` the number of spawned source tiles. Let `V` be the largest possible spawn (4 normally, 8 in Doubles).

At merge level `k`, no more than `floor(N / 2^k)` disjoint groups can reach that level. Each such merge contributes `V × 2^k`. Therefore:

```text
ceiling(N, V) = Σ(k ≥ 1, 2^k ≤ N) floor(N / 2^k) × V × 2^k
```

This deliberately ignores board geometry, move sequencing, and the 10% maximum-tile probability, all of which can only reduce the result.

| Modifier | Moves | Source tiles | Max spawn | Absolute ceiling | Legacy par |
|---|---:|---:|---:|---:|---:|
| Standard | 30 | 32 | 4 | 640 | 1000–2999 |
| Doubles | 30 | 32 | 8 | 1280 | 1000–2999 |
| Rush | 24 | 26 | 4 | 360 | 1000–2999 |

Thus every Standard and Rush legacy par is impossible. For Doubles, 1719 of the 2000 possible par values (1281–2999) exceed even the all-maximum-spawn bound. The remaining values are only nominally inside that loose bound.

`SeedScoreCeiling` tightens the proof by replaying only the deterministic value draws and abstractly merging the resulting multiset. It still ignores geometry, so a par above it is conclusively impossible; a par below it is not necessarily attainable.

## Deterministic calibration evidence

### Seed-specific upper-bound sweep

Command:

```sh
cd backend
BLOCKPARTY_CALIBRATE=1 GOCACHE=/tmp/memba-blockparty-go-cache \
  go test ./internal/blockparty -run TestCurrentParReachabilitySweep -v -count=1
```

Seeds were integers 0 through 999,999, with the production modifier and legacy par derivations.

| Modifier | Seeds | Seed-ceiling min | Median | Max | Legacy par within ceiling |
|---|---:|---:|---:|---:|---:|
| Standard | 333,334 | 312 | 316 | 336 | 0 (0.0000%) |
| Doubles | 333,333 | 624 | 632 | 672 | 0 (0.0000%) |
| Rush | 333,333 | 176 | 180 | 296 | 0 (0.0000%) |

This is exhaustive for the stated million-seed sample, not a proof over all 2^32 seeds. The absolute bounds above are the proof for Standard and Rush.

### Seed-aware reachable lower-bound sweep

Command:

```sh
cd backend
BLOCKPARTY_CALIBRATE=1 GOCACHE=/tmp/memba-blockparty-go-cache \
  go test ./internal/blockparty/engine -run TestCalibrationSweep -v -count=1
```

The deterministic width-96 beam sees the public RNG state, explores legal moves, and optimizes score with board-space/corner tie-breakers. It is a reproducible strong-solver lower bound: every reported score is reachable, but the solver does not prove optimality or model novice play.

| Modifier | Seeds | Min | P10 | P25 | Median | P75 | P90 | Max | Mean |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Standard | 2,048 | 196 | 196 | 200 | 216 | 244 | 308 | 316 | 227.7 |
| Doubles | 2,048 | 392 | 392 | 400 | 432 | 488 | 616 | 632 | 455.4 |
| Rush | 2,048 | 160 | 172 | 172 | 172 | 176 | 176 | 220 | 172.7 |

Doubles scores are exactly twice Standard for an identical seed and legal move sequence; its separate distribution above uses an independently optimized beam but retains that underlying scale relationship. Rush's 20% budget reduction produces a much larger score reduction around the first 32-tile merge frontier, so it should not reuse Standard's target.

These results support playtest starting bands—not a production percentile claim:

- Standard: 180–220
- Doubles: 360–440
- Rush: 152–176

Human play telemetry should determine the final target percentile. The solver results must not be labeled “average player” or “par” without that validation.

## TypeScript/Go parity and golden vectors

Verified parity mechanisms:

- Both ports use integer-only slide/merge logic and matching row/column traversal.
- Both ports use wrapping uint32 Mulberry32 operations and consume RNG in the same places.
- Both return unchanged state on a no-op (identity in TypeScript, `changed=false` in Go).
- Six committed game vectors cover all modifiers, short and long replays, boards, scores, RNG call counts, and game-over state.
- Committed PRNG vectors cover the raw generator.
- A 500-game differential corpus generated by the TypeScript port is replayed by the Go port.
- `parity-assets.test.ts` now fails if the duplicated frontend/backend golden-vector files differ byte-for-byte; previously each port could pass against a different copy.
- Seed-ceiling golden cases now run in both languages, including seed 0 and `uint32` max.

Remaining gap: corpus regeneration is intentionally opt-in and writes only the backend corpus. Any gameplay change must regenerate the corpus, review the diff, and run both language suites. There is no on-wire ruleset version to allow two semantics to coexist.

## Compatibility decision

### Safe now

- Use `seedScoreCeiling(seed, modifier, moveBudget)` in the frontend to detect and suppress/relabel an impossible target.
- Use `blockparty.SeedScoreCeiling(seed, modifier)` in Go for diagnostics or a server-side safety assertion. It derives the authoritative budget internally.
- Keep existing score, board hash, move log, RNG, and replay semantics unchanged.

### Unsafe without a coordinated migration

- Changing merge scoring, spawn odds, budgets, modifier behavior, or RNG consumption.
- Reinterpreting a cached challenge or in-progress run during a deploy.
- Replacing stored par values for already-materialized challenges without a clear compatibility/product policy.
- Advertising a target as population-calibrated before real completion-score telemetry exists.

### Recommended integration sequence

1. Presentation-only v1 guard: when `par > seedScoreCeiling(...)`, label it “Target calibration pending” and remove “± vs par” claims. Do not substitute the ceiling itself; an upper bound is not a fair target.
2. Product approval: choose a target percentile using human playtests/telemetry. Use the bands above only as starting hypotheses.
3. Compatibility: add an explicit target/ruleset version to the challenge contract or guarantee an atomic client/server release at a documented UTC boundary. Persist the formula/version with new challenges.
4. Rollout: do not rewrite historical scores or replay semantics. Existing materialized challenge rows retain their stored legacy par for audit history, while the UI can identify that legacy target as uncalibrated.
5. Monitoring: compare completion distributions by modifier and adjust only through a new version/day boundary.

## Focused verification

Passing on 2026-09-04:

```text
frontend: npm test -- --run src/game/engine
10 files passed, 1 opt-in file skipped; 48 tests passed, 1 skipped

backend: GOCACHE=/tmp/memba-blockparty-go-cache \
  go test ./internal/blockparty ./internal/blockparty/engine
both packages passed

corpus: regenerated the 500-game TypeScript differential corpus with
GEN_CORPUS=1; committed file remained byte-identical; Go corpus and game-vector
replays passed uncached

git diff --check
passed
```

The calibration sweeps above also passed. The Go cache was redirected because the workspace sandbox cannot write the default user cache; this is an environment constraint, not a product-test failure.
