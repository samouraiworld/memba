# Block Party: beta-to-v1 audit and weekend plan

**Audit date:** 2026-09-04

**Integration branch:** `feat/block-party-v1`

**Base:** local `main` at `ae16e8e2386f52939fd067c557c5a36897223399`

**Isolated worktree:** `/Users/zxxma/Desktop/Code/Gno/Memba-worktrees/block-party-v1`

## Executive verdict

Block Party has a credible deterministic game and an unusually strong server-authoritative replay boundary, but the public Daily product is not currently available and the UI hides part of that failure. It is a beta, not a v1.

At 2026-09-04 19:26 UTC the public Pearl route rendered “Couldn't load today's challenge” while its leaderboard rendered “No scores yet today — be first.” A direct request to the same public backend returned HTTP 501 with Connect code `unimplemented` and message `block party is disabled`. The code and operations documentation explain the mismatch: Netlify has enabled the frontend `VITE_ENABLE_GAME` route while Fly's total kill switch `BLOCKPARTY_ENABLED` is off. Enabling the backend is an owner-controlled production action and is intentionally outside this branch.

The weekend slice therefore focuses on truthful degradation, recoverable local play, competitive calibration without replay breakage, a distinctive accessible shell, and stronger local verification. Production activation, data purges, schema/proto changes, attestation claims, deployment, and chain actions remain owner gates.

## Pre-change evidence and classification

This table is the audit snapshot of the base commit before the weekend changes. It is retained to show why the v1 scope was selected; the current branch outcome is recorded immediately after it.

Status vocabulary used below:

- **Verified:** implementation and an executable test, public response, or direct source contract agree.
- **Defective:** the capability exists, but a concrete failure was reproduced or proven from source.
- **Plumbing:** code or storage exists without a complete user-visible lifecycle.
- **Missing:** no credible implementation was found.
- **Owner-blocked:** code cannot safely complete the outcome without configuration, infrastructure, credentials, or product authority.

