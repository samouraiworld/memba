# Validators — Unified Profile Page, Light-Theme Fixes & Overview Optimisation

- **Date:** 2026-06-26
- **Status:** DRAFT — awaiting review (no production code changed; this doc + an audit worktree only)
- **Worktree / base branch:** `memba-validators` on `feat/validators-unify`, cut from `origin/main` @ `d9b4ce9`
- **Author note:** house rules — never commit on `main`; `cd` into the worktree before any `git commit` (the hook checks the Bash cwd's branch); no Claude attribution in commits/PRs; **never merge without explicit approval**.

---

## 0. TL;DR

Today there are **two different validator profile pages**, keyed by **two different addresses**, with **no overlap on test13**:

| Route | Component | Keyed by | Shows | Missing |
|---|---|---|---|---|
| `/validators/:address` | `ValidatorDetail.tsx` | **signing / consensus** addr (`gnoAddr`) | voting power, uptime, 100-block heatmap, incidents, health | identity, bio, socials, reviews, contributions |
| `/validators/valoper/:operatorAddress` | `ValoperDetail.tsx` (the "Blend" page, #553) | **operator** addr | identity header + Overview/Reviews/Quests/Contributions/Activity tabs | **all performance / technical metrics** |

We will collapse these into **one canonical profile** at `/validators/:address` that composes both data sources, adds a **Performance** tab, and gracefully degrades per-section. The legacy `/validators/valoper/:x` route becomes a redirect. Both list entry points link to the one canonical page.

Plus three correctness/polish fixes the user reported:
1. **Light theme is unreadable** on both profile pages — root cause is `validator-detail.css` (23 hardcoded white text literals), imported by **both** pages. Live-confirmed: the performance page is almost entirely white-on-white.
2. The **"What's new" update toast** is dark-only (hardcoded dark surface).
3. The **overview page** is a ~9,000px infinite scroll — optimisation proposal below.

**Sequencing recommendation:** ship the light-theme + toast fixes **first** as a small, independent, low-risk PR (immediate user-visible win, zero logic change), then build the unified profile, then the overview. Decisions confirmed with the user are in §1.

---

## 1. Confirmed decisions (from review)

- **D1 — Unification model:** single canonical route `/validators/:address` rendering one `<ValidatorProfile>`; legacy `/validators/valoper/:operatorAddress` **redirects** to it. ✅
- **D2 — Performance placement:** a **dedicated "Performance" tab** (not folded into Overview). ✅
- **D2b — Reviews placement:** community reviews/rating is **NOT a tab** — it's a **persistent section on the page, below the tab content**, always visible. ✅
- **D3 — Overview layout:** recommended in this doc (§5), decision deferred to review. ✅ (Recommendation: **segment into tabs**.)

---

## 2. Upstream breaking-change audit (fetch-only; no working trees disturbed)

Method: `git fetch` + `log` across the workspace Gno repos. Window: 2026-06-20 → 06-26 (extends the prior 06-24 audit).

| Repo | State | Memba-relevant change | Verdict |
|---|---|---|---|
| **gno** | local edits (held — not pulled) | `r/gnops/valopers` realm: **no change since Jun 1**; `tm2/pkg/bft/rpc` wire: **no change since Jun 1** | **No break.** Memba reads validators via raw Tendermint RPC + this realm; both contracts stable. |
| **gnomonitoring** | clean, up to date | #111 govdao-resilience ("keep proposal on fetch failure") | **Additive**, not breaking the participation/uptime API Memba consumes. |
| **gnodaokit / adena-wallet / samcrew-deployer** | clean, 0 behind | none material | Benign. |

**Verdict: nothing upstream blocks this work or current prod.** Validators are read from `/validators`, `/dump_consensus_state`, `/net_info` (Tendermint RPC), valoper data from `gno.land/r/gnops/valopers` (`queryRender` → `parseValoperDetail`), monitoring from the gnomonitoring API — all unchanged.

**Collision check:** no open Memba branch touches `validator-detail.css`, `validators.css`, or `WhatsNewToast.tsx` (open PRs: #560 mobile guardrails, #559 light-shell — neither touches these). The light-theme fix is unclaimed. The unified-page work touches `ValoperDetail.tsx` / `Validators.tsx` / `App.tsx`, which the §13 light-shell PR does **not**.

---

## 3. The core challenge — two address spaces, disjoint sets

The unification is **not** a simple component merge, because the two pages are keyed by different addresses and on test13 describe **nearly-disjoint** populations:

- The **active validator set** = gno-core **genesis** nodes. These have **no valoper record** (they never registered at `r/gnops/valopers`).
- The **43 registered valopers** are mostly **candidates** — their `signingAddress` is **not** in the active set.
- The only join is `valoper.signingAddress ↔ validator.gnoAddr`.

So the unified page must resolve any incoming `:address` and render the right composition for **three identity cases**:

| Case | Incoming `:address` | Identity source | Performance tab |
|---|---|---|---|
| **A. Registered + active** | operator addr (canonical) | valoper record + gnolove | full metrics (its `signingAddress` ∈ active set) |
| **B. Registered + candidate** | operator addr (canonical) | valoper record + gnolove | "Not in the active set yet" explainer (no metrics) |
| **C. Active, unregistered (genesis)** | signing addr (`gnoAddr`) | minimal — moniker from validator set; identity/social/reviews show honest empty/"coming soon" | full metrics |

**Canonicalisation rule:** the **operator address** is the canonical identity whenever a valoper record exists; the **signing address** is canonical only for genesis validators with no valoper record. If someone deep-links a registered valoper's **signing** address, the page resolves it to the **operator** address and redirects (one hop, guarded against loops).

---

## 4. Implementation plan

### Phase 0 — Light theme + toast (independent, ship FIRST) 🎯

> **UPDATE (2026-06-26, mid-session):** **PR #561 "make validators + validator-detail readable (§13-C)" merged to main during this session** and already fixed `validator-detail.css` (0 hardcoded whites remain) + the `validators.css` badges + the embedded BlockHeatmap. Because `validator-detail.css` is imported by BOTH profile pages, the user-reported light-theme bug on `/validators/:address` **and** `/validators/valoper/:operatorAddress` is **now fixed on main**. **Phase 0 therefore collapses to the one thing #561 did NOT touch: the `WhatsNewToast` (0.4).** Items 0.1–0.3 below are superseded by #561 (kept for the record); 0.5's regression guard is shipped and now also protects #561's work.

Smallest, highest-value, lowest-risk. Pure CSS/style token swaps; **no logic change**. Separate branch (`feat/validators-light-theme`) + PR so it lands fast.

**0.1 `frontend/src/pages/validator-detail.css` — the root cause (23 hardcoded whites).**
Replace every `rgba(255,255,255,α)` with a semantic token, mapped **by role, not by alpha** (tokens are solid and already have light-theme overrides in `tokens.css`):

| Current | Role | → Token |
|---|---|---|
| `rgba(255,255,255,0.9/0.85)` | primary text (`.vd-moniker`, `.vd-stat-value`, `.vd-notfound h2`) | `var(--color-text)` |
| `rgba(255,255,255,0.7/0.55)` | strong secondary (`.vd-nav__current`, `.vd-row__value`) | `var(--color-text)` / `var(--color-text-secondary)` |
| `rgba(255,255,255,0.4/0.45/0.35)` | labels/hints (`.vd-stat-label`, `.vd-perf-label`) | `var(--color-text-secondary)` |
| `rgba(255,255,255,0.25/0.2)` | faint hints/separators (`.vd-nav__sep`, `.vd-stat-hint`, arrows) | `var(--color-text-muted)` / `var(--color-border)` |

**0.2 `frontend/src/pages/validators.css` — overview (9 whites + 5 dark hex).**
- `.val-incident-badge--warning { color:#1a1a1a; background:#facc15 }` and siblings → keep the semantic amber/danger **fill** but make text theme-aware (`var(--color-k-on-accent)` style) or use the existing `--color-k-amber-*` / `--color-k-danger-*` tokens.
- hardcoded borders `#111`, oranges `#f5a623`, status hexes → `var(--color-border)` / `var(--color-warning)` / `var(--color-k-*)`.

**0.3 `frontend/src/pages/valoper-detail.css` — 1 hardcoded white** → token (trivial; this file is otherwise token-clean with 106 var() uses).

**0.4 `frontend/src/components/ui/WhatsNewToast.tsx` — dark-only toast.**
- `background: "rgba(18,18,22,0.95)"` → `var(--color-bg-card)` (or a glass token); keep `backdropFilter`.
- `boxShadow` black → theme-aware (`var(--shadow-lg)` or reduce opacity on light).
- `NetworkItem` `background: "rgba(255,255,255,0.02)"` → `var(--color-surface)`.
- Text already uses `var(--color-text*)` — keep. Accent left-borders (teal/purple/cyan) are fine on both themes.

**0.5 Verification (Phase 0):** Playwright light **and** dark screenshots of both detail pages + the toast; mutation check (flip a token back to white → confirm it breaks). `npm run build` + `vitest` green. (Note: `frontend/` is standalone **npm** — `cd frontend && npm ci` in a fresh worktree; `tsc --noEmit` is a no-op, use `npm run build`.)

---

### Phase 1 — Unified `<ValidatorProfile>` (AAA core)

**1.1 Rename/refactor `ValoperDetail.tsx` → `ValidatorProfile.tsx`** as the base (it already has the identity header, tabs, owner-edit, graceful degradation, and quest/activity hooks). Route param becomes `:address`.

**1.2 Address resolution + canonicalisation (`useValidatorProfileResolution` or inline).**
On mount, in parallel:
- `getValidators(GNO_RPC_URL)` → active set keyed by `gnoAddr`; also gives genesis-validator monikers.
- `fetchValopers(...)` (or a targeted `queryRender(realm, :address)` first, then list for maps) → build `operator→valoper` + `signing→valoper`.

Resolve `:address`:
1. operator match → canonical valoper (cases A/B). Compute active via `computeValoperStatus(signingAddress, activeSet)`.
2. signing match of a **registered** valoper → `<Navigate replace to={np('validators/'+operatorAddress)} />` (one hop; guard: never redirect if already operator).
3. active-set `gnoAddr` with **no** valoper → genesis view (case C), keyed by the signing address.
4. else → not-found card (existing pattern).

**1.3 Add the "Performance" tab; move Reviews OUT of the tabs.** Tabs become `["Overview","Performance","Quests","Contributions","Activity"]` (Performance is 2nd, badged "new"). **Community reviews/rating is no longer a tab** — it becomes a **persistent on-page section** rendered below the tab panel (always visible on every profile, regardless of active tab), so the community rating has standing presence. The old `Reviews` tab and the duplicate Overview "reviews hero" are both removed in favour of this single persistent section. For now it shows the rating hero + "launching soon" (the on-chain reviews realm is P3); the section is theme-aware and degrades to the same coming-soon state across all three identity cases. Port the metric UI from `ValidatorDetail.tsx`:
- voting power + power bar, network share, proposer priority, start time, missed blocks, signed/missed/uptime, participation, incident timeline, `<BlockHeatmap>`, health badge, live-proposer 2s poll.
- **Lazy:** only fetch the heavy per-block heatmap + start the consensus poll **when the Performance tab is first opened** (keep identity paint instant; avoid the heatmap fan-out on every visit).
- Case B (candidate): the tab renders a clear "This operator is registered but **not in the active validator set yet**" explainer (reuse the identity-model note) instead of metrics.
- Case C (genesis): Overview/Contributions show honest **neutral** empty states (e.g. "No valoper profile is registered for this address") — **no "register as a valoper" CTA**; Performance is the primary content. Performance always sits 2nd in the tab order (no per-case reordering).

**1.4 Legacy route redirect.** In `App.tsx`, keep `/validators/valoper/:operatorAddress` but render `<Navigate replace to={np('validators/'+operatorAddress)} />` (or a 2-line redirect component). Preserves existing deep links/bookmarks. **Route order gotcha:** `/validators/:address` must remain **after** `/validators/hacker` and the valoper redirect (documented at `App.tsx` ~L215).

**1.5 Update entry points to the canonical route.**
- `ValoperPanel.tsx:59` — `nav('validators/valoper/'+operatorAddress)` → `nav('validators/'+operatorAddress)` (keep the `state:{valoper}` preset for instant paint).
- `Validators.tsx:454/458` — metrics-table row → already `navigate('/validators/'+gnoAddr)`; **make it network-scoped** (`np(...)`/`useNetworkNav`) and let the page canonicalise signing→operator on the rare overlap. Genesis rows stay valid (case C).

**1.6 Tests (TDD).** Extend `ValoperDetail.test.tsx` (591 lines today) / new `ValidatorProfile.test.tsx`:
- resolves operator → case A (active) shows Performance metrics.
- resolves operator → case B (candidate) shows the "not in active set" explainer.
- resolves genesis signing addr → case C shows Performance + minimal identity.
- signing addr of a registered valoper → redirects to operator route (no loop).
- legacy `/validators/valoper/:x` → redirects.
- heatmap/poll not fetched until Performance tab opened.

---

### Phase 2 — Overview optimisation

See §5 for the recommended design + trade-offs (decision deferred). Build the chosen direction; preserve all existing data sources, sorting, search, pagination, and the hacker-view link.

---

### Phase 3 — Polish & hardening

- **Bio raw-markdown fix:** the valoper `description` renders as raw markdown (`### Networks * **Mainnets:**…`). Render it through the existing markdown/sanitiser used elsewhere (e.g. the board/DAO description renderer) **or** strip-to-plain with line breaks — decision in review. (Bonus finding; not user-listed but visible in the live screenshot.)
- Live browser smoke (light **and** dark): all three identity cases, redirect, overview, toast. Screenshots attached to each PR.
- `npm run build` + `vitest` green; mutation checks for the light-theme tokens.

---

## 5. Overview optimisation — recommendation (decision deferred)

**Current:** one ~9,000px page stacking: stat cards → metrics table (~10 rows) → "Active operators" (4 cards) → **Candidates (43-card grid)** → blocktime timeline → **Network Nodes roster (~60 rows)**. The 43-card grid and 60-row roster dominate and bury the metrics table; the active-validators-vs-operators distinction (the disjoint-set confusion) is invisible.

**Recommended: segment into tabs** — `Validators` · `Operators` · `Network`.

```
⛓️ Validators                         [ Validators | Operators | Network ]
──────────────────────────────────────────────────────────────────────────
Validators ▸ stat cards + participation bar + metrics table (active set)
Operators  ▸ search + "Active operators" + "Candidates (43)" grid
Network    ▸ blocktime/signing timeline + full node roster (~60)
```

| Option | Pros | Cons |
|---|---|---|
| **Tabs (rec)** | Kills the 9k scroll; makes the active-set vs operators-vs-nodes distinction explicit (resolves the disjoint-set confusion conceptually); each view loads focused; deep-linkable via `?tab=` | More re-architecture; need to preserve sort/search/pagination per view |
| Collapse + densify | Smaller change; one URL | Still one long page; collapsed sections hide the candidate roster behind a click; doesn't clarify the concepts |

I recommend **tabs** because it both shortens the page and teaches the model (active validators ≠ registered operators ≠ network nodes), which is the same confusion that motivated unifying the profile pages. Final call is yours at review.

---

## 6. File-by-file change map (conflict surface)

| File | Phase | Change |
|---|---|---|
| `pages/validator-detail.css` | 0 | 23 hardcoded whites → tokens |
| `pages/validators.css` | 0,2 | 9 whites + 5 dark hex → tokens; (P2) tab/segment styles |
| `pages/valoper-detail.css` | 0,1 | 1 white → token; (P1) Performance-tab styles |
| `components/ui/WhatsNewToast.tsx` | 0 | dark surface/shadow/item-bg → tokens |
| `pages/ValoperDetail.tsx` → `ValidatorProfile.tsx` | 1 | rename; address resolution; Performance tab; lazy metrics |
| `pages/ValidatorDetail.tsx` | 1 | metric UI extracted to a shared `PerformancePanel` (or folded into the unified page); route removed/redirected |
| `App.tsx` | 1 | route `:address` → unified page; `valoper/:x` → redirect; preserve order |
| `components/validators/ValoperPanel.tsx` | 1 | link → canonical `validators/:operator` |
| `pages/Validators.tsx` | 1,2 | row link network-scoped; (P2) tab segmentation |
| `lib/valopers.ts` | 1 (opt) | thin `fetchValoperByAddress` + `signing→operator` helper (reuses parse) |
| `*.test.tsx` (ValoperDetail/ValidatorProfile, Validators, ValoperPanel) | 0–2 | resolution cases, redirect, no-loop, light-theme regression |

**Shared-file note:** `App.tsx` and `validators.css` are the only files spanning phases — sequence the PRs (Phase 0 first) to keep diffs clean.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Redirect loop (signing→operator) | Guard: only redirect when `:address` ≠ operator **and** a valoper record maps it; never from an operator address. Unit-tested. |
| Heatmap fan-out slows identity paint | Lazy-load Performance data on first tab open only. |
| Route-order regression (`:address` shadows `/hacker`, `/valoper`) | Keep `:address` last; existing E2E nav test covers it; add a redirect test. |
| `validator-detail.css` is shared → changing it affects both pages | Intended (that's the bug); verify both pages light+dark; mutation-test. |
| Breaking the 591-line ValoperDetail test suite on rename | Refactor tests alongside; keep `data-testid`s stable. |
| Fresh worktree missing deps | `cd frontend && npm ci` (standalone npm project); build, not `tsc --noEmit`. |
| Genesis-validator identity is thin (case C) | Honest, neutral empty states; don't fabricate identity, don't push a register CTA. |

---

## 8. Test & acceptance

**Unit (vitest):** resolution cases A/B/C; signing→operator redirect (no loop); legacy route redirect; lazy heatmap; light-theme token regression (no `rgba(255,255,255` in `validator-detail.css`).

**Live (browser smoke — required, light + dark):**
1. `/validators/:operator` (registered active) → identity + **Performance** populated.
2. `/validators/:operator` (candidate) → "not in active set" explainer.
3. `/validators/:genesisSigningAddr` → Performance + minimal identity.
4. `/validators/valoper/:x` → redirects to `/validators/:x`.
5. Both profile pages + toast readable in **light** theme (the reported bug).
6. Overview optimisation renders; sort/search/pagination intact.

**Acceptance:**
1. Exactly **one** profile page/URL pattern; legacy URL redirects. ✅
2. That page shows **both** performance metrics **and** identity/reviews/contributions, degrading gracefully per case. ✅
3. Light theme readable on every validator surface; toast theme-aware. ✅
4. Overview no longer a 9k scroll. ✅
5. `npm run build` + `vitest` green; live screenshots on each PR. ✅

---

## 9. PR sequencing (ask-before-merge on every one)

- **PR-1 (Phase 0):** light theme + toast. Small, fast, independent — ships the readability fix first.
- **PR-2 (Phase 1):** unified `<ValidatorProfile>` + redirect + entry-point relinks.
- **PR-3 (Phase 2):** overview optimisation (per chosen direction).
- **PR-4 (Phase 3):** bio markdown + hardening (optional/foldable into PR-2/3).

Each: own branch off `main`, CI-green, **explicit approval before merge**, no Claude attribution.

---

## Appendix — key references

- Profile pages: `pages/ValidatorDetail.tsx` (perf, by signing addr) · `pages/ValoperDetail.tsx` (blend, by operator addr, #553)
- Light-theme root cause: `pages/validator-detail.css` (23× `rgba(255,255,255,…)`) imported by both pages
- Toast: `components/ui/WhatsNewToast.tsx:102/108/224`
- Tokens: `tokens.css` (semantic `--color-*` → Kodera `--color-k-*`, with light overrides) · `index.css:67` (light theme block)
- Entry points: `Validators.tsx:454` (table row) · `ValoperPanel.tsx:59` (roster card)
- Data: `lib/validators.ts` (RPC) · `lib/valopers.ts` (`VALOPERS_REALM`, parse, `computeValoperStatus`)
- Routes: `App.tsx` (~L215, order gotcha)
- Prior art: `VALIDATORS_VALOPER_PROFILES_AUDIT_AND_PLAN_2026-06-24.md` (produced the Blend page) · `VALIDATORS_MONITORING_AUDIT_AND_PLAN.md`
