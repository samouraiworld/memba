# Space Invaders — AAA Upgrade & Onchain Leaderboard Plan

**Date:** 2026-07-08
**Status:** DECISIONS LOCKED (owner-approved 2026-07-08) — nothing coded yet. Implementation not started; awaiting explicit go + fresh isolated worktree (many parallel sessions active — conflict-avoidance is mandatory).

### ✅ Owner decisions (locked)
1. **Controls: keep & patch** the current split scheme (left-steer / right-fire) — add visible affordances + proportional steering; **do NOT switch to drag-to-move.** PLUS **make firing faster & more energetic** — allow multiple player bullets on screen + faster fire rate + faster bullet speed (see §3.1b).
2. **Default mode = Daily Challenge** front-and-center.
3. **Bunkers = simplified 3-HP block segments in W2** (defer true pixel-erosion).
4. **v1 onchain scope = T2 board** — ship the server-verified board first; onchain attestation (W6) is a required fast-follow, **must land before prizes go live** (see decision 5).
5. **Prizes/fees = YES (planned).** Design a **separate guarded escrow realm now** (`escrow_v2` pattern, `IsUserCall`-guarded `OriginSend`); the leaderboard realm stays permanently **funds-free**.
6. **Aesthetic = CRT scanline ON** (motion-safe toggle to disable) **+ bigger screen** — substantially larger displayed play area than today's 320px (see §5.2).


**Scope:** `frontend/src/games/space-invaders/` + new backend `spaceinvaders` package + new realm `memba_arcade_leaderboard_v1`
**Live URL today:** https://memba.samourai.app/test13/game/space-invaders (behind `VITE_ENABLE_SPACE_INVADERS`)
**Method:** 5-lens world-class expert panel (arcade game design · mobile UX/ASO · game engineering · onchain/anti-cheat · brand/visual identity), each grounded in the actual code. This document is the CTO synthesis.

---

## 0. TL;DR — the verdict

We built an **excellent deterministic engine wearing a debug skin and a grind score.** The hard, valuable part — a pure fixed-timestep reducer over a seeded integer PRNG, fully TDD'd — is already done and is *exactly* the substrate a trustworthy onchain leaderboard needs. What's missing is the entire **feel + retention + competition layer**, and the wiring to certify scores onchain.

Three findings were flagged independently by **multiple** experts and are the spine of this plan:

1. **🚨 Fixed seed `0x5eed` → every run is byte-for-byte identical** (`SpaceInvaders.tsx:11`). Flagged by 4 of 5 experts. Fatal for retention *and* for a fair leaderboard. Highest-impact single fix.
2. **🚨 Flat, grind-bounded scoring** (`points = [30,20,20,10,10]`, capped ~wave 24 ≈ 23.7k for everyone). Gives near-zero separation between good and great players — fatal for a *competitive* board. Flagged by arcade design + onchain.
3. **🚨 Zero game feel** — killed aliens silently vanish; no sound, particles, shake, or juice anywhere. Flagged by arcade + mobile + engineering + brand. It reads as a tech demo, not a store title.

**The unifying architectural insight (CTO):** juice, audio, *and* onchain verification all depend on the **same two engine changes** — (a) a deterministic `events[]` channel out of `step()`, and (b) a **tick-indexed input log + state-hash**. Build that spine once (Wave 0) and it unblocks three workstreams at once. Do not build juice, audio, and replay as three separate ad-hoc hooks.

**Recommended trust model: T2 (server-side replay verification) + onchain attestation** — anchored on a backend offline signer key, reusing Block Party's proven pattern verbatim. **We must never call it a "trustless leaderboard."** Honest label: *"Server-verified, onchain-certified scores."*

---

## 1. Current state (grounded facts)

| Area | What exists | Gap |
|---|---|---|
| Engine | Pure reducer `step(state,dt,input)`; mulberry32 integer PRNG; fixed timestep + spiral-of-death clamp; `determinism.test.ts` passing | No `events[]` channel; no tick counter; no replay log |
| Determinism | Bit-exact: only `+ - * /`, `Math.min/max/floor`, `aabb`; **no `Math.random`/`Date`/trig** | One latent float bug: `steps*FIXED_MS` round-trip (`SpaceInvaders.tsx:66` → `useGameLoop.ts:14`) can produce off-by-one step counts |
| Seeding | `SEED = 0x5eed` hardcoded | Every run identical; no daily/random seed; not server-issued |
| Scoring | Row points, awarded once per kill, inside the pure reducer (good) | Linear, capped, no combo/accuracy/UFO/wave-bonus; no skill separation |
| Render | Canvas2D, `setState` 60×/s → full React commit → `useEffect([state])` redraw; solid `fillRect`s; no DPR scaling | React-coupled render; sub-320px shimmer; no sprites, no juice |
| Controls | Keyboard (arrows/space/P); touch = left-half relative drag steer + right-half tap fire (magnitude discarded → digital ±1) | Fingers occlude playfield; invisible affordances; no haptics |
| Viewport | Fixed 320px arena, `touch-action:none` ✓ | Tiny on modern phones; no `overscroll-behavior`, no safe-area, no fullscreen |
| A11y | Canvas `aria-label` only; lives = `◈` glyphs | No `aria-live`, no `prefers-reduced-motion`, sub-44px targets |
| Persistence | `localStorage` best only (`highScore.ts`) — fully forgeable | No address, no attestation, no onchain record |
| Listing | `SpaceInvadersGate.tsx` placeholder (🛸 emoji, 4 bullets) | No icon, screenshots, preview, ratings, real copy |
| Onchain | **None.** No leaderboard realm exists in samcrew-deployer | Net-new realm required |

