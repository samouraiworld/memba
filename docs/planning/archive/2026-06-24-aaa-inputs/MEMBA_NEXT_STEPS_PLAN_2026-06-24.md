# Memba — Consolidated Next-Steps Plan (2026-06-24)

> **What this is.** The single, prioritized backlog for Memba, consolidating (a) every carried-forward item from the `.remember` handoff and the earlier-today connected audit (`MEMBA_CONNECTED_AUDIT_AND_PLAN_2026-06-24.md`), and (b) everything a fresh 5-lens audit surfaced (UX/mobile · frontend · backend/Go · security · CTO), **reconciled against live `main` = `509e435` (#470)** and adversarially verified at `file:line`. Supersedes the two 06-23 audit docs and folds in the 06-24 connected audit.
>
> **Rails (non-negotiable).** Never commit to `main`; branch off **updated** `main` first, PR, admin-merge **only on explicit per-PR approval** (even with green CI). No Claude attribution anywhere. Backend logic changes are TDD with permanent regression fixtures. Test parity: `VITE_GNO_CHAIN_ID= npx vitest run` in `frontend/`. Owner legend: **[Me]** = I can implement on a branch + PR for your review · **[You]** = operator-only action (secret rotation, wallet signature capture, prod env flips, mint ceremony, branch protection).

---

## 0. Ground-truth corrections (verify-before-act paid off)

| Claim (handoff / prior docs) | Reality (verified this session) |
|---|---|
| `main @ 6fe5501` | **`origin/main = 509e435` (#470)** — main was pulled forward to #470 at ~09:23. |
| `/Gno/Memba` is the clean "main checkout" | **A concurrent session owns it.** At 09:23 it checked out `main`, spun up **`fix/home-connected-feedback`**, and is **live-editing `YourWorldsPanel.tsx` (+ test)** right now. Do **not** touch that working tree. |
| Broken `@fontsource` import needs reset | **Resolved in code** (deps dropped in #461; zero refs). Real residue = **stale local `frontend/node_modules`** (`vite` binary missing) → `npm ci` in `frontend/`. **[You/worktree-owner]** (don't run it under the concurrent session). |
| #443 restored the NFT gate via `isNftEnabled()` | True **only on the #443 branch**. On `main`, `isNftEnabled()` does not exist and **4 NFT pages are ungated** (see P0-1). |
| `MEMBA_ALLOW_UNSIGNED_AUTH` impersonation window | **Closed in prod** — `fly.toml:39 = '0'`. Only the code *default* is permissive (P2 hardening). |
| #470 removed dead `TractionMetrics.daoCount/repoCount` | Overstated — `daoCount` is **still used** by `UsersTab.tsx:130-137`. #470 only cleaned the home-traction path. |
| OpenRouter key is a leaked secret | `.env` is gitignored and `git log -- .env` is **empty** (never committed). Local-dev secret — still rotate, but blast radius is local. |

**Open PRs:** **#469** (mobile redirect-crash fix, `fix/default-network-invalid-loop`; CI was mid-run) · **#443** (NFT Marketplace Phase 2; **CI fully green**, gated, in the `memba-nft-phase2` worktree). **Housekeeping debt on `main`:** stray `sdd/final-review-fix-report.md`; untracked `MEMBA_CONNECTED_AUDIT_AND_PLAN_2026-06-24.md` (commit it); `samcrew-deployer` parked on an already-merged branch.

**What genuinely shipped since the 06-23 audits** (so don't re-do): #465 member-home refine, #466 indexer RPC pin (prod `fly.toml:35`), #467 docs cutover, #468 DAO-overcount fix + 6 orphaned home panels purged, #470 home-fetch cleanup, #445 `GetHomeSnapshot`, #461 font vendoring. Test12 winddown is **complete** (config + `fly.toml` hard-cut to `test-13`).

---

## 1. P0 — safety / keystone (do first)

| ID | Item | Evidence | Fix | Effort | Owner | Deps |
|---|---|---|---|---|---|---|
| **P0-1** | **NFT feature-gate regression on `main`** — 4 pages ignore `VITE_ENABLE_NFT` and are reachable by direct URL, rendering live mint/trade UI. `MintSection`/`CollectionDetail` call `buildMintPublicMsg(caller, memba_collections, …)`, and **`memba_collections` IS allowlisted on test13** → a public-mint tx hits a live realm while NFT is nominally "off." | `App.tsx:217-222` (routes unconditional); `CollectionDetail.tsx`, `CreatorProfile.tsx`, `studio/StudioHome.tsx`, `studio/StudioManage.tsx`, `studio/sections/MintSection.tsx:62` = **0 gates** (vs `NFTGallery.tsx:41`/`NFTLaunchpad.tsx:20` = gated); `config.ts:209` allowlists `memba_collections`; `nftMarketplaceV3.ts:56` sends `${priceUgnot}ugnot` with no `isRealmValid` backstop. | **Small PR on `main` now** (don't wait for #443): introduce one `isNftEnabled()` helper and wrap all NFT pages **and** the `App.tsx` routes; add a test asserting each NFT route renders `ComingSoonGate` when off. Then ensure #443 inherits it for *every* route (hub + CollectionPublic + creator + studio), not just two. | **S** | [Me] | none — ship standalone |
| **P0-2** | **Backend observability keystone** — no `/metrics`, no Prom/OTEL, backend Sentry absent. The two production-decision signals (signed-login ratio; `IndexerLastBlock` vs chain head) are log-only. This is *why* the frozen indexer hid for ~150k blocks; it gates every risky flip below. | backend `slog`-only; `/health` has no metrics (`cmd/memba/main.go:404-451`); `auth_login` is a log line (`crypto.go:236`); frontend-only Sentry (`main.tsx:18-52`). | Fly log-drain → Grafana/Loki/BetterStack + 2 alerts: (a) signed-login ratio drop, (b) indexer-lag delta > N; surface both on `/health`. | **M** | [Me] build · [You] provision drain/dashboard | unblocks P0-3-flip, badges flip, NFT flip |
| **P0-3** | **Deploy path bypasses the fund-safety CI gate** — `deploy-frontend.yml` omits the feature-flag safety gate + Playwright E2E + bundle budget + Lighthouse; `deploy-backend.yml` omits golangci-lint + coverage. A direct hotfix push to `main` deploys **without** the gate that blocks fund-unsafe flags. | `.github/workflows/deploy-frontend.yml`, `deploy-backend.yml` vs `ci.yml`. | Make deploy jobs `needs:` the full `ci.yml` (or `workflow_run` after CI succeeds). | **S** | [Me] | none |

> P0-1 is testnet-scoped **today** (test13 GNOT), but it is a true gating-discipline defect that becomes a real-fund P0 on mainnet — and it's the cheapest of the three. Do it first.

---

## 2. P1 — high (real risk / honesty / UX, do this sprint)

### Security & correctness
| ID | Item | Evidence | Fix | Effort | Owner |
|---|---|---|---|---|---|
| **P1-1** | **Buy price scraped from formatted render markdown** (pre-flip item A) — a realm render-format change (decimal padding, separators, symbol) desyncs displayed vs signed ugnot. Both v2 & v3 buy paths share it. | `nftMarketplace.ts:84-90` → `nftMarketplaceV3.ts:56`; v2 `BuyNFTModal.tsx:45`. | Source price from the raw integer the backend already returns (`priceUgnot bigint` via `nftApi.ts`), not `parseMarketplaceRender`. | M | [Me] |
| **P1-2** | **SSRF redirect bypass** in the unauthenticated image/metadata proxy — initial URL is validated, but Go's default client follows 30x redirects to internal/metadata hosts **without re-validation**; up to 15 MB returned to caller. | `ipfs_serve.go:298` (no `CheckRedirect`), unauth at `cmd/memba/main.go:204-205`. | Set `CheckRedirect` to re-run `validateHTTPSHost`/scheme checks per hop (or `ErrUseLastResponse` + manual re-validate). | S | [Me] |
| **P1-3** | **GitHub OAuth exchange/userinfo have no timeout & no context** — unbounded hang on the login path holds a worker + rate-limit slot. | `github_oauth.go:199-209, 231-239` (`http.NewRequest` + `http.DefaultClient`, no ctx/Timeout). | `http.NewRequestWithContext(r.Context(), …)` + a client with `Timeout: 10s`. | S | [Me] |
| **P1-4** | **`homeSnapshotRPCURL()` default = the public node #466 avoided** + **`.env.example` RPC drift** — one unset env var away from re-triggering the rate-limit that froze the indexer. | `home_rpc.go:29-37` default `rpc.test13.testnets.gno.land`; `.env.example:19,25` still public node vs `fly.toml:35` pinned `rpc.testnet13.samourai.live`. | Default to the pinned node (or require `NFT_RPC_URL`); align `.env.example`; add a backend RPC fallback list (M9). | S–M | [Me] |

### Honesty & silent-failure (data shown as real when it isn't)
| ID | Item | Evidence | Fix | Effort | Owner |
|---|---|---|---|---|---|
| **P1-5** | **Home "Directory" door shows a gnolove GitHub contributor count labeled "members"** — the *count* and the member *avatars* come from two unrelated populations. | `useDirectoryHighlights.ts:88-91` (count = `fetchTractionMetrics().contributorCount`) → `traction.ts:61-64` (`/stats users.length`) → `DirectoryDoor.tsx:53` (`{n} members`). | Re-source the count (snapshot `directoryMembers` length / registry count) or relabel to "contributors". | S | [Me] |
| **P1-6** | **Ecosystem stats degrade dishonestly** — failed sources render a confident "0"; `fetchAgents()` returns fake `SEED_AGENTS` on hard RPC failure; `traction.ts` caches all-zero 5 min with a non-network-suffixed key. | `lib/agentRegistry.ts:336`; `traction.ts` cache; 06-24 audit M3. | "—" vs "0"; never seed fake data; suffix cache keys by network; don't cache zero on error. | M | [Me] |
| **P1-7** | **Treasury asset-fetch failures swallowed** → a real treasury renders as empty/partial with no error signal; could drive wrong governance/spend decisions. | `Treasury.tsx:85, 111` (inner `catch {}`); outer catch can't fire. | Collect per-source errors; show a partial-failure banner. | S | [Me] |
| **P1-8** | **DAOHome proposal enrichment/votes fail silently** → vote tallies/quorum render as 0%/empty as if real during transient RPC failure. | `DAOHome.tsx:103, 114, 115` (`.catch(()=>null/[])`). | Mark the proposal card degraded instead of substituting zero data. | S | [Me] |

### Mobile / UX (from UX lens + 06-24 audit)
| ID | Item | Evidence | Fix | Effort | Owner |
|---|---|---|---|---|---|
| **P1-9** | **Zero iOS safe-area handling** — bottom nav + `WhatsNewToast` sit under the home indicator on notched phones; toast (`z-999`) also fully covers the tabbar. | `index.html:8` no `viewport-fit=cover`; `index.css` 0× `env(safe-area-inset-*)`; `.k-mobile-tabbar:1386`; `WhatsNewToast.tsx:88,205`. | `viewport-fit=cover` + `padding-bottom: env(safe-area-inset-bottom)` on tabbar; anchor toast above the tabbar. | S | [Me] |
| **P1-10** | **Banner pile-up** — 3 Layout banners stack, 2 are non-dismissible; ≥5 bottom/corner toasts have no stacking manager (cluster ~70-80px on mobile). | `Layout.tsx:301-317`; `RealmsNotDeployedBanner`/`AddressOnlyLoginBanner` (no dismiss); multiple fixed toasts. | One prioritized banner slot + a single bottom-toast stack/region. | M | [Me] |
| **P1-11** | **Stale "Switch to Testnet 12" advice** (test12 retired) in two places. | `RealmsNotDeployedBanner.tsx:60`; `CreateToken.tsx:67-69`. | Make the suggestion dynamic (first `realmsDeployed` network) / fix copy. | S | [Me] |
| **P1-12** | **gnoland1 (Betanet) selectable but realms undeployed** — `isRealmValidOn('gnoland1',…)` returns true for everything → connected actions fail with raw VM errors. | `config.ts` (gnoland1 non-hidden, no allowlist entry). | Set `realmsDeployed:false` (or empty allowlist) until Memba is deployed there. | S | [Me] |

### Performance (the #465 fast-follows)
| ID | Item | Evidence | Fix | Effort | Owner |
|---|---|---|---|---|---|
| **P1-13** | **featured ↔ your-worlds duplicate `memba_dao` fetch** — disjoint react-query keys re-fetch the same config+proposals when the flagship DAO is both featured and saved. | `useFeaturedDao.ts:69` vs `useYourWorlds.ts:69` (`getDAOConfig`+`getDAOProposals` twice). | Extract a shared `daoOverview` query key/fn used by both → react-query dedupes. | M | [Me] |
| **P1-14** | **role-lookup paging cost** (#465) — *framing was stale*: early-exit + lazy 5-min cache already landed; residual is up-to-10 sequential `queryRender` only for late/non-members on 100+-member memberstore DAOs. | `members.ts:107-178` (`maxPages=10`, early-exit); `useYourWorlds.ts:91-106`. | **Decision item, not a true bug:** add a realm-side `GetMember(addr)` selector → O(1) only if a DAO exceeds ~10 member pages. Defer unless a real DAO is that large. | M | [Me] |

---

## 3. P1.5 — Ops/security flips & tracked initiatives (gated, sequenced)

| ID | Item | Status & gate | Action | Owner |
|---|---|---|---|---|
| **NFT go-live** | Flip `VITE_ENABLE_NFT`. | Gated on: P0-1 (gate hygiene) + P0-2 (observability) + **on-chain create→list→buy E2E with a real Adena wallet on test13** + **P1-1** (raw-ugnot price) + **P2-1** (numeric-input hardening). #443 green but unmerged. | Land P0-1 → merge #443 (with your OK) → run the wallet E2E on the #443 deploy-preview → fix P1-1/P2-1 → **then** flip. Do **not** flip before the E2E. | [You] wallet E2E + flip · [Me] code |
| **Multisig enforce** | Flip `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1`. | Correctly **held off** (`fly.toml:44` commented; default false). Prod login impersonation already closed (`MEMBA_ALLOW_UNSIGNED_AUTH=0`). Gated on **P0-2**. | Capture a real multisig-member signature → brute-validate `VerifyMultisigMemberSignature` (mirror the login fix) + permanent regression vector → flip → watch the P0-2 dashboard. Rollback = flip to `0` (lockout-safe two-phase). | [You] sig capture + flip · [Me] validation harness |
| **Badges go-live** | Flip `VITE_ENABLE_BADGES`. | Deployed but never minted; cold-start, ceremony-gated. | IPFS-pin badge assets → multisig mint ceremony (`docs/BADGE_MINT_RUNBOOK.md`) → flip. **Defer** unless there's a launch driver. | [You] |
| **Rotate OpenRouter key** | `OPENROUTER_API_KEY` in root `.env:35`. | gitignored + never committed (low blast radius) but was surfaced in plaintext to tooling. | Rotate the key; confirm gitignore (done). | [You] |
| **Atlas Phase 3 (gnoland1 `GetHomeSnapshot`)** | **DEFER (keep doc, don't build).** `GetHomeSnapshot` itself already shipped (#445). "Phase 3" = per-network featured-DAO gating + snapshot generalization to gnoland1 + an indexer-widened activity ledger. | No value until Memba realms are actually deployed on gnoland1 (they're not — see P1-12). Revisit only if a Betanet/gnoland1 launch is committed. Update the doc header to say so. | [Me] doc note |

---

## 4. P2 — cleanup / hardening (batch opportunistically)

**Security/backend hardening:** numeric-input guard `isInteger/isFinite/upper-bound` on list/offer (pre-flip item B — *lower risk than framed*; `V3ListForSaleModal.tsx:76` et al.) **[P2-1]** · flip the **code default** of `MEMBA_ALLOW_UNSIGNED_AUTH`/multisig to fail-closed (`crypto.go:219-228`) · add a CSP header (backend/`netlify.toml`) · DB `_busy_timeout(5000)` + `SetConnMaxLifetime` on the single-writer pool (`db.go:16-23`) · tailer shutdown `WaitGroup` join before WAL checkpoint (`main.go:237-245`) · log the swallowed rank/badge upserts (`quest_rpc.go:506-510,552-556,614-618,640-644`) · handler tests for `GetChallenge`/`GetToken` (`auth_rpc.go:15,35`) · remove `AUTH-A2-DEBUG` logging (`crypto.go:380-392`, M10) · DNS-rebinding pin-IP dial (`ipfs_serve.go`, secondary to P1-2).

**Frontend hardening/silent-failure:** `useAdena.signArbitrary` typed-result instead of null-swallow (`useAdena.ts:248-322`) · `useAdena` `changedNetwork` listener leak on reconnect (`useAdena.ts:430-463`, M8) · `getValidators` shape-validate vs `as any → []` (`validators.ts:106`) · Marketplace silent `.catch(()=>{})` (`Marketplace.tsx:92,135,152,344`) · `TransactionView` guarded `JSON.parse` with precise errors (`:485-486,523-524`) · `useNetworkPulse` drop non-null assertions + render `avgBlockTime` "—" not "0s" (`:49-51`) · 0-GNOT balance chip should show "0 GNOT" not vanish (`Home.tsx:38-59`).

**Dead code:** delete `lib/nftMarketplaceTemplate.ts` (0 importers) · orphan `buildAcceptOfferMsg`/`buildClaimExpiredOfferMsg` (`nftMarketplace.ts:249,271` — wire the accept/claim UI or drop) · stale `<NetworkPulsePanel/>` doc refs after #468 (`StateBoard.tsx:121,126,149`) · unused `DoorVariant` export (`Door.tsx:19`) · module-internal `*Props/*Result` exports.

**a11y/mobile polish:** sub-44px tap targets in the "More" sheet (`MobileTabBar.tsx:118-233`) · light-theme `--color-k-dim` contrast on door labels (`index.css:68`, `home.css:1207`) · command-palette ≥16px input (iOS zoom, `command-palette.css:54`, L4) · non-semantic clickable `<div>`s + dialog focus-traps (M7) · mobile grid "tables" <360px (`dashboard.css:144`, `multisigview.css:216`, M11).

**Test-coverage holes (highest-risk-least-tested):** `TransactionView.tsx` (multisig broadcast), `useAdena.ts`, `Treasury.tsx`, `DAOHome.tsx`, `CreateDAO/CreateToken` tx submission. Prefer pure-function tests for `buildMultisigSignatureData`/`buildBroadcastTx`.

**Other:** candidature approve → "Propose Add Member" two-step clarity (L8) · login-failure shouldn't force-disconnect the wallet (`Layout.tsx:135`, M1) · "Back to Dashboard" mislands on `/:network/` (L1).

---

## 5. Housecleaning (low-risk, high-signal)

| Item | Action | Owner |
|---|---|---|
| **Stray `sdd/final-review-fix-report.md` on `main`** | Delete via a housecleaning PR (info already in `HOME_PHASE2_GETHOMESNAPSHOT.md`). | [Me] |
| **Docs archival** (~14 superseded) | Move to `docs/planning/archive/`: `HOME_REWORK.md`, `HOME_PHASE2_GETHOMESNAPSHOT.md`, `MEMBA_AAA_A2_SIGNAMINO_LOGIN_DESIGN.md` (SHELVED), `TEST13_V09_MIGRATION_PLAN.md`, `MEMBA_V7_1_IMPLEMENTATION_PLAN.md`, `MEMBA_STATE_AUDIT_AND_PLAN_2026-06-23.md`, `MEMBA_TEST13_LIVE_AUDIT_2026-06-23.md`, `TEST13_GOLIVE_AUDIT.md`, `TEST13_GO_LIVE_NOTE.md`, `TEST13_FEATURE_AUDIT.md`, `NFT_MARKETPLACE_REDESIGN.md`, `NFT_MARKETPLACE_V2_DESIGN/PLAN/STRATEGY`. **Keep:** this plan, the 06-24 connected audit (commit it), `TEST12_WINDDOWN_RUNBOOK.md`, `HOME_ATLAS_REDESIGN.md` (status-update header), `MEMBA_AAA_IMPLEMENTATION_PLAN.md`, active `NFT_*` roadmap + `NFT_POINTS_FORMULA_INVARIANTS.md` (FROZEN), reference/convention docs. | [Me] |
| **Commit the untracked 06-24 connected audit doc** | It's the reconciliation hub this plan builds on. | [Me] |
| **README refresh** | Stale "Features (v4.0)" / "1777+ tests" (`README.md:10,20`) → current reality (Atlas home, NFT v3, GnoBuilders, candidature). Public face at memba.samourai.app. | [Me] |
| **Local checkout** | `npm ci` in `frontend/` to fix the stale `node_modules` (vite missing). **Defer to the worktree owner** — a concurrent session is on it. | [You] |
| **`samcrew-deployer`** | Parked on an already-merged branch (#32 landed) → return to `main`, delete the stale branch. | [You] |
| **(Optional) repo `CLAUDE.md`** | Pointer to `SESSION_CONVENTIONS.md` + this plan for onboarding agents. | [Me] |

---

## 6. Recommended sequencing

1. **P0-1** (gate the NFT pages on `main`) — standalone S PR, closes the live exposure now.
2. **P0-3** (deploy `needs: ci`) — S, removes the deploy-path bypass.
3. **Phase-0 quick wins** (one or two PRs): P1-9 (safe-area), P1-11 (test12 copy), P1-12 (gnoland1 gating), P1-4 (RPC default/`.env.example`), P2 `AUTH-A2-DEBUG` removal, P1-5 (member-count honesty) + housecleaning (stray file, commit audit doc, README). All S, low-risk, visibly improve test13.
4. **P0-2** (observability keystone) — M, the precondition for every flip.
5. **P1 security batch:** P1-2 (SSRF), P1-3 (OAuth timeout), P1-7/P1-8 (silent-failure surfacing), P1-6 (ecosystem honesty), P1-10 (banners).
6. **P1-13** (dup-fetch) + the P2 cleanup/dead-code/a11y batches as capacity allows.
7. **Gated flips, in order, each after its dashboard exists:** NFT (P0-1 → #443 → wallet E2E → P1-1/P2-1 → flip) · multisig enforce · badges. Atlas Phase 3 deferred.

**Consciously NOT now:** Atlas Phase 3 / gnoland1 generalization (no deployment → no value); the NFT flag-flip before the wallet E2E; a true on-chain `GetMember(addr)` selector (early-exit is fine ≤10 pages); the badge mint ceremony (no launch driver).

---

## 7. ⚠️ Concurrent-session coordination

A second session is **actively editing the home** (`YourWorldsPanel.tsx`) on `fix/home-connected-feedback`. Before starting any home/UX item here (P1-5, P1-9, P1-10, P1-13, the MH "Your worlds → Your organisations" items), **reconcile with that branch** — some may already be in flight. This plan file is an **untracked** artifact in that live tree; **commit it promptly** (or I can move it) so a `git clean`/checkout there can't drop it.

---

## 8. Coverage of the requested-minimum items

- **#443 NFT E2E → flip + 2 pre-flip fast-follows** → §3 (NFT go-live), P1-1 (raw-ugnot price), P2-1 (numeric input). ✅
- **Home fast-follows #465** → P1-14 (role-paging; *framing stale*, decision item) + P1-13 (dup-fetch). ✅
- **Home audit items** → P1-6 (ecosystem honesty), P1-9 (safe-area), P1-10 (banner pile-up), P0-2 (observability). ✅
- **Ops/security** → P1-4 (#466 confirmed merged+deployed; `.env.example` drift), multisig flip §3, OpenRouter rotate §3, badges flip §3, Atlas Phase 3 §3 (DEFER). ✅
- **New from audit** → P0-1 (NFT gate regression), P0-3 (deploy CI hole), P1-2 (SSRF), P1-3 (OAuth timeout), P1-5 (members mislabel), P1-7/8 (silent failures), plus the P2 + housecleaning batches. ✅
