# Block Party — Design Spec

- **Status:** Design approved (brainstorm complete) — pending user review before implementation planning
- **Date:** 2026-07-06
- **Branch:** `feat/block-party-game` (isolated worktree; ships dark behind `VITE_ENABLE_GAME=false`)
- **Author:** brainstormed with a 4-lens expert panel (game design, game engineering, web3/on-chain, mobile UX + growth)

---

## 1. Summary

**Block Party** is a small, self-contained daily puzzle game embedded in Memba. It is a
2048-style merge game where **everyone in the world plays the same board today**, the board is
derived from an **unpredictable Gno block** (verifiably not hand-picked by us), and anyone can play
**instantly with no wallet**. Connecting a wallet is a pure bonus layer: your server-verified score
joins the public daily leaderboard and your streak syncs across devices.

The "Wordle model" (one shared daily challenge + a spoiler-safe share) delivers all three product goals
at once:

- **On-chain showcase** — today's board provenance is a public, independently-verifiable function of a Gno block.
- **Viral growth** — "same board for everyone, here's my run, beat me" is inherently shareable.
- **Daily retention** — one board/day, a rotating daily rule, and streaks give a reason to return every morning.

### Design goals
- Genuinely addictive, great UX, native to Memba's dark "Kodera" design system.
- Works on **mobile web and desktop**; **no wallet required** to play/share/streak.
- **Simple, low-cost, low-maintenance** — no per-play gas, no heavy infra, no ongoing balance treadmill.
- Built **on the side** in an isolated branch; zero conflict with in-flight work.

### Non-goals (v1 — YAGNI)
- No on-chain **score** writes / gas per play (Phase 2).
- No XP/badge rewards (Phase 3).
- No rendered image share card (Phase 2 polish — text share ships first).
- No all-time leaderboard, no multiplayer, no matchmaking.
- **Not bot-proof.** A seed-knowing solver can compute an optimal run; this is inherent to a public
  deterministic seed and is explicitly accepted (see §7).

---

## 2. Decisions locked during brainstorm

| # | Decision | Choice |
|---|----------|--------|
| D1 | Game genre | 2048-style merge ("blocks") |
| D2 | Name | **Block Party** |
| D3 | Chain role in v1 | Seed provenance only — **no gas, no per-play tx** |
| D4 | Tiles | Block-themed; milestone tiles (128/512/2048) get a glyph + rank label echoing Memba XP tiers |
| D5 | Anti-cheat | Server-side replay verification (score = replay output) |
| D6 | Loop | **Hybrid** — ranked daily = tight ~30-move puzzle w/ peek-ahead; Practice = classic endless 2048 |
| D7 | On-chain showcase level | Robust off-chain derivation **+ a read-only seed realm** (`qeval`, no gas) — **gated on a feasibility spike** (§6.4), with off-chain-only as the fallback |
| D8 | Marketing claim | "Verifiably un-rigged daily board from an unpredictable Gno block." **Never** "provably fair" / "cheat-proof" / "trustless leaderboard" in v1 |

---

## 3. Game design

### 3.1 Modes
- **Daily (ranked):** the shared board for today's UTC date. **Exactly one ranked run per player per day.**
  A **fixed move budget (~30 moves)** with a **1–2 tile peek-ahead queue** (you see the next tile(s) but
  not the whole sequence). ~90-second session. Score is measured against a **par** and reported as a
  **percentile + rank tier** ("beat 87% today · S-rank"), not as a bare number.
- **Practice (unranked):** classic **endless-until-stuck** 2048 on a *random* (non-daily) seed, unlimited plays.
  This is the onboarding/mastery surface and never consumes the daily run.

### 3.2 Core rules (both modes)
Standard 2048: slide all tiles in the swiped direction; equal adjacent blocks merge and sum; a tile that
merged this move cannot merge again this move; one new tile spawns after any move that **changed the board**
(no spawn on a no-op move); score increases by the value of each merged tile. Values are powers of two,
rendered as glowing "blocks" with the number in JetBrains Mono.

