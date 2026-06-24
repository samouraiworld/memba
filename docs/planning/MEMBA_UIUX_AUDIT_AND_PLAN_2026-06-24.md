# Memba — UI/UX Audit & Implementation Plan

**Date:** 2026-06-24
**Author:** UI/UX tour & audit session (independent, hands-on)
**Status:** Draft for review
**Base:** `main` @ `71e1b9e` (footer reads `memba v4.1.0`)
**Method:** Live tour of production (`https://memba.samourai.app`, desktop 1440px + mobile 390px, light + dark) → code verification against current `main` → cross-reference with existing planning docs.

> **Relationship to existing plans.** This is **not** a replacement for `MEMBA_COMPLETE_AAA_PROGRAM_2026-06-24.md`. It is a **focused, hands-on UI/UX verification + plan** that (a) confirms which catalogued issues are *still open* vs *already shipped*, (b) adds *new* findings from a fresh tour, and (c) slots into the AAA program's **Epic E6 (Connected UX · mobile · a11y · light theme)** and the **demo-blocker** set for the 2026-06-26 gno-core-team demo. Where this plan and E6 overlap, treat E6's IDs as canonical and this doc as the verified, prioritised execution view.

---

## 0. Executive summary

The app is in genuinely good shape: **dark mode (the primary Kodera theme) is clean and polished**, the route surface is broad (44+ routes), Gnolove and the DAO/Validators/Quests features are feature-rich, and several previously-catalogued issues are **already fixed** (iOS `viewport-fit=cover`, DAOHome vote-enrichment honesty).

**Scope note (important):** the user is running **dedicated parallel audit sessions** for Directory, DAO/AI, Validators/valoper, Home/Atlas, and NFT — each with its own plan doc (§2). My independent tour **confirmed** their key findings (e.g. the Directory "VALIDATORS 0" and the breaking-change verdict), but to avoid conflict this plan **defers those areas to their owners** and concentrates on the **cross-cutting UI/UX layer + surfaces no one else owns**:

1. **Create Token is broken in light mode** (dark inputs + black banner on white) — my primary in-scope demo-blocker; **owned by no parallel session.**
2. **Light theme is the weak theme** generally (dark is the polished primary) — needs a consistency sweep, Create Token first.
3. **Honesty/gating (global):** `gnoland1` is selectable but its realms aren't deployed (connected actions fail) — a cross-cutting network-gating concern.
4. **Polish & IA (uncovered surfaces):** sparse Tokens page with no create CTA, Create-DAO preset cards lacking name labels, DAO plugins leaking into the global mobile "More" nav, Feedback-page mixed messaging, Quests visitor-XP.
5. **A11y & mobile tails:** semantic-button cleanups, grid stacking on very small screens, palette iOS-zoom.

