# Memba games: MVP to v1 audit

**Audit date:** 2026-09-04

**Scope:** Block Party and Space Invaders
**Evidence:** repository implementation and history, focused automated tests, and the public Pearl routes at `memba.samourai.app`

## Executive verdict

Both games have stronger deterministic foundations than their presentation suggests. Neither should be described as a complete v1 yet.

| Game | Real status | Public status | v1 recommendation |
| --- | --- | --- | --- |
| Block Party | Feature-complete daily 2048-style beta with a server-issued chain seed, authoritative replay, leaderboard, streaks, modifiers, and practice mode | Route is enabled, but Daily currently ends at “Couldn't load today's challenge” on Pearl. Practice works. | Restore the daily contract and observability first, then calibrate the competitive rules and add delight. |
| Space Invaders | Mechanically rich deterministic arcade beta with replay verification, daily seeds, certification plumbing, procedural audio, touch, and extensive engine tests | Route is enabled and playable. The UI still looks like a debug prototype and no leaderboard is visible. | Best isolated weekend candidate. Freeze the simulation and rebuild the presentation, controls, responsiveness, and results experience. |

The public App Store currently says “No apps listed yet”; both games are mainly discovered from the Home Explore grid. Both routes also use the generic Memba document title and metadata.

## Validation summary

- The combined focused frontend run passed **99 test files / 473 tests**, with one skipped test. JSDOM emitted expected canvas-context warnings.
- Space Invaders' narrower suite passed **45 files / 195 tests**; shared arcade client tests passed **10/10**; `backend/internal/arcade` passed, including submit → replay verify → store → attest integration.
- Block Party has 20 focused frontend test files plus deterministic TypeScript/Go vectors and substantial backend test/fuzz coverage.
- Existing Playwright coverage is shallow: two desktop Block Party cases and one 1280×800 Space Invaders smoke case. Neither game has a mobile-project spec, game-route axe/Lighthouse coverage, a long-session soak, or a performance budget.
- Both lazy bundles are small. Current production assets are roughly 5.7 KiB gzip JS for Block Party and 8.0 KiB gzip JS for Space Invaders, excluding shared code.
- Both source flags default off for safe deployment. Production currently enables both routes, proving that repository defaults alone do not describe the live state.

## Block Party audit

### What is genuinely strong

- Pure deterministic TypeScript engine with golden vectors mirrored by Go verification.
- Daily challenge is derived from a chain block; the backend replays moves and computes the authoritative score.
- Ranked/practice split, move budget, daily modifiers, par, leaderboard, streak/freeze model, seed proof, local state, and share output are implemented.
- Failure is contained: when Daily cannot load, Practice remains available.

### What prevents v1

1. **Production Daily is unavailable.** The public Pearl route currently shows a challenge error, while the leaderboard silently renders “No scores yet.” The frontend/backend flag or seed-source contract needs an operational diagnosis, alert, and synthetic probe.
2. **Provenance can be misleading.** The backend seed source is globally configured, while the UI labels the proof with the currently selected network. Challenge and leaderboard cache keys are not network/source scoped.
3. **Par is mathematically unreachable in Standard and Rush.** It is a seed-derived 1000–2999 heuristic, but 30 legal moves can add at most 32 starting tiles and an optimistic all-4 consolidation scores at most 640; Rush allows only 24 moves. A committed 40-move vector scores 276. “Vs par” is therefore structurally misleading outside Doubles.
4. **Offline/error behavior is brittle.** The daily hook writes local storage without a guard and does not use the cached value for recovery. Leaderboard and streak errors collapse into false empty/zero states.
5. **Score submission is not recoverable enough.** The game-over flow marks a run submitted before the request finishes and does not offer a robust retry or explain first-write-wins behavior. Reloading also makes “one attempt” unenforceable while an authenticated completion auto-commits a bad run.
6. **Presentation is static.** The board has no merge/spawn motion, audio, haptics, milestone art, modifier tutorial, clear goal, or strong result transition.
7. **Accessibility is partial.** The visual grid exposes little row/column context, board changes are not meaningfully announced, and the completion dialog does not manage focus.
8. **Local results contain confirmed bugs.** Practice reads a local best that is never persisted, and a guest ranked share can report a zero streak even when a local streak exists.
9. **Sharing is not date-stable.** The link is the current pathname rather than a date/result route, so opening it after UTC rollover targets a different board; fallback Practice can share a blank date.
10. **Retention is thin.** There is no yesterday recap, personal rank row, useful history, achievement progression, or opt-in reminder loop.