Differences by mode: Daily has the move budget + peek-ahead + a **daily modifier**; Practice is endless with
full randomness and no modifier.

### 3.3 Daily modifier
The same seed also selects **one rotating rule** for the day (cheap `switch`), surfaced in the UI and in the
share ("today: Doubles Day"). Small starter set (3–5), e.g.:
- **Standard** — no twist.
- **Doubles Day** — all spawns are one tier higher.
- **Frozen Block** — one randomly-placed tile is immovable for the run.
- **Locked Axis** — one axis (H or V) is disabled for N moves.
- **Rush** — smaller move budget (e.g. 24).

Modifiers must be part of the deterministic engine spec (§5) so replay/verification stays exact.

### 3.4 Scoring, par, tiers
- Raw score = sum of merges (integer).
- **Par** = a reference score for the day (v1: a fixed target derived from the seed, or a rolling median once
  there's data; start with a seed-derived heuristic target and refine). Result headline = **percentile** among
  today's submitters + a **rank tier** (Initiate → … → Gno Guardian) mapped from percentile/par. Percentile scales
  gracefully at any player count and reads well even at rank #4,000.

### 3.5 Streaks
- **localStorage streak** for guests (cosmetic; never feeds the server streak).
- **Server streak** for wallet-connected players, tied to verified daily submissions.
- **1 streak-freeze per week** — a single missed day doesn't nuke a long streak (the #1 silent churn driver).
- **Daily leaderboard reset** + a **rolling 7-day board**. Never a single frozen all-time board.

### 3.6 Ghost replay
After finishing the daily, the player can watch a compressed replay of the day's **top public run** (and/or
their own). Free — we already store move logs for anti-cheat.

### 3.7 Share (viral loop)
- **Text share via Web Share API** (native sheet on mobile) + clipboard fallback with a "Copied!" toast.
- Content encodes the *run*, not just a number: a **4×4 emoji mini-grid of the final board** (tile tiers →
  distinct glyphs), the **percentile/tier**, the **modifier name**, the **streak**, and a **deep link to today's board**.
  Hook on **line 1** (survives link-unfurl truncation): `Block Party #123 · beat me · <url>`.
- Share is **never gated behind a wallet**.
- **Spoiler-safe:** never include the optimal line or full spawn sequence.
- Rendered OG/canvas image card = Phase 2 (better unfurls on Twitter/Discord); text is 90% of the value at 10% of the cost.

---

## 4. Architecture

### 4.1 Frontend (`frontend/src/`)
Isolation-first: the game **engine is pure TypeScript with no React/DOM**, so it can be unit-tested exhaustively
and mirrored 1:1 in Go (and later Gno).

```
game/
  engine/
    prng.ts        // mulberry32 seeded RNG (u32, Math.imul) — see §5
    board.ts       // rules: spawn, move, merge, score, gameOver, modifiers
    replay.ts      // pure: (seed, modifier, moveLog) -> { finalBoard, score, rngCallCount }
    types.ts       // Board=[16]uint, Move='U'|'D'|'L'|'R', Modifier enum, Result object
    index.ts
  hooks/
    useDailyChallenge.ts  // fetch {date, seed, blockHeight, blockHash, modifier, par}
    useGame.ts            // state machine over engine (start, applyMove, gameOver, restart)
    useSwipe.ts           // Pointer Events, axis-locked, board-owns-touch (see §8)
    useKeyboard.ts        // arrow keys
  components/
    Board.tsx  Tile.tsx  ScoreBar.tsx  PeekQueue.tsx  ModifierBadge.tsx
    GameOverSheet.tsx  ResultShareCard.tsx  DailyLeaderboardPanel.tsx
    StreakBadge.tsx  GhostReplay.tsx  VerifyProvenanceButton.tsx  HowToPlayHint.tsx
lib/
  gameApi.ts       // ConnectRPC: GetDailyChallenge, SubmitScore, GetDailyLeaderboard, GetStreak
pages/
  GamePage.tsx     // lazy route, layout
components/ui/
  GameGate.tsx     // copy of NftGate — gates on VITE_ENABLE_GAME
```
Route added to `App.tsx` as a lazy import; `config.ts` gains `isGameEnabled()` in the `VITE_ENABLE_*` block.