| Area | Status | Evidence and v1 consequence |
| --- | --- | --- |
| Public Daily | **Owner-blocked** | Pearl `/pearl/game` is public and frontend-enabled; the public `GetDailyChallenge` call returns HTTP 501 `block party is disabled`. Fly must deliberately enable the documented total kill switch after its activation checklist. |
| Practice | **Verified, with defects** | Public Practice renders and accepts input without a wallet. The existing page reads a Practice best, but the pre-v1 lifecycle never writes it. |
| Deterministic engine | **Verified** | Pure TypeScript and Go engines share PRNG/game vectors. `make blockparty-vectors-check` passed from the base commit. Focused Go Block Party/service tests passed with Go 1.26.6. |
| Server replay | **Verified** | `SubmitScore` accepts only an auth token, UTC date, and compact `UDLR` log. It caps length, rejects invalid/no-op moves, enforces the modifier budget, replays from the stored seed, and hashes the final board. |
| Submission semantics | **Defective product contract** | Storage is one row per address/date and `InsertScore` is first-write-wins. A retry after an uncertain response receives `AlreadyExists`; the API does not return the existing authoritative result, and the UI marks an attempt before the request resolves. This is not safely described as best-write or fully idempotent. |
| Seed derivation | **Verified** | Backend selects the first block at/after 00:00 UTC, verifies `/status` and block-header chain identities against one configured chain, hashes `blockHash + "blockparty:" + date`, and immutably stores the challenge. The public verification script is present. |
| Seed provenance in UI | **Defective** | The response carries height/hash but no seed-chain identity. The page labels proof with the currently selected frontend network even though backend seeding is globally configured. Until the proto/schema contract changes, UI must not claim that selected network as provenance. |
| Challenge caching | **Defective** | The base React Query key is global and the local cache write is unguarded. Cached challenges are not validated or scoped by selected network/configured seed source, and the cache was not used for recovery. |
| Leaderboard | **Defective** | The base panel maps request failure and missing data to the same empty-state copy. A dependency outage is therefore presented as a legitimate empty field. Cache key includes date but not network/source. |
| Streaks | **Verified backend, defective fallback** | SQLite streak/freeze logic and RPC exist. The UI collapses remote failure toward a local/zero presentation, while a guest share can omit the local streak. |
| Par | **Defective** | Base `DerivePar` yields roughly 1000–2999. A Standard run has 30 legal moves and begins with two tiles, so at most 32 spawned/starting tiles exist; even an optimistic consolidation of all value-4 tiles yields only 640 merge points. Rush has 24 moves and a still lower ceiling. Existing UI “vs par” copy is structurally misleading for those modes. |
| Modifiers and budgets | **Verified** | Standard/Doubles use 30 legal moves and Rush 24; Go is authoritative for submission. Any semantic change must preserve or version replay compatibility. |
| Ranked attempt policy | **Partly implemented** | Backend enforces one authenticated submission per UTC date, first-write-wins. Guest reloads and local replays are not a secure one-attempt boundary. UI must state what is actually enforced. |
| Attestation | **Missing for Block Party** | No Block Party score-to-attestation lifecycle was found. Generic/other-game arcade attestation plumbing must not be presented as a Block Party “on-chain” or “certified” state. |
| Local/offline recovery | **Defective** | Storage reads/writes are brittle, cached challenge fallback is absent in the base, and state recovery does not expose stale/offline distinctions. A stale cached board may support clearly labeled Practice only; it must not silently enter the ranked submission path. |
| Sharing | **Defective** | Share output uses the current pathname rather than a date-stable result/deep link. A later open can resolve to another UTC day; Practice can inherit a blank Daily date. |
| Accessibility | **Partly implemented** | Mode tabs use APG roving focus and arrows on controls are excluded from global gameplay input. The board lacks useful row/column/change context, result focus is unmanaged, and status announcements are too weak. |
| Touch/mobile | **Partly implemented** | Pointer swipe exists, but lacks cancel/capture recovery. The base E2E is desktop-only at 1280×800 and has no 320/390/430 portrait or short-landscape contract. |
| Motion/audio/haptics | **Missing** | The base board is static and has no procedural audio or haptics. Cosmetic feedback must remain outside deterministic state and honor reduced motion/mute. |
| Metadata/discovery | **Partly implemented** | Home Explore and `/game` routing exist behind the frontend flag. The live document title is generic Memba; App Store discovery and date-stable result metadata are incomplete. |
| Observability | **Missing for the daily contract** | No Block Party-specific public synthetic probe or dashboard was found. The generic health endpoint remains healthy while the feature's total kill switch is off. |
| Privacy | **Reasonable base, incomplete telemetry contract** | Share text should never include wallet addresses, auth tokens, raw move logs, or block hashes. No new game telemetry is required for this slice; future analytics must exclude those fields. |
| Security/abuse | **Strong base with policy gaps** | Auth precedes replay, move logs are bounded, no-op padding is rejected, per-address rate limiting exists, and scores are server-derived. Remaining issues are first-write retry semantics, date/reload policy clarity, source-scoped caching, and lack of an explicit duplicate-response contract. |
| IP/trade dress | **Needs ongoing review** | Mechanics are genre-standard, but the public blog and visual framing explicitly use “2048.” v1 art/copy should use original Pearl signal-routing language, geometry, symbols, color, sound, and result composition—not recognizable 2048 tile styling. This is a product review, not legal advice. |

## Final v1 outcome

The branch resolves the code-level Priority A–D defects without crossing the owner-controlled production boundary or changing replay semantics.

