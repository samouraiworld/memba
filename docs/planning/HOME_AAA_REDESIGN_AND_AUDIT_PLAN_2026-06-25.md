# Memba — Home AAA Redesign + P0/P1 Audit Remediation — Implementation Plan

- **Date:** 2026-06-25
- **Worktree:** `/Users/zxxma/Desktop/Code/Gno/memba-home-uiux`
- **Base commit (plan):** `79b335a` (origin/main tip, post-#527)
- **Status:** EXECUTED — Home redesign shipped to `main`; most P0/P1 audit fixes shipped; Wave 3 deferred (data-gated); a P2/P3 + docs long-tail remains. See **§0.1 Shipped status**.
- **Owner:** zxxma (sole code owner — see D-F11)
- **Design locked:** C-visuals on A-architecture · GovDAO read directly from `gno.land/r/gov/dao` · gold = Layer-1 governance, teal = community · MembaDAO demoted to footer credit · test13-only DAOs.

> This is the single source of truth for this mission (audit backlog + design spec + implementation plan in one file, per preference). It supersedes scattered notes for the Home work.

---

## 0.1 Shipped status (updated 2026-06-26, live)

> **§13 APP-WIDE LIGHT-THEME SWEEP — COMPLETE & LIVE ON PROD (2026-06-26).** 9 PRs merged: `#558` accent-text token · `#559` shell · `#561` validators + ValidatorDetail · `#563` gnolove · `#565` DAO/governance/profile/directory · `#568` tokens/multisig/quests/misc · `#570` semantic-token + cleanup · `#573` inline-TSX tail · `#574` CI guardrail. Method: route every text `color:` through theme-aware `--color-k-*-text` tokens (dark values == prior shades → zero dark regression); 3 systemic token fixes (accent-text, `--color-text-dim` gray-300→AA, legacy `--color-{success,warning,danger,info}`→`-text` fixed ~75 inline usages at once); shared `CopyableAddress`; new `.k-brand-text` utility (color-mix darken of a `--ck` brand hex on light) for role/category/team color maps. **Verified light-mode 0 contrast offenders** (Playwright WCAG audit) on home/validators/ValidatorDetail/gnolove/directory(all tabs)/tokens/quests/DAO-detail; **CI guardrail** (`ci.yml`) now fails any new hardcoded `color:` in component CSS. **Design-system rule:** never hardcode a text color — use a `--color-k-*-text` token or `.k-brand-text`+`--ck`. Deferred (out of light scope): **§13-J** dark-only items (`#444` dao-path/arrows, hacker heatmap). Token vocabulary + rule documented in `docs/DESIGN_SYSTEM.md`.
>
> **§12 P3 — on-chain reviews / web-of-trust realm — DESIGN APPROVED (2026-06-26), build pending.** Spec: `docs/superpowers/specs/2026-06-26-reviews-realm-design.md`. Open posting (NOT interactor-gated — user dropped that), hybrid trust (reputation + verified-`@username` badge), hybrid moderation (author delete + community flag + multisig hide), fully on-chain realm + RPC reads, deploy via samcrew-deployer **after a mandatory security review**. Next: `writing-plans`.

Delivered as small, independently-green PRs squash-merged to `main` (each deploy-preview-verified in dark **and** light where UI-facing). Authoritative list:

**Home redesign — DONE**
- `#531` Wave 1a — equal-height showcase cards (the centerpiece E-F5 fix: `grid-auto-rows:1fr` + `door{height:100%}` + pinned footer link).
- `#532` trim visitor hero tagline (dropped "Answer to no one." per user).
- `#533` Wave 1b — **gold GovDAO Layer-1 spotlight** (new `useGovDao` reading `gno.land/r/gov/dao`, fulfils Wave 0c) + **MembaDAO demoted** from full-bleed hero to a `Built on Memba · MembaDAO` footer credit (E-F6/E-F8).
- `#534` Wave 1b-2 — live launchpad token count + GovDAO stat pluralization.
- `#535` cleanup — removed the now-unused `FeaturedDoor`/`useFeaturedDao` (superseded by the spotlight).
- `#540` Wave 1b-3 — top-contributors real avatars (GitHub img + initials fallback) + score bars.
- `#538` Wave 2 — below-the-fold: ecosystem band (honest counts, omit zeros) + explore grid (6 live surfaces) + `soon`-labelled coming-soon teaser (NFT/Services/Agent-credits never render as live).

**P0/P1/P2 audit fixes — DONE**
- `#528` **B1** — stopped the home-snapshot double-base64 of qrender data (counts were returning 0 in prod). P0.
- `#529` **E-F9** — drop stale untagged DAOs that don't render on the active network.
- `#530` **S-F1** — NFT image proxy `nosniff` (content-type sniffing).
- `#536` **C-F7** — `team_rpc` authz now fails **closed** on a swallowed query error.
- `#537` **S-F2** — only trust client-IP headers behind a configured trusted proxy (rate-limit-bypass).
- `#539` **B2** — thread request ctx through quest verifiers so cancellation aborts the RPC fan-out.
- `#541` **E-F1/E-F2/E-F3/E-F4** (Wave 6a) — replace hardcoded dark hex with `var(--color-k-*)` tokens on CreateToken/Treasury/ProposalView/ImportMultisig/MobileTabBar/ProgressBar + multisig/daomembers CSS (light-theme legibility).
- `#542` **C-F1** (Wave 5a) — first unit coverage for `useAdena` (14 mutation-verified tests). *(open at time of writing; auto-merging on green.)*

**Wave 3 (activity feed) — DEFERRED, data-gated (conscious decision, not a silent drop)**
Live test13 check (2026-06-25): GovDAO `gno.land/r/gov/dao` = **1 member, no open proposals**; `memba_dao` = 0 proposals; no temporal token/member event source exists without a net-new backend event-aggregator. Per the honesty contract (empty → invitation, never fabricate), a headline "Live across gno.land" feed would render empty/near-empty and read as broken. **Decision:** defer until either (a) real on-chain activity volume exists on the target chain, or (b) the indexer's `nft_raw_events`/tailer is generalized into a multi-source activity store. The below-fold already gives an honest "what's live" via the ecosystem band + explore grid (#538). Revisit at test14/mainnet redeploy.

**Remaining (documented, not done — see §2 for IDs)**
- *Wave 4* visitor onboarding 3-step strip (E-F11) — low priority; visitor home is already full (GovDAO spotlight + below-fold).
- *Wave 1c polish* StatusStrip true full-bleed top-bar (E-F7) — cosmetic.
- *Wave 5 long-tail* wallet/validators typing (C-F3/C-F4); e2e RPC mocking + non-blocking live job (C-F2 — **real but CI is currently green**: e2e specs test UI/nav, not live-chain assertions); ProposalView test (C-F6); coverage gate (C-F5); test-file typecheck (C-F8); pin CI actions (C-F9); backend B3/B4/B5/B6/B7/B10; security S-F3/S-F4; docs D-F1/F3/F5/F6/F7/F8/F13/F14.
- *Wave 6b* P3 cleanup batch (B8/B9/B11/B12, C-F10/F11/F12, S-F7) + motion + Lighthouse perf.
- *Coordinate (other sessions)* D-F10 Dependabot, D-F11 CODEOWNERS, D-F12 multisig golden-A3.
- *New finding (from #542)* `useAdena` `changedNetwork` listener has **no unsubscribe** (`adena.On` returns bool, no off API) → stale-handler accumulation on repeated connect/disconnect. Low severity; guard-or-document follow-up.

---

## 0. How to use this plan — multi-session safety protocol

Multiple Claude sessions run against `samouraiworld/memba` concurrently. As of 2026-06-25:
- `memba-uiux-wt` → branch `main` @ `ceceebc` — go-live readiness session.
- `Memba/` (primary worktree) → branch `chore/dependency-refresh` @ `79b335a` — **likely owns the Dependabot backlog (D-F10)**.
- `memba-endpoints` → detached @ `79b335a` — prior endpoints worktree (clean).
- `memba-home-uiux` → **this work**, branch `feat/home-redesign-aaa`.

### RESYNC CHECKPOINT (run at the START of every phase, and before opening any PR)
```bash
cd /Users/zxxma/Desktop/Code/Gno/memba-home-uiux
git fetch origin --prune
git log --oneline origin/main -5                      # what landed since we branched?
git rev-list --left-right --count HEAD...origin/main   # how far behind are we?
# If origin/main moved: rebase early, resolve small, re-run tests.
git rebase origin/main                                 # keep the branch current; never let it rot
gh pr list -R samouraiworld/memba --state open         # are other sessions touching home files?
git -C /Users/zxxma/Desktop/Code/Gno/Memba worktree list  # confirm no other worktree grabbed home files
```
- **Conflict-watch files** (if another PR touches these, coordinate before continuing): `frontend/src/pages/Home.tsx`, `frontend/src/components/home/**`, `frontend/src/hooks/home/**`, `frontend/src/lib/config.ts`, `backend/internal/service/home_rpc.go`, `api/memba/v1/memba.proto`.
- If a conflict-watch file gains an open PR from another session, **pause that task, rebase, and reconcile** rather than racing.

### Hard rules (non-negotiable)
- **Never commit on `main`/`master`.** Always this feature branch → PR. (A PreToolUse hook enforces this; it checks the Bash cwd's branch — always `cd` into this worktree before committing.)
- **No Claude attribution** anywhere — no `Co-Authored-By`, no "Generated with" footer, no Claude mention in commits/PRs.
- **Never merge without explicit user approval**, even on green CI. Admin-merge only after the user OKs each PR.
- **Gate admin-merge on CI all-green**, not just `mergeable`.
- **Ask before pushing.**
- Commit message format: one concise line on the *why*. No trailers.

### Per-worktree environment gotchas
- `frontend/` is a standalone **npm** project (not in the pnpm workspace). Fresh worktree needs: `cd frontend && npm ci` (root `pnpm install` will NOT install it → "vitest not found").
- `.env*` files live at the **repo root** (`vite.config.ts` sets `envDir: '..'`); files under `frontend/.env*` silently no-op.
- `tsc --noEmit` is a **no-op** here (root tsconfig `files:[]`) — use `npm run build` to typecheck. (Also a finding: C-F8.)
- **Feature-flag gate:** the prod build fails if any `VITE_ENABLE_*` money-path flag is `true` in `.env.example` (build-time `safeFlagsPlugin`). Keep NFT/Services/Treasury/Agent-credits flags OFF.
- **Do NOT flip** `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` (would brick multisig).

---

## 1. Context & current state

### 1.1 What just landed (do NOT redo — already on `origin/main`)
#505 directory URL-state · #506 analyst public read · #507/#509 NFT indexer · #508 flag gate · #510 official endpoints · #511/#519 test13 doc sweep · #512 real DAO threshold · #513 auth keep-connected · #515 cmd-k de-flake · #516 tokens visitor CTA · #517 NFT points anti-farm · #518 DAO RPC error surfacing · #520 indexer retry · #521 mobile UX · #522 a11y WCAG · #523/#524 dead-code removal (~1,470 LOC) · #525 /metrics token · #526 SSRF dialer · #527 CSP unsafe-inline.

### 1.2 gno.land core breaking-change scan — verdict: NO LIVE BREAKS
- Memba has **no Go-module dependency** on `gnolang/gno`; it talks over the wire (tm2 RPC `abci_query` qrender/qeval, gnoweb render, `r/sys/users`).
- Chain pin = tag `chain/test13` (`f45cc5c88`, 2026-06-15); live node = `v1.0.0-rc.0`. **Everything merged upstream in the last ~3 weeks is master-only** and not live on test13.
- **Forward watchlist** (only matters on a chain upgrade / test14 / mainnet redeploy — track, don't fix now):
  - #5655 gnoweb/keeper "find usernames with hyphens" — touches the VM keeper path-query layer Memba reaches via qrender/qeval. Add a hyphenated-username live probe when the node version flips.
  - amino #5301 reserved field numbers — re-run A3 sign-bytes golden vectors on any chain bump.
  - gnovm panic-recovery cluster (#5715/#5723/#5733/#5764/#5780/#5827/#5829) — re-run realm integration harness before any redeploy.
  - Lead indicator: when `rpc.test13.testnets.gno.land/status` `version` moves off `v1.0.0-rc.0`, re-run the scan.

### 1.3 Design decisions locked (from this session)
1. **Architecture:** extend the existing `Door` system (the home stack is the healthiest part of the codebase) — do NOT rearchitect.
2. **Look:** Direction C richness (per-card icon + accent + mini-viz; avatars on contributors).
3. **Below the fold:** P2 Complete + **live activity feed in v1** (ecosystem band → explore grid → quests → activity feed → "coming soon" teaser → footer).
4. **GovDAO:** distinct **gold** Layer-1 spotlight, read directly from `gno.land/r/gov/dao` (reuse `getDAOProposals`/`getDAOConfig`; `GovDAOTab.tsx` is prior art). B's live-proposal module included.
5. **MembaDAO:** demoted from the full-width hero to a one-line footer credit.
6. **Stale DAOs:** only test13-deployed/this-network DAOs in "Your organisations" (close the untagged-legacy hole).
7. **Honesty contract preserved everywhere:** never render fabricated `0`/`—`; empty → invitation; error → neutral + retry; gated features never shown as live.

---

## 2. Part 1 — consolidated audit backlog (prioritized, deduped)

Severity: **P0** demo/correctness blocker · **P1** important · **P2** polish/hardening · **P3** nit. Confidence H/M/L. Each maps to a wave (§4). IDs prefixed by lens: E=experience, C=code/QA, B=backend, S=security, D=CTO/docs.

### P0 — correctness blockers
| ID | Finding | file:line | Wave |
|----|---------|-----------|------|
| B1 | Home snapshot **double-base64-encodes** qrender data → snapshot-sourced counts return 0/empty in prod | `home_rpc.go:221,244,393,429,452` + `render_proxy.go:127` | 0 |
| C-F1 | Wallet signing (`useAdena`) has **zero direct tests** (login-proof, sig/pubkey, broadcast) | `useAdena.ts:74,266,286` | 5 |
| C-F2 | DAO/validator **e2e hit live RPC, self-skip on failure** → green CI proves nothing | `e2e/validators.spec.ts:18`, `e2e/dao.spec.ts:68` | 5 |

### P1 — important
| ID | Finding | file:line | Wave |
|----|---------|-----------|------|
| E-F5 | 4 showcase cards **uneven height / thin data** (Launchpad has no metric) | `home.css:225`, `LaunchpadDoor.tsx`, `DirectoryDoor.tsx:52` | 1 |
| E-F6 | FeaturedDoor (MembaDAO) **over-dominant** full-bleed hero | `ShowcaseBoard.tsx:50`, `home.css:719` | 1 |
| E-F1 | **Light theme broken on forms** — hardcoded dark hex, no `[data-theme=light]` | `TreasuryProposal.tsx:227`, `ImportMultisig.tsx`, `createmultisig.css`, `daomembers.css:50` | 6 |
| E-F2 | CreateToken hardcoded dark rgba panels | `CreateToken.tsx:205,343` | 6 |
| C-F3 | `getAdena(): any` → entire wallet API untyped | `useAdena.ts:48` | 5 |
| C-F4 | `validators.ts` 12× `as any`, no typed RPC response | `validators.ts:106…` | 5 |
| C-F5 | Frontend coverage collected but **never gated** | `ci.yml:114`, `vite.config.ts:71` | 5 |
| C-F6 | `ProposalView.tsx` (557 lines, vote tally) **no test** | `ProposalView.tsx` | 5 |
| B2 | Quest verifiers **drop request ctx** → uncancellable, 8s×nodes per verify | `quest_verify.go:347,433` | 5 |
| S-F1 | NFT image proxy mirrors upstream `Content-Type`, **no `nosniff`** | `ipfs_serve.go:416,520,628` | 5 |
| D-F1 | `MAINNET_PREPARATION.md` wholesale stale (calls test12 "primary") | doc | 5 |
| D-F4 | README markets gated NFT/Marketplace/Services as **shipped** | `README.md:91-132` | 2/5 |
| D-F9 | No release tag; **incoherent versioning** + 3 contradictory test counts | `CHANGELOG/README/ROADMAP/SKILL` | 5 |
| D-F10 | **28 Dependabot alerts (1 critical)**, freeze at 0 | `dependabot.yml` | 5† |
| D-F11 | **Bus-factor 1** (sole code owner) | `OPS_RUNBOOK` | 5† |
| D-F12 | Untested multisig money-path before any enforce flip | `fly.toml:44`, `tx_rpc.go` | 5† |

† **Coordinate:** D-F10/D-F11/D-F12 likely owned by the go-live / dependency-refresh sessions. Confirm ownership at a resync checkpoint; do not double-implement. This plan tracks them but defers execution unless the user assigns them here.

### P2 — polish / hardening
| ID | Finding | file:line | Wave |
|----|---------|-----------|------|
| E-F8 | GovDAO has no special rank | `useYourWorlds.ts:137` | 1 |
| E-F9 | Stale-DAO residual: untagged legacy save resolving on active net shows as live | `useYourWorlds.ts:145-154` | 0 |
| E-F7 | StatusStrip reads as floating card, not a top bar (double gutter) | `index.css:1243` vs `home.css:130,206` | 1 |
| E-F11 | Visitor cold-start reads empty; thin onboarding | `Home.tsx:65`, `VisitorHero` | 4 |
| E-F3 | MobileTabBar hardcoded colors | `MobileTabBar.tsx:197,219,226` | 6 |
| E-F4 | Vote buttons raw material hex | `ProposalView.tsx:509,512` | 6 |
| C-F7 | `team_rpc` authz **fails open** on swallowed `Scan` err | `team_rpc.go:262,269,276,337` | 5 |
| C-F8 | CI `tsc --noEmit` no-op; test files never typechecked | `ci.yml:84`, `tsconfig*` | 5 |
| C-F9 | Unpinned CI action/tool versions (`@master`/`@latest`) | `deploy-backend.yml:56`, `ci.yml:59`, `security.yml:29`, `gno-test.yml:39` | 5 |
| B3 | Indexer poller/tailer bypass node failover | `poller.go:159`, `tailer.go:419` | 5 |
| B4 | `resilient*` query paths ignore inbound ctx deadline | `render_proxy.go:122`, `quest_verify.go:418` | 5 |
| B5 | `points.LoadConfirmedSales` reads `collection` not `collectionID` (v3) | `points.go:83` | 5 |
| B6 | "rebuild-from-raw" recovery asserted but **doesn't exist**; raw not immutable | `dispatch.go:86`, `reorg.go:64` | 5 |
| B7 | Single SQLite conn serializes all reads+writes | `db.go:25` | 5 |
| B10 | Home snapshot reads 8 sources **sequentially**, no per-source deadline | `home_rpc.go:122` | 3 |
| S-F2 | `ExtractIP` trusts client-settable headers → rate-limit bypass | `limiter.go:138` | 5 |
| S-F3 | LLM prompt-injection from on-chain proposal text | `analyst.go:24` | 5 |
| S-F4 | Auth token in `localStorage` (XSS-exfiltratable, 24h) | `useAuth.ts:5,14` | 5 |
| D-F3/5/6/7/8 | Doc hygiene: test-count truth, gno-compat doc merge, archive ~9 done docs, ROADMAP self-contradiction | docs | 5 |

### P3 — nits (batch into a cleanup PR)
E-F10 hero voice · E-F12 door error has no retry wired · C-F10 dup `extractField` · C-F11 LLM fan-out dup · C-F12 god-function `HandleAnalystConsensus` · B8 treasury denom `HasSuffix` · B9 tx cursor unvalidated · B11 snapshot no singleflight · B12 offer-resolve outside sale tx · S-F5 dev CSP (accepted) · S-F6 unsigned-auth path (prod-gated) · S-F7 `/health` verbose · D-F13 ARCHITECTURE residual · D-F14 Node version contradiction.

### Notably GOOD (preserve — do not regress)
Honesty contract (omit zeros) · per-panel `PanelBoundary` fault isolation · reduced-motion + focus-visible coverage · backend error-discipline (zero `any`, fail-closed membership, ctx-cancelled goroutines) · strong crypto test coverage · build-time fund-flag gate · multisig fail-safe defaults · DOMPurify on all `dangerouslySetInnerHTML` · sound OAuth.

---

## 3. The locked Home design — specification

### 3.1 Design system & policies
- **Tokens (dark / light pairs already defined):** bg `#000`/`#f8f9fa` · panel `#141414`/`#f0f1f3` · elevated `#0c0c0c`/`#fff` · edge `#222`/`#e0e2e6` · text `#f0f0f0`/`#1a1a2e` · dim `#999`/`#6b7280` · accent teal `#00d4aa`/`#00a88a` · amber `#ffa502`/`#d97706` · featured `#0c1614`/`#f1faf7`, border `#14463a`/`#bfe6dd`. **Never hardcode hex** in new components — use `var(--color-k-*)`. (This is also the E-F1/E-F2 fix discipline.)
- **Type:** sans (Inter) = human-readable; mono (JetBrains Mono) = machine-truth only (addresses, hashes, counts, eyebrows). Lowercase eyebrows.
- **Color semantics:** **teal = Memba/community**, **gold/amber = Layer-1 governance (GovDAO)**. This is the single most important new visual rule — GovDAO must read as constitutionally different.
- **Honesty:** omit absent metrics (never `0`/`—`); `empty → invitation`; `error → neutral + retry`; `loading → skeleton`.
- **Gating:** NFT/Services/Agent-credits never render as live — only as a labeled `soon` teaser. Flags stay OFF.

### 3.2 Information architecture
**Connected (member) — above the fold**
1. **Status pulse bar** (full-bleed, true top bar — fixes E-F7): `testnet 13 ●` · block height · validators · members · wallet balance/address chips. Mono. Honest omission.
2. **Two-column hero:** left = **GovDAO gold spotlight** (eyebrow `★ layer 1 · core governance`, name, one-line "constitution of gno.land", live open-proposal count + members, primary "Monitor governance", `verify on-chain ↗`); right = **your next move** (top actionable item from the action inbox — vote/sign/claim/candidature — or "all caught up").
3. **Your organisations** (network-scoped, test13 only): compact uniform DAO tiles + "add an organisation" invitation. GovDAO is NOT here (promoted to its own spotlight). MembaDAO is NOT here (footer credit).
4. **4 equal rich cards** (the centerpiece fix): contributors (top-3 + avatars + score), network health (active/total + status + uptime sparkline + block time), directory (member count + completion donut + cluster), launchpad (real token count + creation bars). Equal height, pinned footer link, per-card icon + accent.

**Connected — below the fold**
5. **Ecosystem at a glance** — KPI band (tokens, DAOs†, members, validators, agents). †DAO count needs a source decision (§5.3).
6. **Explore gno.land** — grid of live surfaces only (Tokens, Directory, Validators, Gnolove, Quests, Multisig, Alerts).
7. **Your quests** — XP/level progress + next-quest CTA (member).
8. **Live across gno.land** — activity feed (net-new, §5.4).
9. **Coming soon** — `soon`-labeled teaser (NFT Marketplace, Services, Agent credits). Never live.
10. **Footer** — socials · version · alpha disclaimer · `Built on Memba · MembaDAO ↗` (the MembaDAO demotion target).

**Visitor (logged-out)** — same skeleton, with:
- Hero left = the "Run your DAO. Own your stack." pitch + `Explore DAOs` / `Connect wallet`; hero right = GovDAO spotlight (so even visitors see the L1 governance).
- Replace "your organisations" / "your next move" / "your quests" with a **3-step "how Memba works" onboarding strip** (fixes E-F11 cold-start emptiness).
- Same 4 cards, ecosystem band, explore grid, activity feed, coming-soon, footer.

### 3.3 Equal-card system (E-F5 fix)
- Grid: `display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); grid-auto-rows:1fr; gap:12px;` and each `.door{height:100%; display:flex; flex-direction:column}` with footer link `margin-top:auto`. Result: all cards in a row are equal height, content top-aligned, link pinned to the bottom — no dead whitespace.
- Each card = eyebrow (icon + label) → hero metric → mini-viz → pinned footer link. Launchpad gains a real metric (token count, §5.3) so it's no longer the emptiest.
- ≤768px: collapse to 1 column; DOM order = priority.

### 3.4 Data source per element
| Element | Source | Status |
|---------|--------|--------|
| Status bar height/validators | `/status`, `/validators` (resilient) | real today |
| GovDAO spotlight | `getDAOProposals`/`getDAOConfig` @ `gno.land/r/gov/dao` (reuse `GovDAOTab` plumbing) | real today; new `useGovDao` hook |
| Your next move | existing action inbox (`useHomeActions`) | real today |
| Your organisations | `useYourWorlds` (localStorage + per-DAO RPC), network-scoped | real; harden E-F9 |
| Contributors | `useGnoloveHighlights` (gnolove API) | real; add avatars |
| Network health | `useValidatorHealth` | real; add sparkline/block-time |
| Directory | `useDirectoryHighlights` (gnolove traction API) | real |
| Launchpad count | tokenfactory_v2 qrender (`countTokens`) | real **after B1 fix** |
| Ecosystem band | `EcosystemCounts` (proto `memba.proto:657`) | real after B1; **DAOs tile needs source (§5.3)** |
| Quests | quest realm / localStorage | real today |
| Activity feed | **net-new** `GetRecentActivity` aggregator | §5.4 |
| Coming-soon | static (gated flags) | static |

### 3.5 a11y / responsive / theme
- New components: real `<a>`/`<button>`, keyboard-focusable, `:focus-visible` rings, `prefers-reduced-motion` honored, AA contrast, `aria-label` on icon-only controls (match the standard #522 just set).
- Light + dark parity verified for every new surface (token-driven). Home must look right in both before merge.
- Mobile: verified at ≤768px (single column, tap targets ≥44px, safe-area) — build on #521.

---

## 4. Implementation waves

Each task: **files · approach · tests · acceptance · effort (S<½d / M / L>1d) · risk**. One PR per task group unless noted. **Run the §0 resync checkpoint at the start of every wave.**

### Wave 0 — Foundations & blocking fixes (PRs: 0a, 0b, 0c)
- **0a · B1 snapshot double-base64 (P0).** `home_rpc.go` — pass raw `realmPath+":"+path` to `homeQuery`; let `abciQueryOnce` (`render_proxy.go`) do the only base64. Add a real-`abciQuery` integration test (current fakes decode once and hide the bug). *Acceptance:* launchpad/agents/featured counts non-zero against live test13. *Effort S. Risk M (touches prod snapshot — verify live).*
- **0b · Stale-DAO hardening (E-F9).** `useYourWorlds.ts` + `lib/daoSlug` — require an explicit `network` stamp; stamp on first successful resolve; drop untagged legacy entries that don't resolve on the active network; one-time localStorage migration to prune/tag. *Tests:* unit cases for tagged-foreign (drop), untagged-resolves (keep+stamp), untagged-no-resolve (drop). *Effort M. Risk L.*
- **0c · `useGovDao` read util.** New hook wrapping `getDAOConfig`/`getDAOProposals` @ `gno.land/r/gov/dao` with honesty + error/loading states; reuse `GovDAOTab` patterns. *Tests:* hook unit (ready/empty/error). *Effort S. Risk L.*

### Wave 1 — Above-the-fold redesign (PRs: 1a, 1b, 1c)
- **1a · Equal-card system + 4 rich cards (E-F5).** `home.css` grid (`grid-auto-rows:1fr`, door `height:100%`, pinned footer); enrich `ContributorsDoor` (avatars — real GitHub avatar images in-app, fallback initials), `NetworkHealthDoor` (sparkline + block time), `DirectoryDoor` (donut + cluster), `LaunchpadDoor` (real token count from 0a). Wire `onRetry` on the 3 doors missing it (E-F12). *Tests:* extend `showcaseDoors.test.tsx`; equal-height snapshot; honest-empty preserved. *Effort L. Risk L.*
- **1b · GovDAO gold spotlight + MembaDAO demotion (E-F6, E-F8).** New `GovDaoSpotlight` (gold treatment, `useGovDao`); demote `FeaturedDoor` from full-width hero to footer credit line; restructure `ShowcaseBoard`/`Home.tsx` zones. *Tests:* spotlight states; MembaDAO no longer full-width. *Effort M. Risk M (layout change to a healthy file — keep PanelBoundary isolation).*
- **1c · Status pulse bar (E-F7) + your-next-move + network-scoped your-daos.** Make `StatusStrip` a true full-bleed bar (resolve the `.k-main` double-gutter); "your next move" from `useHomeActions`; your-daos tiles consume the 0b-hardened hook. *Tests:* strip layout; member/visitor branch. *Effort M. Risk L.*

### Wave 2 — Below-the-fold static sections (PR: 2a)
- **2a · Ecosystem band + explore grid + quests + coming-soon.** New components reading `EcosystemCounts` (post-B1) + static explore/coming-soon; quests from existing hook. DAOs tile gated on §5.3 decision (omit if no honest source). *Tests:* component render + honest omission + gated-feature-never-live assertion. *Effort M. Risk L.*

### Wave 3 — Activity feed (PRs: 3a backend, 3b frontend) — net-new
- **3a · Backend `GetRecentActivity` aggregator.** §5.4. New proto RPC + cached/polled aggregator (parallel `errgroup`, per-source deadline — also addresses B10 pattern). *Tests:* aggregation, cache, degrade-on-source-error. *Effort L. Risk M.*
- **3b · Frontend activity feed.** `ActivityFeed` component + hook; honest empty/error; reduced-motion. *Tests:* feed render/empty/error. *Effort M. Risk L.*

### Wave 4 — Visitor mode parity + onboarding (PR: 4a)
- **4a · Visitor hero + 3-step onboarding (E-F11, E-F10).** Single hero voice; onboarding strip; GovDAO spotlight on visitor; reuse all below-fold. *Tests:* `home-a11y.test.tsx` extended, visitor snapshot. *Effort M. Risk L.*

### Wave 5 — P0/P1 audit remediation (independent PRs, can parallelize after Wave 0)
- **5a** useAdena tests (C-F1) + wallet typing (C-F3) + validators typing (C-F4). *M.*
- **5b** e2e RPC mocking + non-blocking live job (C-F2); ProposalView test (C-F6); coverage gate (C-F5); `tsc -b` + test typecheck (C-F8); pin CI actions (C-F9). *M.*
- **5c** backend: quest-verifier ctx (B2); poller/tailer failover + ctx (B3/B4); `team_rpc` fail-closed (C-F7); points collectionID (B5); rebuild-from-raw reality (B6). *M.*
- **5d** security: NFT proxy `nosniff` (S-F1); trusted-proxy IP (S-F2); prompt-injection wrapping (S-F3); token-storage hardening (S-F4). *M.*
- **5e** docs/versioning: cut a version tag + reconcile test counts/README gated-feature labels (D-F3/F4/F9); rewrite/retire `MAINNET_PREPARATION.md` (D-F1); merge gno-compat docs + refresh (D-F5/F6); archive ~9 done planning docs (D-F7); ROADMAP/ARCHITECTURE/Node fixes (D-F8/F13/F14). *M.*
- **5f †** (coordinate) Dependabot critical (D-F10), CODEOWNERS reviewer (D-F11), multisig golden A3 test (D-F12) — confirm ownership before doing.

### Wave 6 — Light-theme sweep, polish, perf, final QA (PRs: 6a, 6b)
- **6a · Light-theme sweep (E-F1/F2/F3/F4).** Replace all hardcoded dark hex with tokens; add `[data-theme=light]` where missing; verify CreateToken/Treasury/Multisig/vote buttons + the whole new home in light. *L.*
- **6b · P3 cleanup batch + motion + perf.** B8/B9/B11/B12, C-F10/F11/F12, S-F7, snapshot singleflight; tasteful motion; Lighthouse pass. *M.*

---

## 5. Backend work detail

### 5.1 B1 fix (Wave 0a)
Root cause: `home_rpc.go` builds `base64(realmPath:path)` then hands it to `homeQuery` which (`render_proxy.go:127`) base64s again. Fix = pass the raw string; `abciQueryOnce` owns the single encode. Add an integration test that exercises the **real** `abciQuery` (not the decode-once fakes) so this can't regress.

### 5.2 GovDAO spotlight data (Wave 0c/1b)
Reuse `getDAOProposals`/`getDAOConfig` @ `gno.land/r/gov/dao`. Live open-proposal count + member count + recent proposals (with vote progress for the B-style module). Honest: if a read fails, the spotlight degrades to name + "verify on-chain" (never a blank/fake hero).

### 5.3 DAO count for the ecosystem band — DECISION NEEDED
`EcosystemCounts` (proto `memba.proto:657`) has tokens/collections/agents/validators — **no `daos` field**, and there is no DAO-registry read. Options:
- (a) Add a `daos` proto field + a registry/count source (cleanest, more work).
- (b) Omit the DAOs tile for v1 (honest — show only counts we can source).
- **Recommended: (b) for v1**, add (a) when a registry source exists. Do not fabricate.

### 5.4 Activity feed aggregator (Wave 3a) — net-new
- New `GetRecentActivity` RPC (cached like the snapshot; serve-stale-on-error; parallel `errgroup` with per-source deadline).
- v1 sources (cheapest reliable): recent GovDAO + featured-DAO proposals; recent tokens (tokenfactory); recent username registrations (`r/sys/users` if queryable); validator-set changes; existing NFT events (`nft_raw_events`).
- Each item: type, title, actor (escaped), timestamp, link. Honesty: empty feed → invitation, never fabricated rows.
- *Risk:* this is the largest new surface; keep it strictly additive and behind graceful degradation so it can never blank the home.

---

## 6. Test & verification strategy
- **Unit/component:** extend the high-density home tests (`showcaseDoors`, `ActionInbox`, `home-a11y`, `useYourWorlds`); add the new-hook/new-component tests above. Preserve every honesty-contract assertion.
- **Coverage gate:** add vitest thresholds (C-F5) — start ~40% lines, raise over time.
- **e2e:** mock RPC via `page.route` for structural asserts; live checks in a separate **non-blocking** job (C-F2).
- **Visual/manual:** dev-server preview for every wave — verify connected + visitor, **dark AND light**, desktop + ≤768px mobile, equal-card heights, GovDAO gold treatment, no stale DAOs, gated features absent. Capture before/after screenshots.
- **Typecheck:** `npm run build` (not `tsc --noEmit`).
- **Backend:** `go test ./...`; live integration probe for B1 + GovDAO reads.

## 7. Risk register & rollback
| Risk | Mitigation |
|------|------------|
| Branch rots vs fast-moving main | §0 resync checkpoint every phase; rebase early/often |
| Layout change regresses healthy home stack | Keep `PanelBoundary` isolation; small PRs; tests-first |
| B1 fix changes prod snapshot output | Live-verify before merge; snapshot serves-stale on error |
| Activity feed adds load/latency | Cached + parallel + per-source deadline + singleflight |
| GovDAO read slow/empty | Degrade to name + verify-link; never a blank hero |
| Conflict with concurrent sessions | Conflict-watch file list; pause+reconcile, don't race |
| Accidentally surfacing gated features | Build-time flag gate + explicit "never live" test |
Rollback: every change is an isolated PR; revert the PR. No DB migration is destructive in Waves 0-2/4/6; Wave 3 adds (no destructive) tables only.

## 8. PR plan / sequencing
- Small, independently green, individually reviewable PRs (bus-factor 1 → keep diffs reviewable).
- Order: Wave 0 (0a→0b→0c) → Wave 1 (1a→1b→1c) → Wave 2 → Wave 4 → Wave 3 → (Wave 5 in parallel after Wave 0) → Wave 6.
- Each PR: title `feat(home): …` / `fix(…): …`; body = summary + test plan, **no Claude attribution**; **do not merge without explicit user OK on green CI**.

## 9. Open questions / verify-live before/while building
1. GovDAO `gno.land/r/gov/dao` health on test13 — confirm `getDAOProposals` returns real proposals (the spotlight depends on it).
2. Featured/GovDAO **member count** availability (home snapshot stubs it to 0 today) — source or omit.
3. DAO-count source for the ecosystem band (§5.3) — confirm (b) omit for v1.
4. Activity-feed source reliability (§5.4) — which sources are cheap+reliable on test13 now.
5. Ownership of D-F10/F11/F12 (dependency-refresh / go-live sessions) — confirm before Wave 5f.
6. Real GitHub avatars for contributors — confirm CSP/img-src allows `avatars.githubusercontent.com` (in-app, not the mockup).

## 10. Appendix
- **gno-core forward watchlist:** §1.2.
- **Conflict-watch files:** §0.
- **Key source files:** `pages/Home.tsx`, `components/home/{ShowcaseBoard,Door,StatusStrip,VisitorHero,ActionInbox,StateBoard}.tsx`, `components/home/doors/*`, `components/home/panels/YourWorldsPanel.tsx`, `hooks/home/{useYourWorlds,useHomeActions,useHomeSnapshot,useGnoloveHighlights,useValidatorHealth,useDirectoryHighlights,useFeaturedDao}.ts`, `lib/{config,dao,daoSlug}.ts`, `backend/internal/service/home_rpc.go`, `backend/internal/service/render_proxy.go`, `api/memba/v1/memba.proto`.

---

## 11. Round 2 — post-go-live refinements (user feedback, 2026-06-25)

After the home, validators-split, and activity feed went live, the user reviewed prod and filed these. **Honesty contract still holds** — every "show more info" below is backed by REAL reachable data (mapped via an Explore pass); where the original mockup viz was dropped for lack of data, the now-live indexer/RPC make it real.

### Home (`memba.samourai.app/test13/`)
- **R2-H1 · GovDAO card color** — the current gold/amber reads as a warning tone; pick a more premium/distinct governance color (keep it visually different from the teal community cards). *Door/spotlight CSS.*
- **R2-H2 · GovDAO card too empty** — surface real data now (not just "1 member"): open-proposal count, latest proposal title + status, member count, threshold. Source: `getDAOProposals`/`getDAOConfig` already fetched in `useGovDao` (just pass more through).
- **R2-H3 · Cards clickable + hover** — make the whole of each card (contributors/network/directory/launchpad) navigable (`Door` already supports `href`) and add a hover state revealing a bit more (e.g. tooltip/secondary metrics). Today only Launchpad uses the full-card `href`.
- **R2-H4 · Mockup-fidelity viz** — restore the per-card mini-viz from Direction C that were dropped (no data then): **network block-time sparkline** (real, from indexer `getBlocks` recent block intervals / RPC `/status`), **directory breakdown** (realms/packages/users). Contributor avatars + score bars already shipped.
- **R2-H5 · Directory card richer** — beyond "294 members": realms, packages, users, tokens counts (Directory page tabs already source these via `lib/directory.ts`; reuse on the card).
- **R2-H6 · Network health richer** — show validators (active/total), candidates (from valopers), block height, latest + AVG block time. All real: `getNetworkStats` (`lib/validators.ts`) + valoper counts.
- **R2-H7 · Ecosystem band as listings** — "1 tokens / 8 validators" should expand to the actual items inline (token rows from `fetchTokens`, validator rows from `getValidators`) with their metrics, not just a count.

### Directory (`/test13/directory`)
- **R2-D1 · Light theme broken** — `directory.css` `.dir-featured-card` gradient uses `rgba(13,13,13,0.9)` (near-black, unreadable on light) + low-opacity teal overlays + `DAOCard` inline `${cat.color}22` hardcoded hex. Replace with `var(--color-k-*)` tokens / theme-aware values.
- **R2-D2 · Stale DAOs** — `getDirectoryDAOs()` = hardcoded `SEED_DAOS` + localStorage saved, with NO on-chain resolve. FOUFOU DAO CLUB / hihihi / Surf Club DAO / French Boulangerie don't resolve on test13. Apply the home E-F9 pattern: only show DAOs that actually render on the active network (per-DAO resolve check), drop/section the rest.

### Validators (`/test13/validators`)
- **R2-V1 · Section order** — move the validator metrics **table** (toolbar + `.val-table-wrap` + pagination, `Validators.tsx` ~426–633) to directly AFTER the Network Health banner (line ~381) and BEFORE the ValoperPanel (line ~383), so live network metrics lead, then the valoper/candidate roster.

### Sequencing (independent PRs, all preview- then prod-verified)
- **R2-V1** (validators reorder) — quick, isolated → ship first.
- **R2-D1/D2** (directory light-theme + stale filter) — isolated to Directory.
- **R2-H1/H2/H3** (GovDAO color+richness, clickable+hover) then **R2-H4/H5/H6** (network/directory viz+metrics) then **R2-H7** (ecosystem listings) — home cards, sequenced.

---

## 12. Profile pages — validator / candidate / individual / organisation (QUEUED after Round 2; Claude Design FIRST)

User request (2026-06-25): turn the validator/candidate profile page (`ValoperDetail.tsx`, e.g. `/test13/validators/valoper/g1…`) into a rich, **standard-based, editable profile** with a **web of trust**. **Do NOT start until Round 2 lands.** Begin with **Claude Design mockups (a few proposals)**, validate, then build (this is a large, multi-realm effort — treat like the home redesign: design → spec → phased build).

### Must provide (per user)
1. **On-chain reviews — comments + STARS rating** → a progressive web of trust (Uber / marketplace style). **MUST be on-chain.**
2. **Quests** of this validator (from the quest realm/API, by address).
3. **Gnolove contributions** (gnolove API — needs an address↔GitHub identity link).
4. **On-chain activities** (reuse the new `/api/indexer` proxy → filter `transactions` by the profile's address as caller/signer/recipient — the activity-feed plumbing is directly reusable).

### Standard-based + editable
- Base the profile on a **standard shared by individual / organisation / validator** profiles so one model + one edit flow serves all. Investigate gno's existing infra before inventing: `r/sys/users` (username registry, current `userRegistryPath`), `r/demo/profile` (profile fields), and `r/gnops/valopers` (operator moniker/description/serverType/signing keys). Pick/extend one so a user/validator/candidate can **edit** their profile (logo/avatar, bio, links, etc.) via signed txs (Adena). Org profiles map to the DAO realms (`lib/dao`).

### Hard design questions (resolve in the design phase — web-of-trust is non-trivial)
- **Reviews realm (new Gno realm, deploy via samcrew-deployer):** data model for ratings+comments; **sybil/spam resistance** (who may rate? any gno account, members only, or only addresses that have interacted on-chain? one rating per account? review-bombing defense); edit/revoke; aggregation (avg stars, count); moderation/abuse; immutability vs editability; gas/UX of writing a review. This is the biggest, riskiest piece — design + a security review before any deploy.
- **Identity linking** for gnolove contributions (on-chain address ↔ GitHub handle) — how is it established/verified?
- **Edit auth:** only the profile owner (operator address) can edit their profile; reviews are written by *others*.

### Reusable building blocks
`ValoperDetail.tsx` + `valoper-detail.css` (current profile), `lib/valopers`, `lib/activity.ts` + `/api/indexer` (on-chain activity by address), `gnoloveApi.ts` (contributions), the quest realm/readers, `lib/dao` (org profiles), `r/sys/users`/`r/demo/profile` (identity/profile fields).

### Suggested phasing (after Round 2)
- **P0 · Claude Design** — DONE (2026-06-25): 3 mockups shown; **user LOCKED** layout = **Blend** (Direction B editable identity header + tabs Overview/Reviews/Quests/Contributions/Activity, with Direction A's rating/review hero at top of Overview) and **review eligibility = on-chain interactors** (only addresses that interacted with the subject on-chain may rate; one editable review per account; strong sybil resistance).
- **P1 · Profile standard + editable profile** — **DECIDED: reuse the existing hybrid** `lib/profile.ts` `UserProfile` (`r/sys/users` username + gnolove + Memba-backend-stored editable bio/avatar/links via `api.updateProfile`) + valoper fields; unify `ValoperDetail.tsx`. **No new on-chain profile realm needed** (editable = backend; the app's established pattern). **P1 read-only restructure SHIPPED as PR #553** (Blend layout, identity header + tabs, graceful degradation). **P1b** (owner edit via `api.updateProfile`) = next.
- **P2 · Aggregation tabs** — on-chain activity (`/api/indexer` by address), quests, gnolove contributions (read-only, reuse existing sources). Next after P1b.
- **P3 · On-chain reviews realm** — interactor-gated; design (+ **security review**) → deploy via samcrew-deployer → ratings/comments read + write (stars UI, web-of-trust aggregation). Separate spec; sequence last; highest risk.
- **Reuse note:** `ProfilePage.tsx` (individual profile) overlaps the new validator profile — a future opportunity to extract shared profile components (contributions/social/packages/votes) for individual/org/validator.

---

## 13. Light-theme contrast + design-system consistency — APP-WIDE (user note, 2026-06-25)

**User:** in **light theme** there is a lot of unreadable text / low-contrast design **everywhere** in the app; text should be black (or much higher contrast). Wants a **well-defined design system with high contrast**, applied + **verified EVERYWHERE**, consistent. This is foundational — it affects every page incl. the new home/profile.

### Why it keeps happening (root causes)
1. **Hardcoded colors** — components that set raw hex/`rgba(...)` (dark-assumed) instead of `var(--color-k-*)` → unreadable on the light surface. (We've fixed pockets: #541 forms, #549 directory, #550/#551 home cards — but NOT app-wide.)
2. **Token VALUES** — even token-driven text may use a too-light stop in the `[data-theme="light"]` block (e.g. `--color-k-dim`/`-muted` on `--color-k-bg`) that fails WCAG contrast. The light ramp needs auditing for **AA (≥4.5:1 body, ≥3:1 large)** against its backgrounds.
3. **No enforced contrast standard** — nothing prevents a new low-contrast color from shipping.

### Approach (a dedicated systematic sweep — NOT per-page whack-a-mole)
1. **Define/Document the design system** (`index.css` tokens + a short `docs/DESIGN_SYSTEM.md`): for light theme, set text tokens to high-contrast (near-black `--color-k-text` e.g. `#16161d`; raise `-dim`/`-muted` until ≥4.5:1 on bg/panel/elevated); document each token's role + min-contrast target; keep dark parity.
2. **Find every hardcoded color** — grep `frontend/src` for `#[0-9a-f]{3,6}`, `rgb(`/`rgba(`, `linear-gradient` in `.tsx`/`.css` (excluding `index.css` token defs + intentional code-syntax/category colors) → replace with tokens. This is the bulk.
3. **Audit token contrast** — compute contrast of each light text token vs its surfaces; bump failing stops.
4. **Verify EVERYWHERE** — Playwright pass over every route in light mode + an automated contrast check (e.g. axe-core, or a script flagging any text node with computed contrast <4.5:1); fix until clean. Capture before/after.
5. **Guardrail** — add a lint/CI check (or a documented review rule) so new hardcoded colors / sub-threshold contrast are caught.

### Scope
Every page/component: home, directory, validators, valoper/profile, DAO pages, proposals, tokens, multisig, quests, gnolove, alerts, settings, modals/drawers, toasts, forms, badges/pills. Overlaps Wave 6a (light-theme) + the per-page fixes already shipped — supersede those with the systematic standard. High priority (foundational); do as its own focused effort.

---

## 14. Connected / member home — AAA pass (audit + plan, 2026-06-27)

> **Status:** AUDIT DONE — phased plan below — **AWAITING USER GO** before any implementation.
> **Worktree:** `/Users/zxxma/Desktop/Code/Gno/_worktrees/memba-home-member` · branch `feat/home-member-aaa` (off `origin/main` @ `d761125`/#595).
> **Context:** The visitor (logged-out) home shipped to the editorial AAA bar (#584/#589/#590/#593). That work was visitor + desktop-first. The **connected/member spine predates it and was never brought to the same bar.** This section is the audit of the member home + a phased delivery plan to close the gap, plus the result of a 390px mobile verification of the already-shipped (shared) sections.

### 14.0 Method
3-lens expert audit (visual · UX · data-feasibility), code-mapped against `origin/main`. Live-connected verification needs Adena (no local wallet) → **must verify on a deploy-preview**; the shared/visitor sections were verified live at 390px on prod this session. Standards unchanged: Revolut/Qonto bar · honesty contract (omit absent data, never `0`/`—`) · §13 light-theme tokens only (both themes) · TDD · a11y · per-wave PRs.

### 14.1 What the member home is today (code map)
Member branch (`pages/Home.tsx:90-116`): `StatusStrip` → `WalletChips` (2 bare mono spans) → `ActionInbox` ("Act now") → `YourWorldsPanel` ("Your organisations") → **then the same shared `ShowcaseBoard` + `BelowFold` the visitor sees, in visitor order.**
The visitor, by contrast, gets an **editorial hero** (`VisitorHero`: 30px headline + CTAs + `NetworkProofCard` live proof object) + `ValueStrip`. **The member has no hero at all** — it opens on impersonal network chrome and a (usually empty) action list.

### 14.2 Consolidated findings (deduped across the 3 lenses; prefix `MH-`)
| ID | Sev | Finding | Anchor | Fix direction |
|----|-----|---------|--------|---------------|
| **MH-01** | **P0** | **Member has no above-the-fold hero.** Spec §3.2 locked a 2-col member hero (GovDAO spotlight + "your next move"); it shipped as a bare inbox heading. The logged-in/“paying” user lands on a *thinner, flatter* page than an anonymous visitor. **Single biggest gap (all 3 lenses).** | `Home.tsx:90-102` vs `VisitorHero.tsx` | Build the member hero (§14.4 W-M1). |
| **MH-02** | **P0** | **`WalletChips` honesty guard is dead → renders `— GNOT` / `0 GNOT`.** Guard is `balance !== "0"`, but `useBalance` only emits `"— GNOT"` (loading) / `"? GNOT"` (error) / `"0 GNOT"` (empty) / `"X.Y GNOT"` — never bare `"0"`. So the forbidden `—`/`0` always render. **Verified in code.** | `Home.tsx:41`; `useBalance.ts:35,79,99` | Omit chip unless `rawUgnot > 0n` (thread the numeric, don’t string-match). TDD. Small. |
| **MH-03** | **P0** | **Reachable, motivating member data surfaced nowhere.** `resolveOnChainUsername`, `fetchUserProfile` (avatar), and full quests (`getCompletionPercent`/`fetchUserQuests`/`TOTAL_POSSIBLE_XP`, candidature threshold = 350) all exist; the home consumes only the binary `canApplyForMembership()`. Progress *toward* eligibility is invisible. | `useHomeActions.ts:95`; `lib/quests.ts`; `lib/profile.ts` | Surface identity + XP/level/candidature-progress on the spine (W-M1/W-M2). |
| **MH-04** | **P0** | **Spec §3.2 item 7 "Your quests" (XP/level progress + next-quest) was never built.** `BelowFold` renders only the shared visitor band. The strongest new-member loop (earn XP → 350 → eligible) has no home presence except an all-or-nothing inbox row that only appears *after* you already qualify. | `BelowFold.tsx:19-27` | Build the member quests progress surface (W-M2). |
| **MH-05** | **P1** | **Stacked-empty case reads as a dead end.** Dominant testnet state = "You're all caught up." + "Pin a DAO" — two adjacent empties both saying "go elsewhere"; *less* motivating than the visitor hero. | `ActionInbox.tsx:93-114`; `YourWorldsPanel.tsx:80-150` | Make caught-up a *positive* standing/next-step moment (W-M3). |
| **MH-06** | **P1** | **"Browse/Join/Explore DAOs" repeated 4+ times** (caught-up door, cold-start invite, worlds-board invitation, + shared ExploreGrid/DirectoryDoor) while the member-specific job (quests) is offered nowhere. | `ActionInbox.tsx:104`; `YourWorldsPanel.tsx:71-76,87` | De-dup; one distinct next step per empty state (W-M3). |
| **MH-07** | **P1** | **Member sees the visitor showcase verbatim, in visitor order;** GovDAO spotlight that spec wanted *in the member hero* sits below an empty inbox. | `Home.tsx:104-114`; `ShowcaseBoard.tsx:57` | Re-order for logged-in context (W-M4). |
| MH-08 | P2 | **WalletChips not an editorial anchor** — 10px mono pills in a 2nd `border-bottom` band under StatusStrip; reads as a debug ribbon. No name/avatar/role. | `home.css:1393-1425` | Fold identity into the hero (W-M1); merge the two stacked bands. |
| MH-09 | P2 | **Page reads as a stack of widgets** — every member section uses the same flat 13px section title; no type-scale crescendo, no focal point. | `home.css:1941,2189` | Hero focal tier above (W-M1) demotes section titles to 2nd tier. |
| MH-10 | P2 | **Emoji action chips** (`🗳 ✍ 🎁 🌱`) clash with the Phosphor/`ti` icon set used elsewhere; render inconsistently cross-platform. | `ActionDoor.tsx:28-46` | Swap to icon components (W-M5). |
| MH-11 | P2 | **Two near-duplicate action primitives** (`ActionCard` rail+`ti` vs `ActionDoor` chip+Door) visible in the same scroll. | `ActionCard.tsx` / `doors/ActionDoor.tsx` | Consolidate to one (W-M5). |
| MH-12 | P3 | **Hardcoded hex fallbacks** in member CSS (`var(--color-k-warning,#f59e0b)` etc.) — §13 says tokens only; a fallback bakes a wrong color into the other theme. | `home.css:181,1988,2049` | Drop the hex fallbacks (W-M5). |
| MH-13 | P3 | Ecosystem band "**1 tokens**" not singularized (shared/visitor copy nit, surfaced during mobile pass). | `EcosystemBand` | Pluralize (fold into W-M0 copy pass). |
| **MH-15** | **P2** | **Ecosystem band cards unequal height** (user-reported, 2026-06-27): the "tokens" and "Top validators" cards render at different heights (different row counts) — should be the same size for a tidy band. | `home.css` `.ecosystem-band__sections` / `.ecosystem-section` | Make the sections grid stretch to equal height (e.g. `align-items: stretch` / equal-height grid + flexible inner). |
| **MH-16** | **P2** | **Ecosystem band validators show addresses, not monikers** (user-reported, 2026-06-27): the top-3-by-power are genesis validators **unregistered in `r/gnops/valopers`**, so `fetchValoperMonikers` returns no name → honest truncated-address fallback. User wants names. The full validators page resolves names via **gnomonitoring** (`mergeWithMonitoringData`) and/or **net_info node monikers** — sources the band's `useEcosystemValidators` deliberately skips. | `useEcosystemValidators.ts` / `lib/validators.ts` | If gnomonitoring/net_info carries a name for these addrs, add that (cheap) source to the band's enrichment; **verify a real name exists before wiring** (never fabricate — if no on-chain/monitoring name exists, the address fallback stays). |
| **MH-14** | **P1** | **Ecosystem band header count can exceed the rows shown** (user-reported: header "3 tokens", list shows 1). The header count comes from the fresh backend snapshot while the rows come from `fetchTokens` (5-min `sessionStorage` cache) — right after a token launch the count jumps to 3 while the cached list still holds 1, and the "view all" gate keyed off the *stale list length* so no "view all 3" appeared → looks complete-but-wrong (count contradicts visible rows). Verified: fresh prod load shows all 3 correctly; the divergence is the transient cache window. | `EcosystemBand.tsx:75,122,169` | Count = `max(snapshot, listLength)`; show "view all N" whenever count > rows shown (applied to tokens **and** validators). |

### 14.3 Honest data palette (feasibility lens — what the member hero MAY show)
**SAFE high-value adds** (real + always meaningful, journey-framed not empty):
- **Identity:** truncated address (always present), `@username` when registered (else omit), avatar/initials (gnolove/backend, else initials).
- **Wallet balance** — after the MH-02 honesty fix.
- **Quests XP / level / completion% / candidature progress** — always computable locally; 0 XP frames as an onboarding rung, not a bare 0; eligibility is backend-authoritative.
- **Shared network pulse** (block height / validators / chain health) — reliably non-zero.

**EMPTINESS TRAPS — degrade to "all caught up"/invitation, NEVER a bare 0:** # open proposals awaiting my vote · # multisig sigs pending · GovDAO open-proposal/member counts · per-DAO open counts (all ~0 on test13: `memba_dao` 0 proposals, GovDAO ~1 member/0 open).
**HARD-EXCLUDE for v1:** ecosystem **DAO-count tile** (no registry source, §5.3) · **live activity feed counts** as member metric. **"# DAOs I'm a member of"** is a quiet trap — it’s inferred over *localStorage-saved* DAOs, not a true on-chain membership index; present as "your saved worlds," never an authoritative count.

### 14.4 Phased plan (member AAA pass) — small independent PRs, preview- + both-theme-verified
- **W-M0 · Honesty + copy quick-fixes (ship first, tiny).** MH-02 WalletChips `rawUgnot>0n` honesty fix (TDD) + MH-13 "1 token(s)" pluralization + **MH-14 ecosystem count↔rows consistency** (count = `max(snapshot,list)`, "view all N" when count > rows shown — tokens + validators). Independent of the redesign; lands immediately. *Effort S.*
- **W-M1 · Member hero (centerpiece — closes spec §3.2 #2, MH-01/03/08/09).** New member-spine hero, 2-col desktop → stacks mobile, reusing the visitor `hero-*` vocabulary so it matches the shipped system. **Left:** identity + standing (greeting/@username/avatar, honest balance, **XP→350 candidature progress meter**). **Right:** "your next move" (top `useHomeActions` item) **or a positive caught-up state**. Honesty everywhere (omit/invite, never 0). TDD + a11y + both themes. *Effort L.*
- **W-M2 · Member quests progress surface (closes never-built §3.2 #7, MH-04).** XP/level bar + next-quest CTA + candidature progress (from `lib/quests.ts`). May be the hero's left column (fold into W-M1) or a dedicated panel — decided by W-M1 layout. Honest empty = onboarding invitation. *Effort M.*
- **W-M3 · Empty-state uplift + CTA de-dup (MH-05/06).** "All caught up" → positive standing/next-step; reframe `YourWorldsPanel` cold-start; remove the 4× "browse DAOs" duplication so each empty has a distinct job. *Effort M.*
- **W-M4 · Member board re-order (MH-07).** Lead the logged-in board with personal standing + GovDAO; demote the shared marketing board for members. *Effort M. (decision-gated — see 14.6.)*
- **W-M5 · Consistency cleanup (MH-10/11/12).** Icon vocabulary for action chips; consolidate ActionCard/ActionDoor; drop hardcoded hex fallbacks. *Effort M.*
- **W-M6 · Verify.** New member surfaces at 390px in **both themes on a deploy-preview** (needs Adena → user-assisted), desktop both themes, a11y, §13 guardrail green.

### 14.5 Mobile verification of SHIPPED (shared) sections — result (390px, prod, light)
**All shipped sections pass** — no overflow, clean stacking: editorial hero → stacks (headline → CTAs → NetworkProofCard full-width); GovDAO spotlight single-column (gold intact, proposal list stacks); 4 cards + ecosystem listings (tokens + Top-validators rows) stack; Launchpad mini-card real (CANICULE); **activity feed is live with diverse data** (gnoswap test_token approvals — the deferred-feed note in §0.1 is now stale on test13). Nits only (non-blocking): aggressive feed-title truncation, slight coming-soon 2-col cramp at 390, "1 tokens" plural (MH-13). **No mobile blocker fixes needed in shipped sections** — Phase-3 mobile (#594) held. Connected-only surfaces (wallet chips / inbox / your-worlds) can't render locally — they’re exactly what W-M1–M3 rework, and get verified on the deploy-preview.

### 14.6 Decisions — LOCKED (user GO, 2026-06-27)
1. **Member hero anchor (W-M1):** ✅ **identity + XP→350 candidature-progress meter** is the hero's #1 surface (greeting/@username/avatar + honest balance + progress). Closes spec §3.2 #2 + #7.
2. **GovDAO placement:** ✅ **keep `GovDaoSpotlight` in the shared board for v1** (lower-risk); the member hero leads with personal standing. (W-M4 reduces to ordering, not relocating GovDAO.)
3. **Avatar source:** default **initials-only for v1**, progressive-enhance to gnolove/backend avatar only if CSP `img-src` already allows it (it allows `avatars.githubusercontent.com` per §9.6) — never block the hero on an image.
4. **Scope:** ✅ **full plan W-M0 → W-M6**, sequenced as small independent PRs, **pausing for explicit user OK before each merge** (per the hard rules in §0).