**Reusable prior art found (critical — minimizes new invention):**
- **Block Party** already shipped **server-side replay verification** (`backend/internal/service/blockparty_rpc.go` — "client never sends a score, only its move log; server replays"), with a Go engine port + **cross-language determinism corpus** (`internal/blockparty/engine/testdata/*.json` pinned by `corpus.gen.test.ts`), auth-before-replay, rate limits, length caps, no-op-move rejection, chain-block-derived daily seeds, streaks. **Reuse wholesale.**
- **`memba_quest_attestation_v1`** realm = the onchain-write pattern to copy: backend holds an **offline ed25519 key that never broadcasts**, signs a canonical voucher; the **user broadcasts** and pays gas; realm verifies sig vs configured pubkey, rejects reused nonces, bounds the value. Backend counterpart `internal/attestation/signer.go` with byte-identical canonical message pinned by cross-test.
- **`memba_reviews_v1`** = the DoS-safe bounded/paginated `Render` + `*JSON` read pattern (`MaxPageLimit = 100`).
- **Frontend broadcast rail:** `doContractBroadcast([msg])` (Adena) already used in `lib/myListings.ts` / `lib/membaDAO.ts`.

---

## 2. The shared spine (Wave 0) — build this first

Everything downstream depends on it. Three engine changes, all determinism-preserving, all TDD:

### 2.1 Deterministic `events[]` channel out of `step()`
`step()` today returns only the next `GameState`, so the render/audio layers can't tell *what happened* (which alien died where, player hit, wave cleared). Return `{ state, events }` (or fold a bounded `events` array into state). Events are pure functions of `(state, input)` → deterministic & safe:
`alienKilled{x,y,row}` · `playerFired{x}` · `playerHit` · `lifeLost` · `waveCleared` · `alienStep{dir}` · `ufoSpawned/ufoKilled` (later).
**This one channel feeds juice + audio + the verification hash simultaneously.** Highest-leverage change in the plan.

### 2.2 Tick-indexed input log + monotonic `tick` counter
- Add a monotonic `tick` to `GameState`, incremented once per `step()`.
- **Canonical timeline = the fixed-step tick index, NOT the rAF frame.** Record `{tick, input}` deltas (only when input changes → a full game is a few hundred edges, compresses tiny). rAF timestamps must **never** enter the log.
- This is the replay substrate for anti-cheat (§7) and enables a future ghost/replay viewer for free.

### 2.3 Fix the float round-trip (determinism bug)
`drainAccumulator` computes an integer `steps`, but the loop passes `steps * FIXED_MS` (16.666…) back into `advance()`, which re-divides in a `while` loop — accumulating rounding error that can run `steps±1`. **Pass the integer step count directly** (`advance(prev, nSteps, input)` with a `for` loop). Must fix *before* anyone relies on replay reproducibility.

### 2.4 Injectable seed
Replace the `SEED = 0x5eed` constant with a seed **prop**, threaded through `newGame(seed)` and recorded in the replay. Wire it now while touching the replay layer. Fixed seed survives only as an explicit "replay yesterday's daily" affordance.

> **Also decouple render from React here** (engineering P0): draw from `stateRef.current` in the rAF loop, drop the `useEffect([state])` redraw, and let React hold only a throttled HUD projection. Cleanest to do while restructuring the loop for the tick counter.

---

## 3. Gameplay & scoring redesign

### 3.1b Rapid-fire feel (owner decision 1) — **energetic, faster firing**
Today only **one** player bullet exists at a time (`step.ts:36` gates on `!s.playerBullet`) and bullets travel at `0.4 px/ms`. To make it faster and more energetic — all inside the pure reducer, all deterministic:
- Replace the single-bullet gate with **N concurrent player bullets** (start N=3) held in a `playerBullets[]` array + a short **fire-rate cooldown** (e.g. ~120–160ms) so holding fire streams shots instead of one-at-a-time.
- Increase player bullet speed (`playerSpeedPxPerMs` 0.4 → ~0.55–0.7) for snappier feel.
- **Rebalance interaction with scoring:** the combo multiplier resets on a *missed* shot and the accuracy bonus is `hits/shots` — rapid fire makes missing easier, which *raises* the skill ceiling (good), but retune combo-reset leniency + accuracy `K` so spraying isn't strictly optimal. This is a W2 tuning pass, pinned by determinism vectors.
- Bound `playerBullets[]` length explicitly (DoS/clarity) and update the Go replay engine + corpus accordingly.

