# Memba App Store — Community Reviews + Self-Service Submission

**Date:** 2026-07-08 · **Status:** SPEC — owner review pending, nothing coded · **Audit:** 5-lens expert panel (security / realm-architecture / frontend-CTO / product-UX / release-ops) → **SHIP-WITH-CHANGES** · **Program ref:** `MEMBA_ROADMAP_COMPOUND_2026-07.md` §4.3 / Wave 9, `SPIKE_APP_STORE.md`.

---

## 0. The one fact that reshapes this whole feature

`memba_appstore_v2` (live on test13, self-managed 2-of-2 admin) **already implements ~80% of the submission lifecycle**:
- `RegisterApp(...)` — public, anyone pays **exactly 1 GNOT** → 100% forwarded to the samcrew treasury (no custody), listing starts `pending`. Has the O-13 `IsUserCall` guard, exact-coin `OriginSend`, fail-closed treasury, CEI. **This IS "pay a fee to samcrew."**
- `ApproveApp` (curator-only): `pending → live`. **This IS "Unverified → Verified."**
- `FlagApp` / `DelistApp` / `RestoreApp` — moderation already present.

So this feature is **not** a green-field build. It is: (1) reviews on apps, (2) evolve the realm to **v3** for a real reject/edit/screenshots lifecycle + bounded reads, (3) build the **write-side + curator + trust UX** the frontend lacks — all behind flags, TDD, one PR per slice.

Status quo details: frontend `AppStore.tsx`/`lib/appStore.ts` are read-only, show `live` only; `VITE_ENABLE_APPSTORE` is de-gated (out of `SAFETY_GATED_FLAGS`, Jul 7) but OFF in local envs; the #808 masthead/hero/monogram/trust redesign **is now on main**.

---

## 1. Scope (owner-approved)

Dedicated app-reviews realm · on-chain realm **v3** · all four extras: **curator review dashboard**, **trust interstitial + Verified badge**, **screenshots gallery**, **My Submissions**. Plus the panel-added, high-value-low-cost items: **Report button** (the `flagCount` field already exists), **"Used this app" review badge**, **free-resubmit-once** after rejection.

---

## 2. Trust model & labeling (panel correction — biggest single change from the literal ask)

The literal ask was an **"Unverified" peer tab**. The security + product lenses both flag this as the plan's #1 risk: a polished card inside *Memba's own App Store* that then asks Adena to sign carries **implied endorsement** no tab label undoes — on a page whose whole promise is "verify the source before you sign." So:

