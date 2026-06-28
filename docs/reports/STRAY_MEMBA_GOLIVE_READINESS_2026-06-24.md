# Memba — Go-Live Readiness Audit & Consolidated Plan (2026-06-24, evening)

> **One-file consolidation.** Built after syncing all `/Gno/*` repos, reconciling the ~20 PRs (#490–#509) that merged today, and running an **11-dimension parallel expert audit of current `main` (`c4afa22`) + the realm source**, with every finding **adversarially fact-checked against the actual code** (0 of 69 refuted) and 3 load-bearing P1s spot-checked by hand. This plan supersedes the stale/in-flight parts of `MEMBA_COMPLETE_AAA_PROGRAM_2026-06-24.md` — that program is now **mostly shipped**; this is the **verified remaining tail**, re-grounded on current code.

---

## 0. Verdict — Memba is shippable today

**No P0s. Zero go-live blockers. No critical security holes.** The big AAA push (E0–E8) largely landed; the criticals (NFT gating, analyst auth, SSRF/OAuth, observability, RPC failover, multisig make-safe, indexer hardening, directory/test13 fixes) are **in `main` and verified**.

The 69 confirmed findings are all **finishing work**:

| Severity | Count | Nature |
|---|---:|---|
| P0 / blocks-go-live | **0** | — |
| P1 (important) | 21 | correctness, honesty, dead-code, doc-truth, mobile, a11y |
| P2 (minor) | 37 | security hardening, resilience, perf, coverage, polish |
| polish (cosmetic) | 11 | wordmark, emoji, dvh, micro-perf |

**The single highest-value, lowest-effort lever is truth-telling**: the publicly-served `llms.txt` and the operator deploy docs still say "test12 / cutover pending" — provably false (cutover shipped #450, prod is test13). That's an 8-fix doc sweep that removes real operational risk and public inconsistency. After that, it's correctness P1s, then the UX/a11y/dead-code tail, then the gated go-lives (operator-gated).

---

## 1. Merge decisions (your explicit OK required per the hard rule)

| PR | State | Decision | Why |
|---|---|---|---|
| **#508** `ci/flag-gate-from-build` | ✅ CI green, MERGEABLE, behind-by-4 (no conflicts) | **MERGE (squash)** | Closes **SEC-1/P1-1** — the only fund-safety P1. Build-time `safeFlagsPlugin` fails `vite build` (CI + Netlify prod) if a gated flag resolves `"true"` from *any* source (incl. Netlify dashboard), while correctly skipping deploy-previews. 11 tests, 131 lines, elegant, conflict-free. |
| **#443** `feat/nft-marketplace-phase2` | 🔴 CONFLICTING | **Keep held** | This is the **E9-b NFT go-live epic**, not a merge: needs rebase, `NftGate` on the new `LegacyCollectionView` route, raw-ugnot price fix (P1-1 of NFT audit), numeric-input hardening, `NFT_WATCHED_REALMS` wiring, then your wallet-signed create→list→buy E2E, *then* the `VITE_ENABLE_NFT` flip. |

**Other repos:** samcrew-deployer / gnolove / gnomonitoring / Samourai-Guard — **0 open PRs, clean.** gnodaokit #62/#63/#64 (UNSTABLE) + #25 (conflicting) are the long-parked v0.9-migration/audit-v5 work — **out of scope** (no Memba runtime dependency); leave parked.

---

## 2. Workstreams — remaining work, re-batched into clean PRs

Conventions (unchanged): branch off **updated** `main`; one feature per branch; PR = Summary + Test plan; **no Claude attribution**; backend logic = TDD with real-body fixtures; FE parity = `VITE_GNO_CHAIN_ID= npx vitest run`; admin-merge only on your per-PR OK, gated on CI-**green**. Owner: **[Me]** = code+PR · **[You]** = operator action.

### TIER 0 — Truth & safety (do first; demo-credible, low effort)

**WS-1 · Merge #508** — closes SEC-1/P1-1. **[You]** approve → **[Me]** admin-squash. _(eff S)_

**WS-2 · `docs/test13-truth-sweep`** — kill every stale "test12 / cutover-pending" claim. **8 findings.** _(eff M)_
- `frontend/public/llms.txt` (**DOCS-2/P1**, publicly served, says test12 current) · `SKILL.md` (**DOCS-1/P1**, AI entry point: test12 chain, dead `memba_dao_channels` path, wrong test count) · `docs/DEPLOYMENT.md` (**DOCS-3/P1**, Netlify **prod** env → test12 = would misconfigure prod) · `docs/OPS_RUNBOOK.md` (**DOCS-4/P1**) · `docs/DEPLOYMENT_RUNBOOK.md` (**DOCS-5/P1**, test12 as primary) · `docs/AGENTIC.md` (**DOCS-6/P2**) · `README.md` version/test-count (**DOCS-7/P2**) + chain table lists 5 dead networks, omits test13 (**DOCS-8/P2**).
- Single source of truth = `frontend/src/lib/config.ts` (chainId `test-13`, RPC `rpc.test13.testnets.gno.land:443`) + root `.env.example`. Rebuild so `dist/llms.txt` regenerates.

> **gno-core endpoint migration (aeddi, 2026-06-24) — fold in here.** Official test13 endpoints are now `https://test13.testnets.gno.land/` (gnoweb), `https://rpc.test13.testnets.gno.land/` (RPC), `https://indexer.test13.testnets.gno.land/graphql` (indexer). The `*.test-13.gnoland.network` family is **deprecating**. Memba's primary RPC + general gnoweb already use the official hosts ✅. **Two code repoints needed (NEW, post-audit):**
> 1. **`frontend/src/lib/valopers.ts:22`** defaults the valoper gnoweb URL to the deprecating `https://gnoweb.test-13.gnoland.network` → repoint to `https://test13.testnets.gno.land`. This also **resolves the open valoper host-strategy decision** (`VALIDATORS_VALOPER_PROFILES_…` D5) → **unify on the official host (shape U)**; drop the dedicated valoper-host constant.
> 2. Drop the now-dead `rpc.test-13-aeddi-1.gnoland.network` RPC fallbacks (`config.ts:102,111`; `backend/.../rpc_resilient.go:32`).
>
> _Future option (not a fix):_ the official GraphQL indexer could replace the buggy `tx_search` newest-timestamp proposal-date fallback (audit **FE-5**).

### TIER 1 — Correctness & integrity (P1; trust-affecting)

**WS-3 · `fix/dao-data-correctness`** — DAO reads tell the truth. **4 findings.** _(eff M)_
- **FE-1/P1** — quorum threshold **fabricated as hardcoded `60%`** (`dao/config.ts:40` regex never matches basedao's `MembersThreshold(0.66,…)` → `:90` `|| "60%"`). memba_dao shows 60% when it's **66%**. Fetch the real threshold from chain (qeval the condition accessor) or parse the rendered condition; show `—` when unknown. Drive ProposalView + TierPieChart from the resolved value.
- **FE-2/P1** + **FE-4/P2** — RPC outage **swallowed at the ABCI layer**: `rpcFallback.ts` `resilientAbciQuery` returns `null` for *both* "realm rendered nothing" and "every endpoint down" → DAO shows an empty generic card, featured-DAO door can never reach its error state. Make it throw (or return a discriminated result) on all-endpoints-down so `DAOHome`'s existing `ErrorToast+onRetry` engages.
- **FE-5/P2** — proposal date fallback (`tx_search`) assigns the realm's **newest** proposal timestamp to whatever proposal is being resolved → wrong dates. Resolve per-proposal.

**WS-4 · `fix/login-no-force-disconnect`** — **FE-3/P1** (= master-plan M1/E6-b). `Layout.tsx:133-136` calls `adena.disconnect()` on *any* login error; a transient backend 5xx (`getChallenge`) logs the user fully out. Surface `authError`, **keep the wallet connected**, allow retry; reserve `disconnect()` for explicit logout. _(eff S)_

**WS-5 · `fix/indexer-retry-on-dispatch-error`** — **BE-2/P1** + **BE-7/P2**. `tailer.go` logs a dispatch failure then `saveCursor` advances past the block; the "recoverable by rebuild-from-raw" the comments promise (`dispatch.go:84`) **has no implementation** → silent permanent data gap. Fix: on first dispatch error in block _h_, return **without** advancing the cursor (idempotent `INSERT OR IGNORE` makes retry safe) — or implement `RebuildFromRaw(fromBlock)`. Also fix `loadCursor` degrading a freshly-seeded realm's `block_hash` to empty (weakens reorg detection). TDD with a real failing-dispatch fixture. _(eff M)_

### TIER 2 — UX, a11y, dead-code (P1 + high-value P2)

**WS-6 · `fix/mobile-ux`** — mobile viewport correctness. **10 findings** (3×P1, 4×P2, 3×polish). _(eff M)_
- **MOB-1/P1** safe-area: `.k-main-column` padding is bare `56px` (`index.css:1597`) → content hides under the home-indicator inset (tabbar got the inset at `:1391`, content didn't). 1-line `calc(... + env(safe-area-inset-bottom))`.
- **MOB-2/P1** **tx-confirmation modal has no `max-height`/scroll** (`tx-confirmation.css:15`) → Confirm/Cancel pushed off-screen for multi-message txs — on the **money-confirm path**. Add `max-height: calc(100dvh - 32px); overflow-y:auto` (or sticky footer).
- **MOB-5/P1** connect/balance + primary buttons are 36/40px across 376–767px (44px only <375px) — below HIG/Material min. Lift `min-height:44px` into the `<=768px` block.
- **MOB-3/4, MOB-6, MOB-7** (P2) toasts (`QuestToast`/`WhatsNewToast`) overlap tabbar; dashboard activity table header/rows misalign <480px; tx-confirm buttons ~38px. **MOB-8/9/10** (polish) cmdk 15px iOS-zoom, bottom-sheet bare-token gap, `100vh→100dvh`.

**WS-7 · `fix/a11y-wcag`** — WCAG AA gaps (= master-plan M7/E6-f). **7 findings** (2×P1, 5×P2). _(eff M)_
- **A11Y-1/P1** Teams/DAO card is a click-only `<div>` (`DAOList.tsx`) on a **live** page — no keyboard access. Convert root to `<button>` (keep inner remove-button + stopPropagation).
- **A11Y-3/P1** `--color-text-muted` **fails AA contrast in both themes** (measured 2.4–2.8:1; used across ~73 files as real text). Darken to ~`#8a8a8a` dark / ~`#6b7280` light; re-verify hierarchy + muted-on-panel.
- **A11Y-2/4/5/6/7** (P2): no global `prefers-reduced-motion` guard (~25 infinite animations); missing `aria-expanded` (Settings/Alerts/analyst toggles); Cmd+K missing `aria-modal`+focus-trap; icon-only ×/remove buttons unnamed; analyst loading/error lacks `aria-live`.

**WS-8 · `fix/dashboard-to-home`** — **UXD-1/P1** (coupled copy + dead-code). Every "Dashboard" destination now `<Navigate>`s to Home, yet "Dashboard" is still the primary sidebar item + Cmd+K command + ~9 "Back to Dashboard" CTAs; `pages/Dashboard.tsx`+`dashboard.css` are orphaned. Relabel all to "Home", delete the orphan page (keep `components/dashboard/*` used by Home/ActionInbox), update tests. _(eff M)_

**WS-9 · `chore/dead-code-frontend`** — proven-dead TS (grep/zero-importers). **6 findings.** _(eff S–M)_
- **CQ-1/P1** `lib/marketplace/{index,queries,types}.ts` (+tests) zero importers · **CQ-3/P1** `lib/membaDAO.ts` 98% dead (move `ZOOMA_ADDRESS`→`config.ts`, ideally env-sourced) · **CQ-4/P1** `lib/nftMarketplaceTemplate.ts` (440 lines, 0 refs) · **CQ-7** `ConnectWalletPrompt.tsx`+CSS · **CQ-8** `useMultisig` hook · **CQ-5** `MakeADR36SignDoc` · **CQ-6** `BoardParser`/`parserV2` placeholder · **CQ-10** scattered dead/over-exported test-only internals.

**WS-10 · `chore/dead-code-backend`** — proven-dead Go (`deadcode ./cmd/memba`). _(eff S)_
- **CQ-2/P1 + BE-5/P2** — the NFT-poller Render-scraping cluster (8 funcs `parseStatsRender`/`parseListingsRender`/`parseSalesRender`/… + `reStat*` regexes + `statsInfo`/`listingInfo`/`saleInfo` types) is unreachable since the event-tailing migration; `pollOnce` only calls collection/token upsert. Shrinks `poller.go` 575→~300 LOC. · **CQ-11** dead `dispatchEvent` 3-line wrapper.
- **Decision needed — BE-6/P2**: `internal/points` recompute harness is fully built but **unwired** (no caller/RPC/schedule). **Wire it or delete it** — flag for your call; don't blind-delete (may be intended).

### TIER 3 — Hardening, resilience, perf, coverage (P2)

**WS-11 · `feat/off-volume-backups`** — **BE-1/P1** (= E8-e). SQLite snapshots write to `/data/backups` on the **same Fly volume** as the DB — zero DR against the volume-loss failure this app already hit. Ship snapshots off-volume behind `BACKUP_S3_URL` (Tigris/Backblaze) or adopt Litestream; document a restore drill. **[Me]** code · **[You]** provision store. _(eff M)_

**WS-12 · `chore/backend-shutdown-and-ctx`** — **BE-3/P2** join tailer/poller/backup goroutines (WaitGroup) before WAL checkpoint + DB close on shutdown; **BE-4/P2** propagate `context` through the single-shot `abciQuery` path (cancel on client disconnect / before the 90s WriteTimeout). _(eff S)_

**WS-13 · `fix/security-hardening-p2`** (or split) — **SEC-2/P2** gate `/metrics` behind a scrape token or Fly 6PN private bind (currently public, leaks auth-posture + Go runtime internals); **SEC-3/P2** drop CSP `'unsafe-inline'` via a hash of the static Plausible stub; **SEC-4/P2** close the IPFS-proxy **DNS-rebind TOCTOU** with a pin-the-resolved-IP `DialContext` (= E5-b). _(eff S–M)_

**WS-14 · `fix/perf-visibility-polling`** — **PERF-1/P2** `useBalance` 30s poll never pauses on hidden tab; **PERF-3/P2** `NetworkStatusToast` 60s poll on every page, no visibility gate. Gate both on `document.visibilityState` / `refetchIntervalInBackground:false`. (polish: **PERF-2** Phosphor eager chunk, **PERF-4** directory avatars page-1-only.) _(eff S)_

**WS-15 · `test/money-path-coverage`** — **QA-1/P2** wallet signing/broadcast money-paths have **0% unit + e2e-smoke-only** coverage; **QA-5/P2** auth-token issuance + OAuth/IPFS handlers at 0% backend coverage; **QA-3/P2** Playwright `firefox` project defined but never run in CI; **QA-2/P2** JS bundle 3004KB sits ~2% under the 3072KB warn threshold (budget headroom). (polish **QA-4** hardcoded `waitForTimeout` sleeps.) Co-locate unit tests for `TransactionView`/`useAdena`/`Treasury`/`DAOHome`/Create flows; add a per-file coverage floor. _(eff M)_

### TIER 4 — Big item + cosmetic

**WS-16 · `feat/light-theme-completion`** (= E6-n, big) — **UXD-2/P2** Directory markdown/code render uses dark-only grays → low-contrast in light theme; plus the remaining inline-hex → theme-token migration beyond the already-done Create Token/Settings (#493). **Audit-first, post-demo.** _(eff L)_

**WS-17 · `chore/cosmetic-polish`** — **UXD-4** katakana wordmark next to Latin logo; **UXD-5** emoji headings alongside Phosphor icons (cross-platform inconsistency); **CQ-9/P2** merge the two parallel error-message mappers (`errorMap.ts` vs `errorMessages.ts`). _(eff S–M)_

### REALM track (on-chain — requires samcrew-deployer redeploy → **[You]**)

**WS-18 · realm hardening** _(lower priority; gated features)_ — **REALM-2/P2** `escrow_v2` has no max-milestone cap (`amount*Pct` can theoretically overflow int64) — add an upper bound; **REALM-3/polish** v3 `SetFeeRecipient` lacks the empty-address guard `collections.SetFeeRecipient` enforces (consistency); **REALM-1/P2** `memba_market_core` is deployed-but-unused (split-math duplicated) — document/deprecate, don't reference. Bundle with E9-d on-chain enforcement work.

---

## 3. Sequencing (dependency-ordered; independent PRs run in parallel)

- **Wave A — Truth & safety (today/next):** WS-1 (#508), WS-2 (doc sweep). _Low-risk, high-credibility._
- **Wave B — Correctness P1s:** WS-3 (DAO data), WS-4 (login), WS-5 (indexer integrity). _TDD; trust-affecting._
- **Wave C — UX/a11y/dead-code:** WS-6 (mobile), WS-7 (a11y), WS-8 (Dashboard→Home), WS-9 + WS-10 (dead-code FE+BE). _Mostly parallel; WS-8 must precede/coordinate WS-9 (shared Dashboard files)._
- **Wave D — Hardening/resilience/perf/coverage:** WS-11 (backups), WS-12 (shutdown/ctx), WS-13 (security P2), WS-14 (perf), WS-15 (coverage).
- **Wave E — Big + cosmetic:** WS-16 (light theme, audit-first), WS-17 (polish), WS-18 (realm hardening, with redeploy).
- **Wave F — Gated go-lives (operator-gated):** §4.

---

## 4. Go-live gates — operator-gated flips (each strictly after its make-safe work)

Nothing here is deferred; each is sequenced behind the work that makes it safe. **[Me]** builds to the handoff line + a runbook; **[You]** do the irreversible step.

| Gate | Make-safe state | Your step |
|---|---|---|
| **Multisig sig-enforce** (`MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1`) | Propose-format make-safe **shipped** (#494, stores canonical sign-doc). Per `docs/MULTISIG_ENFORCE_RUNBOOK.md`. | Capture a real Adena member sig over a live `/vm.m_call`, confirm `VerifyMultisigMemberSignature==nil`, watch `multisig_sig_verify{result=ok}` on `/metrics`, **then flip**. Rollback = flip to 0. **Do NOT flip before that capture.** |
| **NFT** (`VITE_ENABLE_NFT`) | = WS/#443 epic (rebase + gate-gap + raw-ugnot price + numeric hardening + `NFT_WATCHED_REALMS`). | Wallet-signed create→list→buy E2E on the #443 preview, then flip. |
| **Badges** (`VITE_ENABLE_BADGES`) | Tooling ready (`cmd/badge-mint`, `docs/BADGE_MINT_RUNBOOK.md`). | IPFS-pin assets → multisig mint ceremony → `-mark-minted` → flip → verify `TotalSupply()` grew. |
| **Services / Treasury-spend / Agent-credits** | **On-chain enforcement incomplete — that's why they're gated** (E9-d). Realm work + N3 Treasury memberstore fix are prereqs. | After realm enforcement ships + redeploy + audit, flip per-flag. |
| **Secret rotation** (E0-e) | — | Rotate OpenRouter + Lighthouse keys; confirm gitignore. |
| **Observability provisioning** (E1-b) | `/metrics` live (auth-login ratio + indexer lag). | Provision Fly log-drain → Grafana/BetterStack + 2 alerts (signed-login drop, indexer-lag). |

---

## 5. Coverage matrix — all 69 findings → workstream (nothing dropped)

| Finding(s) | WS | Finding(s) | WS |
|---|---|---|---|
| SEC-1 | WS-1 (#508) | CQ-2, BE-5, CQ-11 | WS-10 |
| DOCS-1..8 | WS-2 | BE-6 | WS-10 (decide: wire/delete) |
| FE-1, FE-2, FE-4, FE-5 | WS-3 | BE-1 | WS-11 |
| FE-3 | WS-4 | BE-3, BE-4 | WS-12 |
| BE-2, BE-7 | WS-5 | SEC-2, SEC-3, SEC-4 | WS-13 |
| MOB-1..10 | WS-6 | PERF-1..4 | WS-14 |
| A11Y-1..7 | WS-7 | QA-1..5 | WS-15 |
| UXD-1 | WS-8 | UXD-2 | WS-16 |
| CQ-1, CQ-3, CQ-4, CQ-5, CQ-6, CQ-7, CQ-8, CQ-10 | WS-9 | UXD-4, UXD-5, CQ-9 | WS-17 |
| REALM-1, REALM-2, REALM-3 | WS-18 | | |

_(69 findings: SEC×4, REALM×3, BE×7, FE×5, UXD×5, MOB×10, A11Y×7, CQ×11, DOCS×8, QA×5, PERF×4 = 69 ✓)_

---

## 6. What the audit did NOT find (reassurance)

- **No P0 / no fund-loss exploit / no auth bypass.** The gated-off flags genuinely prevent fund movement; the gating is correct.
- The recently-merged fixes (NFT gate, analyst auth + public read, SSRF redirect, OAuth timeout, `/metrics`, RPC failover, `busy_timeout`, AUTH-A2-DEBUG removal, multisig make-safe, indexer malformed-event rejection, directory/test13 fixes, valoper, GovDAO) are **present and correct in current `main`** — re-flagging them was actively suppressed and the adversarial verifiers caught no regressions in them.
- Realm ACLs check out (no repeat of the historical `agent_registry.UseCredit` gap on the audited surface).

---

## 7. Method (so you can trust the above)

11 expert dimensions (security, realms, backend, frontend-correctness, UI/UX desktop, UI/UX mobile, a11y, code-quality/dead-code, docs, QA/build, perf) audited current `main` + the realm source **in parallel**; **every** finding was then re-checked by a second, skeptical, refute-first verifier against the real files (**0 of 69 refuted**); and I hand-spot-checked the 3 highest-leverage P1s (FE-1 quorum, BE-2 indexer cursor, MOB-1 safe-area) — all confirmed. Dead-code claims were grep/`deadcode`-proven before listing. Build/test health checked by the QA dimension.
