# Memba — Product Roadmap

> Versioned roadmap for Memba, the standalone Gno multisig & DAO wallet.
> Each version includes scope, acceptance criteria, engineering gates, and cross-perspective review checkpoints.

> **Active long-term program (2026-07-03 →):** [Program "Compound" — Waves 5+](docs/planning/MEMBA_ROADMAP_COMPOUND_2026-07.md), the successor to the v7.2.x AAA remediation plan (Waves 0–4 delivered, PR #732). All forward planning lives there; the sections below are the historical version-by-version record.

---

## Current Status (2026-07-10)

| Metric | Value |
|--------|-------|
| **Latest Release** | v7.2.0 (cut 2026-06-29) + a large `[Unreleased]` wave (#851–#872: marketplace-v2 shell, App Store submit/curator/reviews, blog SEO + on-chain reader, perf & indexer hardening). |
| **Shipped Versions** | 51+ (v0.1.0 → v7.2.0) + ongoing feature branches |
| **Test Suite** | **3,000+ automated tests (CI-enforced)** — 243 Vitest files + 64 Go test files (auth/db/indexer/points/service, incl. `FuzzMakeADR36SignDoc`) + pinned-gno template compile gate + 27 Playwright E2E specs. CI is the source of truth for exact counts. |
| **Coverage** | Frontend/Backend CI-enforced thresholds (aggregate bump deferred) |
| **Networks** | **test13 is the prod default — cutover DONE**; all `_v2` and `v3_1` realms LIVE (DAO + commerce + feedback + NFT launchpad) |
| **Architecture** | Go 1.25.x + ConnectRPC backend (Fly rolling deploys + GHCR mirror + Litestream backups), React 19 + Vite frontend, SQLite, OpenRouter AI |
| **Security** | Auth: `MEMBA_ALLOW_UNSIGNED_AUTH=0` (fail-closed); 0 open Dependabot alerts on `main` after Wave 1 hardening; 1 own advisory (MEMBA-2026-001) |
| **On-Chain** | Full Memba realm set live on test13 (`memba_dao`, `memba_quest_attestation_v1`, `memba_market_core_v2`, `memba_nft_market_v3_1`, etc.) |
| **AI Analyst** | 10 free models via OpenRouter, DAO-level + proposal-level, cached 6h |
| **GnoBuilders** | 85 quests, 8-tier rank system, leaderboard, badge NFTs (GRC721 `gnobuilders_badges_v2`), **XP cryptographically settled on-chain** |
| **Active program** | [Program "Compound" (Waves 5+)](docs/planning/MEMBA_ROADMAP_COMPOUND_2026-07.md) — v7.2.x AAA remediation Waves 0–4 delivered (#732, 2026-07-03) |
| **Next Priority** | **Owner: finish the test13 ceremony** (blog republish → appstore v3 + migration → NFT v3.2 → fee-path checklist → submit de-gate; SSOT `samcrew-deployer/projects/memba/TEST13_CEREMONY_2026-07-10.md`) · **Code: next-cycle plan Waves A–F** ([MEMBA_NEXT_CYCLE_AUDIT_AND_PLAN_2026-07-09.md](docs/planning/MEMBA_NEXT_CYCLE_AUDIT_AND_PLAN_2026-07-09.md)) |

> **Note on chain naming**: Memba uses `gnoland1` as chain ID (matching the RPC `/status` response). The community often refers to this network as "betanet". Both names refer to the same chain.

---

## Methodology

Every version follows these gates before release:

| Gate | What happens | Deliverable |
|------|-------------|-------------|
| **1. RFC** | Scope lock, acceptance criteria defined | Scope doc approved by zooma |
| **2. Design Review** | Architecture, API, DB changes reviewed | Updated `ARCHITECTURE.md` / proto files |
| **3. Implementation** | Code + tests + PR reviews | Merged PRs, lint-clean |
| **4. QA Gate** | All acceptance criteria verified | Test report + security checklist |
| **5. Release Gate** | CHANGELOG + tag + deploy + verify | Production-verified release |

After each release, a **Cross-Perspective Review** is conducted:

| Lens | Focus |
|------|-------|
| 🔒 Security | Auth, key handling, input validation, CORS, rate limits |
| 👤 UX | Clarity, latency, error messages, accessibility, mobile responsiveness |
| ⚙️ Engineering | Code quality, test coverage, performance, tech debt, documentation |

Review findings feed into the **next version's RFC** as action items.

---

## v7.1 Phase 0 — Audit Unblock & Security Hardening ✅ COMPLETE (2026-05-11)

> Plan: [`docs/planning/MEMBA_V7_1_IMPLEMENTATION_PLAN.md`](docs/planning/MEMBA_V7_1_IMPLEMENTATION_PLAN.md) §4
> Signoff: [`docs/reports/archive/v7.1-phase0-signoff.md`](docs/reports/archive/v7.1-phase0-signoff.md) (immutable audit record)
> Releases: `v6.0.2` (#331), `v6.0.3` (#332 + hotfix #333)

| Workstream | Outcome | PRs |
|------------|---------|-----|
| Go stdlib advisories (`GO-2026-4918/4971/4980/4982`) | Go 1.25.10 + `govulncheck` pinned v1.3.0 | #331 |
| Clerk `GHSA-vqx2-fgx2-5wq9` + `GHSA-w24r-5266-9c3c` | `@clerk/clerk-react ^5.61.6` + override `@clerk/shared ≥ 3.47.5` | #332 |
| dompurify `GHSA-39q2/-h7mw/-crv5/-v9jr` (4 advisories) | `dompurify ^3.4.2` + 30-vector OWASP regression suite | #332 |
| **AUTH-CHAINID-01** (own advisory `MEMBA-2026-001`) | ADR-036 signDoc `chain_id` rebinding rejection in `backend/internal/auth/crypto.go` + 4 regression tests + `FuzzMakeADR36SignDoc` | #331 |
| Rollback strategy | Drop bluegreen (incompatible), switch to `fly.toml [deploy] strategy = "rolling"` + per-release GHCR image mirror | #331 + hotfix #333 |
| Sentry source-map upload | `SENTRY_AUTH_TOKEN` wired in `deploy-frontend.yml` | #331 + hotfix #333 |
| Dependency policy + dependabot freeze | [`docs/DEPENDENCY_POLICY.md`](docs/DEPENDENCY_POLICY.md); `dependabot.yml` `open-pull-requests-limit: 0`; `dependency-review-action@v4` gate | #332 |
| 15-PR backlog | 6 merged, 13 closed (10 folded, 3 deferred to v7.2) | — |

**Test delta:** Vitest 1,628 → 1,659 (+31 OWASP DOMPurify vectors); Go auth 11 → 14 + 1 fuzz target.
**Production deploys:** backend `ghcr.io/samouraiworld/memba-backend:a4f6eb9` (rolling), frontend Netlify deploy of `2baa5db` — both HTTP 200, stable.

---

## v7.1 Phase 1 — Auth Hardening + Custody + Stale-Doc Refresh 🚧 IN PROGRESS

> Plan: [`docs/planning/MEMBA_V7_1_IMPLEMENTATION_PLAN.md`](docs/planning/MEMBA_V7_1_IMPLEMENTATION_PLAN.md) §5
> Gate: Phase 1 PRs touching auth, secrets, or chain probes require a secondary CODEOWNERS reviewer (Q-A). The AD-15 self-merge pattern from Phase 0 is **not** repeated.

| PR | Scope | Status |
|----|-------|--------|
| `samcrew-deployer:fix/mainnet-security-audit-v3` | 5 commits (channels events, escrow + agent registry + NFT market + candidature + badges audit fixes) | Open |
| `gnodaokit:fix/security-audit-v5-realm-fixes` | Red/Blue + expert + CTO findings — float64→bps consensus safety, H-6 Snapshot, M-10 openCount leak, R17 supermajority | Draft PR open |
| **AUTH-SESSION-REJECT-01** | `backend/internal/auth/crypto.go` — defensive rejection of Adena 1.20+ session subaccounts; unit test | Hold (Q-A) |
| **Custody section in `MAINNET_PREPARATION.md`** | Signers, M-of-N, hardware class, geographic distribution, recovery, rotation, dry-run; signed by ≥ 2 Samourai Coop principals. Hard prerequisite for Phase 2. | Draft (1 signer confirmed, slots TBD for the rest) |
| **SECRETS_ROTATION.md** expansion + **SECURITY.md** update | PGP fingerprint, GHSA enablement, Resolved Advisories table seeded with `MEMBA-2026-001` | Open |
| `chainHealth` fallback + gnoland1 transfer-lock probe | Corrected probe path `params/bank:p:restricted_denoms` (gno #5629). Updates `GNO_CORE_BREAKING_CHANGES.md`. | Hold (Q-A) |
| **Stale-doc refresh** (this PR) | `DEPLOYMENT_RUNBOOK.md`, `MAINNET_PREPARATION.md`, `ROADMAP.md`, `realm-versions.json`, `PROGRESSIVE_DECENTRALIZATION.md` | In review |
| `docs/planning/V7_1_DOCS_INVENTORY.md` + `V7_1_KT.md` | Doc inventory + knowledge-transfer doc | Pending |
| CODEOWNERS audit + branch-protection screenshot | Confirm Q-A reviewer mapping + immutable evidence of branch rules | Pending |

Phase 1 close-of-phase deliverable: [`docs/reports/v7.1-phase1-signoff.md`](docs/reports/v7.1-phase1-signoff.md) mirroring Phase 0's shape (goal vs outcome, PRs merged, advisories, DoD).

---

## v2.15.0 — Gnoland1 Support & Smooth Network Switching ✅ SHIPPED (2026-03-19)

> Branch: `feat/gnoland1-smooth-switching`

| Feature | Status | Files | Tests |
|---------|--------|-------|-------|
| Gnoland1 network in NETWORKS + explorer + GnoSwap | ✅ | 1 | +4 |
| Adena AddNetwork + SwitchNetwork integration | ✅ | 1 | — |
| ChainMismatchBanner with "Add & Switch" button | ✅ | 1 | — |
| Layout success toast + wiring | ✅ | 1 | — |
| WhatsNewToast gnoland1 update | ✅ | 1 | — |
| Changelogs.tsx v2.15.0 entry | ✅ | 1 | — |
| ARCHITECTURE.md + README.md + .env.example | ✅ | 3 | — |

**Total: 776+ tests (35 files). Zero lint/TS/build errors.**

---

## v2.1a — Community Foundation ✅ COMPLETE (2026-03-07)

> Discord-like channels, $MEMBA token, candidature flow, IPFS avatars, MembaDAO bootstrap.

| Feature | Status | Files | Tests |
|---------|--------|-------|-------|
| Channel Realm v2 (role-based ACL, threads, admin actions) | ✅ | 8 | +71 |
| $MEMBA GRC20 Token (10M supply, 2.5% fee, 40/30/20/10% allocation) | ✅ | 3 | +8 |
| MembaDAO Candidature (submit/approve/reject, re-candidature cost) | ✅ | 2 | +49 |
| IPFS Avatars (Lighthouse upload, canonical `ipfs://` save) | ✅ | 4 | +18 |
| MembaDAO Bootstrap (config, deployment, status checker) | ✅ | 2 | +23 |

**Audit**: 5 rounds, 23 findings (15 fixed: self-approval guard, FEE_RECIPIENT fix, skills validation, re-candidature cost, type safety, substring match, configurable edit window).

**Total: 529 tests (22 files). Zero lint/TS/build errors.**

---

## v2.2a — Organization Directory ✅ SHIPPED (2026-03-08)

> Branch: `feat/v2.2a-directory` — PR #76 → merged

| Feature | Status | Files | Tests |
|---------|--------|-------|-------|
| Directory data layer (sessionStorage cache, registry parsers) | ✅ | 2 | +13 |
| DAO Render parser (members, proposals, description, batch fetch) | ✅ | 1 | +11 |
| DAOCard + FeaturedDAOs components (rich cards, carousel) | ✅ | 3 | — |
| CSS extraction (glassmorphism, responsive grid — 330 LOC) | ✅ | 1 | — |
| Directory.tsx refactor (CSS classes, data layer, ARIA tabs) | ✅ | 1 | — |
| 9-finding audit (C1/C2/I1-I4/M1-M2) | ✅ | 6 | — |

**Audit**: 9 findings, all fixed (canonical queryRender, cache schema validation, dedup RPC, useDeferredValue, anchored regex, valid HTML nesting, memoization, ARIA tabpanel).

**Total: 636 tests (29 files). Zero lint/TS/build errors.**

---

## v2.2b — Directory Enrichment ✅ SHIPPED (2026-03-08)

> Branch: `feat/v2.2b-enrichment` — PR #77 → merged

| Feature | Status | Tests |
|---------|--------|-------|
| DAO Category Tags (6 heuristic categories, colored badges) | ✅ | +13 |
| User Avatar Enhancement (gradient CSS, img support) | ✅ | — |
| Contribution Scores (Set-indexed scoring, activity badges) | ✅ | +9 |
| DAO Auto-Discovery (ABCI probe, configurable API, cache) | ✅ | +3 |
| Per-DAO Notification View (filter + unread count per DAO) | ✅ | +4 |
| Deep Review (7 findings: I1-I3 + M1-M4, all fixed) | ✅ | — |

**Total: 665 tests (29 files). Zero lint/TS/build errors.**

---

## v2.2c — Quick Wins ✅ SHIPPED (2026-03-08)

> Branch: `feat/v2.2c-quick-wins` — PR #78 → merged

| Feature | Status |
|---------|--------|
| Sidebar Notification Badges (notifUnreadCount prop) | ✅ |
| IPFS Avatars in Directory (gnolove batch fetch + resolveAvatarUrl) | ✅ |
| Typed BankMsgSend (BankMsgSend interface) | ✅ |

**Total: 665 tests (29 files). Zero lint/TS/build errors.**

---

## v2.6 — Hardening & OSS Prep ✅ COMPLETE (2026-03-08)

> Branch: `dev/v2` — Phase 0-3

| Feature | Status | Tests |
|---------|--------|-------|
| Board deploy fix (std → chain/runtime in 4 realm templates) | ✅ | — |
| Content-Security-Policy meta tag | ✅ | — |
| Cmd+K Command Palette (14 commands, fuzzy search, keyboard nav) | ✅ | — |
| Error message translation layer (20+ patterns) | ✅ | +26 |
| Shared gas config (getGasConfig(), user-configurable) | ✅ | +5 |
| Tx retry (2× exponential backoff, smart skip) | ✅ | — |
| Executable proposals (buildExecuteMsg, handleExecute, UI) | ✅ | — |
| Extensions Hub page (4 cards, status badges) | ✅ | — |
| Faucet card redesign (dismissible, TESTNET ONLY badge) | ✅ | — |
| Dashboard graceful degradation (suppress backend errors) | ✅ | — |

**Deferred:** BoardView decomposition, onboarding tooltips, GnoSwap (→ FUTURE)

**Total: 718 unit tests (34 files), 238 E2E. Zero lint/TS/build errors.**

---

## v2.14.0-alpha — Hacker View & Validator Detail 🕵️ ✅ SHIPPED (2026-03-17)

> Branch: `feat/validators-hacker-mode` — targeting testnet12

| Feature | Status | Files |
|---------|--------|-------|
| `/validators/hacker` — Gnockpit-parity live telemetry (status bar, CONNECT, NETWORK STATE, PEERS, DOCTOR, NODE STATE) | ✅ | 5 new |
| `/validators/:address` — Dedicated validator detail page (rank, stats, proposer badge, identity, perf, heatmap) | ✅ | 2 new |
| BlockHeatmap 25-column Gnockpit-style refactor (signer count inside cells) | ✅ | 1 |
| Dual-RPC strategy (Samourai sentry preferred, public RPC fallback) | ✅ | config.ts |
| Clickable validator rows with keyboard accessibility (tabIndex, role, onKeyDown) | ✅ | Validators.tsx |
| Per-validator block signature history (fetchLastBlockSignatures) | ✅ | validators.ts |
| NodeStatus type + getNodeStatus() fetcher | ✅ | validators.ts |
| getNetworkStats: AbortSignal third parameter (critical bug fix) | ✅ | validators.ts |
| `fetchBlockHeatmap` chunked batching (10/batch, prevent rate limiting) | ✅ | validators.ts |
| CSP `connect-src` + TRUSTED_RPC_DOMAINS: `*.samourai.live` | ✅ | index.html, netlify.toml, config.ts |
| Dead code removal (`HackerModeToggle.tsx` + orphaned CSS) | ✅ | 2 files |
| 22-perspective deep audit (all findings fixed) | ✅ | see final_audit.md |
| README + .env.example + docker-compose updates | ✅ | docs |

**Acceptance criteria:**
- `/validators/hacker` loads with live H/R/S, peers, heatmap, node state
- `/validators` rows are clickable → navigate to detail page
- `/validators/:address` loads for any active validator bech32 address
- Graceful 404 for unknown addresses
- All RPCs fail gracefully (no crashes, show `—`/`"unknown"`)
- `tsc --noEmit` 0 errors — **✅ PASSED**

**Test gate:** 771 unit tests (35 files), +15 new — **✅ PASSED**

---

## v2.7 — Monitoring Integration & UI Polish ✅ COMPLETE (2026-03-08)

> Branch: `dev/v2` — gnomonitoring deep dive + GovDAO polish

| Feature | Status | Files |
|---------|--------|-------|
| Monitoring API client (`gnomonitoring.ts`) — 30s cache, 5s timeout, graceful degradation | ✅ | 1 |
| `hexToBech32()` — Tendermint hex → bech32 address conversion | ✅ | 1 |
| Validator enrichment (monikers, participation, uptime columns) | ✅ | 2 |
| Active Validators card fix (was showing 0) | ✅ | 1 |
| GovDAO UI polish (grey badge, `.k-stat-card` CSS, description) | ✅ | 2 |
| MultisigHub page (`/multisig`) | ✅ | 2 |
| CSP + config + `.env.example` updates | ✅ | 3 |
| **gnomonitoring multi-origin CORS [PR #60](https://github.com/samouraiworld/gnomonitoring/pull/60)** | ⏳ Pending merge | External |
| **Monikers display** | ✅ COMPLETE | v2.13 — via ABCI `valopers` Render (bypasses CORS) |

---

## v2.1b — Validators & Notifications ✅ SHIPPED (2026-03-08)

> Branch: `feat/v2.1b-validators-notifications` — PR #75 → merged

| Feature | Status | Files | Tests |
|---------|--------|-------|-------|
| Notification Center (bell icon, ABCI polling, localStorage) | ✅ | 6 | +27 |
| Validator Dashboard (stats cards, table, search, pagination) | ✅ | 6 | +13 |
| Gasless Onboarding Phase 1 (faucet eligibility, cooldown) | ✅ | 2 | +16 |
| Faucet Claim UI (dashboard card, eligibility check) | ✅ | 3 | +12 |
| Multi-DAO Notification Polling (max 5/cycle, parallel) | ✅ | 2 | — |
| Validator Pagination (auto-paginate >100, client controls) | ✅ | 3 | +5 |
| Bundle split (manualChunks: 568→449KB, -21%) | ✅ | 1 | — |
| Dual-round audit (15 findings, all fixed + 7 Phase 2 hardening) | ✅ | 6 | — |

**Total: 612 tests (27 files). Zero lint/TS/build errors.**

---

## Archive

Versions prior to v2.14 (v0.1.0 → v2.0-η, v2.x planning, v3–v10 early iterations) are archived in [docs/archive/ROADMAP_PRE_V2.14.md](docs/archive/ROADMAP_PRE_V2.14.md).