- **Default view = Verified only.** Badge: **"Verified by samcrew"**, tooltip *"samcrew reviewed this listing's identity and realm path. Not an audit — always read the source."* (Never let Verified imply "safe/audited" — liability.)
- **"Pending review"** (renamed from "Unverified" — honest: we haven't checked, vs a verdict) is **opt-in, off by default** — a low-emphasis "Show community-submitted apps (not yet reviewed)" toggle. Every pending card carries a persistent amber chip *"Not reviewed — anyone can list this. Verify the realm path yourself."* and its "Open app" routes through the **hardened leaving-Memba interstitial**.
- **`rejected` listings are NOT public** — visible only to their publisher (My Submissions) and the curator queue.
- **Stars never promote a listing to Verified.** Curator approval is the only gate. Ratings are legibility, not a trust tier.

> Owner decision flagged in §8: adopt "Pending review, opt-in" (recommended) vs the original visible peer tab.

---

## 3. On-chain — realm `memba_appstore_v3` (fresh immutable deploy + sealed migration)

Fresh `_v3` is required: gno realms are immutable, and the new **writes** (reject / edit / screenshots) cannot mutate v2's state. An additive index realm can't deliver writes; a data/logic split is over-engineering for a ~9-app catalog (revisit at v4).

### 3.1 Data model changes
- **New status** `rejected` + `RejectReason string` (curator-supplied, shown to submitter).
- **Screenshots:** `ScreenshotCIDs` stored as `[]string` but **taken over the wire as a single delimited CSV string** (`SetScreenshots(cur, pkgPath, csv)` / a csv param on `RegisterApp`) — a slice-typed MsgCall param is awkward for Adena; split + validate on-chain (≤6, each ≤`MaxCIDLen`, strict CID shape).
- **Free-resubmit credit:** `paidResubmitCredit bool` on the listing — set on reject, consumed by one free `EditListing` resubmit; second reject = no credit.

### 3.2 Bounded reads (architecture MUST-fix — the current design is O(total))
`ListLiveJSON` filters in-iterate; for a *minority* status (the curator queue) that is a full-catalog scan = the read-DoS the code claims to avoid. Add:
```
statusIndex    = avl  // key: status + "\x00" + zeroPad(id) -> pkgPath
publisherIndex = avl  // key: publisherAddr + "\x00" + zeroPad(id) -> pkgPath
counters: liveCount / pendingCount / rejectedCount / delistedCount (O(1))
```
- `ListByStatusJSON(status, offset, limit)` / `ListByPublisherJSON(addr, offset, limit)`: prefix-bounded range-iterate → true O(offset+limit), FIFO by zero-padded id.
- **Maintain both indexes + counters on EVERY status transition** (`RegisterApp`, `ApproveApp`, `RejectApp`, `DelistApp`, `RestoreApp`, `SeedListing`). A missed transition silently corrupts a queue → exhaustive tests required.
- `isVisible` (flag-auto-hide) stays a **read-time filter layered on the "live" window** (flag-hide is not a status change).

### 3.3 New / changed writes
- `RejectApp(cur, pkgPath, reason)` — curator-only, `pending→rejected`, stores reason, sets `paidResubmitCredit=true`.
- `EditListing(cur, pkgPath, ...)` — publisher-only; **panic if status ∈ {live, delisted}**; **always resets status→pending** (re-review); edit **cooldown** (by `ChainHeight`) + re-submission cap to kill the reject→edit→pending griefing loop.
- **`FlagApp` extended to `pending`** (today live-only) + auto-hide a pending listing past `FlagHideThreshold` → the public Pending tab gets a community safety valve.
- **`appURL` scheme allowlist** (`http`/`https`/leading `/` only) enforced on-chain in `RegisterApp` + `EditListing` (defense-in-depth behind the frontend `AppLink`).

### 3.4 Migration `SeedListing` (+ mandatory seal)
- `SeedListing(cur, full listing incl. Id + original CreatedAt + FlagCount + Status + Publisher)` — owner-only, **non-payable** (pure tree `Set`s, never touches the banker), dedupe on pkgPath, reuse `validatePkgPath`, update `nextId = max+1` + indexes + counters.
- **`FinalizeSeed()` one-way latch** (owner-only, sets permanent `seedingSealed` → `SeedListing` panics thereafter). **Non-negotiable** (security + architecture): without it, `SeedListing` is a permanent fee-free listing-forgery backdoor with arbitrary Publisher/CreatedAt.
- **State carry-over (seed from LIVE v2 values, not `init()` defaults):** `owner`, `treasury`, `registrationFee`, `paused` re-seeded from v2 getters (v2 may have been repointed / DAO-handed-off); `curators` reconstructed by replaying `CuratorAdded`/`CuratorRemoved` events; all listings reconstructed from `AppRegistered` events + `GetListingJSON`; **`flaggedBy` deliberately reset** (unrecoverable — `AppFlagged` doesn't emit the flagger) so `FlagCount=0` on v3.

### 3.5 New getters (frontend needs these — currently missing)
- `IsCurator(addr) bool` — the curator-dashboard gate (`isCurator` is private today).
- `GetCuratorsJSON()` — curator management + makes the *next* migration recoverable (curator set is currently unrecoverable from v2).
- Per-status counts in `GetStatsJSON` (served from O(1) counters).
- `RejectReason` + `ScreenshotCIDs` added to the **full** `GetListingJSON` only (list windows stay small); `rejectReason` also in the my-submissions/rejected window (short).
- `jsonEscape` **every** new field incl. each CSV/CID element and `RejectReason`.

### 3.6 Fee path (unchanged shape, re-verified on v3)
The money path is provably safe and mirrors `memba_token_otc_v1/otc.gno` — but the guarantees do **not** inherit from v2 (fresh deploy, new params). Re-run the fee-path checklist against v3, and order validation correctly: `assertNotPaused → IsUserCall → validate (incl. ≤6 CIDs) → exact-coin OriginSend → treasury≠"" → CEI write → banker forward`. CID/screenshot validation sits **before** `OriginSend`, never between the coin read and the forward.

---

## 4. On-chain — dedicated reviews realm

**Build a shared package, not a 720-line fork** (architecture; precedent = `memba_market_core_v2`):
- Extract the review engine into **`p/samcrew/reviews`** (a `ReviewStore` struct holding the avl trees + `Post/Edit/Delete/React/Flag/Hide` methods + pure JSON renderers).
- `memba_appstore_reviews_v1` (`gno.land/r/samcrew/memba_appstore_reviews_v1`) is a ~40-line consumer supplying only `ModeratorAddress` (**confirm = samcrew multisig before deploy**), `caller()` plumbing, and `Render()`. Zero drift; a future `memba_reviews_v2` can adopt it.
- **Dedicated realm is justified** by **reputation isolation** — `memba_reviews_v1` keeps a *global per-author* reputation; sharing would let sockpuppet down-votes on an app review tank someone's validator web-of-trust. A separate realm walls that off + gives an independent moderator multisig.
- **Subject** = the app's own `pkgPath` (stable across v2→v3). Realm stays decoupled (accepts any subject string); the **frontend** only renders reviews for listed apps and applies integrity signals (§5.2). Owner decision (§8): hard-constrain subjects to registered apps via a cross-realm read (extra coupling) vs frontend-only (recommended).
- One pre-cutover check: if any app reviews were already posted to the *shared* `memba_reviews_v1` (subject=pkgPath) they won't appear in the dedicated realm — verify none exist (App Store only de-gated Jul 7).

---

## 5. Frontend (build on the merged #808 redesign)

### 5.1 Slices, files, and contention
| Slice | New/edited files | Notes |
|---|---|---|
| **B1 read side** | `pages/AppStore.tsx`, `appstore.css`, `lib/appStore.ts`(+test) | v3 repoint (**fix `appStore.test.ts` `_v2`→`_v3`**); Verified default + Pending opt-in toggle + amber chip; screenshots gallery; `AppReviewStars`; sort/filter; **Report button** (flagCount exists); **status enum literals** (never free-text into a qeval expr); **CID shape validation in `coerce`**. |
| **B2a reviews refactor** | `lib/reviews.ts` (Lane-A) | Thread a `realm = DEFAULT_REVIEWS_PATH` default arg through the 14 baked-in fns (`evalJSON`, `fetchReputation`, `buildReviewMsgCall` + 13 builders). Backward-compatible; **its own pre-PR, Lane-A-reviewed in isolation.** |
| **B2b reviews mount** | `lib/appReviews.ts`(+test, new), AppDetail panel | `<ReviewsSection realmPath={APPSTORE_REVIEWS_PATH} subject={pkgPath}/>`; reuse `StarRating`/`ReviewCard`/`useBlockTime` verbatim. |
| **B3 submission (money path, merges DARK)** | `pages/AppSubmit.tsx`, `lib/appStoreSubmit.ts`(+test, new), `App.tsx` route | New builder `send:"1000000ugnot"` (verified live pattern; `RegisterUsernameForm` analog). React-Query **mutation + `setQueryData`** (not the reviews ref-based reconcile). |
| **B4 curator dashboard** | `pages/AppCurator.tsx`, `lib/appStoreCuration.ts`(+test, new) | `IsCurator` gate (UX-only; realm enforces). Approve / Reject(reason). |
| **B5 My Submissions** | `pages/AppMine.tsx`, `lib/appStoreMine.ts`(+test, new) | `ListByPublisherJSON(me)`; status + reject reason + **free resubmit** via `EditListing`. |

- **Routing:** `/apps/*` is a splat parsed as a pkgPath, so **`/apps/submit` currently falls through to the grid** — add explicit `apps/submit` · `apps/review` · `apps/mine` routes, **each wrapped in `<AppStoreGate>`** (mirror the feed's per-route gating), lazy-split + route-tested.
- **Contention:** B2/B4/B5 share `AppStore.tsx`/`appstore.css`/`config.ts` → **serialize B1→B2→B4→B5** on those; B3/B4/B5 logic lives in new files. #823 (Space Invaders) lives in `frontend/src/games/**` — **does NOT touch appstore files**. `config.ts`/`App.tsx`/`navManifest.ts` = additive append + rebase.

### 5.2 Review integrity (cheap, high-trust)
Show reviewer **member-age / XP tier** (already resolved) next to the star; a **"Used this app"** badge when the reviewer's address has actually called that realm (pure on-chain read, first-party apps); display **"4.6 ★ (n=12)"** not a bare bar; **hide the rating under 3 reviews** ("Not enough reviews yet"). Skip stake-weighting / reputation algorithms.

### 5.3 IPFS (plan correction) + submission funnel
- **It's the avatar pipeline, not the feed:** `lib/ipfs.ts` → `POST /api/upload/avatar` → Lighthouse. Reuse the **low-level `uploadToLighthouse`** (not `uploadAvatar`, which hard-resizes to 256²/512KB — fine for the icon, destroys screenshots); add a **screenshot preprocess under the backend 2 MB cap**; up to 7 uploads/submission → sequential + backoff on the `"upload"` rate bucket.
- **Auth coupling (real gap):** the upload route requires a **Memba backend JWT (`memba_auth_token`), separate from an Adena connection.** The submit funnel must **force Memba backend sign-in before the upload step** (or gate the pickers on `memba_auth_token`).
- **Funnel (5 steps, no dead ends):** connect wallet → 6 required fields (`name`, `pkgPath` [validated, doubles as best auto-reject], `tagline`, `category`, `appURL`, `iconCID`) with **live card preview** → fee disclosure → sign 1 GNOT → confirmation into My Submissions (`Pending review`). `descr` + ≤6 screenshots optional at submit but **required to reach Verified** (curator gate, not submit gate). Publisher = connected wallet (no free-text).
- **Fee copy (before signing):** *"1 GNOT listing fee → samcrew treasury. Deters spam and funds curation. Not refundable, including if rejected."* Reject copy: *"Not approved: {reason}. Fix and resubmit free."*
- **Curator load controls:** pre-pay client+realm auto-reject (malformed / duplicate / non-existent pkgPath, non-https URL); rate-limit pending per wallet (≈3); honest SLA *"most submissions reviewed within 3 business days"* on the form.

### 5.4 Flags (ops MUST-fix)
- `VITE_ENABLE_APP_REVIEWS` — new **read-only** flag, **NOT** in `SAFETY_GATED_FLAGS`; register in `navFlags.ts`; default `false`.
- **`VITE_ENABLE_APPSTORE_SUBMIT` — NEW flag, ADDED to `SAFETY_GATED_FLAGS`.** The money path must NOT ride the already-de-gated `VITE_ENABLE_APPSTORE` (no build brake). B3 physically cannot ship green until code review removes the gate **after** the v3 fee-path checklist passes. Consider **re-gating `VITE_ENABLE_APPSTORE`** until v3's fee path is re-verified.

---

## 6. Delivery — order, CI, coordination

**Merge `#822` (CHANGELOG `merge=union` driver) FIRST** — then all 7 PRs' `[Unreleased]` appends auto-concatenate; each PR still needs a unique `### ` heading (the `Changelog entry` gate fails any `frontend/**` PR without one).

**Merge-order DAG:**
```
#822 ──► unblocks CHANGELOG
[p/samcrew/reviews pkg → A2 reviews realm]  ∥  [A1 v3 realm]      (deployer repo)
        └─► OWNER: deploy A1+A2 → SeedListing migrate → FinalizeSeed → verify parity
                 └─► FE repoint APPSTORE_REALM_PATH v2→v3 (serialize: realm live BEFORE repoint)
B1 read ──► B2a reviews.ts refactor ──► B2b reviews mount ; B4 curator ; B5 mine   (serialize on shared files)
B3 submit — built in parallel, MERGES DARK, enabled ONLY after v3 fee-path checklist
```
Parallel-safe: `A1 ∥ A2`; all B-series **development** against gnodev / live v2 (only the flag-flip / v3 repoint serializes).

**CI reality:** a `feat/*` branch with no open PR runs **zero** CI — **opening the PR runs the suite**; `cancel-in-progress` means each rebase restarts CI, so **re-confirm the full required set green after the final rebase**. Required FE checks: `Backend (Go)`, `Frontend (React · Node 20)`, **`Frontend (React · Node 22)`**, **`Frontend E2E (chromium)`**, `Frontend E2E guardrails`, `Proto (Buf)`, `Docker Build`, **`Changelog entry`**, `Go Security Scan`, `CodeQL (javascript-typescript)` + `CodeQL (go)`, `Dependency Review`. Deployer PRs (A1/A2): `Gno Test & Lint`, `ShellCheck`, `Bash Syntax Check` — and **add each new realm dir to `KNOWN` in `test.yml`** or the classification Guard reddens the PR.

**Hard rules (every PR):** branch + PR, never commit on main; **implement in an isolated git worktree** (the shared `Memba/` checkout is actively committed by the parallel session); **rebase on main immediately before merge and re-await green**; **deep review + CTO-panel review before merge**; **never merge without explicit owner approval** even on green; **zero Claude attribution**; register a `SESSION_SYNC.md` lane before touching each shared file (`CHANGELOG.md`, `.env.example*`, `config.ts`, `App.tsx`, `navManifest.ts`, `reviews.ts`, tx toolkit). Stay clear of Lane C (multisig-signing paths) and `api/**`/`Proto` (B-series is on-chain reads/writes, no backend RPC).

---

## 7. Owner-gated actions (I cannot execute these)
1. Per-PR merge approval (even green).
2. Deploy `p/samcrew/reviews` + `memba_appstore_reviews_v1` + `memba_appstore_v3` to test13 (multisig `addpkg`).
3. Run `SeedListing` migration → **`FinalizeSeed()`** → verify v3 parity with v2 **before** the frontend repoint.
4. **Author + execute the App Store fee-path runbook** on test13 (none exists today — model on the NFT one; add the §2/§3 pending-tab mitigations as gates) → then de-gate `VITE_ENABLE_APPSTORE_SUBMIT`.
5. Netlify flag flips: `VITE_ENABLE_APP_REVIEWS` (after A2 live), `VITE_ENABLE_APPSTORE_SUBMIT` (after checklist).
6. Confirm `ModeratorAddress` for the reviews realm = samcrew multisig; optionally set the `appstore` DAO fee lane (defaults 200 bps).

---

## 8. Decisions — RESOLVED (owner, 2026-07-08)
1. **Trust framing:** ✅ **"Pending review", opt-in, off by default** + amber chip + hardened interstitial; stars never promote to Verified. (Not a visible peer tab.)
2. **Reviews engine:** ✅ **Extract `p/samcrew/reviews` shared package**; `memba_appstore_reviews_v1` is its first ~40-line consumer.
3. **Review-subject constraint:** ✅ **Frontend-only** (render reviews for listed apps + integrity signals); realm stays decoupled.
4. **Free-resubmit-once:** ✅ **Include** in v3 (`paidResubmitCredit` field).

---

## 9. Panel verdicts
- **Security:** SHIP-WITH-CHANGES (~0.85). Money path sound; risk moved to the public pending tab — addressable with idiomatic realm changes (flag-on-pending, appURL allowlist, seal SeedListing, escape new fields) + FE validation.
- **Architecture:** approve direction; 4 non-negotiables (status/publisher indexes + counters, FinalizeSeed latch, IsCurator/GetCuratorsJSON getters, reviews-as-package).
- **Frontend:** GREEN; coin-attach LOW-risk (solved pattern); real gaps = IPFS/backend-auth coupling + AppStore.tsx contention; reviews.ts refactor as its own pre-PR.
- **Product/UX:** meets intent; single biggest risk = the "Unverified peer tab" framing → make Pending opt-in + hardened interstitial + never let stars promote to Verified.
- **Ops:** GO conditional on (a) merge #822 first, (b) gated `VITE_ENABLE_APPSTORE_SUBMIT`, (c) author the fee-path runbook before B3 enablement.
