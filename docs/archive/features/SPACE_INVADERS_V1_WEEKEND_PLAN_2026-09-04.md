# Space Invaders v1 weekend build plan

**Branch:** `feat/space-invaders-v1`

**Worktree:** `Memba-worktrees/space-invaders-v1`

**Base:** `main` at `ae16e8e2`
**Delivery:** review-ready pull request; no weekend production merge

## Product intent

Turn the technically mature but anonymous arcade beta into an original, unmistakably Memba experience: a compact neon signal-defense cabinet set over Pearl, instantly understandable on desktop and touch, honest about daily verification, and delightful enough to replay.

The weekend work deliberately freezes the deterministic simulation. It may change rendering, cosmetic FX, shell layout, copy, focus, pointer/keyboard lifecycle, and tests. It may not change scoring, collision, spawn cadence, daily seed derivation, replay wire format, state hashing, the verification worker, database, realm, or deployment flags.

## Creative direction: Signal Defense

- **World:** the player protects the Pearl relay from corrupted signal swarms.
- **Look:** deep ink/teal cabinet, luminous mint circuitry, warm gold projectiles, magenta anomaly/UFO, original row-specific signal creatures, restrained phosphor bloom.
- **Shape language:** asymmetric digital organisms and a relay-skiff—not the copyrighted classic alien/cannon silhouettes.
- **Motion:** readable pulses, formation energy, controlled trails, impact fragments, damage erosion, and a brief wave-clear breath. Reduced-motion mode keeps contrast/state feedback without shake, flicker, or spatial drift.
- **Voice:** concise operator language—“Daily signal,” “Relay online,” “Wave cleared,” “Signal lost”—while retaining the public game name until owner/IP review decides otherwise.

## Weekend scope

### Lane A — visual system and Canvas

Owner: technical artist / Canvas engineer. Files: `render/**` and render tests.

- Procedural original sprites by enemy row, player, UFO, bullets, and damaged bunkers.
- Layered star/circuit background, arena horizon, border energy, vignette, scan treatment.
- Richer bounded event FX, actual-score popups, UFO reward, hit and wave feedback.
- No asset dependency and no writes to deterministic state.

### Lane B — cabinet, HUD, results, responsive UX

Owner: React product engineer / UX designer. Files: `SpaceInvaders.tsx`, `space-invaders.css`, new colocated shell components/tests.

- Branded heading/status, compact HUD groups, mode-first start card, controls legend.
- Daily-first hierarchy without silently auto-starting a run.
- Responsive two-column desktop composition and one-column/landscape mobile cabinet.
- Accessible phase announcements, focus target, 44 px mute/pause, results hierarchy.
- Honest locally verified/pending copy; no new backend integration in this PR.

### Lane C — input, lifecycle, accessibility, performance

Owner: interaction engineer / accessibility and performance QA. Files: `hooks/**`, `lib/audio.ts`, targeted tests, game E2E.

- Scoped keyboard ownership and interactive-target bypass.
- Pointer capture, cancel/lost-capture/blur/visibility cleanup.
- Phase-aware loop, background auto-pause, audio cleanup.
- Portrait/landscape/touch/keyboard/reduced-motion regression coverage.

### Lane D — integration, quality, and product contract

Owner: integration lead. Files: audit/plan docs, final cross-lane integration, full verification. Sole owner of any shared-file proposal.

- Protect the engine/replay/backend boundary and resolve overlaps.
- Maintain visual and copy coherence.
- Run focused and full frontend checks, inspect desktop/mobile screenshots, and complete the cross-expertise audit.
- Update changelog/version only if the owner approves release scope; do not touch shared files speculatively.

## Consulted review roles

- Gameplay/determinism and anti-cheat reviewer
- Original-art and motion reviewer
- Audio/haptics reviewer
- Mobile interaction specialist
- WCAG accessibility reviewer
- Backend/on-chain certification reviewer
- Privacy/telemetry reviewer
- Legal/IP reviewer
- Performance and release/SRE reviewer

The four implementation lanes consolidate these specialties so the team fits the available parallel capacity without losing a review gate.

## Milestones

### Friday — baseline and contract

- Capture public/local baseline and audit both games.
- Choose Space Invaders and create an isolated worktree/branch from `main`.
- Freeze simulation and assign exclusive file ownership.
- Lock the original visual direction and acceptance criteria.

### Saturday — parallel build

- Land Canvas art/FX, shell/cabinet UX, and input/lifecycle changes in parallel.
- Keep changes colocated and continuously run targeted tests.
- Integrator resolves interfaces; no worker edits shared application files.