### Block Party v1 implementation plan

#### BP-0 — restore and make the contract truthful

- Align the production frontend/backend flags and seed network.
- Return authoritative seed chain identity in the challenge response or hard-gate ranked play to the configured chain.
- Scope query caches by seed source/network.
- Add a synthetic challenge/read/submit probe, metrics, alert, and dashboard.
- Give challenge, leaderboard, and streak independent loading, empty, offline, and error states.
- Guard storage access and use a validated cached challenge as an explicitly stale fallback.
- Make submission idempotent and retryable with clear “saved / retrying / failed” states.
- Repair Practice best persistence, guest streak sharing, and prior-result recovery.

**Done when:** Pearl can mint, play, submit, and read a daily score; the proof names the actual source chain; a failed dependency is never displayed as an empty leaderboard; an operator receives an alert before users report the outage.

#### BP-1 — lock fair competitive rules

- Calibrate par using deterministic solver simulations and/or rolling score percentiles.
- Publish the move budget, modifier, scoring, one-attempt policy, UTC rollover, and tie rules in-product.
- Add corpus tests for modifier difficulty and par distributions.

**Done when:** par is achievable but selective across a documented seed sample, identical rules are enforced client/server, and the UI can explain every score and rank.

#### BP-2 — add game feel and comprehension

- Animate tile spawn, slide, merge, milestone, invalid move, and result transitions.
- Add original Memba milestone tiles, restrained procedural sound, haptics, and responsive board depth.
- Teach the day's modifier with a one-screen interactive preview.
- Add practice-only undo and an explicit restart confirmation; never add undo to ranked mode.
- Respect reduced motion and mute preferences.

**Done when:** a first-time player understands goal, modifier, controls, move budget, and result without external help; motion never changes deterministic state; the game is polished at 320–1440 px.

#### BP-3 — results, social, and return loop

- Add personal row/rank, yesterday recap, best percentile, streak/freeze progress, and daily history.
- Generate a date-stable share card/deep link without leaking wallet or replay details.
- Add privacy-safe funnel events and an optional daily reminder.

**Done when:** players know how they performed, have a reason to return tomorrow, and can share a recognizable result safely.

#### BP-4 — release quality

- Add screen-reader board mode, focus-managed game-over, mobile Chrome/WebKit E2E, axe, route Lighthouse, offline/reconnect, date-rollover, and 30-minute soak coverage.
- Exercise seed-source failover and rollback in the runbook.

**Done when:** all critical paths pass the supported browser/device matrix, game-route accessibility is at least 90, there are no serious/critical axe findings, and the full frontend/backend CI is green.

## Space Invaders audit

### What is genuinely strong

- Pure fixed-timestep reducer and versioned replay log with state hashing and golden scenarios.
- 5×11 formation, endless waves, rapid fire, combos, accuracy/lives bonuses, UFO, destructible bunkers, haptics, and procedural audio are implemented.
- Daily seed, bounded delta log, local self-verification, backend worker re-simulation, storage, and day-close attestation plumbing exist.
- Canvas rendering and cosmetic RNG are separated from the certified simulation.
- No-wallet free play is small, lazy, and a good offline candidate.

### What prevents v1

1. **Presentation is visually MVP.** Aliens, ship, bullets, and UFO are rectangles; there is no title, original identity, attract scene, wave reveal, meaningful damage language, result poster, or story.
2. **The loop contradicts its architecture claim.** It calls React state updates around 60 times per second and continues work in ready, paused, and game-over states, wasting mobile CPU/battery.
3. **Keyboard ownership is invasive.** Global handlers consume arrows and Space even for focused controls and do not reset reliably after blur/visibility changes.
4. **Touch can stick.** It lacks pointer capture plus cancel/lost-capture/blur cleanup.
5. **Mobile and accessibility are below v1.** The HUD does not wrap, pause/mute controls are below 44 px, landscape height is not constrained, the canvas is label-only, and phase/life/wave changes are not announced.
6. **Feedback can be wrong.** Alien popups show base points rather than the combo-adjusted score; UFO rewards have no equivalent feedback.
7. **Daily is not a complete loop.** Free play is the initial mode, one best score is shared across modes, and there is no visible board, personal rank, streak, history, or share result.
8. **Certification language overclaims.** A backend-verified pending run is called “Certified on-chain” before day-close attestation.
9. **Competitive integrity has one unresolved edge.** Shooting one's bunker increments shot parity used by the UFO without breaking the combo, allowing a player to manipulate the bonus opportunity.
10. **Release evidence is incomplete.** Realm/key/Fly/Netlify activation needs owner proof; no game telemetry, synthetic probe, mobile E2E, route Lighthouse, performance profile, or soak exists.

