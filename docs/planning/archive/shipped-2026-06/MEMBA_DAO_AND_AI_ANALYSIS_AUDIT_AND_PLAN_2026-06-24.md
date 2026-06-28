# Memba — DAO Pages & "AI Analysis" — Deep Audit + AAA Implementation Plan (2026-06-24)

> **Scope (User Note C):** `/:network/dao` (DAOs list), `/:network/dao/<realm>` (DAO home),
> `/:network/dao/<realm>/proposal/<id>` (proposal detail) — with a focus on making the **AI Analysis**
> *perfectly functional, optimised, with high input/output quality + rendering*, and verifying the
> DAO pages' UX/UI to AAA standard.
> **Status:** Audit complete (code- and on-chain-source-grounded). **Decisions received 2026-06-24 → §8 holds the finalized direction (authoritative); §3–§5 are the original audit/options.** No code written yet.
> **Slots into:** `MEMBA_COMPLETE_AAA_PROGRAM_2026-06-24.md` — this is the just-in-time detail plan for
> **E3-b (`feat/ai-dao-assistant`)** + the DAO-page correctness/UX items in **E7-a / E0-c / E6-f**.

---

## 0. Methodology & sources (what this audit is grounded in)

- **Repos synced:** `Memba` pulled (`main` @ `71e1b9e`, clean); `gno`, `gnodaokit`, `adena-wallet`, `gnolove`, `gno-govdao-activity-parser` fetched (non-destructive — several repos are on feature branches / dirty, left untouched).
- **Read:** `GNO_CORE_BREAKING_CHANGES.md`, `GNO_CORE_COMPAT.md`, `AGENTIC.md`, the master AAA program, and the full DAO/analyst code path (frontend + Go backend).
- **Ground truth:** the **deployed gov/dao v3 render source** in `gno/examples/gno.land/r/gov/dao/v3/impl/{render,types}.gno` (test13 branch) — reconciled line-by-line against Memba's regex parser. (Live RPC + browser pulls were blocked in this session — sandboxed `curl`, a parallel session holding the Playwright browser, and a transient safety-classifier outage — so a **live visual pass is the one open verification item**, listed in §7.)

---

## 1. Breaking-change assessment (User ask #1)

**Verdict: no *new* upstream breakage; the DAO pages already absorb the test13 gov/dao churn — but reconciling against the real render source uncovered two latent parser bugs (see F-E1/E2/E3).**