### 4.2 Backend (`backend/`)
- New ConnectRPC methods (proto in `api/memba/v1/`): `GetDailyChallenge`, `SubmitScore`, `GetDailyLeaderboard`, `GetStreak`.
- **Go replay verifier** — a byte-for-byte port of `engine/` (`internal/game/`), the single source of truth for a
  submitted score. Shares golden vectors with the TS engine (§9).
- **Daily challenge service** — derives + **immutably caches** `{date, blockHeight, blockHash, seed, modifier, par}`
  once per day (§6). Durable store so testnet resets can't lose history.
- Data model (SQLite/existing store): `daily_challenges`, `daily_scores`, `streaks` (see §10).
- Reuses existing Adena challenge-response auth middleware.

### 4.3 On-chain (Phase-1 stretch, spike-gated — §6.4)
- Tiny **immutable, read-only Gno realm** exposing `DailySeed(date) string` (and/or `DailyChallenge(date)`),
  queried via `qeval` (no gas, no tx). Makes "the seed is defined on Gno" literally true and becomes the
  skeleton for the Phase-2 on-chain leaderboard realm. Uses current interrealm-v2 / test13 conventions and is
  `gno lint`-gated like the rest of Memba.

---

## 5. Determinism specification (load-bearing — locks Go/Gno parity)

Score is a **pure function of `(seed, modifier, moveLog)`**. The same function must produce byte-identical
results in **TypeScript, Go, and (later) Gno**. These invariants are frozen and enforced by golden vectors +
cross-language differential fuzzing.

1. **PRNG = mulberry32.** State is `uint32`. In JS: keep state as a `number`, apply `>>> 0` after every op, and
   use **`Math.imul`** for the 32-bit multiply (never `*`). In Go/Gno: native `uint32` wrapping arithmetic.
   A separate `prng_vectors.json` pins the first 100 outputs for a fixed seed.
2. **All-integer engine.** No floats anywhere — not for probabilities, not for scoring, not for position.
   Spawn value: `rng() % 10 == 0 ? 4 : 2` (or the chosen ratio). Spawn position: `emptyCells[rng() % len]`.
3. **Bounded draws use `rng() % n`** (not multiply-shift) to avoid any 64-bit dependency.
4. **Row-major everywhere.** Board is a flat `[16]` indexed `0..15`, top-left origin. Empty-cell enumeration is
   strictly ascending index order in **all** languages.
5. **RNG-call order is pinned:** initial two spawns before any move (position then value each); per move, **only
   if the move changed the board**, draw position then value for the single new tile. **No RNG consumed and no
   spawn on a no-op move.**
6. **Merge sweep is pinned:** per direction, tiles resolve toward the swipe direction, farthest cell first; a
   tile may merge at most once per move. Canonical check: `[2,2,2,2]` swiped left → `[4,4,0,0]`.
7. **Score type** is 64-bit-safe (JS `number` ≤ 2^53, Go `int64`) — unreachable overflow in a 4×4/30-move game,
   but the type is pinned so a fuzzer can't find a divergence.
8. **Modifiers are part of the pure function** — each modifier's effect on spawns/moves/budget is specified and
   fuzzed.

Board serialization for vectors: flat `[16]` of literal tile values, row-major.

---

## 6. Seed derivation & provenance