| Area | Final branch outcome |
| --- | --- |
| Public truth | Disabled (`unimplemented`), not-ready, generic unavailable, offline, cached, and live states are distinct. Failed reads never masquerade as empty data, and ranked input remains locked without a fresh live challenge. Production remains owner-blocked. |
| Recovery | Validated challenge records are scoped by network/date and capped at 36 hours. A cached board is explicitly unranked and may only be converted to Practice until the live response returns. Storage failures cannot prevent play. |
| Submission | Exact retries of the authoritative score/move log/board hash return success; a different replay returns a definitive first-write conflict. Streak updates are transactional and same-day idempotent. The result UI distinguishes checking, verified, retryable failure, and final conflict. |
| Fairness | The deterministic engine, RNG, score, move budgets, hashes, and stored challenge values are unchanged. A TypeScript/Go seed ceiling suppresses impossible legacy target claims. Million-seed and reproducible beam evidence is documented separately. |
| Practice/guest | Practice best persists monotonically, guest streaks survive and cannot be rewound by old dates, and guest Daily shares are accurately labeled local/unsubmitted rather than Practice. |
| Leaderboard/streak | Loading, successful-empty, failed, and retry states are separate. Cache keys include network scope. Equal scores use deterministic ordering and shared competition rank. |
| Experience | The new Pearl signal-routing shell uses original circuitry/orbit motifs, clear Daily/Practice hierarchy, move-budget/rules/UTC copy, seed disclosure, and a structured result state. It avoids recognizable 2048 colors or tile treatment. |
| Accessibility/mobile | The board exposes rows/cells/coordinates and live summaries; locked boards are semantically disabled; dialogs receive focus. Keyboard, captured/cancel-safe pointer gestures, 44 px targets, light/dark, reduced motion, 320/390/430 portrait, and 667×375 landscape are automated. |
| Sharing/privacy | Result links retain the UTC date while stripping existing query/fragment data. Shared content excludes addresses, tokens, move logs, and block hashes and distinguishes Daily from Practice. |
| Operations | A read-only probe and incident runbook define disabled/not-ready/failure/empty outcomes, provenance checks, immutable-row handling, and owner-only activation/containment. |

Procedural audio and haptics were evaluated but deliberately deferred: the branch has no established mute preference or shared haptic contract, and adding unverified feedback late would weaken rather than complete the accessibility/reduced-motion release gate. Cosmetic motion remains deterministic-state-independent and reduced-motion safe. Block Party-specific attestation, historical results, and production observability remain explicit post-v1/owner work.

### Visual evidence

- `screenshots/block-party-public-before-2026-09-04.png`: unobscured public Pearl failure/false-empty baseline captured on 2026-09-04.
- `screenshots/block-party-v1-after-desktop.png`: final desktop Daily surface with local deterministic API fixture.
- `screenshots/block-party-v1-after-mobile-390.png`: final 390 px surface with local deterministic API fixture; the unrelated global network-health toast was dismissed in the evidence harness, not changed in application code.

## Architecture and state lifecycle

The route is lazy-loaded behind `VITE_ENABLE_GAME`. `BlockPartyGame.tsx` owns mode, auth bridging, network context, Daily/Practice seed selection, and page composition. Game state lives in `useGame` and the pure engine. Daily data, leaderboard, and streak use separate React Query calls, but the base UI does not preserve their distinct error meanings. `GameOverSheet` owns local persistence and authenticated submission. The backend owns the challenge cache, replay, first-write score insert, percentile, leaderboard, and streak storage in SQLite.

The intended ranked path is:

1. Backend resolves UTC date and returns an immutable server-issued challenge.
2. Client initializes the exact issued seed/modifier/budget and records legal moves.
3. Client submits only the move log after authentication.
4. Backend replays every move, derives score and board hash, then performs a first-write insert.
5. Backend returns percentile and streak; leaderboard is a separate read.

The intended degraded path must never cross into step 3. A validated cached challenge can explain or offer a stale Practice replay, but cannot become today's authoritative ranked board without a fresh ready response.

## Competitive calibration decision