| Upstream (gno test13) | Memba status |
|---|---|
| #5418 *markdown injection escaping in Render* | **Absorbed** — `shared.ts:106 unescapeMarkdown()` strips `\(`,`\[`,`\_`… |
| #4488 *executor creation-realm in proposal render* | **Absorbed** — `proposals.ts:268 executorMatch` parses `Executor created in:` |
| #5261 *ExecuteOrRejectProposal* | **Absorbed** — `builders.ts:38 GOVDAO_EXECUTE_FUNC`, `ProposalView.tsx:214` comment + reload-after-execute |
| #5271 *abstain vote* | **Partial** — realm supports abstain (`render.gno:193`), but Memba **hides** the abstain button for GovDAO (`ProposalView.tsx:517`) → **F-E6** |
| `gnodaokit` render changes (#46 history, #48 No/Abstain, #40 piechart) | **Monitor only** — affects Memba-built DAOs *if/when* realms are upgraded; deployed test13 realms unaffected |
| adena 1.19.7 + test13 RPC/gnoweb domain moves (#856/#860/#863) | **Absorbed** — `config.ts` points at `rpc.test13.testnets.gno.land` + `test13.rpc.onbloc.xyz`, gnoweb `test13.testnets.gno.land` |

**Parallel-session activity:** only two open PRs — **#487** (`chore/archive-superseded-plans`, docs) and **#443** (`feat/nft-marketplace-phase2`, NFT). The master program also notes `fix/home-connected-feedback` owns the **home** tree. **None of these touch the DAO-pages / analyst files** in §6 — our scope is conflict-free (one coordination flag in §6.4).

---

## 2. The AI Analysis feature — how it works today (map)

- **Backend:** `POST /api/analyst/consensus` (`analyst_consensus.go`) fans out to **10 free OpenRouter models** (`analyst_openrouter.go:15-80`), each given a governance "role" (Risk Scout, Security Auditor, Devil's Advocate…), 2 batches of 5, **55 s** budget, **no streaming**. Weighted aggregation → `{verdict, confidence, agreementLevel, agreeCount/totalCount, summary, keyRisks, keyRecommendations, perspectives[]}`. Server-cached 6 h (sqlite), **auth-required** (`main.go:197-201`, SEC-03), rate-limited 10/min.
- **Frontend:** `AnalystReport.tsx` (proposal, on-demand button) and `DAOAIInsight.tsx` (DAO home, auto-fetch), both via `useAnalystReport.ts`. Output rendered as **plain `<p>`/`<li>` text** (no markdown). Server-side prompts only (injection-hardened, SEC-NEW-04).

This is a genuinely strong foundation. The gaps below are about **correctness, input richness, output rendering, and the logged-out path** — i.e. turning a working prototype into an AAA, demo-ready feature.

---

## 3. Audit findings — AI Analysis

Severity: **HIGH** = breaks/​misleads in normal use · **MED** = quality/trust gap · **LOW** = polish.

### Functionality & correctness
- **A1 · HIGH · Logged-out "Run AI Analysis" is a dead button.** `useAnalystReport.ts:109-110` returns silently when there's no `memba_auth_token`. On the *public* proposal URL, a signed-out visitor clicks the idle button (`AnalystReport.tsx:98`) → no loading, no error, nothing. Looks broken.
- **A2 · HIGH · The whole feature is invisible to signed-out visitors.** `requireAuthMiddleware` gates **both** cached-read and generate (`main.go:198-201`); DAO-level auto-fetch returns `null` silently when signed out, so the AI Council section never renders. A *cached* report costs nothing to serve — gating reads makes the headline feature unreachable on the link you shared.
- **A3 · HIGH · Consensus math is corrupted by failed models.** Failed calls become `verdict:"abstain", confidence:0` (`analyst_consensus.go:426-434`) but still count in the denominator: agreement ratio and completeness use `len(perspectives)` = 10 (`:229,:237`). So 8 approve + 2 failed reads as *"strong, 8/10"* not *"unanimous, 8/8 responded"*, and confidence is silently scaled by `8/10`. Proposal-level UI prints raw `agreeCount/totalCount` (`AnalystReport.tsx:149`), conflating **disagreed** with **failed to respond**. (DAO-level is already more honest — `DAOAIInsight.tsx:84 respondedCount`.)

### Input quality
- **B1 · HIGH · Proposal analysis is starved of context.** `ProposalView.tsx:400-401` sends `proposalData = proposal.description || proposal.title` and `daoContext = "DAO: <path>, Proposal #N: <title>"`. The model **never** sees the on-page facts that decide a proposal: **action metadata** (`actionType`/`actionBody`/`executorRealm` — *what it does*), **vote tallies & status**, proposer, eligible tiers, threshold, member count, or treasury. The backend even has a `TreasuryContext` field that is never populated (`analyst_consensus.go:29,392`). Net effect: the prompts say *"if the proposal lacks detail, lower your confidence"* (`analyst_openrouter.go:142`) → systematically weak, low-confidence output.
- **B2 · MED · DAO-level context is half-built.** `buildDAOSummary` (`DAOOverviewCard.tsx:32-47`) does pass good metrics (members, active/total, awaiting-exec, non-voter %, power, health) — but `daoContext` is just the realm path (`DAOAIInsight.tsx:48`), and the model gets **no treasury balance, tier breakdown, or recent-proposal list**, which the health rubric (`analyst_openrouter.go:92-95`) explicitly wants.
- **B3 · MED · Description carries raw render noise.** `getProposalDetail` descMatch (`proposals.ts:260`) swallows the `This proposal contains the following metadata… Executor created in:…` block + `---` into `description`. That noisy text is shown in the description card **and** is what gets sent to the AI.

### Output quality & rendering
- **C1 · MED · No markdown rendering.** `reasoning`/`summary` go straight into `<p>` (`AnalystReport.tsx:64,179`; `DAOAIInsight.tsx:133,179`). Any emphasis/lists/inline-code the models emit shows as raw text. (Memba already ships DOMPurify for safe markdown elsewhere.)
- **C2 · MED · Per-model recommendations are dropped.** Backend returns them; the proposal ModelCard shows only reasoning + risks (`AnalystReport.tsx:62-72`), DAO-level only reasoning. Useful signal wasted.
- **C3 · MED · Verdict framing / disclaimer.** A big `APPROVE`/`REJECT` badge can read as *"how to vote."* There's no visible "AI advisory — not a vote, not financial advice; analyzes untrusted on-chain text" note near the verdict (master plan E3-b explicitly calls for **untrusted-content framing**).
- **C4 · LOW · No freshness/transparency.** `expiresAt` is returned but unused; only "cached" shows. No "generated N min ago", no plain-language note on what the 10 models/roles are.
- **C5 · LOW · a11y.** Emoji-only icons (🤖), **color-only** verdicts (red/green), caret glyphs (▶/▸), nested spans inside a button. Needs aria-labels, a non-color verdict cue, and `aria-expanded`.

### UX flow
- **D1 · MED · 55 s wait, no progress, no streaming.** Loading is a static shimmer "Analyzing with 10 AI models…" for up to 55 s — no elapsed time, no per-model progress, no "~1 min" expectation. AAA wants progressive/streamed results or at least an honest progress affordance.
- **D2 · LOW · Inconsistent affordances.** Proposal = on-demand; DAO = auto-fetch; refresh/retry styling differs between the two components. Unify and justify.

---

## 4. Audit findings — DAO pages (correctness + UX)

Reconciled against the real gov/dao v3 render (`render.gno`, `types.gno`):

- **F-E1 · HIGH · A denied proposal shows as ACTIVE on the detail page.** Detail render emits `**PROPOSAL HAS BEEN DENIED**` (`types.gno:149`). `getProposalDetail` statusMatch captures `DENIED` (`proposals.ts:243`), but `normalizeStatus` (`shared.ts:215-223`) has **no `denied` branch** → defaults to `open`. So a denied proposal renders the **LIVE badge, a 30 s poll, and active vote buttons** in detail — while the **list** correctly shows REJECTED (`render.gno:181 → "REJECTED"`). The test that "proves" this works (`dao.test.ts:555`) is a **synthetic** fixture (hand-written `Status: ACCEPTED`) — the exact synthetic-fixture trap the master plan warns about.
- **F-E2 · MED · Detail author lost for unresolved addresses.** Unregistered authors render as bare `g1…` (`render.gno:200 tryResolveAddr`). The list parser has a `g1` fallback, but the **detail** parser only matches `Author: [@user](url)` (`proposals.ts:240`) → no author shown.
- **F-E3 · MED · Vote tallies undercount.** Votes are parsed only from `@user](url)` voter lists (`proposals.ts:350`); bare-`g1` voters are dropped. gov/dao emits YES/NO/**ABSTAIN** PERCENT (`types.gno:164-166`); Memba parses yes/no percent but **not abstain** (`proposals.ts:247-248`). "Voting Insights" participation can therefore be wrong.
- **F-E4 · MED · GovDAO console-404 noise** from `tx_search` (≈63 errors) — **already tracked as E0-c/DB4**; cross-referenced, not re-derived.
- **F-E5 · LOW · Description metadata noise** — same root as B3; a display bug too.
- **F-E6 · LOW · Abstain unavailable on GovDAO** despite realm support (`ProposalView.tsx:517` vs `render.gno:193`).
- **F-F1 · MED · Vote-confirm dialog** is inline-CSS with `role="alertdialog"` but **no focus trap / Esc / outside-click** (`ProposalView.tsx:494-509`) — overlaps master **E6-f**; coordinate.
- **F-F2 · LOW · Pervasive inline styles** in `ProposalView.tsx` (buttons/warnings) — blocks the light-theme epic (E6-n).
- **F-F3 · LOW · Polish:** author avatar shows "?" for non-@ authors (`:336`); breadcrumb title-cases the last path segment ("Dao" for gov/dao); stat-card facts live only in `title=` tooltips (invisible on touch/keyboard).

**Baseline is good:** loading/empty/not-found/error states exist across DAOList/DAOHome/ProposalView; #477 already surfaces failed vote-loads; #468 fixed DAO overcount. The work below is correctness + AAA polish, not a rebuild.

---

## 5. Implementation plan (AAA, branch-per-PR, TDD)

**Conventions (inherited from the master program):** never commit to `main`; one feature per branch off updated `main`; per-PR approval even on green CI; **no Claude attribution**; backend logic is TDD with **real-render fixtures** (no synthetic inputs); a11y changes get axe assertions; each PR independently revertible.

### Phase 0 — DAO-page correctness (small, high-value, demo-safe) → Wave 1
| PR branch | Fixes | Effort | Notes |
|---|---|---|---|
| `fix/dao-proposal-status-denied` | **F-E1** | S | `normalizeStatus`: add `denied/deny→rejected`; map detail prose explicitly. **Replace synthetic `dao.test.ts` fixture with a real `render.gno`-shaped one** (denied/accepted/open). |
| `fix/dao-detail-author-and-votes` | **F-E2, F-E3** | S–M | Detail author `g1` fallback; capture bare-address voters; parse ABSTAIN PERCENT; reconcile tally vs percent. Real-render fixtures. |
| `fix/dao-description-cleanup` | **B3, F-E5** | S | Stop swallowing metadata into `description`; keep executor metadata only in the Action card. |
| `fix/govdao-abstain-enable` | **F-E6** | S | Allow abstain on GovDAO (verify against `MustVoteOnProposalSimple(..,"ABSTAIN")`). |

> **Coordinate:** these touch `proposals.ts`/`shared.ts`/`ProposalView.tsx`, which **E7-a** (N5 vote-success skeleton, N6 cache-invalidation) and **E6-f** (dialog focus-trap, `ProposalView.tsx:494`) also touch. Recommend either folding N5/N6/E6-f into Phase 0/§F-F1, or sequencing Phase 0 first and rebasing E7-a/E6-f. **Your call in §7.**

### Phase 1 — AI Analysis: correct & honest (this is the core of E3-b) → Wave 2
| PR branch | Fixes | Effort |
|---|---|---|
| `fix/analyst-responder-math` (backend, TDD) | **A3** | M | Compute agreement + confidence over **responding** models; carry `respondedCount` in `ConsensusVerdict`; both UIs show "N/10 responded" distinctly from "agree". Fixture with 2 simulated failures. |
| `fix/analyst-logged-out-ux` (frontend) | **A1** | S | No token → render a clear "Sign in to run AI analysis" CTA wired to the login flow (not a dead button); DAO-level shows the same gentle prompt instead of vanishing. |
| `feat/analyst-public-cached-read` (backend) | **A2** | M | Split: **public** `GET` of an existing cached report (no LLM cost, rate-limited) vs **auth** `POST` to generate. ⟵ **security decision, §7**. |

### Phase 2 — AI Analysis: input quality → Wave 2
| PR branch | Fixes | Effort |
|---|---|---|
| `feat/analyst-rich-proposal-context` | **B1** | M | Frontend assembles a structured block (action type/body/executor, status, yes/no/abstain tallies, eligible tiers, threshold, member count, proposer) + populate `TreasuryContext`; backend prompt template consumes it. Caps respected (50 KB/10 KB). |
| `feat/analyst-dao-health-context` | **B2** | S–M | Add treasury balance + tier distribution + recent-proposals digest to the DAO-level context; drop the redundant `daoContext=realmPath`. |

### Phase 3 — AI Analysis: output quality, rendering, UX → Wave 2
| PR branch | Fixes | Effort |
|---|---|---|
| `feat/analyst-markdown-render` | **C1, C2** | S–M | Safe markdown (DOMPurify) for `reasoning`/`summary`; surface per-model recommendations. |
| `feat/analyst-advisory-a11y` | **C3, C4, C5** | S–M | Advisory + untrusted-content disclaimer near the verdict; non-color verdict cue + aria + `aria-expanded`; show freshness from `expiresAt`; a one-line "what are these models?" affordance. axe assertions. |
| `feat/analyst-progress-ux` | **D1, D2** | M | Elapsed-time + honest "up to ~1 min" copy and a determinate-ish progress affordance; unify retry/refresh. **Stretch:** progressive/streamed per-model results (larger lift — §7). |

### Phase 4 — Hardening & tests (interleave; → Wave 3/5)
- `test/analyst-auth-gate-regression` — the master **E3-a** fast-follow (existing tests call the handler directly, bypassing the middleware) + optional **daily LLM-spend ceiling**.
- `test/dao-parser-real-fixtures` — capture real `render.gno`-shaped fixtures for list/detail/votes (kills the synthetic-fixture class of bug) — backstops Phase 0.
- e2e: denied proposal renders as REJECTED (no LIVE/vote); analyst happy-path with a mocked provider.

---

## 6. Files in scope (for conflict-avoidance)

`frontend/src/lib/dao/{proposals,shared}.ts` · `frontend/src/pages/ProposalView.tsx` · `frontend/src/components/dao/{AnalystReport,DAOAIInsight,DAOOverviewCard}.tsx` · `frontend/src/hooks/useAnalystReport.ts` · `backend/internal/service/analyst_consensus.go` · `backend/internal/service/analyst_openrouter.go` · `backend/cmd/memba/main.go` (analyst routes only).

**No overlap** with #487 (docs) or #443 (NFT). **Overlap to coordinate:** `ProposalView.tsx`/`proposals.ts` with master **E7-a** + **E6-f** (see §5 note). The **home** branch is untouched by this scope.

---

## 7. Open decisions for your review

1. **Public cached reads (A2):** make a cached report readable without sign-in (recommended — it's the headline feature on a public link, zero LLM cost), or keep fully auth-gated?
2. **Model strategy (quality vs cost):** keep the 10 free OpenRouter models (cheap, flaky), or add **1 reliable anchor / a small synthesis pass** to lift quality? (Cost/posture call.)
3. **Streaming vs progress (D1):** ship the quick progress affordance now and defer true streaming, or invest in streamed per-model results now?
4. **Coordination (§5 note):** fold E7-a (N5/N6) + E6-f (dialog a11y) into this DAO-page work, or keep them in their own epics and rebase?
5. **Plan home:** this doc lives in `docs/planning/`. Want it committed on a branch (e.g. `docs/dao-ai-analysis-plan`) so a `git clean` can't drop it, like E0-f did for the other plans?

> On your go-ahead I'll write the per-phase TDD micro-plans (`docs/superpowers/plans/2026-06-XX-…`) and execute subagent-driven, one PR at a time, each gated on your approval. Suggested first cut for **Friday's demo**: **Phase 0** (correctness) + **Phase 1** (honest, logged-out-friendly AI) + **Phase 2 P2.1** (rich proposal context) — that's the biggest visible quality jump for the least risk.

---

## 8. Finalized direction (post-review, 2026-06-24) — AUTHORITATIVE

### Decisions
1. ✅ **Public cached reads** — a generated report is readable without sign-in.
2. ✅ **9 perspectives + 1 reviewer** — keep 9 free role-models for breadth, add **one reviewer model** that receives the 9 outputs **plus the full context** and writes the headline review. Keep it simple/free for now (reviewer = the strongest free model, e.g. `gpt-oss-120b`); upgradeable to a paid anchor later if quality needs it.
3. ✅ **Auto-displayed, generated once per proposal** (server-side), not re-triggered per visit.
4. **(CTO call) Absorb the overlapping items.** This workstream **owns** `ProposalView.tsx`, `lib/dao/{proposals,shared}.ts`, the analyst components/hook, and `analyst_*.go` + `main.go` analyst routes — pulling in the overlapping **E7-a** N5 (vote-success skeleton) + N6 (proposal-cache invalidation) and **E6-f** (vote-dialog focus-trap) so two sessions never edit these files. The remainder of E7-a/E6-f stays in their epics. I'll flag this in the master program's coverage notes.
5. **(CTO call) Protect the doc now.** Commit this plan on `docs/dao-ai-analysis-plan` (isolated worktree, so a `git clean` in the main checkout can't drop it); **push/PR only on your OK**. It then rides into the Phase-0 PR.

### Finalized AI-analysis architecture (the E3-b shape)

**A. Server-authoritative input (fixes B1/B3, enables 3).** Given `(realmPath, proposalId, chainId)`, the **backend** fetches the canonical proposal itself via `vm/qrender` (+ votes + DAO config/treasury) and assembles the rich context: **who** proposes (address/username, tier), **what** it really does (decoded action / executor body = the "code"), tallies + status, eligible tiers, threshold, member count, treasury. The frontend stops sending `proposalData`. This raises quality *and* verifies the proposal exists (an abuse gate), *and* removes the frontend-trust problem.

**B. 9 + 1 consensus (decision 2).** The 9 role-models run as today (drop one of the current 10 to make room — fold "Governance Expert" into the reviewer's remit). A **reviewer** pass then takes the 9 perspectives + full context and emits a structured review — *who · what · impacts · potential impacts · code/security* → verdict + confidence + key risks/recommendations. The reviewer's narrative is the headline; the 9 become the "model breakdown." The weighted tally is kept as a cross-check and computed over **responding** models only (fixes A3).

**C. Auto-generate-once + public cache (decisions 1 & 3).**
- `GET /api/analyst/consensus?realm=&proposalId=&chainId=` → returns the **public** cached report (no auth) if present.
- On cache miss: backend **verifies the proposal on-chain**, generates once, caches publicly, returns it. Frontend **auto-fetches on proposal load** (proposal-level becomes auto like DAO-level) — no button, no per-visit regen.
- **Abuse controls (generation is the only cost):** generate only for on-chain-verified proposals on gov/dao + allowlisted DAOs; **global daily LLM-spend ceiling** (the E3-a fast-follow) + per-IP limit; show an "analysis pending" state if the ceiling is hit.
- **Optional warm-on-create:** after a Memba-mediated proposal submission (`ProposeDAO`/`TreasuryProposal`), fire a non-blocking generate — the literal "trigger once when posted."

**D. Output (C1/C2/C3/C5).** Safe-markdown (DOMPurify) render of the reviewer narrative + per-model reasoning/risks/recs; advisory + untrusted-content disclaimer by the verdict; non-color verdict cue + aria + `aria-expanded`; freshness from `expiresAt`.

**E. Progress (D1).** Auto + cached ⇒ most visitors get an instant cached result; cold-generation shows a determinate "reviewing… (~1 min)" state. Streaming deferred (unneeded once cached/auto).

### Revised phase order (Friday-demo-first)
- **Phase 0** — DAO-page correctness (denied-status, author/votes, description, GovDAO abstain) **+ absorbed N5/N6/E6-f**. Ship first; pure correctness, demo-safe.
- **Phase 1** — backend: server-side content fetch + public `GET` + auto-generate-once + the 9+1 reviewer + responder-only math. The headline.
- **Phase 2** — frontend: auto-fetch + markdown/advisory/a11y rendering of the reviewer output; remove the on-demand button + dead-button path.
- **Phase 3** — abuse hardening (daily ceiling, allowlist), warm-on-create, real-render fixtures + e2e.

Net: **simpler frontend, one extra model call, server does the fetching** — and the result is genuinely decision-useful (who/what/impact/security), auto-shown, and free to read.