### Sunday — hardening

- Combine lanes, run full frontend build/lint/unit/E2E, deterministic corpus and backend arcade tests.
- Inspect 320/390/430 px portrait, phone landscape, 1280×800, light/dark, reduced motion, keyboard, and touch.
- Fix defects, update change documentation, and perform the 17-perspective Memba audit.
- Prepare a PR; do not merge during the weekend freeze.

### Monday — owner gates

- Product and IP review.
- CI, human review, canary, Pearl certification ceremony, monitoring, and owner-controlled flags.

## Definition of done

- Original, ownable art direction; no copied sprites, sounds, or trade dress.
- Current engine corpus, replay score/hash, and backend worker remain compatible.
- No global key hijack or stuck pointer/key after cancel, blur, visibility change, or route exit.
- Ready, paused, and game-over states do not continuously advance the simulation or churn React.
- No overflow at 320 px portrait or common phone landscape; primary controls are at least 44×44 px.
- Reduced-motion, keyboard-only, mute, and touch paths are complete.
- No serious/critical axe findings; game-route Lighthouse targets accessibility ≥90 and performance ≥85.
- Focused and full frontend tests, build, lint, E2E, backend arcade tests, and worker freshness checks pass.
- Space Invaders route JavaScript stays ≤40 KiB gzip excluding shared vendor chunks; no unbounded FX collections or AudioContext leaks.
- No new backend, realm, lockfile, deployment flag, or unrelated shared-file change.
- Review-ready PR with summary, screenshots, test plan, known owner gates, and no automated-tool attribution.

## Explicitly deferred

- Simulation/scoring fixes, including bunker/combo/UFO parity.
- Replay version bump or leaderboard season cutover.
- Live board/history/streak backend integration.
- New analytics collection.
- Public rename, production flags, realm/key/secrets work, merge, or deployment.

## Saturday verification checkpoint — 2026-09-05

- Space Invaders focused suite: **44 files / 211 tests passed**.
- Full frontend unit suite: **477 files passed, 1 skipped; 4,763 tests passed, 1 skipped**.
- Full frontend lint and production build passed; the game route remains below the 40 KiB gzip budget.
- Desktop gameplay plus route-scoped WCAG 2.1 AA checks passed.
- The complete mobile/desktop guardrail command passed **11/11**, including iPhone WebKit, Pixel touch input, 320 px portrait, and short landscape.
- Full backend `go test -race -count=1 ./...` and `go build ./...` passed.
- The protected deterministic engine, replay, wire, verification, and backend diff remains empty.
- The repository-wide 476-case Playwright command is not yet a clean gate: a five-worker run encountered five unrelated Firefox/browser teardown timeouts after 358 passes, while all 24 tests in the affected files passed at one worker; a two-worker retry encountered the existing Validators page-size select accessibility check, which then passed three consecutive isolated repetitions. No commit, push, or PR is allowed until the complete command finishes green.

## CTO remediation checkpoint — 2026-09-05

- Independent technical CTO review found and the branch fixed four release issues: keyboard focus after manual controls, 667×320 HUD clipping, wall-clock-sensitive full-game test helpers, and continuous Canvas repainting in static phases. The follow-up review approved the Space Invaders product/code scope with no remaining P0–P2 findings.
- Space Invaders focused suite: **44 files / 215 tests passed** with Vitest's default parallelism.
- Full frontend unit suite: **482 files passed, 1 skipped; 4,808 tests passed, 1 skipped**.
- Full frontend lint and production build passed; the game route remains below the 40 KiB gzip budget.
- Focused desktop Chromium, route-scoped WCAG 2.1 AA, iPhone WebKit, and Pixel Chromium regressions passed **6/6**, including keyboard-only resume and strict short-landscape containment.
- Full backend `go test -race -count=1 ./...` and `go build ./...` passed after integrating current `origin/main`.
- The protected deterministic engine, replay, wire, verification, and backend diff remains empty.
- The complete CI-profile Playwright run reached **469 passed / 15 declared skips**. Its only failures were the same pre-existing Marketplace mobile case on iPhone and Pixel: that test assumes a live `test13` v1 lane, while the current default `pearl` environment correctly renders the Marketplace gate. The Space Invaders branch has no Marketplace diff, and the failure reproduces in isolation on the base behavior.
- Space Invaders is technically approved but remains operationally blocked from push/PR by the repository's all-green local policy until that upstream Marketplace test/environment mismatch is fixed independently and the complete command is rerun green.