Changing the deterministic engine or score function during a live, unversioned daily would silently split client/server replay and existing leaderboard meaning. This weekend therefore preserves engine scoring and seed derivation. Safe calibration consists of:

- deterministic seed sweeps and a documented reachable-score distribution;
- a shared TypeScript/Go par rule only if it affects challenge metadata rather than replay semantics and both languages remain identical;
- updated parity tests for that metadata rule;
- product copy that calls the value a target, explains the move budget, and never overclaims attainability.

If empirical evidence cannot justify a compatible target rule, hide “vs par” for affected modifiers and ship the tooling plus an owner decision record instead.

## Weekend team and exclusive ownership

All work is confined to this worktree. Other Memba sessions are active; no worker may revert another worker, touch the primary checkout, or edit the Space Invaders worktree.

| Lane | Responsibilities | Exclusive ownership |
| --- | --- | --- |
| Integration lead (`/root`) | Product contract, public reproduction, audit/plan, architecture, security/privacy/IP synthesis, `BlockPartyGame.tsx` and `blockparty.css` integration, cross-lane tests, screenshots, Git/release gate, final PR decision | `docs/features/BLOCK_PARTY_V1_AUDIT_2026-09-04.md`, `frontend/src/pages/BlockPartyGame.tsx`, `frontend/src/pages/blockparty.css`, shared-file coordination |
| Gameplay/fairness | Mathematical bounds, simulations, target/par calibration, TypeScript/Go parity and vectors | `frontend/src/game/engine/**`, `backend/internal/blockparty/engine/**`, `backend/internal/blockparty/budget*`, fairness doc/tooling |
| Experience | Original board/components, motion-safe visuals, screen-reader semantics, component-level mobile/accessibility | `frontend/src/game/components/**`, optional new `frontend/src/game/experience/**` |
| Reliability | Daily/cache/persistence/retry/date stability, seed/service correctness, operational diagnostics, Block Party E2E | `frontend/src/game/hooks/**`, `frontend/src/game/lib/**`, Block Party backend service/store/seed files, Block Party E2E, operations doc |

After integration, a separate read-only adversarial pass covered deterministic integrity, correctness, accessibility, responsive behavior, security/privacy, CI compliance, and misleading claims. It found and drove fixes for Daily/Practice share classification, definitive duplicate conflicts, pointer lifecycle, locked-board semantics, and stale documentation. Its final verdict reported no blocking code finding.

## Phased MVP-to-v1 plan

### Weekend slice — truthful, resilient, polished beta

- Distinguish feature-disabled, unavailable, not-ready, offline, cached, loading, empty, and error states.
- Keep unavailable Daily inert and make Practice a deliberate recovery path.
- Guard and validate storage; persist Practice best and guest streak correctly.
- Scope caches by network/source context and make share results date-stable.
- Make submission status and first-write behavior explicit; support safe retry/recovery where the current API permits it.
- Calibrate target/par metadata with deterministic evidence and TypeScript/Go parity, without changing replay/scoring semantics.
- Build an original signal-routing presentation with reduced-motion-safe feedback, robust keyboard/touch input, meaningful board announcements, focus-managed results, and 320 px-safe layout.
- Expand unit/E2E coverage for dependency failure, cached fallback, UTC date stability, keyboard, touch, mobile overflow, and axe.
- Add a non-mutating daily probe/runbook. Do not activate it against production submission.

### v1 activation gate — owner-controlled

- Verify seed RPC and expected chain id together.
- Decide how to handle any pre-Pearl immutable challenge/score/streak rows; the documented purge is destructive and requires owner execution.
- Enable `BLOCKPARTY_ENABLED` on Fly only after challenge, verification-script, leaderboard, logging, and rollback checks pass.
- Confirm the already-enabled frontend route and record a Pearl challenge response with matching public seed proof.
- Add alerting that treats feature-disabled/unimplemented as unhealthy when the public route is enabled.

