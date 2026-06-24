# Memba — Demo-Readiness + AAA Ecosystem Roadmap (2026-06-24, PM)

> **What this is.** The session deliverable for the request: *pull all Gno repos, find breaking changes, deeply audit five new dimensions (A Validators · B gno-mcp · C Quests · D UI/UX · E repo health), and produce an AAA implementation plan* — with a **demo tomorrow for the gno core team + ecosystem call** as the governing constraint.
>
> **What it builds on (do not re-do).** This session's morning work already produced two verified, file:line-backed docs that cover Memba's *internal* state: [`MEMBA_NEXT_STEPS_PLAN_2026-06-24.md`](./MEMBA_NEXT_STEPS_PLAN_2026-06-24.md) (the prioritized P0/P1/P2 backlog) and [`MEMBA_CONNECTED_AUDIT_AND_PLAN_2026-06-24.md`](./MEMBA_CONNECTED_AUDIT_AND_PLAN_2026-06-24.md) (the connected-mode + 7-agent sweep). **This doc does NOT duplicate them** — it adds the five new dimensions the user asked for, the upstream-Gno breaking-change verdict, and folds everything into one demo-first, AAA-sequenced roadmap. Where an item already lives in the morning backlog, it's referenced, not restated.
>
> **Method.** All Gno repos pulled/fetched; a 5-agent parallel deep-dive (Gno upstream · Validators · gno-mcp · Quests · live UX walkthrough), each verifying claims at `file:line`/URL; highest-impact findings spot-checked first-hand by me. Live UX driven against `https://memba.samourai.app/test13` (27 screenshots).
>
> **Rails (non-negotiable).** Never commit to `main`; branch off **updated** `main`, PR, admin-merge **only on explicit per-PR approval** (even with green CI). No Claude attribution anywhere. Backend logic changes are TDD with permanent regression fixtures. Each phase is independently shippable **and** revertible. Owner legend: **[Me]** = I implement on a branch + PR for your review · **[You]** = operator-only (secret rotation, wallet-signed E2E, prod env flips, multisig ceremony, infra provisioning).

---

## 0. Ground truth — repo sync & upstream breaking-change verdict

**Repos pulled/fetched this session.** Clean repos on `main` fast-forwarded (`gnomonitoring` +new branch, `gnolove`, `gnodaokit`, `gno-docs`, `gno-agent-workspace` — all already current). `Memba` is on `fix/home-connected-feedback` with **uncommitted home edits + the two morning planning docs (untracked)** — left untouched (a concurrent home session owns that tree). `gno` is a pinned detached-HEAD checkout at `f45cc5c88` (2026-06-05); **`origin/master` is 54 commits ahead**. `gno-mcp` (gnoverse) and `gno-onboarding-bot` (samouraiworld) cloned to `/tmp/gno-research/` for analysis.

