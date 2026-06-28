# Validator Profile Pages — Audit & Implementation Plan

> **Status: ✅ SHIPPED (2026-06-26).** All 5 reported bugs + polish merged in **#581** (`aefc0f1`). The follow-up roster-pagination fix (candidate count capped at 50) shipped in **#585** (`e2bd46d`). Deferred (see §4): review subject-orphaning, token-family unification (`vd-*`/`vp-*`/`reviews-*`), optimistic updates, and a prod visual eyeball.

**Date:** 2026-06-26
**Scope:** The single-validator profile page `/:network/validators/:address` (`ValidatorProfile.tsx`) and its persistent Reviews section. One focused, reviewable PR: the 5 reported bugs **+** the high-impact theme / a11y / loading polish surfaced by audit.
**Reference subject:** `g1k7asng8uzf74xs0tsrfwytldl76hs4l3asglym` (the Samourai-crew validator).
**Branch base:** `chore/reviews-enable-flag` (reviews un-gated via `5a5817e`).

---

## 0. Key facts established by investigation

- **The reference validator is a `genesis` identity case.** It is in the live consensus set (1 of 10 on test13) but has **no valoper record** — `r/gnops/valopers:g1k7asng8…` returns `unknown address`. There is **no Samourai entry registered** in the valopers realm at all. This one fact drives bugs #3 and #5.
- **The reviews realm stores block height, not time.** `memba_reviews_v1.gno`: `CreatedAt int64 // block height` set via `runtime.ChainHeight()` (no `time` import). The realm is immutable-path (already deployed to test13), so the fix is **frontend-side** resolution.
- **RPC `/block?height=N` returns real block time.** Verified: block `432000` → `2026-06-24T11:17:29Z`; current height ~`478528`. So block height → wall-clock is resolvable and accurate.
- **No live ecosystem breaking changes.** The 67 unmerged `gno` master commits (chain.emit hard-cap #5858, grc721 event schema #5745, gnoclient session signing #5657) are next-chain-upgrade risks only; `gnolove` contribution API and `adena-wallet` are unchanged/aligned. Out of scope for this PR.

---

## 1. Decisions (locked with stakeholder)

1. **Scope:** 5 reported bugs **+** high-impact polish — one PR.
2. **Dates:** Resolve block height → real block time via RPC `/block?height=N`, cached + deduped. Exact human dates.
3. **Genesis identity:** Curated address map **+** general moniker merge (so all genesis validators get names where available; Samourai gets name + contributions).
4. **Logged-out reviews form:** Fully interactive (pick stars + type) before connect; "Post review" triggers Adena connect, then submits.

---

## 2. Root-cause map (the 5 reported bugs)

| # | Symptom | Root cause | File:line |
|---|---------|-----------|-----------|
| 1 | Reviews UI hidden when logged out | Whole write-form replaced by a "Connect wallet" prompt when `!connected` | `ReviewsSection.tsx:106–152` |
| 2 | Date "6 Jan 1970" | `new Date(ts*1000)` treats a **block height** (~432000) as Unix seconds | `ReviewCard.tsx:42–49` (review header `:269` + comment row `:93`) |
| 3 | Name not shown (address only) | `getValidators()` returns `moniker:""`; genesis path reads it raw → `genesisMoniker=""`; no moniker merge, no curated fallback | `ValidatorProfile.tsx:207,216–218,248` |
| 4 | "Loading validator…" off-center | `.vd-loading` is a left-aligned flex (`align-items:center`, `padding:3rem 0`), unlike canonical centered loaders; reused 2nd time in perf panel | `validator-detail.css:56–63`; `ValidatorProfile.tsx:260–267`; `ValidatorPerformancePanel.tsx:150–157` |
| 5 | "No gno contributions found" | `resolveValidatorIdentity` needs moniker or `BY_ADDRESS` hit; genesis → no moniker; address not curated | `validatorIdentity.ts:22–47`; `ValidatorProfile.tsx:188–193,575–580` |

---

## 3. Implementation — phased

> Methodology: TDD per the repo norm (`npm run build` to typecheck — `tsc --noEmit` is a no-op here; Vitest for units; existing Playwright specs for regression). Each phase is independently reviewable.

### Phase 1 — Reviews date (#2): block-height → real time

**New module `frontend/src/lib/blockTime.ts`**
- `export async function fetchBlockTime(height: number, rpcUrl?): Promise<number | null>` — GET `${rpc}/block?height=${height}`, parse `result.block.header.time` (RFC3339) → epoch **ms**; return `null` on failure / height 0.
- Module-level `Map<number, number|null>` cache **+** in-flight `Map<number, Promise>` dedup so N review cards requesting the same height fire **one** request.
- `export async function fetchBlockTimes(heights: number[]): Promise<Map<number, number>>` — dedupe, `Promise.all`, skip cached. (Batch entry used by the section.)

**New hook `frontend/src/hooks/useBlockTime.ts`**
- `useBlockTime(height: number): { ms: number | null; loading: boolean }` — reads cache synchronously, else fetches; cancels on unmount via mounted-guard.

**`ReviewCard.tsx`**
- Replace `formatDate(ts)` with a height-aware renderer:
  - `const created = useBlockTime(review.createdAt)`
  - While `loading` → show a thin shimmer or `·` (no "1970"); when `ms` resolves → `new Date(ms).toLocaleDateString(undefined,{year,month:'short',day})`; if resolution fails → graceful fallback `block #${review.createdAt}` (tooltip `title` always carries the block height for provenance).
  - Apply to **both** call sites: review header (`:269`) and `CommentRow` (`:93`) → both use `useBlockTime(c.createdAt)`.
  - `editedAt` "(edited)" badge: keep the boolean check; optionally title-tooltip its resolved date.
- Delete the seconds-based `formatDate` (or keep a renamed pure helper `formatEpochDate(ms)` used by the hook output).

**Tests:** `blockTime.test.ts` (cache hit, dedup single-flight, null on 0/failure, RFC3339→ms); `ReviewCard` test asserts no "1970" and that a known height renders the mapped date (mock the hook).

---

### Phase 2 — Logged-out reviews form (#1 + #4 reviews UX)

**`ReviewsSection.tsx`**
- **Always render the form** (remove the `connected ? form : connectPrompt` fork at `:106–152`). Stars + textarea are interactive regardless of connection.
- `handleSubmit`: if `!connected || !address`, call `await connect()` first; if still not connected (user cancelled), set a soft `submitError` ("Connect your wallet to post") and return; else proceed to `buildPostReviewMsg → submitMsg`.
- Single permanence notice (de-dup the two copies at `:124` and `:148`).
- "Post review" button label stays; disabled only while `submitting` or `rating===0` (not gated on connect — connect happens on click).
- **De-dup the reply path** in `ReviewCard.tsx:420–457` the same way: show the reply affordance to everyone; connect-on-submit.

**Loading consistency (#4, reviews half):**
- Replace plain "Loading reviews…" (`:155`) with **skeleton review cards** matching `.review-card` geometry (2–3 placeholders).
- On `subject` change, **reset `reviews`/`summary` to empty at the top of `load()`** so the previous validator's reviews don't flash under the new spinner.

**Tests:** `ReviewsSection.test.tsx` — form visible when disconnected; submit while disconnected calls `connect()` then `submitMsg`; cancelled connect shows soft error and does not submit; list resets on subject change.

---

### Phase 3 — Genesis validator name (#3) + contributions (#5)

**`validatorIdentity.ts`** — add to `BY_ADDRESS`:
```ts
"g1k7asng8uzf74xs0tsrfwytldl76hs4l3asglym": team("samouraiworld", "Samourai.world"),
```
Fixes #5 directly (Contributions tab now resolves the Samourai team).

**`ValidatorProfile.tsx`** — name fallback + moniker merge:
- **Display-name fallback chain** (`:248`):
  `valoper?.moniker || genesisMoniker || mappedIdentity?.label || truncateValidatorAddr(address)`
  → the Samourai genesis validator now titles as **"Samourai.world"** instead of the raw address. (`mappedIdentity` is already computed at `:188`.)
- **General moniker merge** so *other* genesis validators get names where the network exposes one: after `getValidators()` in `load()` (`:207`), enrich via the existing pipeline already used by the list page — `fetchValoperMonikers` + `mergeValoperMonikers` and/or `mergeWithMonitoringData` (`validators.ts:188,237,272`). Reuse the **exact** sequence `Validators.tsx` uses (confirm at implementation; avoid divergence). Then `genesisMoniker` is sourced from the enriched list.
  - Keep non-blocking / abort-safe (already inside the `ctrl.signal` guarded `load`).
- Update `document.title` + breadcrumb (`:251,:343`) automatically via the same `moniker` value.

**Tests:** `validatorIdentity.test.ts` — the new address resolves to the samouraiworld team. `ValidatorProfile.test.tsx` — genesis validator with a curated identity renders the label as moniker (not the address) and renders the mapped contributions card; genesis with no identity still truncates address.

---

### Phase 4 — Loading state centering (#4, page half)

**`validator-detail.css` / canonical loader**
- `.vd-loading`: center both axes — `justify-content:center; align-items:center; min-height:40vh;` (or match the app's canonical page-loader). Confirm against the main pages' loader idiom (`hk-pulse` spinner usage) so the validator route matches the rest of the app.
- Apply the same to the **Performance panel** loading (`ValidatorPerformancePanel.tsx:150–157`) so the in-tab loader is centered too.
- Keep the back-nav header visible above the loader (current behavior) so the page doesn't look blank.

**Tests:** existing Playwright validator specs assert the page renders; add a centered-loader visual assertion only if cheap (otherwise rely on the CSS review).

---

### Phase 5 — Light-theme + a11y polish (high-impact subset)

**Light theme (`reviews.css`)** — replace dark-only white fills with tokens:
- `.review-card__rep-chip` bg `rgba(255,255,255,0.04)` (`:87`) → token surface.
- `.review-comment` bg `rgba(255,255,255,0.02)` (`:258`) → token.
- `.reviews-section__permanence` bg `rgba(255,255,255,0.02)` (`:424`) → token.
- `.reviews-section__connect-prompt` bg `rgba(255,255,255,0.01)` (`:435`) → token (note: prompt is removed in Phase 2, but if any residual chrome remains, tokenize it).
- Verify against the §13 light-theme CI guardrail (`ci.yml`) — no new hardcoded text colors.

**Accessibility**
- **StarRating input mode** (`StarRating.tsx:22–34`): convert the 5 buttons to a **`role="radiogroup"`** with `role="radio"` + `aria-checked`, roving `tabIndex`, and **Left/Right + Home/End** key handling; add **hover-fill preview** (stars 1..n fill on hover, revert on leave) via local hover state. Associate with its label (`ReviewsSection.tsx:108` "Your rating" span gets an `id`; group gets `aria-labelledby`).
- **ReviewCard action buttons** (`:314–349`): wrap emoji in `aria-hidden` spans; add explicit `aria-label` to **Reply** and **Flag** (currently none).
- **Live regions:** add `aria-live="polite"` to the reviews list/status container and the comments container so post/reload is announced.

**Logic correctness (cheap, ride-along)**
- **Comment tombstone filter** (`ReviewCard.tsx:408–409`): remove the inverted `!c.deleted || c.body===""` pre-filter; let `CommentRow` render `[deleted]` (it already handles `comment.deleted` at `:65`).
- **Reviews abort/stale-write** (`ReviewsSection.tsx:47–65`): guard `load()` with a captured-`subject` / AbortController so a late resolve for a previous subject can't overwrite the current view (mirrors `ValidatorProfile.load` and the perf panel).
- **Average single source of truth** (`ReviewsSection.tsx:85,96`): use one computation for both the star and the number (either on-chain `summary.average` or the client recompute — pick recompute for consistency, drop the unused field or use it consistently).

**Tests:** StarRating keyboard test (arrow moves selection, Enter/click sets, hover preview class); a11y label presence test; tombstone test (deleted non-empty comment shows `[deleted]`); abort/stale test.

---

## 4. Out of scope (deferred, noted for a follow-up)

- **Full token-family unification** across `vd-*` / `vp-*` / `reviews-*` and responsive-breakpoint reconciliation (480/640/768) — structural, larger diff.
- **Optimistic updates** for like/dislike/flag/reply (currently full refetch per action) — UX win but bigger; ride-along only the stale-write guard now.
- **Review subject-continuity / orphaning**: a genesis validator's reviews are keyed by signing address; registering a valoper later flips the subject to operator address, orphaning prior reviews. Needs a realm-level alias or a frontend subject-resolution policy — design separately.
- **Dead CSS** (`.vp-soon`, `.vp-desc`) and the stale "5 tabs" JSDoc — trivial cleanup, fold in if the diff stays small.
- **Reviews realm v2** storing `time.Now().Unix()` instead of block height — would obsolete Phase 1's resolver, but requires a new immutable realm path + migration; not worth it now.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| `/block?height=N` adds latency / RPC load for review lists | Cache + single-flight dedup; only distinct heights; graceful `block #N` fallback on failure (never blocks render). |
| Moniker-merge pipeline drift vs. `Validators.tsx` | Reuse the **exact** existing sequence; add a unit test pinning genesis-moniker resolution. |
| Curated address could later become a registered valoper | `BY_ADDRESS` is precedence-after-valoper in the resolver; once registered, the real valoper moniker wins — curated entry becomes a harmless contributions hint. |
| Always-on form changes connect funnel | Connect-on-submit preserves the gate; cancelled connect shows a soft inline error, no tx. |
| Light-theme token swaps regress dark theme | Verify both themes on deploy-preview; rely on §13 CI guardrail. |
| `VITE_ENABLE_REVIEWS` prod-flag state | Per memory, the flag is live; this PR only touches reviews **UI behavior**, no realm/flag changes — safe. Confirm before merge. |

---

## 6. Test & verification plan

- **Unit (Vitest):** `blockTime.test.ts`, `validatorIdentity.test.ts` (new address), `ReviewsSection.test.tsx` (logged-out form, connect-on-submit, subject reset), `ReviewCard` (date no-1970, tombstone), `StarRating` (keyboard + hover).
- **Build:** `cd frontend && npm run build` (the real typecheck).
- **Playwright:** run existing validator/profile specs for regression; verify genesis profile renders name + contributions.
- **Manual / deploy-preview:** the reference URL in **both themes** — name shows "Samourai.world", contributions show the team, a posted review shows a real date, the form is usable logged-out, loaders are centered.

---

## 7. Phase → PR-commit breakdown (suggested)

1. `blockTime` resolver + hook + ReviewCard date fix (#2)
2. Logged-out reviews form + connect-on-submit + reply path + skeletons + subject reset (#1)
3. Curated Samourai address + name fallback chain + moniker merge (#3, #5)
4. Loading centering (page + perf panel) (#4)
5. Light-theme token swaps + StarRating a11y/hover + action aria + tombstone + abort guard (polish)

One PR, commits in this order so review can track each reported bug to its fix.