### Post-v1 product depth

- Version a real replay/attempt contract before any scoring or rule change.
- Add an authenticated personal-result read endpoint and personal leaderboard row so a prior accepted result can be recovered across devices without exposing move logs.
- Add previous-day result recovery and history with explicit retention/privacy rules.
- Add Block Party-specific attestation only through an explicit versioned backend/on-chain design; until then, use “server verified” only.
- Add opt-in reminders and privacy-safe funnel telemetry after consent/retention review.

## Verification and release matrix

The base was fixed before worker edits (`ae16e8e2386f52939fd067c557c5a36897223399`). Public UI/API reproduction and source inspection established the baseline; test counts below are from the final integrated branch, not a concurrent intermediate state.

| Gate | Final evidence |
| --- | --- |
| Frontend unit | `npm test`: **481 files passed, 1 skipped; 4,783 tests passed, 1 skipped**. The jsdom suite emitted its known non-fatal canvas warning. |
| Backend | `go test ./... -count=1` and the pre-push-required `go test -race ./... -count=1`: **all packages passed**, including arcade, attestation, auth, Block Party engine/store/service, DB, indexer, rate limit, and RPC nodes. |
| Determinism | `make blockparty-vectors-check`: **passed**; 500-game cross-language corpus and parity-asset tests are in the suites; verify-worker rebuild produced no diff. |
| Fairness simulation | 1,000,000-seed ceiling sweep and 2,048-seed-per-modifier beam calibration: **passed**. Standard/Doubles/Rush sampled upper-bound maxima were 336/672/296; legacy par was reachable in 0 sampled seeds. |
| Fuzz | Engine replay fuzz: **742,918 executions** in 5 seconds; submission parser fuzz: **38,082 executions** in 6 seconds; no failure. |
| Type/lint/theme/security | `npx tsc --noEmit`, `npm run lint`, exact hardcoded text-color gate, and `npm run audit:ci`: **passed**; no unallowlisted high/critical production advisory. |
| Build/bundle | `npm run build` and `npm run check:bundle`: **passed**. Block Party lazy JS is 30.61 kB (10.22 kB gzip), CSS 23.02 kB (4.65 kB gzip). Main JS is 388 kB, under the 600 kB CI limit; total JS is 4,547 kB and retains the repository's warning-only >3 MB condition. Three.js remains isolated and precache-excluded. |
| Desktop/soak | Chromium Block Party matrix repeated three times serially: **12/12 passed** (real completion, dependency failure, cached reconnect, keyboard, light/dark, reduced motion). |
| Mobile/a11y | Chromium Pixel + WebKit iPhone: **6/6 passed**, covering 320/390/430 portrait, 667×375 landscape, real swipe, 44 px controls, failed-vs-empty, and axe WCAG 2.1 AA with no serious/critical finding. |
| Review/hygiene | Independent adversarial review: **no blocking code findings remain**. `git diff --check`: **passed**. No realm, schema, deployment, flag, lockfile, shared navigation/discovery, Space Invaders, or primary-checkout change. |

Every locally runnable required gate is green. Opening a PR still depends on remote authentication/availability. This branch will not merge or deploy.

## Risks and owner decisions

1. **Production remains unavailable until Fly is deliberately enabled.** This branch cannot prove a live ranked submit while the total kill switch remains off.
2. **The proto lacks seed-source identity.** Honest copy can avoid a false chain claim now; a fully authoritative provenance label requires a reviewed proto/generated-code change.
3. **First-write remains an intentionally strict product policy.** Exact retries now recover safely, but a different replay remains a final conflict and there is no authenticated cross-device read endpoint for the already accepted personal result.
4. **No Block Party attestation exists.** Do not use “on-chain,” “certified,” or “attested” for a stored score.
5. **A mechanical name/visual review is still needed.** Original presentation reduces trade-dress risk, but counsel/owner review controls any public naming change.