**Upstream Gno → Memba breaking-change verdict: NONE. Nothing in the 54 commits requires a Memba change before the demo.**
- Memba's on-chain realms (`p/samcrew/*`, `r/samcrew/*`) and their **vendored** deps are 100% untouched by the range → zero recompile/redeploy risk.
- Every change that *looked* threatening resolves to non-impacting once usage is checked at `file:line`:
  - **grc721 `SetTokenMetadata` gained a `caller` arg** — Memba imports its **own** `p/samcrew/grc721` (2-arg, untouched), not `p/demo/tokens/grc721`. Safe.
  - **valopers Register docs + validators-v3 limits removed** — `valopers.gno` *Render* untouched (Memba's moniker regex at `validators.ts:251` still matches); Memba never queries `r/sys/validators`. Safe.
  - **gnoclient `QuerySessionAccount`→`GnoSessionAccount`** — Memba backend uses **no** gnoclient (signs via Adena in-browser). N/A.
  - **out-of-gas UX rework** — CLI-only; the runtime ABCI error string Memba/Adena match on is unchanged. Safe.
  - **amino reserved-fields / gnovm AST changes** — wire-compatible; tx types Adena signs untouched. Safe.
- **One 30-second live smoke-test (not a blocker):** `f194b2ef4` *state-explorer refactor (#5649)* touched `GetDirectoryView`. Memba's **Directory page scrapes that gnoweb listing's `href` anchors** (`gnoweb.ts:86` → `directory.ts:552,657`). Anchor format was not the PR's target and is very likely intact, but confirm `/r/samcrew` still renders `<a href="/r/samcrew/memba_dao">` on test13. (Memba's primary realm reads use ABCI `qrender`/`qeval`, which are unaffected.)

**Opportunity unlocked upstream:** the valoper system Memba can now surface — `Valoper` exposes `OperatorAddress` + `gpub1…` `SigningPubKey` (`valopers.gno:75,471`); see **A** below.

---

## 1. DEMO TOMORROW — the critical path

This is the section that matters for tomorrow. The app is in **good demo shape**: dark theme is clean and polished across every surface, most pages have real, rich data. The weak spot is the **Directory front door**; the strongest content is **Validators + GovDAO + Quests(join-dao) + the AI analyst**.

### 1A. Demo-blockers to fix tonight (all small, all [Me] on a branch)

| ID | Blocker | Evidence | Fix | Effort |
|---|---|---|---|---|
| **DB1** | **Directory shows `VALIDATORS 0`** while Home + Validators page correctly show **5** — wrong data in front of the people who run the validators. | `components/directory/ChainMetricsBanner.tsx:47` sources `validatorCount` from `getNetworkStats().totalValidators` (returns 0 here; the Validators page's richer path returns 5). | Re-source the count from the same working path, or fix `getNetworkStats` so Directory and Validators agree. | S |
| **DB2** | **Raw unrendered Markdown on a DAO card** — literal `[> Go to Memberstore <](/r/gov/dao/v3/memberstore)` instead of a link. Visibly broken. | GovDAO card description on `/test13/directory` (DOM-confirmed). | Render markdown→link (or strip) in the directory DAO-card description. | S |
| **DB3** | **Broken-looking empty search box** — featureless gray rectangle, no placeholder/icon, above the tabs (a *second*, working "Search DAOs…" box exists below it). Reads as a failed-to-load element. | `pages/Directory.tsx:115` (`dir-search dir-search--global`). | Add placeholder + icon, or remove the redundant global box. | S |
| **DB4** | **63 console 404 errors on GovDAO** — repeated `tx_search` (`message.module='gno.land/r/gov/dao'`) 404 across all 3 RPC endpoints. Renders fine, but **the gno team will open devtools** and see a wall of red. | `/test13/dao/gno.land/r/gov/dao` console log. | Guard/handle the 404 path (feature-detect `tx_search` support or stop firing the unsupported query on test13); don't spam the console. | M |
| **DB5** | **NFT-gate regression (also the morning plan's #1 P0, CONFIRMED still open)** — `CollectionDetail`, `CreatorProfile`, `StudioHome`, `StudioManage` have **no `VITE_ENABLE_NFT` gate** and their routes are unconditional → a curious dev typing `/test13/nft/studio` hits **live mint UI against the allowlisted `memba_collections` realm** while NFT is nominally "off." | `App.tsx:217-223` unconditional; only `NFTGallery.tsx:41`/`NFTLaunchpad.tsx:20`/`CreateCollectionLaunchpad.tsx:32` define `NFT_ENABLED` (no shared helper). | Introduce one `isNftEnabled()` helper; wrap **all** NFT pages + routes in `ComingSoonGate` when off; add a test asserting each NFT route renders the gate. | S |

> **DB5 is testnet-scoped today** but it's a gating-discipline defect (becomes a real-fund P0 on mainnet) and it's cheap. Do it. **Optional tonight (security "gotcha" insurance):** also close the candidature localStorage XP bypass UI-side (see **C / HIGH-1**) — gate the form on backend XP when a wallet is connected (`CandidaturePage.tsx`). S. Only surfaces in a connected flow, so lower demo-urgency than DB1-4.

### 1B. Demo narrative (what to show, what to avoid)

**Lead with strength, in this order:**
1. **Validators** — genuinely impressive and *exactly* the audience's domain: real block height, 3.9s blocks, 5/5 healthy, 99.94% uptime, full validator table + 55-node roster + incidents timeline + "Hacker view," zero console errors, clean on mobile. **Frame it with the new valoper-onboarding story** (you read the test13 validator article): "Memba reads the new `r/gnops/valopers` registry." If **A/E1-E3** ship tonight, show the valoper/candidate panel + onboarding links — that's the single most audience-aligned moment of the demo.
2. **GovDAO detail** (`/test13/dao/gno.land/r/gov/dao`) — your richest content: 21 PASSED proposals, vote bars, tier breakdown, power donut. Pair it with **the AI analyst report on a proposal** (Memba's "safe AI + Gno" story — see **B**).
3. **Quests → join-dao** — connect wallet → complete `join-dao` (the one quest that is **truly on-chain verified end-to-end**) → watch XP/rank update → leaderboard. Frame badges as "ceremony-gated, coming soon."
4. **gno-mcp live read** (for this audience specifically) — in Claude Code, `gno_render gno.land/r/samcrew/memba_dao` via gnomcp: "Memba's realms are AI-legible through Gno's own tooling." Endorses the ecosystem's own tool; strong note to end on.

**Avoid (until fixed):** the **Directory page** (DB1-3), the **Home hero "MembaDAO" link** (all zeros — 0 members/0 proposals; a click lands on an empty page — drive to GovDAO instead), the **~18 un-grantable quests** (don't present quests that silently can't complete — confirm the catalog hides them), and any connected flow that hits the candidature gate unless DB5-optional is done.

---

## 2. The five dimensions (A–E): findings + plan

### A — Validators (onboarding, candidates, monitoring)

**New onboarding (test13) = a 5-stage pipeline**, operator-identity-keyed: **Setup** (consensus key `gpub1…`) → **Register** a profile on-chain at `r/gnops/valopers` (`Register(moniker, desc, serverType, operatorAddr, pubKey)`, permissionless self-register) → **Discord verify** via `gno-onboarding-bot` (`/candidate-testnet`, `/submit-request`) → **GovDAO batch vote** (`proposal.NewValidatorProposalRequest`, initial power=1) → **Activation** (bot's 5-min poller auto-grants the Discord "Testnet Validator" role when the signing address appears in the live valset). **Key model fact: operator address ≠ signing address** — the consensus set is keyed by the rotatable signing key; identity is the stable operator address. This is exactly what gnomonitoring just fixed (monikers were resolving by the wrong address).

**Memba's validators page is already rich** (`pages/Validators.tsx`, `lib/validators.ts`, `lib/gnomonitoring.ts`): overview cards, health banner, 30-day incidents chart, voting-power distribution, a full validator table with uptime/missed-blocks/participation **already pulled from 7 gnomonitoring endpoints**, and a P2P node roster. **Gaps:** no valoper-specific surface (server type, keep-running, operator-vs-signing distinction, *registered-but-pending-activation* candidates), no onboarding CTA/links, and a `getValidators` `as any → []` parse (`validators.ts:106`).

**Data available (all queryable today):** `r/gnops/valopers` (`qeval GetByAddr` for structured fields; Memba already calls `Render` for monikers at `validators.ts:245`), `r/sys/validators/v3.GetValidators()` (governance view), `/validators` RPC (current primary), `/net_info` (roster), gnomonitoring JSON API `:8989`. **Honest gap:** the "GovDAO candidate queue" lives in the bot's *private Google Sheet* — not consumable; the on-chain proxy (registered valoper with `KeepRunning=true` whose signing addr is **not** yet in the valset = "pending activation") is the pragmatic substitute.

**Plan:**
| ID | Item | Source | Effort | Demo tmrw? |
|---|---|---|---|---|
| **A-E1** ⭐ | **Valoper/Candidate panel** — list registered valopers with status **Active / Registered–pending-activation / Standby**, moniker, operator addr, server-type badge, profile link. The visible payoff of the new onboarding system; 5 real valopers live on test13 (gnocore-val-01, berty-val2-1, PRO Delegators, zxq-val-01, KalpaTech). | `r/gnops/valopers` `GetByAddr` + cross-ref `GetValidators()` | **M** | **Yes** (headline) |
| **A-E2** | **Operator vs signing address clarity** on the validator detail page (both addresses + last-rotation height). | `GetByAddr` | **S** | **Yes** |
| **A-E3** | **Onboarding CTA + ecosystem links** — "Become a validator on this network" → test13 article, gnops.io specs, `r/gnops/valopers`; optionally the exact `Register` gnokey snippet. Strong "we promote your flow" signal. | static | **S** | **Yes** |
| **A-E4** | Governance view (trust level, cooldown, keep-running). | `r/sys/validators/v3` | S–M | stretch |
| **A-E5** | Harden `getValidators` with a typed (zod) parse vs `as any → []`. | — | S | roadmap |
| **A-E6** | Adopt gnomonitoring's one-call `/api/chain/<id>/health` (fuses valset + server_type + keep_running + precommit_bitmap) — *if Lours has deployed it publicly* (currently marked unreleased; confirm). | gnomonitoring | M | roadmap |

**Demo set: A-E3 (tonight, S) + A-E2 (tonight, S) + A-E1 (if time, M).** Even A-E3 alone makes the validators page "speak the new onboarding language."
**Honesty caveats:** (1) the prior-audit "clickable non-semantic divs" a11y bug on Validators **appears already fixed** (`Validators.tsx:476` rows are semantic with `role/tabIndex/onKeyDown/aria-label`) — re-verify before listing it as work; (2) the referenced onboarding-bot **PR #9 (`/remove-validator-role`) did not verify** in the repo history (PRs #5, #8, #10–#12 exist) — flag, don't assume.

### B — gno-mcp / safe AI + Gno

**gnomcp** (gnoverse/gno-mcp, **v0.7.0, pre-release & explicitly unaudited**, actively developed) is well-architected and security-conscious: **23 tools** (read tools mature + safe; write/session tools experimental and "will be reworked"), Go + official MCP SDK over **stdio**, built on gno's own `gnoclient`. Its safety model **mirrors Memba's**: keys never leave `gnokey`; writes are **structurally** confined to dev/testnet by a chain-id regex (`^(dev|test-?\d+)$`) so the mainnet write path *doesn't exist in code*; all chain-derived bytes wrapped in `<untrusted_content>` envelopes; per-write audit log; no key custody. The gno monorepo ships **no** first-party MCP — gnomcp is the de-facto standard.

**Memba already has ~80% of the ideal pattern:** `/api/analyst/consensus` fans out a proposal/DAO's on-chain context to ~10 OpenRouter models → an aggregated governance verdict (`analyst_consensus.go:310`), rendered on proposal pages (`useAnalystReport.ts`). Read-only chain context → LLM, client-side Adena signing, server-side keys only. **This *is* the MCP pattern as REST.**

**The one must-fix (also the morning plan's N1, independently re-confirmed):** `/api/analyst/consensus` is **UNAUTHENTICATED** — `main.go:195` wires only `rateLimitMiddleware`, while its sibling `/api/analyst/analyze` at `main.go:194` uses `requireAuthMiddleware`; the frontend sends no auth header (`useAnalystReport.ts:115-130`). A fresh `(realm,proposal,chainId)` bypasses the cache and burns a 10-model fan-out with no caller identity — an API-key cost-drain / feature-DoS. **Fix ≈ 3 lines:** apply the existing `requireAuthMiddleware` (`main.go:357`) + send the Adena token header. Optionally a global daily LLM-spend ceiling.

**Plan (ranked):**
1. **Secure + demo the in-app "Ask AI about your DAO/proposal"** (Option b). Must-fix the auth above (**S**), then it's demo-able **today** — a real proposal gets a multi-model verdict, and the auth-hardening *is* the security story. **[Me]** code; auth middleware already exists.
2. **Recommend/document gno-mcp to the gno core team** (Option c) + a live `gno_render gno.land/r/samcrew/memba_dao` in Claude Code. **S**, demo-able, most audience-aligned. No dependency.
3. **Dedicated read-only "Memba MCP" server** (Option a) — domain-shaped read tools (`memba_dao_summary`, `quest_status`, `validator_uptime`). **M–L, roadmap, largely redundant** with gnomcp for generic reads; only build for Memba-specific shaping. Must be strictly read-only, realm-allowlisted, rate-limited, no key custody, untrusted-content envelopes.

**Non-negotiable guardrails for any AI+Gno+Memba work:** read-only by default; transactions ONLY via user-signed Adena (never server/MCP-held keys); realm allowlist (Memba already validates paths — `analyst_consensus.go:67`, `render_proxy.go:18`); auth + rate-limit every LLM-spending endpoint; treat all chain/LLM output as untrusted data; no secrets in the client bundle.
**Bottom line:** authenticate the consensus endpoint, demo the existing analyst as Memba's "most security-conscious AI+Gno integration," and end on a live gnomcp read of a Memba realm.

### C — Quests (production-readiness)

**Good news first:** the prior **P0 backend findings are FIXED** — there is now a real server-side verification layer (`quest_verify.go`), XP is server-authoritative (client cannot set XP; summed from completed IDs — `quest_rpc.go:176,330`), and the XP-farmable deploy "benefit of the doubt" branch was removed. Leaderboard ranking math is sound (deterministic tiebreak, DoS-bounded offset). **The "swallowed upserts" the morning plan flagged are benign best-effort cache/queue writes — the authoritative grant INSERT does return its error** (corrects prior framing).

**Catalog reality:** two catalogs coexist — legacy v1 `QUESTS` (10) and authoritative v2 `ALL_QUESTS` (~85, `gnobuilders.ts`). Of the ~85: **~7 verifier paths work for real** (`register-username`, `submit-candidature`, `first-transaction`, `faucet-claim`, **`join-dao` live-verified**, the 18 `deploy-*` with namespace+path+dedup anti-farm, `create-token` speculative/fails-closed); **~22 `off_chain`** quests are **low-trust accept (forgeable by design)**, including the meta-quests `earn-500-xp`/`complete-all-everyone`/`top-10`; and **~18 `on_chain` quests (incl. `vote-proposal`) have no verifier case → silently return `false` → NOT grantable.**

**Integrity gaps (ranked):**
| Sev | Gap | Evidence | Fix | Effort |
|---|---|---|---|---|
| 🔴 **HIGH-1** | **Candidature eligibility is localStorage-authoritative & bypassable** (morning N7/P1-1, **still live**). `canApplyForMembership()` reads `totalXP` from localStorage; submission goes straight on-chain via Adena with **no XP re-check**, and the realm `Apply()` has no XP gate. Set `localStorage` → form unlocks → on-chain accepts. *Backstop:* candidature ACL can't self-approve → integrity/spam, not fund theft. | `lib/quests.ts:262-269,141-153`; `CandidaturePage.tsx:59,121-152,215`; realm stub `candidature.gno:13` | UI: gate on backend `fetchUserQuests(addr).totalXP` when connected (**S**); true fix: backend pre-check or realm/oracle enforcement (**M-L**, realm change in samcrew-deployer). | S→L |
| 🟠 **MED-2** | **`off_chain` quests + meta-quests forgeable** — `CompleteQuest` accepts any `off_chain` ID; meta-quests (50 XP) claimable directly. Leaderboard farmable up to Σ off_chain XP. | `quest_verify.go:127-130` | Server-compute meta-quests from the DB (reject via `CompleteQuest`); cap aggregate off_chain XP. | M |
| 🟠 **MED-3** | **QuestAdmin gate = single hardcoded client address** (L5). *Mitigated:* backend independently enforces the same allowlist (`quest_rpc.go:651-665,725-727`), so a forged client can't approve. Residual = single point of authority. | `QuestAdmin.tsx:32`; `membaDAO.ts:22` | Move allowlist to env/DB (**S**); long-term M-of-N / DAO authority (**L**). | S→L |
| 🟡 LOW-4 | `create-token` verifier parses an **unconfirmed-live** factory format (empty on test13); fails closed (safe but possibly inert). | `quest_verify_phase3.go:50-52,96-113` | Validate against a real token via the gated live test. | S |
| 🟡 LOW-5 | **Badges queued but never minted; stale "background worker" comment.** Queue is drained by the operator CLI `cmd/badge-mint`, not an in-process worker; `VITE_ENABLE_BADGES` off; on-chain `TotalSupply()=0`. | `quest_rpc.go:610-645` | Fix the misleading comment (**S**); go-live = IPFS-pin → `cmd/badge-mint` → multisig ceremony → flip (**M**, no new code). | S / M |

**Verdict & plan.** *Demo-tomorrow (tonight, all S, frontend-only):* (1) close the candidature localStorage bypass UI-side (HIGH-1 UI); (2) **confirm the catalog curation (`LIVE_QUEST_IDS`/`getLiveQuests`) hides the ~18 un-grantable `on_chain` quests** so the demo grid only shows completable quests; (3) fix the stale worker comment; (4) demo script = lead with `join-dao`. *Roadmap:* server-compute meta-quests (MED-2), full candidature enforcement (HIGH-1), admin allowlist→env (MED-3), badge go-live ceremony (LOW-5), confirm `create-token` + un-defer `vote-proposal` once `memba_dao` has proposals.

### D — UI/UX (demo polish)

Covered operationally by **§1** (demo-blockers + narrative). The remaining **polish** backlog (nice-to-have, none demo-blocking):
- **Mobile iOS safe-area** — `.k-mobile-tabbar` has no `env(safe-area-inset-bottom)` / `viewport-fit=cover`; labels sit under the home indicator on notched iPhones. **S.** (= morning P1-9.)
- **Marketplace "Coming Soon" card hardcoded dark in light theme** — dark card on a light page; bullet checkmarks render as empty squares (▢); low-contrast heading. **S.**
- **Footer social icons are unicode text placeholders** (𝕏, ◻, ▶, literal "in", ✈, ✉); only GitHub is a real SVG. Looks unfinished. **S/M.**
- **Home 4-card row has ragged bottoms** (heights 175/148/…/106px — not equal-height). **S.** (= morning MH7.)
- **Light-theme low-contrast muted labels** (`rgb(107,114,128)` on near-white). **S.**
- **Latent blank-icon risk:** `ti ti-*` (Tabler) classes in `ActionCard.tsx`/`YourWorldsPanel.tsx` but **no Tabler font ships** → blank icons. **Not visitor-facing** (wallet-gated), so not a demo-blocker, but will bite connected views. **S.** (The concurrent home branch may already be replacing these with Phosphor — reconcile.)

**What's great (don't "fix"):** dark theme everywhere; the Validators page; GovDAO detail; ⌘K palette; Alerts; Gnolove; Extensions; mobile nav; graceful 404. Light theme renders correctly (the "split-brain sidebar" was a false alarm). **No stale test12/test11 strings on any visitor surface** — though the morning plan's `CreateToken.tsx:67-69` "Testnet 12" copy is a *connected/gated* view the walkthrough couldn't reach; keep that code fix (morning M4/P1-11).

### E — Repo cleanliness / docs / safety

Already well-mapped by the morning plan (§5 housekeeping + §10.4 dead-code) and confirmed this session. The consolidated, low-risk housekeeping batch:
- **Commit the untracked planning docs** (the two morning docs + this one) so a `git clean`/checkout on the concurrent branch can't drop them. **[Me/You]** — needs a branch (can't commit on `main`; current tree is the home branch).
- **Delete stray `sdd/final-review-fix-report.md`** on `main` (info already in `HOME_PHASE2_GETHOMESNAPSHOT.md`).
- **Archive ~14 superseded planning docs** to `docs/planning/archive/` (list in morning §5). **Keep:** this doc, the two morning docs, `MEMBA_AAA_IMPLEMENTATION_PLAN.md`, `HOME_ATLAS_REDESIGN.md`, runbooks, FROZEN invariants, conventions.
- **~1,500 lines of verified dead code** to delete (morning §10.4): `lib/escrowTemplate.ts`, `lib/nftMarketplaceTemplate.ts`, `ConnectWalletPrompt.tsx`, `hooks/useMultisig.ts`, `DAOCards.tsx`, stale barrels, `.board-sidebar` CSS, `buildFlagThreadMsg`, etc. **M** as a dedicated PR.
- **README refresh** — stale "Features (v4.0)" / "1777+ tests" → current reality (Atlas home, NFT v3, GnoBuilders, candidature). Public face at memba.samourai.app. **S.**
- **Stale config/comments** — `nftConfig.ts:7-9,20-23` "NOT YET DEPLOYED" (v3 live), `config.ts:498` "(pending deploy)", test12 strings in `gnoweb.ts:120`/`dao/builders.ts:20`/`templates/prologue.ts:25`/`Changelogs.tsx`, `realm-versions.json` empty test11/staging blocks. **S.**
- **Secret rotation** — `OPENROUTER_API_KEY` in root `.env:35` (gitignored + never committed → low blast radius, but rotate) and the **client-bundled `VITE_LIGHTHOUSE_API_KEY`** (morning N2: avatar upload POSTs the Bearer key directly, bypassing the server proxy — route via proxy, stop reading the VITE var, rotate). **[You]** rotate · **[Me]** the proxy fix. **S.**
- **(Optional) repo `CLAUDE.md`** pointer to `SESSION_CONVENTIONS.md` + the active plans for onboarding agents. **S.**

---

## 3. Unified priority order (this session + morning backlog)

The morning backlog's keystone is **P0-2 observability** (Fly log-drain → Grafana + signed-login-ratio & indexer-lag alerts) — the precondition for every risky flip. This session adds the demo-critical and ecosystem items. Merged order:

1. **Tonight / pre-demo (all S, [Me] on one or two branches):** DB1·DB2·DB3 (Directory) · DB5 (NFT gate helper) · **B must-fix** (auth `/api/analyst/consensus`) · **A-E3 + A-E2** (validator onboarding links + addr clarity) · **C** demo prep (catalog-curation check + candidature UI gate + worker-comment) · DB4 (GovDAO console errors, M — do if time). Plus housekeeping: commit the planning docs.
2. **Demo + immediate fast-follow:** **A-E1** valoper/candidate panel (M) · **B option-1** ship the secured analyst demo · **B option-2** gnomcp doc + live read.
3. **Keystone:** morning **P0-2 observability** (M) — unblocks NFT flip, multisig-enforce, badges.
4. **P1 security/honesty batch (morning):** SSRF redirect/DNS-rebind (P1-2/N8), OAuth timeout (P1-3), silent-failure surfacing (P1-7/8/M12), ecosystem-stat honesty (P1-6/M3), banner consolidation (P1-10/M2), N1 already done in step 1.
5. **C roadmap:** server-compute meta-quests, candidature enforcement, admin allowlist→env.
6. **Cleanup/dead-code/a11y/light-theme** + deploy `needs: ci` (morning P0-3/M6/N9) + backend RPC failover (morning M9/N-backend) + off-volume backups (morning N11).
7. **Gated flips (each after its dashboard exists):** NFT (DB5 → #443 → wallet E2E → raw-ugnot price P1-1 → flip) · **multisig-enforce — BLOCKED on the propose fee/msg-shape divergence + golden A3 round-trip test** (morning §10.1 — do NOT flip before that) · badges ceremony. **Atlas Phase 3 / gnoland1 deferred** (no deployment → no value; also set `realmsDeployed:false` for gnoland1, morning P1-12/M5).

---

## 4. AAA rails & test bar

- **Observability before enforcement, always** — no flag flip ships before its dashboard exists (the frozen-indexer lesson).
- **Each phase independently revertible** — UI/logic PRs revert by PR; env flips revert by flipping back (two-phase auth is lockout-safe).
- **Smallest safe wins first** to bank momentum and shrink reviewer diff.
- **Test bar:** backend logic changes are **TDD with permanent real-body regression fixtures** (the tailer `block_meta` and login `args` bugs both shipped because tests used synthetic inputs); frontend a11y changes get axe/Lighthouse assertions; the feature-flag safety-gate stays authoritative (and should be hardened to read the real build env — morning N9). Frontend test parity: `VITE_GNO_CHAIN_ID= npx vitest run` in `frontend/`.
- **Merge discipline:** no PR merges without explicit per-PR approval; prod/enforcement flips are confirmed + verified live.
- **What NOT to do:** don't flip `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` (blocked on the propose-format fix) or `VITE_ENABLE_NFT` (before wallet E2E) ; don't enable `VITE_ENABLE_SERVICES`/`TREASURY_SPEND`/`AGENT_CREDITS`; don't mirror the frontend `"active"` removal into backend `home_rpc.go` (raw render `ACTIVE` = open); don't smuggle the light-theme migration into a11y PRs.

---

## 5. Honesty caveats & open verifications

- **DB5 / P0-1 confirmed still open** (I verified `App.tsx:217-223` unconditional + 4 ungated pages). But `/collections` 404ing (the UX agent's observation) is a **red herring** — no such route; the live NFT pages are `/nft/*`.
- **Validators a11y bug likely already fixed** (`Validators.tsx:476`) — re-verify before scheduling.
- **onboarding-bot PR #9 unverified** in repo history — confirm with Lours before citing.
- **gnomonitoring `/api/chain/<id>/health`** marked unreleased — confirm public availability before A-E6.
- **#5649 directory-listing scraper** — 30-second live smoke-test (§0).
- **`create-token` quest** — speculative until factory format confirmed live.
- **Concurrent home session** owns `fix/home-connected-feedback` (editing `YourWorldsPanel.tsx`); reconcile any home/UX item (D polish, MH*) against that branch before touching it.

---

## 6. Open decisions for you

1. **Tonight's scope** — do you want me to implement the §1A demo-blockers now (recommend: **DB1-3 + DB5 + B-auth-fix + A-E3/E2 + C demo-prep**, all small, one or two branches), or only the subset you pick?
2. **Validator panel for the demo** — ship **A-E1** (the valoper/candidate panel, M) tonight as the headline, or keep tonight to A-E2/E3 (S) and land A-E1 as the post-demo fast-follow?
3. **gnomcp in the demo** — want me to prep the live `gno_render` of a Memba realm as the closing beat (needs the gnomcp install on the demo machine), or keep AI to the in-app analyst only?
4. **DB4 (GovDAO console 404s)** — fix tonight (M) so devtools is clean, or accept it and steer the demo away from opening devtools on that page?