### 6.1 Derivation (pure function of public chain data — zero backend discretion)
- **Block selection:** the block whose **on-chain block timestamp** is the first `≥ 00:00:00 UTC` for date `D`.
  Selection uses the block's own timestamp (in-chain fact), **not** the backend's wall-clock — so anyone can
  reproduce the exact height from a public node.
- **Seed:** `seed = SHA256(blockHash ‖ "blockparty:" ‖ D)` (domain-separated), reduced to the engine's integer
  width. The **modifier** and **par** are derived from `seed` deterministically.
- **UTC date string `YYYY-MM-DD`** is the single shared boundary primitive across client, seed derivation, and
  submission validation (prevents off-by-one at the day boundary).

### 6.2 Robustness (survives the failure modes the panel flagged)
- **Immutable cache:** once `{D, height, hash, seed, modifier, par}` is derived it is **persisted and never
  re-derived** — so a **reorg** cannot mutate a live day's board, and a **testnet reset** cannot lose history.
- **Chain-halt / RPC-lag / not-yet-mined:** if today's qualifying block doesn't exist yet, `GetDailyChallenge`
  returns "not ready" and the client shows a graceful "today's board mints shortly" state; once cached it's stable.
- **Client resilience:** the fetched challenge is cached in `localStorage`; the game reuses the resilient RPC
  fallback layer already in the app.

### 6.3 Independent verifiability (this is what makes the claim honest)
- Ship a **public verification script + README** and an in-app **"Verify" button**: given `D`, re-select the
  height from a **public Gno RPC**, fetch `/block?height=H`, and recompute `seed = SHA256(hash ‖ "blockparty:" ‖ D)`.
  A skeptic gets our exact seed — proving the board was not hand-picked.
- The API's `blockHash` field is a *convenience*; the source of truth is the public node. The Verify path
  re-fetches rather than trusting our field.
- **Copy:** advertise *"a verifiably un-rigged daily board derived from an unpredictable Gno block."* Do **not**
  say "provably fair," "cheat-proof," or imply the leaderboard is trustless.

### 6.4 Read-only seed realm — feasibility SPIKE (blocks D7)
Before committing to the on-chain seed realm, a spike must confirm: **can a Gno realm read a historical block's
hash** (needed for `DailySeed(pastDate)`), or only current context? If realms can only see the current block, the
on-chain function may be "today-only" — which reshapes (but doesn't kill) the realm design.
- **Spike pass →** deploy the immutable read-only realm; the in-app Verify can additionally `qeval` the realm and
  show "seed computed on-chain."
- **Spike fail →** fall back to §6.1–6.3 off-chain derivation only (a strict subset; no rework). Still honest and
  chain-anchored; the realm returns in Phase 2 in whatever form the spike allows.

---

## 7. Anti-cheat & submission protocol

### 7.1 What server replay does — and doesn't
- **Score = server replay output.** The client's `claimedScore` is dropped from the trusted path (at most an
  early-fail hint). The Go verifier re-simulates `(seed, modifier, moveLog)` and that result is authoritative.
- **Replay validates *legality*, not *effort*.** Because the seed is public and deterministic, an offline solver
  can compute a near-optimal `moveLog` and submit it; replay will accept it as legal. **This is unpreventable in
  v1 and is accepted.** Mitigations (not fixes): percentile/streak-weighted ranking so the top isn't a
  raw-score whale wall, and a **nullable `verificationStatus`** column so bot/inhuman-speed detection can bolt on
  before any value (Phase 3 XP) is attached.

### 7.2 Submission
- Schema: **`{version, date, moveLog, signature}` only.** Client never sends board or RNG state.
- **Signature** binds to the submission: sign over `hash(date ‖ moveLog)` with a **single-use** challenge nonce
  (not a reusable session token) → no signature replay.