### Space Invaders v1 implementation plan

#### SI-0 — freeze the competitive contract

- Keep the current engine, scoring, replay version, backend worker, and golden vectors unchanged for the visual weekend build.
- Decide the bunker/combo/UFO parity rule separately. Any behavior change requires a new simulation version, rebuilt worker/fixtures, and an owner-approved leaderboard cutover.
- Obtain legal/IP review for the public name and recognizable genre language. Use original art and sound now.

**Done when:** every weekend change is classified as shell/render/input-only and the deterministic corpus is byte-identical.

#### SI-1 — stability, input, and mobile foundations

- Stop simulation/React churn outside active play and throttle HUD projection during play.
- Auto-pause on backgrounding and reset all inputs on blur/visibility loss.
- Scope keyboard controls to the game surface and ignore interactive targets.
- Use pointer capture and handle pointer cancel/lost capture.
- Dispose/suspend WebAudio correctly.
- Build a wrapping HUD, 44 px controls, safe-area spacing, and width-and-height constrained cabinet.

**Done when:** ticks do not advance while ready/paused/game-over, Space activates focused buttons normally, input never sticks, a daily replay remains identical, and 320 px portrait plus phone landscape have no overflow.

#### SI-2 — original Memba-native presentation

- Replace rectangles with original procedural pixel sprites for distinct enemy rows, the player, UFO, bullets, and bunker damage.
- Add a Pearl/circuit-space backdrop, cabinet frame, attract/menu state, wave banner, impact/death language, combo escalation, richer bounded particles, and an expressive game-over reveal.
- Make visual score feedback equal the actual delta and add UFO feedback without touching certified state.
- Extend the procedural sound palette and mix only after lifecycle cleanup; keep mute/reduced-motion first-class.

**Done when:** visuals are ownable and pass IP review; all cosmetic settings preserve score/hash; reduced motion removes shake/flashing/large movement; the agreed mid-tier mobile device holds stable 60 FPS.

#### SI-3 — daily-first results and leaderboard

- Make Daily the primary entry and Free Play the secondary sandbox.
- Add a results poster with total, wave, accuracy, max combo, bonuses, and personal-best delta.
- Surface the existing Invaders board client with loading, empty, offline, pending, and attested states plus a connected-wallet row.
- Replace false “on-chain” copy with “Verified and queued for attestation,” then show attested state only when read from chain.
- Add daily history/streak, achievement moments, and a safe share card.

**Done when:** a player can follow locally verified → submitted → pending → attested → ranked, understands any unverified result, and can share without exposing a token, wallet detail, or raw input log.

#### SI-4 — product integration and observability

- Add an Arcade/App Store listing, route-specific title/meta/OG image, sitemap entries, and a direct Home path.
- Track privacy-safe view/start/control-mode/end/restart/share/certify events and performance vitals; never collect raw input logs.
- Add a route synthetic probe and certification success/failure monitoring.

**Done when:** the game is discoverable, link previews are branded, the funnel and failures are measurable, and free play can be rolled back independently from certification.

#### SI-5 — competitive and release gate

- Add year-scale daily seed sweeps, cap/date-rollover/duplicate/replay-theft tests, mobile touch/keyboard E2E, axe, game-route Lighthouse, offline/reconnect, frame profiles, and a 30-minute soak.
- Run the owner-gated Pearl submit → verify → store → attest → board ceremony after the code PR is green.

**Done when:** full CI and worker freshness pass; no serious/critical accessibility findings or console errors remain; game-route targets are accessibility ≥90 and performance ≥85; the release owner has verified rollback and monitoring.

## Selection for the weekend

**Build Space Invaders first.** It is already playable in production, its engine/certification substrate is mature, and the highest-impact work fits almost entirely inside `frontend/src/games/space-invaders/**`. Block Party first needs coordinated backend/ops and rules work, which is neither independent nor a safe visual-only weekend sprint.