### 3.1 Scoring model (the leaderboard's backbone) — **all terms inside the pure reducer, integer/fixed-point only**
Float multipliers risk JS↔Go verifier divergence — store multipliers as integer numerators (×1.5 = `15`, `/10` floor).

1. **Widen row hierarchy:** `[40,30,20,20,10]` — make top rows worth chasing.
2. **Combo / no-miss multiplier (P0, primary skill lever):** increments per hit, **resets on any missed shot** (already detected at `step.ts:81`). Steps ×1→×1.5→×2→×3→×4 (cap). Creates most of the good-vs-great separation.
3. **Accuracy bonus (P0):** end-of-wave `floor(hits/shots · K)`. Pieces already flow through `step`.
4. **Escalating wave-clear bonus (P1):** `wave · C` + speed bonus (fewer formation steps) + flawless (no life lost) bonus. Fixes the linear-score ceiling.
5. **UFO risk/reward (P0, ties to §3.2):** variable 50/100/150/**300**, with 300 gated on **shot-count parity** exactly like the 1978 original — invisible to casuals, huge skill lever at the top.
6. **No-miss / perfect-wave streak bonus (P1).**
7. **Remaining-lives bonus at game over (P1):** `lives · 500` — makes the 3 lives a scored, spent resource.

**Anti-abuse:** cap per-source contributions; daily seed + replay verification is the real backstop; bound input-log length. Keep every term in `step()` — never compute bonuses in React/UI (would break replay).

### 3.2 Classic mechanics
| Mechanic | Priority | Effort | Notes |
|---|---|---|---|
| **Mystery UFO ship** (seeded timer, shot-parity 300) | P0 | M | Highest-value leaderboard mechanic; deterministic off existing `rng` |
| **Fire from bottom-of-column** (not random alien `step.ts:110`) | P0 | S | Looks right, plays fair |
| **Wave difficulty scaling** — ramp fire rate/concurrent bullets/speed; **cap the start-Y kill wall** (`spawn.ts:6` `dropPerWave`) | P0 | S | Today the *only* between-wave change is dropping start-Y until wave ~25 spawns inside the kill line — difficulty must come from pressure, not a spawn wall |
| **Destructible bunkers/shields** | P0 | M–L | The missing tactical layer. Ship simplified 3-HP block segments first if pixel-erosion is too heavy |
| **Per-row alien sprites** (crab/squid/sentinel) | P1 | S | Makes the scoring hierarchy legible |
| Splitting/armored aliens, bonus waves | P2 | M | Reserve for modes |

### 3.3 Modes & seeding
- **Daily Challenge (flagship):** one **chain-block-derived** seed per UTC day (reuse `blockparty.SelectDailyBlock`/`DeriveSeed`) → everyone plays the same board, unpredictable until the block exists, verifiable. One ranked submission/address/day. **Default mode on open.**
- **Endless / Arcade:** server-issued **random** seed, all-time personal best.
- **Practice:** free/replay-yesterday, **not ranked**.
- **Ghost/replay viewer (P2):** the verification input logs already exist — play back the current #1's run. Big retention for ~zero extra infra.

---

## 4. Feel, juice & audio (engineering-authored, brand-directed)

**Hard rule: every cosmetic effect reads sim state but never writes it, and uses its OWN RNG** (never `state.rng`) — else juice corrupts the verified timeline. All fed by the §2.1 `events[]` channel.

| Effect | Priority | Effort | Layer |
|---|---|---|---|
| Alien **death explosion** (particles) — kills the silent vanish | P0 | S | Cosmetic, off `alienKilled`, separate PRNG |
| **Screen shake + hit-stop** on death/kill | P0 | S | Render-only `ctx.translate`, wall-clock decay |
| **Sound + accelerating "heartbeat"** — 4 descending bass notes, tempo from existing `formationStepMs()` | P0 | M | WebAudio; lazy `AudioContext` unlocked on first gesture; mute = master `GainNode` persisted to localStorage |
| Floating `+points` popups, muzzle flash, hit-flash | P1 | S | Cosmetic |
| 2-frame alien march animation | P1 | S | Off `alienStep` event |
| Parallax starfield / faint scanline+bloom (CRT accent) | P2 | S | CSS overlay; motion-safe toggle |

**Motion-safety:** gate all shake/flash/particles/CRT behind `prefers-reduced-motion: no-preference`; swap the current 8Hz invuln blink (`Canvas.tsx:28`, near photosensitivity zone) for a steady dimmed state under reduced motion.

**Perf (all determinism-preserving):** compute `living` once (dedupe the double `.filter` at `step.ts:49,107`); loop-based min/max instead of spread (`step.ts:55`); skip `aliens.map` on unchanged frames; DPR-correct backing store (`canvas.width = 320·dpr`, prefer integer scale); **auto-pause on `visibilitychange`**. Pool particle objects so juice doesn't reintroduce GC churn.

---

## 5. Mobile UX, controls & accessibility

### 5.1 Controls — **KEEP & PATCH the split scheme (owner decision 1)**
Retain left-steer / right-fire, but fix the three things that make it feel bad today:
- **Visible affordances (P0):** tint/outline the two zones and draw a steering nub + a fire glyph so the split is *seen*, not guessed. The bigger screen (§5.2) gives room for this.
- **Proportional steering (P0):** stop discarding drag magnitude in `useTouch.ts:32-37` (currently digital ±1). Map drag distance → ship speed so fine dodges are possible.
- **Move zones toward the gutters / bottom band (P1):** reduce playfield occlusion — with the larger screen, the steer/fire touch bands can sit lower so thumbs cover less of the kill zone.
- **Rapid-fire (decision 1):** right-side hold now streams multiple bullets (see §3.1b), which makes the fire zone feel responsive instead of one-shot-at-a-time.

Rejected: drag-to-move (owner chose keep-and-patch), tilt (permissions/desktop-hostile).

### 5.2 Viewport & platform
- **P0 — BIGGER SCREEN (owner decision 6):** substantially enlarge the displayed play area — scale the stage to roughly `min(96vw, ~480–520px)` on desktop and **near-full-width** on mobile (today's 320px reads as unfinished). Keep the **320×400 internal buffer** so pixel-art + determinism vectors are unchanged (`image-rendering: pixelated` upscales cleanly on integer-ish factors). *Optional W2 tuning:* enlarging the internal arena (e.g. 400×520) gives more dodging space but changes tuning + invalidates determinism corpus — treat as a deliberate gameplay decision, not a display tweak.
- **P1** `overscroll-behavior: none` (kill pull-to-refresh from chrome), `env(safe-area-inset-*)` on HUD (notch/Dynamic Island), landscape nudge ("rotate to portrait" — don't stretch the fixed aspect), fullscreen toggle on the Start gesture.
- **P1** Haptics via `navigator.vibrate`: hit ~30ms, life lost ~60ms, wave clear double-tap, game over longer. Cheapest mobile juice available (iOS silently ignores — fine).

### 5.3 Onboarding & retention
- **P0** Teach by showing: pulsing ghost-hand gesture on the ready screen ("Drag to move · Auto-fire"), explicit **"TAP TO START"** (clean hook for fullscreen/haptics/audio-unlock gesture). Juice the **first kill**.
- **P1** Instant restart from anywhere a run ended (tap overlay / "R" key). Faster dead→playing = more sessions.
- **P1** Web Share score (`navigator.share`) with deep link — organic acquisition, zero backend.
- **P2** Day-streak counter (localStorage) on ready screen; PWA daily-challenge reminder (opt-in Notifications API) as the web-native substitute for push.

### 5.4 Accessibility
- **P1** `aria-live="polite"` for score/wave milestones, `assertive` for game-over; real `aria-label="3 lives"` (not three diamond glyphs); 44×44px minimum on pause + all chrome; WASD alt keys.
- **P0** (once juice lands) full `prefers-reduced-motion` path.
- **P1** Distinct **sprite silhouettes** (ship/alien/UFO/bullet) so shape — not just color — carries meaning; helps CVD and all players parse the board.

---

## 6. Branding, visual identity & App Store listing

### 6.1 Direction: **"Certified Arcade"**
Crisp modern-pixel on true black + one controlled glow/scanline pass — *not* full neo-CRT (reads cheap), *not* sterile flat-pixel. **The play area is a dark arcade artifact; the frame around it is Memba.** That single idea resolves theme coherence, key art, and store framing.

- **Palette (game-scoped tokens, rhyming with brand `--color-k-*`):** screen `#04120f` · hero teal `#4ff0c0` (bright twin of brand accent `#00d4aa`) · phosphor `#e6f7ef` · shot gold `#ffd24d` (distinct from brand govdao gold `#c9a227` — **two golds, two jobs:** in-screen energy vs brand/trust marks) · UFO/bonus `#ff6b8a` (single warm counter-accent). Add a `--color-si-*` block to honor the no-literal-hex discipline.
- **Rule:** inside the screen = the phosphor colors; outside (HUD/bezel/chrome) = `--color-k-*` tokens. Never bleed across.
- **Bezel (fixes dark-screen-in-light-app):** wrap the canvas in a `--color-k-panel` frame + `1px --color-k-edge` + inset shadow → obviously a "monitor." Masthead reuses `.appstore__eyebrow` + heavy headline + realm-path chip so the game page feels like part of the App Store.
- **Typography:** JetBrains Mono for HUD/labels (tabular nums already set); a pixel display face **only** in the wordmark/key-art (never running UI).
- **Sprites:** 3 alien ranks (2-frame) on an 8/16px grid; ship = teal wedge; UFO = `#ff6b8a` + `#ffd24d` underside (the only place two accents touch → reads "special"). Eyes/vents pick up `#4ff0c0` so player color threads through enemies.
- **Glow discipline (CRT ON — owner decision 6):** one ≤2px outer glow on emissive sprites + a 6–8% scanline overlay on the bezel layer, **on by default**, with a motion-safe settings toggle to disable (auto-off under `prefers-reduced-motion`). No barrel distortion / chromatic aberration / vignette flicker (the tells of a cheap filter) — the premium read comes from *one* controlled glow + *one* faint scanline, not a stack of effects.
- **Colorblind:** teal/white/gold all safe; the only risk is bonus `#ff6b8a` vs gold — mitigated by shape + horizontal-sweep motion + shared gold underside. Never encode lives/danger in color alone (lives already use `◈` — keep).

### 6.2 Icon / wordmark / key art
- **App icon (priority):** ONE Rank-C sentinel alien in `#e6f7ef` + a single `#ffd24d` shot from a `#4ff0c0` cannon nub, on `#04120f`, rounded-square screen tile. Must read "alien + shot" at 48px (grid) and 32px (favicon). 1024² master, artwork inside central 816² safe area. A `#c9a227` gold "✓ chain" tick bottom-right **only ≥512px**. **First game to break the seeded-monogram default** — sets the bar. Web/artifact favicon fallback: `👾🟢`.
- **Wordmark:** `SPACE / INVADERS` stacked pixel face, an alien glyph replacing a letter, mono kicker `MEMBA ARCADE · ONCHAIN`.
- **Key art:** 16:9 + 3:1, arcade screen at a slight cabinet tilt, formation mid-march, teal shot connecting, gold tracers, `#04120f→#000` edge bleed into Memba black; one small `#c9a227` "CERTIFIED ONCHAIN" seal.

### 6.3 App Store listing (in-app store)
- **No device frames** (Memba house style is frameless/object-on-black) — show the bezeled game directly.
- **6 portrait screenshots** (`1290×2796`) + mono caption bars: hero gameplay · onchain leaderboard (+Certified seal) · daily challenge · score/combo moment · mobile controls · your certified rank.
- **Animated preview** (6–8s loop, ≤5MB): title → gameplay → wave-clear pulse → **score certifies to leaderboard (the ✓ onchain stamp animates in)** → end on board. The certify beat is the payload. (We have `gif_creator` tooling.)
- **Badges** (reuse `.appchip`): `ONCHAIN LEADERBOARD` (teal) · `DAILY CHALLENGE` (gold) · `CERTIFIED SCORES` (gold ✓) · `ARCADE`.
- **Copy (terse):** Title `Space Invaders` · Subtitle `Onchain arcade classic` · Grid tag `Blast the swarm. Prove your score onchain.` · Lede *"The arcade classic, rebuilt for Memba. Clear the swarm, chase the daily seed, climb a leaderboard that lives on Gno — not a database."*
- **Ratings:** wire the existing reviews realm (`VITE_ENABLE_REVIEWS`); prompt to rate **after a new high score**, never on a low-score game-over.
- **Instant-play badge:** no-wallet/no-download is a genuine differentiator vs typical Web3 games — elevate it visually.

### 6.4 Branding the onchain angle (trust, not gimmick)
Communicate via Memba's existing `.apptrust` grammar: on game-over, the score row animates `#8a8a8a` (pending) → `#c9a227` gold ✓ when recorded. A **realm-path chip** `gno.land/r/…/space_invaders` in `.apppath` style = address-as-identity. **Three-state color grammar: gold = certified, teal = live, gray = pending.** No glowing "BLOCKCHAIN" banners, no coin iconography — the trust signal is typographic and factual. If the model is sig-gated (it is), copy says **"signed & recorded,"** never "trustless." Share card reuses Block Party's `ShareCard` (score + rank + certified seal + realm path) = growth loop + trust proof in one.

---

## 7. Onchain score certification & dedicated leaderboard

### 7.1 Trust model (honest spectrum)
| Tier | Score computed by | Stops | Does NOT stop | Verdict |
|---|---|---|---|---|
| T0 client submits | browser | nothing | any forged number | never use |
| T1 signed submission | browser, server stamps | in-transit tamper | modified client fabricates | weak |
| **T2 replay-verified** ✅ | **server re-runs input log** | fabricated/impossible scores, memory edits, speed hacks, no-op padding | skilled bots, sybil, server-operator trust | **recommended** |
| T3 fully onchain | the realm re-simulates | + server-operator trust | bots/sybil; costs gas; needs Gno engine port | future stretch |

**Chosen: T2 verification + onchain *attestation* (the `quest_attestation_v1` shape).** Guarantee: every board entry is a score the backend **re-derived** from a recorded input log under the versioned engine — no client number is ever trusted. Explicitly **not** guaranteed: that a human (not a bot) played, no sybil, or that the server operator *couldn't* mint a voucher (they hold the signer key — bounded by a realm-side `MaxScore`). **Never marketed as trustless.**

### 7.2 Certification flow (game-over)
1. **`GetGameSeed(addr)`** → backend issues `gameId` (uuid) + seed. Daily board: `seed = H(dailyBlockHash | date | addr | gameId)`; practice: fresh random. Store `{gameId, addr, seed, unused}`.
2. Client plays with issued seed, records the **tick-indexed input log** (§2.2). Provisional score is UI-only.
3. On game-over transition (`SpaceInvaders.tsx:74`, where `saveBest` fires today) → **`SubmitGame{gameId, inputLog}`**. Backend: authenticate → rate-limit → validate gameId (exists/owned/unused/unexpired, mark used) → **REPLAY** the Go engine → authoritative `score = st.score` (client number ignored) → sanity bounds → persist to SQLite fast board → **`IssueVoucher(addr, gameId, score, nonce)`** with the offline ed25519 key.
4. **User broadcasts** (pays gas) `RecordScore(gameKey, addr, gameId, score, period, nonce, sigHex)` via `doContractBroadcast([msg])`.
5. UI reads board via `vm/qeval GetTopJSON` / `GetPlayerBest`.

**Signature:** offline key signs canonical `gameKey|addr|gameId|itoa(score)|period|nonce`; byte-identical backend↔realm, pinned by a cross-test (like `signer_test.go`). Realm trusts the **signature, not the caller address**. Anti-replay: single-use `gameId` (backend) + single-use `nonce` (realm AVL tree).

### 7.3 Leaderboard realm — `memba_arcade_leaderboard_v1`
One realm for all arcade games (keyed by `gameKey`, e.g. `"space-invaders"`) so Tetris/Block Party share it later. Modeled on `memba_quest_attestation_v1` (sig auth) + `memba_reviews_v1` (bounded reads).

- **State (bounded `avl.Tree`):** `signerPubKey` · `usedNonce` · `bestOf[gameKey:addr]→Entry` (one row/player) · `board[gameKey:period]→TopN`.
- **Bounded top-N is DoS-critical:** store a fixed-capacity (N=100) sorted structure per board, evict on insert — **O(N) per board forever**, regardless of traffic. Never store every submission onchain.
- **Writes:** `SetSigner` (owner multisig only, `unsafe.PreviousRealm`); `RecordScore` (anyone broadcasts, sig is authority; panics/reverts on invalid/replayed/out-of-range). `period ∈ {"all", "YYYY-MM-DD"}`, `gameKey` allow-listed, `0 < score ≤ MaxScore`.
- **Reads (DoS-safe):** `GetTopJSON(gameKey,period,offset,limit≤100)`, `GetPlayerBest`, paginated `Render("space-invaders/2026-07-08")`.
- **⚠️ Funds guard:** the leaderboard realm holds **no funds — permanently** (owner decision 5). **Prizes ARE planned**, so they go in a **separate escrow realm designed now** (§7.3b), never the board.

### 7.3b Prize escrow realm (owner decision 5 = prizes planned) — `memba_arcade_prizes_v1`
Prizes are confirmed for a later phase, so we design the money-path realm up front (but deploy it only when prizes launch, and **only after W6 onchain attestation lands** — real value must not ride on a purely offchain T2 board).
- **Separate realm**, modeled on the guarded `escrow_v2` pattern. **Every `OriginSend()` read MUST be guarded by `IsUserCall()`** — the documented P0 fund-drain class (ref guard `appstore.gno:125`); an unguarded read lets a wrapper realm spoof deposits and drain the pot.
- Payouts are authorized by the **same offline-signer attestation** (a `PrizeVoucher{winnerAddr, boardKey, period, amount, nonce}`) so a prize can only be claimed for a verified, onchain-recorded winning entry; single-use nonce; owner-multisig funds the pot + sets caps (`MaxPayout`).
- The leaderboard realm exposes the *ranking* (read-only); the prize realm reads the finalized board period and releases escrow to the attested winner. Clean separation = the board can never be drained, and the prize realm carries the guard discipline.
- **Deploy gate:** prizes go live only when (a) W6 onchain attestation is live, (b) the escrow realm passes a dedicated fund-drain audit + the v2 CI gate, (c) multisig funds + caps set. Never ship a funds realm to mainnet without the `IsUserCall` guard audit.

### 7.4 Anti-cheat (concrete)
- **Server replay is the core control.** Port `engine/step.ts` → Go under `backend/internal/spaceinvaders/engine/`, pinned by a **cross-language corpus** (TS `corpus.gen.test.ts` generates vectors; Go must reproduce score-identical or **CI fails**). The `rngFloat` `/0x100000000` + `Math.*` float math is the determinism risk — the corpus test is the guarantee; a mismatch is a **release blocker**.
- **Server-issued seed** kills pre-computation + hardcoded-seed farming; daily seed is chain-derived so all players face the same run.
- **Input-log integrity:** length cap, enum/charset validation, no-op/impossible-transition rejection (analog to Block Party's `RngCallCount`-unchanged guard).
- **Rate limiting:** per-IP + per-address (`ratelimit.SpaceInvadersSubmit`); one daily submission/address.
- **Residual (state honestly):** skilled bots (undetectable by replay — heuristic mitigation only), sybil (needs account friction, not replay), server-operator trust (T2 ceiling; bounded by realm `MaxScore`), signer-key leakage (offline-key discipline + multisig rotation via `SetSigner`).

### 7.5 Integration & deploy
- **Backend:** clone `blockparty` package → `spaceinvaders` (engine/, store.go SQLite board, reuse `SelectDailyBlock`/`DeriveSeed`/`blockparty_chain.go` verbatim). Reuse `attestation.Signer` unchanged. Add RPCs `GetGameSeed`/`SubmitGame`/`GetLeaderboard`/`GetPlayerBest` to `api/memba/v1/memba.proto` + regen. DB migration `NNN_space_invaders.sql` (mirror `019_blockparty.sql`).
- **Realm:** build under `projects/memba/realms/memba_arcade_leaderboard_v1/` with full tests (voucher vectors + bounded-insert + pagination); pass the **v2 CI gate**; deploy via **2-of-2 admin multisig** (`MsgAddPackage`, owner `g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0`, test13). Post-deploy: generate offline signer keypair, `SetSigner(pubKeyHex)` from multisig, set backend env, pin canonical cross-test.
- **Flags:** existing `VITE_ENABLE_SPACE_INVADERS` for the game; **new `VITE_ENABLE_SPACE_INVADERS_LEADERBOARD`** + backend `spaceInvadersEnabled` gate so certification dark-launches independently. **Never** ship a funds-touching variant to mainnet without the `IsUserCall` guard audit.

---

## 8. Phased roadmap

| Wave | Theme | Contents | Effort | Gate |
|---|---|---|---|---|
| **W0 — Spine** | Engine foundation | `events[]` channel · `tick` counter + tick-indexed input log · fix `steps*FIXED_MS` float bug · injectable seed · decouple render from React | M | (internal) |
| **W1 — Make it feel alive** | Juice + audio + seed fix | Death explosion · shake/hit-stop · WebAudio + accelerating heartbeat · mute toggle · **randomize seed per run** · popups/muzzle flash · haptics · reduced-motion path | M | `VITE_ENABLE_SPACE_INVADERS` (already live) |
| **W2 — Make it a game** | Mechanics + scoring | Combo/no-miss multiplier · accuracy bonus · UFO (shot-parity 300) · fire-from-bottom · wave difficulty scaling + cap kill-wall · lives bonus · sprites | M–L | same |
| **W3 — Make it mobile-AAA** | Controls + UX | Drag-to-move + auto-fire · responsive arena · onboarding gesture + TAP TO START · overscroll/safe-area/fullscreen · instant restart · Web Share · a11y (aria-live, 44px, WASD) | M | same |
| **W4 — Make it beautiful** | Brand + listing | `--color-si-*` tokens · bezel/masthead · sprite set · app icon + exports · 6 screenshots · animated preview · badges · copy · wire ratings | M | ships to App Store card |
| **W5 — Prove the score (offchain) — v1 SHIP LINE** | T2 verification | Backend `spaceinvaders` pkg (Go engine port + cross-lang corpus) · `GetGameSeed`/`SubmitGame` replay · SQLite board · rate limits/caps | M | `VITE_ENABLE_SPACE_INVADERS_LEADERBOARD` (dark) |
| **W6 — Certify onchain (required fast-follow)** | Realm + attestation | Deploy `memba_arcade_leaderboard_v1` (multisig) · offline voucher · user-broadcast `RecordScore` · `GetTopJSON` reads · certify UI (pending→gold) · realm-path chip | M–L | realm dark until `SetSigner`, then flag flip |
| **W7 — Daily competition** | Daily board | Chain-block daily seed · per-day bounded TopN · per-day cap · streaks · ghost/replay viewer | M | flag flip |
| **W8 — Prizes (gated on W6)** | Escrow + payouts | Deploy guarded `memba_arcade_prizes_v1` (§7.3b) · fund-drain audit · prize voucher · multisig fund + caps | M–L | prizes flag; **only after W6 live + audit green** |
| **W-stretch** | T3 | Port engine to Gno; realm re-simulates (gas-bounded). Strengthens trust once real prize value rides on scores | L | separate flag + heavy audit |

**Effort:** S <1d · M 2–4d · L 1–2wk. **v1 ships at W5** (owner decision 4 = T2 board) — a server-verified, cheat-resistant board, honest from day one. **W6 (onchain attestation) is a required fast-follow, not optional**, and **must land before W8 prizes** (owner decision 5 = prizes planned): real value must never ride on a purely offchain board. Sequencing rationale: **feel first** (W1 transforms perception in days on the already-live game), then the **competitive foundation** (W2 — scoring/UFO/rapid-fire make scores skill-expressive), then mobile/brand/listing, then the verification stack. This mirrors exactly how Block Party shipped (verified board first, chain layer additive).

---

## 9. Consensus critical findings (flagged by ≥2 experts)

1. **Fixed seed → identical runs** — arcade + mobile + engineering + onchain. *(W0/W1)*
2. **No game feel / silent kills** — arcade + mobile + engineering + brand. *(W1)*
3. **Flat scoring, no skill separation** — arcade + onchain. *(W2)*
4. **Cosmetics must use a separate RNG / stay out of the sim** — engineering + onchain (determinism integrity). *(W0/W1)*
5. **T2 replay verification, honest "not trustless" framing** — engineering + onchain + brand (three-state trust UI). *(W5/W6)*
6. **Distinct sprite shapes (not color-only)** — mobile (a11y) + brand (identity). *(W2/W4)*
7. **Reduced-motion + 44px targets + aria-live** — mobile + engineering. *(W1/W3)*

---

## 10. Risks & honesty constraints

- **Determinism drift (JS↔Go / future Gno):** the whole onchain value rests on bit-exact replay. Mitigation: cross-language corpus test as a release blocker (Block Party precedent). Fix the float round-trip (§2.3) first.
- **Never claim "trustless leaderboard."** The trust anchor is the backend offline signer key (T2). Copy must say "signed & recorded / server-verified / onchain-certified." Bound blast radius with realm `MaxScore`.
- **Fund-drain P0 class:** keep the leaderboard realm funds-free; any future `OriginSend` read requires `IsUserCall` guard; prizes go in a separate guarded escrow, never the board. Never ship unguarded funds realms to mainnet.
- **DoS:** bounded top-N + paginated reads are mandatory, not optional (memory: render-DoS + bounded-status-index lessons).
- **Scope creep:** bunkers (P0, M–L) and T3 (L) are the two heavy items — ship the simplified bunker first; treat T3 as stretch.

---

## 11. Decisions — RESOLVED (owner-approved 2026-07-08)

1. **Controls:** keep & patch the split scheme (visible affordances + proportional steering, no drag-to-move) **+ rapid-fire** (multiple bullets, faster rate & speed — §3.1b). ✅
2. **Default mode:** Daily Challenge. ✅
3. **Bunkers:** simplified 3-HP segments in W2. ✅
4. **v1 scope:** ship at the **T2 board (W5)**; W6 onchain attestation is a required fast-follow. ✅
5. **Prizes:** planned → separate guarded escrow realm designed now (§7.3b), live only after W6; leaderboard stays funds-free. ✅
6. **Aesthetic:** CRT scanline ON (motion-safe toggle) + **bigger screen** (~480–520px desktop / near-full-width mobile — §5.2). ✅

## 12. Pre-merge verification protocol (owner-mandated — many parallel sessions active)

Nothing is coded yet. **Implementation has not started** and must run in a **fresh isolated worktree** (not the shared `docs/appstore-reviews-submission-plan` branch) to avoid clobbering the other active sessions. When an implementation branch is *fully done*, before any merge run this gate **in order**, and merge **only if every step is green + owner approves** (standing rule: never merge without explicit approval):

1. **Repo state / conflict check** — fetch latest; confirm the branch is not behind/diverged; rebase or `--onto` as needed; verify no overlap with in-flight PRs from other sessions.
2. **CI logs** — pull the actual run logs (not just the status badge); confirm all required checks green (incl. the v2 realm CI gate + frontend build; remember `tsc --noEmit` is a no-op, use `npm run build`).
3. **All-PRs sweep** — review every open PR touching the same files/realms to pre-empt merge-order conflicts.
4. **Review** — standard code review of the diff.
5. **CTO deep review** — architecture/security pass (determinism corpus pinned, cosmetics use separate RNG, `IsUserCall` guards on any funds path, bounded top-N/render, no overclaiming copy).
6. **CI logs re-check** — after any rebase/fix, re-confirm green.
7. **Merge** — only when 1–6 all pass **and** owner gives the go. Admin-merge per workflow; strip all Claude attribution.

---

*Panel: arcade game design · mobile UX/ASO · game engineering · onchain/anti-cheat · brand/visual identity. All grounded in the live code at `frontend/src/games/space-invaders/`. Prior art reused: Block Party (replay verification + daily seed), `memba_quest_attestation_v1` (offline voucher), `memba_reviews_v1` (bounded reads).*