**Upstream (gnolang/gno) breaking-change risk to Memba is LOW** — gno master moved 56 commits since the deployed test13 cut, but Memba runs against a *pinned* test13 chain and the backend has no gno-core dep; nothing breaks the deployed app (independently matches the Directory session's verdict). Watch-items in §7.

---

## 1. Method & coverage

| Layer | What was done |
|---|---|
| **Live tour (prod)** | Desktop (1440×900) + mobile (390×844), light + dark. Pages visited live: Home, Tokens, Token detail, DAO detail, DAO members, DAO treasury, Directory, Validators, Quests, Gnolove, Leaderboard, Alerts, Settings, Create Token, Create DAO, Feedback. Console errors checked per page (clean on the pages tested). |
| **Screenshot cache** | Re-used the session's `demo-walkthrough-shots/` (Jun 24) for already-captured states (home mobile, More sheet, validators mobile, govdao, command palette, extensions, marketplace coming-soon, 404). Fresh captures saved under `ui-audit-2026-06-24/`. |
| **Code verification** | Confirmed each finding against current `main` with file:line (see §3). Corrected stale catalogue items that are already shipped. |
| **Route inventory** | Full 44+ route map produced (see Appendix A). |
| **Deferred** | A handful of auth-only / parameterised surfaces (Profile, Multisig view/propose/tx, Proposal detail, Directory sub-tabs detail) were audited **from code only** — flagged below for live re-verification with a wallet. |

> **Tooling note.** A transient `classifier unavailable` outage during the session blocked Bash/subagent/git mid-audit. The **git deconfliction in §2 must be re-run before branching** (commands provided). All file:line refs below were verified via direct file reads.

---

## 2. Deconfliction & methodology (READ FIRST — parallel sessions are live)

### Ownership map

| Area | Owner | This plan |
|---|---|---|
| **Home page + home components** (`pages/Home.tsx`, VisitorHero, doors, ActionInbox, StateBoard, `YourWorldsPanel`, `ActionCard`, `useFeaturedDao`, `useYourWorlds`, `useDirectoryHighlights`, FeaturedDaoPanel) | **Home/Atlas session** (`fix/home-connected-feedback`, `feat/home-atlas`) | **OUT OF SCOPE.** Observations only; defer fixes. |
| **NFT + Marketplace** (`pages/nft/*`, `pages/studio/*`, `Marketplace.tsx`, `lib/nft*`, market modals) | **NFT session** (`feat/nft-marketplace-phase2`, worktree `memba-nft-phase2`) | **OUT OF SCOPE.** |
| **Directory page + all 7 tabs** (`pages/Directory.tsx`, `components/directory/*`, `lib/directory.ts`, `lib/validators.ts` count) | **Directory session** → `docs/planning/DIRECTORY_UPGRADE_AUDIT_AND_PLAN_2026-06-24.md` | **OUT OF SCOPE / DEFER.** Cross-check only (their plan already owns DB1/DB2/Users-tab/tx_search). |
| **DAO detail + AI analysis** (`DAOHome`, `ProposalView`, AI council, `normalizeStatus`) | **DAO/AI session** → `docs/planning/MEMBA_DAO_AND_AI_ANALYSIS_AUDIT_AND_PLAN_2026-06-24.md` (E3-b) | **OUT OF SCOPE / DEFER.** |
| **Validators / valoper detail** (`ValoperPanel`, validator detail) | **Valoper session** → `docs/planning/VALIDATORS_VALOPER_PROFILES_AUDIT_AND_PLAN_2026-06-24.md` | **OUT OF SCOPE / DEFER.** |
| **DAO member-count honesty** (DB5/E5-f) | **Home tree** (`fix/home-connected-feedback`) | **DEFER.** |
| **THIS PLAN (cross-cutting + uncovered surfaces)** — **Create Token / Tokens**, Create DAO wizard, Settings, Profile, Multisig, Quests UI, Gnolove, Alerts, Feedback, **global chrome** (footer, sidebar/tabbar, command palette), **light-theme consistency**, **a11y**, **mobile responsiveness** — everywhere except the parallel-owned areas above | **This plan** | IN SCOPE |

### Required deconfliction step (run before creating any branch)

```bash
cd /Users/zxxma/Desktop/Code/Gno/Memba
git fetch --all --quiet
git worktree list
git branch -a | grep -iE 'home|atlas|nft|connected|feedback'
# For each file you intend to touch, confirm it is NOT modified on a parallel branch:
for f in frontend/src/pages/CreateToken.tsx frontend/src/pages/Directory.tsx \
         frontend/src/components/directory/ChainMetricsBanner.tsx frontend/src/lib/config.ts; do
  echo "== $f =="; git diff --stat main...origin/fix/home-connected-feedback -- "$f" 2>/dev/null
done
```

### Methodology rules (hard)

- **Never commit on `main`.** One branch per workstream: `fix/uiux-directory-demoblockers`, `fix/uiux-createtoken-lighttheme`, etc. PR each.
- **No feature-flag flips** in this plan (NFT/Marketplace/Services/Teams stay off; that's E9 territory and gated on observability).
- **Verify-before-fix:** re-confirm each issue on the branch's current code before editing (catalogue drifts; several items here were already fixed).
- **No Claude attribution** in commits/PRs.
- **Small, revertible PRs;** TDD/regression test where there's logic (data sources, gating).

---

## 3. Findings (severity-tagged, evidence-backed)

Legend: **OPEN** = verified still present · **FIXED** = already shipped (do not redo) · **CODE-ONLY** = found by reading source, re-verify live · **DEFER** = parallel-session owned.

### P0 — Demo-blockers (target: before 2026-06-26)

| ID | Finding | Evidence | Status | Owner / fix locus |
|---|---|---|---|---|
| **U-DB4** | **Create Token is broken in light mode** — "Connect your wallet" banner is a black box on white; all inputs (Name, Symbol, Decimals, Initial Mint, Faucet, Memo) are dark with near-invisible text. | Live (light, desktop); `CreateToken.tsx:253-336` inputs use inline `style={inputStyle(loading)}`, `labelStyle`, `hintStyle` with hardcoded dark colors (pre-Kodera outlier). | **OPEN — THIS PLAN** | Convert the form to Kodera classes / `var(--color-*)` tokens (kill the inline `inputStyle`/`labelStyle`/`hintStyle` objects + the banner's hardcoded background). High visual impact, contained file, **not owned by any parallel session.** |
| ~~U-DB1~~ | Directory "VALIDATORS 0" | Live + `ChainMetricsBanner`. | **DEFER → Directory session** | Their plan: exact fix `lib/validators.ts:318-319` reads `valResult.total` (tm2 never returns it) → count `validators.length` (5). My independent live tour **confirms** the symptom. |
| ~~U-DB2~~ | Directory featured card "raw markdown" `[> … <]` | Live + `demo-walkthrough-shots/12b`. | **DEFER → Directory session** | Their plan frames it as escaped `\>` links (gno#5418), real fix = render markdown in `RealmsTab.tsx:164` preview. Confirmed live. |
| ~~U-DB3~~ | Directory empty gray search box | Live; `Directory.tsx:108-119` (`dir-search--global`). | **DEFER → Directory session (flag)** | Functional cross-tab search that reads as broken in light mode. **Not explicitly in their note** — flag to the Directory session to add `.dir-search--global` light-theme styling (visible border/placeholder + search icon). |

> **Cross-check note:** I independently re-verified the Directory demo-blockers (DB1/DB2) and the breaking-change verdict live — they **match** the Directory session's findings. The console-404 "63× tx_search on GovDAO" was **not reproduced** on the pages I toured (Directory session owns it: gate `tx_search` off for test13).

### P1 — Honesty, gating, theme, perceived-perf

| ID | Finding | Evidence | Status | Fix locus |
|---|---|---|---|---|
| **U-1** | **`gnoland1` (Betanet) is selectable** in the topbar network combobox and Settings, but its realms aren't deployed → connected actions fail with VM errors. | Live (topbar combobox `option "Betanet (gnoland1)"`; Settings → Network lists it). | **OPEN** | Gate gnoland1: either hide it until realms deploy, or keep it browseable but block connected actions with a clear "realms not deployed on gnoland1 yet" state (mirror the existing test12 wind-down pattern). |
| **U-2** | **Light-theme sweep** beyond Create Token: low-contrast `--color-k-dim` door/label text; Directory featured-card text barely readable on the gradient; verify Settings/Token cards. | Live (light Directory, dark D3 mid-fade showing dim labels). | **OPEN** | Audit + tokenise hardcoded/low-contrast colors page-by-page (Create Token first, then Directory cards, then sweep). Tie to E6-n. |
| **U-3** | **Quests shows "15 XP · 1/44 quests" for an unconnected visitor.** Suggests XP read from localStorage, not the connected address. | Live (Quests, no wallet). | **CODE-ONLY** | Confirm XP source in `QuestHub`/quest hook; for a visitor, show `0`/"connect to track progress", not stale local XP. (Relates to the catalogued candidature localStorage-bypass — E4.) |
| **U-4** | **MembaDAO detail shows "0 Members / 0 Proposals / 0 Active".** Vote-enrichment is already hardened, so this is a separate stats-count question. | Live (DAO detail desktop + mobile); `DAOHome.tsx:117-123`. | **DEFER → DAO/AI session + home tree** | Member-count honesty (DB5/E5-f) lives in `fix/home-connected-feedback`; DAO detail UI is the DAO/AI session's. Flag the "0 stats as if real" symptom to them. |
| **U-5** | **Validators page slow to settle** ("Loading validator data…" several seconds; multi-node RPC). E2-c demo headliner. | Live (caught mid-load twice). | **DEFER → Valoper session** | Validators feature owned by the Valoper plan; recommend progressive render (stat cards first, stream the table) as a perf add — flag to them. |
| **U-6** | **Feedback page mixed messaging:** shows "No feedback yet" + promotes an "On-Chain Feedback Board — COMING ON BETANET", while docs say `memba_feedback_v2` is **live on test13**. | Live (`Feedback` snapshot). | **OPEN (copy)** | Reconcile: either wire the test13 feedback board or fix the copy so it doesn't imply the board is only "coming on betanet". |

### P2 — Polish, IA, a11y, dead-ends

| ID | Finding | Evidence | Status | Fix locus |
|---|---|---|---|---|
| **U-7** | **Tokens page is sparse** (1 token, acres of whitespace) and has **no "Create Token" CTA** on the page itself — discovery dead-end. | Live (Tokens). | OPEN | Add a primary "+ Create Token" CTA and a richer empty/low-count state. |
| **U-8** | **Create-DAO preset cards lack name labels** (icon + description only; no bold "Simple/Team/Treasury/Full") and no clear selected state. | Live (Create DAO step 1). | OPEN | Add a bold preset name per card + a visible selected state (ring/checkmark). |
| **U-9** | **Mobile "More" sheet surfaces DAO plugins** (Proposal Explorer, Channels, GnoSwap, Leaderboard, Payroll) in **global** nav — confusing IA (plugins are DAO-scoped). | `demo-walkthrough-shots/22`. | OPEN | Scope plugins to the active DAO, or relabel the section so it's clear these are last-visited-DAO plugins. |
| **U-10** | **Tabler icon gap** — `ActionCard.tsx`/`YourWorldsPanel.tsx` use `ti ti-*` with no Tabler font shipped → blank icons in connected views. | Catalogue. | **CODE-ONLY / DEFER** | These are **Home/Atlas-owned** components — hand to that session; just flag. |
| **U-11** | **A11y semantic cleanups** — non-semantic clickable `<div>` in `TransactionView` dialog and FreelanceServices modal; sub-44px targets in the More overflow. | Catalogue + code. | CODE-ONLY | Convert to `<button>`/`role`+keyboard; enforce 44px. |
| **U-12** | **Mobile grid stacking <360px** — fractional grids in `dashboard.css`, `multisigview.css` not stacking; command-palette input <16px triggers iOS zoom. | Catalogue. | CODE-ONLY | Add stacking breakpoints; bump palette input to ≥16px. |
| **U-13** | **Katakana eyebrow "メンバー"** on Home eyebrow — confirm this is intentional branding (Memba = メンバー), not a placeholder. | Live (home, desktop+mobile). | QUESTION | Confirm intent; if intentional, fine. (Home-owned — flag only.) |

### Already FIXED — do **not** re-open

| Catalogue item | Status now | Evidence |
|---|---|---|
| iOS safe-area: `index.html` missing `viewport-fit=cover` | **FIXED** | `index.html:6` has `viewport-fit=cover`. |
| DAOHome proposal vote tallies render fake `0%` on RPC failure (P1-8) | **FIXED** | `DAOHome.tsx:117-123` marks `enrichFailed` → "couldn't load votes". |

---

## 4. AAA acceptance rubric (the bar every in-scope surface must meet)

A surface is "AAA done" only when **all** hold:

1. **Functional** — primary action works end-to-end; no dead CTAs; console clean.
2. **Responsive** — no horizontal scroll / overflow 320 → 1440px+; content stacks; tables become cards/scroll-areas on mobile.
3. **Both themes** — no hardcoded colors; passes contrast (WCAG AA) in light **and** dark.
4. **Honest data** — never render a bare `0`/`—` for a failed fetch; distinguish "empty" from "couldn't load" with a visible degraded state.
5. **Accessible** — semantic `<button>`/`<a>`; icon-only controls have `aria-label`; inputs have labels; dialogs trap focus; ≥44px touch targets; `:focus-visible`.
6. **Stateful** — explicit loading (skeleton, not full-page spinner), empty, and error states.
7. **Polished** — consistent spacing/typography (Kodera), no placeholder/raw-markdown leakage, sensible empty-state CTAs.

---

## 5. Implementation plan (phased, PR-sized, deconflicted)

> Each PR: own branch off `main`, run §2 deconfliction first, add/extend tests where there's logic, screenshot light+dark+mobile in the PR body, no flag flips.

### Phase 1 — Demo-blocker (before 2026-06-26) · ~0.5 day
- **PR 1.1 `fix/uiux-createtoken-lighttheme`** — U-DB4: convert Create Token form to Kodera classes/tokens; fix the connect-banner background. (The Directory demo-blockers are owned by the Directory session — see §2; verify their PR lands before the demo.)
  - *Accept:* Create Token legible and on-brand in light **and** dark; visual-diff screenshots attached.

### Phase 2 — Honesty & gating · ~1 day
- **PR 2.1 `fix/uiux-gnoland1-gate`** — U-1: gate gnoland1 connected actions / hide until deployed.
- **PR 2.2 `fix/uiux-quests-visitor-xp`** — U-3: visitor XP source fix (coordinate with E4 candidature work to avoid overlap).
- **PR 2.3 `fix/uiux-feedback-copy`** — U-6: reconcile Feedback-page messaging with the live `memba_feedback_v2` board on test13.

### Phase 3 — Light-theme sweep · ~1–2 days
- **PR 3.1 `fix/uiux-light-theme-sweep`** — U-2: tokenise remaining hardcoded/low-contrast colors on **in-scope** surfaces (Settings, Token/Create-DAO cards, global chrome). Extends E6-n. **Exclude Directory, DAO, Validators, Home, NFT** (owned elsewhere — send them token suggestions instead).

### Phase 4 — Polish, IA, a11y, mobile tails · ~1–2 days
- **PR 4.1 `fix/uiux-tokens-cta-emptystates`** — U-7.
- **PR 4.2 `fix/uiux-createdao-presets`** — U-8.
- **PR 4.3 `fix/uiux-mobile-more-ia`** — U-9 (scope/relabel plugins).
- **PR 4.4 `fix/uiux-a11y-semantics`** — U-11 + U-12 (semantic buttons, 44px, grid stacking, palette zoom-guard). Touch only in-scope components.

### Hand-offs (flag, do NOT edit here)
- **Directory session:** DB3 search-box light styling (`.dir-search--global`); cross-checked DB1/DB2 confirmations.
- **DAO/AI session:** U-4 (DAO overview "0 stats as if real").
- **Valoper session:** U-5 (Validators progressive-render perf).
- **Home/Atlas session:** U-10 (Tabler icons in `ActionCard`/`YourWorldsPanel`), U-13 (katakana eyebrow), DAO member-count honesty (DB5).
- **NFT session:** anything under `nft/`, `studio/`, `Marketplace`.

---

## 6. Per-feature tour checklist (systematic, one-by-one)

Status from this tour. ✓ good · ⚠ issue (see ID) · ⛔ broken · — not tested live · 🔒 parallel-owned.

| Feature / sub-page | Desktop | Mobile | Light | Dark | A11y | States | Notes |
|---|---|---|---|---|---|---|---|
| Home (visitor) | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | Atlas-owned; looks clean. U-13 katakana check. |
| Tokens (list) | ⚠ | — | ✓ | ✓ | ✓ | ⚠ | U-7 sparse + no create CTA. |
| Token detail | ✓ | — | ✓ | — | ✓ | ✓ | Clean. |
| DAO list | ✓ | — | ✓ | — | ✓ | ✓ | Cached; fine. |
| DAO detail / members / treasury / proposal | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | **DAO/AI session.** Tour saw 0-stats (U-4) — flagged. Vote-enrichment FIXED. |
| Directory (page + all 7 tabs) | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | **Directory session.** Cross-checked DB1/DB2 live (match); DB3 search-box flagged. |
| Validators (list / hacker / detail) | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | **Valoper session.** Content good live; U-5 slow-load flagged. |
| Quests | ⚠ | — | ✓ | — | ✓ | ✓ | U-3 visitor XP. Otherwise strong. |
| Leaderboard | ✓ | — | ✓ | — | ✓ | ✓ | |
| Gnolove (+tabs) | ✓ | — | ✓ | — | ✓ | ✓ | Polished (v6.3.0 sweep). Sub-tabs spot-check. |
| Alerts | ✓ | — | ✓ | — | — | ✓ | Clerk-gated sections — verify auth flow. |
| Settings | ⚠ | — | ✓ | — | ✓ | ✓ | U-1 gnoland1 offered. |
| Create Token | ⛔ | — | ⛔ | ✓ | ⚠ | ✓ | U-DB4 light break. |
| Create DAO | ⚠ | — | ✓ | — | ✓ | ✓ | U-8 preset labels. |
| Feedback | ⚠ | — | ✓ | — | ✓ | ✓ | U-6 messaging. |
| Profile | — | — | — | — | — | — | Code-only; verify with wallet. |
| Multisig (hub/view/propose/tx) | — | — | — | — | — | — | Code-only; verify with wallet. |
| Marketplace / Services / NFT / Teams | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | Gated off (coming-soon) / NFT-owned. |
| Global: footer | ✓ | ✓ | ✓ | ✓ | ✓ | — | Version `v4.1.0`; social links accessible. |
| Global: sidebar / tabbar | ✓ | ✓ | ✓ | ✓ | ✓ | — | Safe-area FIXED. |
| Command palette | ✓ | — | — | — | — | — | Cached; verify mobile (≥16px input, U-12). |
| 404 | ✓ | — | — | — | — | ✓ | Cached. |

**Remaining live verification (needs wallet / specific routes):** Profile, Multisig flows, DAO members/treasury/proposal, Directory sub-tabs, Validators hacker mode, Alerts (Clerk), GovDAO console-404 repro, command palette mobile. Recommend a short authenticated pass + a `feat/nft-marketplace-phase2`-free desktop+mobile sweep once the tool outage clears.

---

## 7. Upstream (gno) breaking-change watch — LOW risk

Memba targets a **pinned, deployed test13**; gno master moving does not change the running chain. Of the 56 new gno-master commits (2026-06-05 → 2026-06-24), only two are worth tracking, and **neither is breaking today**:

- **`gnoclient QuerySessionAccount` signature change (#5834) + account sessions (#5657)** — only relevant if/when the Go backend bumps `gnoclient`. Verify the backend `go.mod` pin before any gno dependency bump.
- **`grc721 SetTokenMetadata` now owner-gated (#5792)** — affects NFT realms on a future redeploy → **NFT session's** concern, flagged to them.

Informational only: tm2 B+32 tree replacing IAVL (#5438), numerous gnovm panic/bounds fixes, gnoweb username-hyphen fix (#5655) — relevant only on a future chain upgrade / realm redeploy.

---

## 8. Open questions for review

1. **Scope vs E6:** do you want this as a standalone set of PRs, or folded into the AAA program's E6 wave (same work, different bookkeeping)?
2. **Demo priority:** confirm the 2026-06-26 demo path so Phase 1 targets exactly the screens that get shown (Directory + Validators + a DAO).
3. **Katakana eyebrow (U-13):** intentional branding or placeholder?
4. **Authenticated pass:** want me to run the deferred wallet-gated tour (Profile, Multisig flows, DAO members/treasury/proposal, Directory sub-tabs) + the git deconfliction (blocked by a transient tool outage during this session) before Phase 1 starts?

---

## Appendix A — Route inventory (44+ routes)

Network-scoped under `/:network/` (test13 primary; gnoland1 betanet ungated → U-1). Core: `/` (Home), `/dashboard`→`/`, `/tokens`(+`/:symbol`), `/dao`(+`/create`, splat `/dao/*` → DAOHome, `/proposal/:id`, `/members`, `/propose`, `/treasury`(+`/propose`), `/channels`, `/plugin/:id`), `/directory` (7 tabs), `/validators`(+`/hacker`, `/:address`), `/multisig`(+`/create`,`/import`,`/:address`(+`/propose`)), `/tx/:id`, `/create-token`, `/profile`(+`/:address`), `/u/:username`, `/quests`(+`/:id`), `/quest-admin`, `/leaderboard`, `/gnolove` (10 nested: report, notable-prs, analytics, teams(+`/:team`), reports, milestone, contributor/:login), `/alerts`, `/settings`, `/feedback`, `/changelogs`, `/extensions`, `/github/callback`, `*`→404. Gated (flags OFF in prod): `/marketplace`, `/services`, `/nft/*`, `/organizations`.

## Appendix B — Evidence

Fresh captures: `ui-audit-2026-06-24/desktop/` and `.../mobile/`. Re-used: `demo-walkthrough-shots/`. Key verified file:line refs: `index.html:6`, `ChainMetricsBanner.tsx:43,47,75`, `Directory.tsx:106,108-119`, `DAOHome.tsx:117-123`, `CreateToken.tsx:64-73,253-336`.