- Server checks, **in order**: (1) `date == today (UTC)`; (2) auth signature valid **before** running replay
  (so anonymous floods can't burn CPU); (3) **one submission per (address, date)** — bounded, first-write or
  best-of; (4) `moveLog` length ≤ **4096** and contains **no no-op moves** (a no-op is never useful → reject the
  whole submission; kills the pad-with-noops replay-CPU DoS); (5) per-address/IP rate limit; (6) HTTP body cap (~16 KB).
- `moveLog` is a terse encoding (2 bits/move; 4096 moves ≈ 1 KB packed). Replay is O(moves × 16) — microseconds.

---

## 8. Mobile / UX / accessibility requirements

### 8.1 Touch (make-or-break on mobile web)
- Board element: **`touch-action: none`** (kills native scroll/pinch/double-tap-zoom *within the board* only),
  **`overscroll-behavior: none`** (kills iOS rubber-banding + pull-to-refresh), `user-select: none`,
  `-webkit-touch-callout: none`.
- **Axis-locked Pointer-Events swipe:** `preventDefault()` on `touchmove` inside the board; threshold ~24px;
  lock to the dominant axis once past threshold. Prefer per-element `touch-action` over a global
  `user-scalable=no` (keep pinch-zoom elsewhere for a11y).
- **Guard the iOS edge-back-swipe:** keep the board off the extreme left edge (margin), never flush to `x=0`.
- **Haptic on merge** (`navigator.vibrate(10)` where supported).

### 8.2 First session (anti-bounce)
- **Board-first render** — no wallet check, spinner, or modal before the board.
- **Persistent header:** `Block Party #123 · today's board · N playing` — the "daily" framing is the hook.
- **Zero-modal how-to:** an animated **ghost-swipe hint** on the board that fades on first input + a one-line
  caption. First move teaches the rest.
- **Above the fold, one-thumb:** on 375×667 the grid + score + share fit without scrolling; **safe-area insets**
  (`env(safe-area-inset-*)`) on top score and bottom action bar.

### 8.3 Wallet framing (mobile-majority-friendly)
- Default (guest) state is **complete, not lacking**: score + local best + local streak + share all work.
- **Capability-detect Adena** (absent in most mobile browsers). If missing, show
  "Leaderboard needs the Adena extension — your score is saved, post it later" (optionally a desktop deep-link/QR),
  **never** a broken Connect button.
- Show the Connect CTA **after** a finished run (motivation peak), framed as *"claim your spot on the public board,"*
  never as a gate.

### 8.4 Accessibility
- **Colorblind/luminance-safe tiers:** tile identity readable from **number + brightness ramp + milestone label**,
  never hue alone.
- **AA number contrast (4.5:1)** against the glowing block bg — bloom often drops contrast; add a solid number
  chip/text-shadow if needed.
- **`prefers-reduced-motion`:** cut slide/merge/glow animations to instant/opacity-only; fully playable without motion.
- **Keyboard:** focus lands on the board on load; visible `:focus-visible` ring; Share/Connect Tab-reachable; tap targets ≥ 44×44.
- **Screen reader:** board as an ARIA grid or an `aria-live="polite"` region announcing "merged to 512, score 4,102".

---

## 9. Testing strategy

- **Engine unit tests (TS):** merge/score/gameOver correctness, PRNG determinism, `replay(seed,mod,log) == score`,
  each modifier, edge boards (`[2,2,2,2]` each direction, full-but-mergeable, single legal move, empty log, max log).
- **Golden vectors** (`vectors.json`, checked in, consumed by **both** TS and Go suites): each vector =
  `{seed, modifier, moveLog, expectedFinalBoard[16], expectedScore, expectedRngCallCount}`. `expectedRngCallCount`
  catches "spawned on a no-op" / "value-before-position" divergences a matching score would hide. Plus a
  `prng_vectors.json` for the RNG in isolation.
- **Cross-language differential fuzzing (the real guarantee):** a CI harness generates random `(seed, modifier,
  legal moveLog)`, runs the TS engine (node) **and** the Go verifier, and asserts identical
  `(finalBoard, score, rngCallCount)` over thousands of games.
- **Property tests:** tile "mass" changes only by spawns; score == sum of merges; no-op ⇒ board unchanged;
  full board with no merges ⇒ game over; replay idempotent.
- **Backend:** submission validation (date guard, one-per-day, no-op rejection, length cap, sig binding, auth-before-replay), rate limiting.
- **Frontend component + one E2E happy-path** (scripted keyboard daily → submit → appears on board) behind the flag.
- **CI gate:** both engines' vector tests + the differential fuzzer are required on any PR touching either engine;
  `vectors.json` is a pinned review artifact (nobody silently regenerates it). Mirrors the existing multisig
  golden-parity discipline.

---

## 10. Data model & result object

### 10.1 Versioned result object (the Phase-2 broadcast / Phase-3 attestation payload — defined now)
```
BlockPartyResult {
  version: 1
  date: "YYYY-MM-DD"        // UTC
  seed: string              // derived per §6
  blockHeight: uint64
  address: string           // Gno bech32 — canonical player key (nullable slot for guests)
  score: uint64             // authoritative = server replay output
  moveLog: string           // terse encoding, replayable
  boardHashFinal: string    // anchor for streaming/partial models later
  verificationStatus: enum? // nullable; reserved for bot-detection before Phase-3 value
}
```

### 10.2 Backend tables
- `daily_challenges(date PK, block_height, block_hash, seed, modifier, par, created_at)` — immutable once written.
- `daily_scores(date, address, score, move_log, board_hash_final, verification_status, created_at, UNIQUE(date,address))`.
- `streaks(address PK, current, longest, last_played_date, freezes_remaining, week_anchor)`.

### 10.3 Identity
- **Gno bech32 address is the canonical player key from day one.** Guests get a server pseudonym mapped to a
  **nullable address slot** so a later wallet connect claims their history with no identity migration/merge mess.
  Reuse Memba's existing Adena identity conventions — no parallel identity system.

---

## 11. Rollout & phases

- **Feature flag:** `VITE_ENABLE_GAME=false` initially; `GameGate` (copy of `NftGate`) wraps the route; backend
  methods gated too. Ships dark; flip when ready.
- **Phase 1 (this spec):** daily + practice, off-chain robust seed + Verify, backend leaderboard + streaks, share,
  a11y. Read-only seed realm **if** the §6.4 spike passes.
- **Phase 2:** on-chain **score** leaderboard realm (connected users broadcast the versioned result; small gas),
  rendered OG/canvas share card.
- **Phase 3:** XP/badges via Memba's **existing on-chain quest-attestation flow** (reuse, don't rebuild); at this
  point bot/inhuman-run detection (`verificationStatus`) must be live because rank now carries value.

---

## 12. Open risks / must-verify

1. **§6.4 Gno realm block-hash read access** — spike blocks the on-chain seed realm (fallback defined; no rework).
2. **TS↔Go(↔Gno) determinism** — the top implementation risk; fully mitigated by §5 discipline + §9 differential
   fuzzing. This is the one thing that, if skipped, forces a Phase-2 rewrite.
3. **Par calibration** — v1 seed-derived heuristic may be rough until there's a submission distribution; refine to
   a rolling median. Percentile framing makes this low-stakes.
4. **Bot leaderboard** — accepted, not solved; percentile/streak weighting + `verificationStatus` contain it.
5. **Adena on mobile** — most mobile users can't connect; §8.3 ensures they're first-class regardless.

---

## 13. Build isolation

All work on `feat/block-party-game` in a dedicated worktree off `main`; never touches the active parallel branches
(`feat/w72-feed-thread-view`, `fix/chunk-error-auto-recovery`, `fix/per-signature-verified-flag`). Frontend is a
standalone npm package (`cd frontend && npm ci` in a fresh worktree). Ships dark behind `VITE_ENABLE_GAME`.
