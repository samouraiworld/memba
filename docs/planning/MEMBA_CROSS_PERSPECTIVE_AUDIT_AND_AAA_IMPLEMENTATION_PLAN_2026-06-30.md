# Memba — Cross-Perspective Audit & AAA Implementation Plan

> **Document type:** Deep technical audit + CTO-level remediation & delivery plan
> **Date:** 2026-06-30
> **Scope:** Full repository (`frontend/`, `backend/`, `contracts/` + generated Gno realms, `api/`, `mcp-server*/`, `packages/`, infra/CI, docs) and its first-party dependencies.
> **Method:** Four parallel domain audits (frontend, backend, Gno/codegen, infra/CI) + direct source verification of every HIGH/P0 finding.
> **Status of code:** Alpha, self-declared *experimental and unaudited* (see `DISCLAIMER.md`). This document is an internal engineering audit, **not** a substitute for a formal third-party security audit.

---

## 0. How to read this document

This is structured in three layers so each reader can enter at the right altitude:

1. **§1–§3 — The picture.** Executive summary, what Memba is in Gno terms, and the threat model. Read this if you have five minutes.
2. **§4 — The findings register.** Every confirmed issue, severity-rated, with `file:line` evidence and the *why it matters*. This is the audit.
3. **§5–§9 — The plan.** A waved, dependency-ordered implementation plan with concrete tasks, acceptance criteria, verification, and quality gates. This is the CTO deliverable.

**On effort estimates:** per house style, this plan deliberately does **not** estimate calendar time. Difficulty is expressed in terms of *blast radius* (which subsystems change), *invasiveness* (how deep the edit goes), and *risk/dependencies* (what must land first, what can go wrong).

---

## 1. Executive summary

Memba is an unusually ambitious alpha: a single product that fuses a **multisig coordination service**, an **on-chain DAO governance hub**, a **token + NFT launchpad/marketplace**, a **validator telemetry suite**, an **AI governance analyst**, and a **gamified onboarding system** — across two Gno networks, with React 19 / Go 1.25 / SQLite / ConnectRPC and a pair of MCP servers for AI agents.

**The headline:** the engineering *maturity signals* are genuinely strong for an alpha — fail-closed auth defaults, a 27-vector DOMPurify regression suite, parameterized SQL throughout, SSRF hardening on IPFS/NFT proxies, GitHub OAuth CSRF protection, a 600 KB bundle budget gate, Buf breaking-change checks, dependency review, and an extensive planning/runbook corpus. This is not a toy.

**But the surface area has outrun the controls in four concentrated places**, and these are where real loss can occur:

1. **On-chain fund-handling correctness** — the committed `memba_nft_offers_v1` realm settles offers by *deleting the order and emitting an event without transferring the NFT or paying anyone* (escrowed buyer funds can be stranded), and the generated escrow code ships without the refund/timeout functions that the frontend already builds calls for. These are **fund-loss class** defects. (Mitigant: the offers realm is gated off the frontend allowlist today; the danger is latent-on-deploy.)
2. **Backend access control & integrity** — `MultisigInfo` returns any multisig's pubkey set and member list to *any authenticated user* (broken object-level authorization); multisig signature verification is shipped in **log-only mode** in production (`fly.toml` deliberately holds enforcement off); `CompleteTransaction` trusts a client-supplied final hash; and quest XP for `off_chain` quests is auto-granted (leaderboard farming).
3. **DAO governance math** — the generated DAO realm finalizes proposals *instantly on a single qualifying vote* (no voting-period floor), uses an asymmetric reject threshold, and `executeAddMember` bypasses the role allowlist that every other path enforces.
4. **Supply chain & SAST labeling** — deploy workflows install release-critical tooling at `@latest` (and pin Fly's action to `@master`), and the README "Security" badge points at a **gosec-only** job — there is no CodeQL/JS SAST despite the implied coverage.

None of these are exotic. All are fixable with surgical, well-scoped changes. The plan in §5 sequences them so that **fund-loss and auth defects land first, behind tests**, before any further feature expansion.

**Top-line verdict (CTO lens):** *Do not widen the product surface until Wave 0 + Wave 1 close.* The codebase has the test infrastructure and discipline to absorb these fixes cleanly; the risk is not capability, it's prioritization. Freeze net-new feature realms, harden the money paths, flip the enforcement flags that are already wired, and make the CI security story match its badge.

---

## 2. Gno context — the mental model this audit assumes

Memba lives or dies by how correctly it speaks Gno. Establishing the shared model:

- **Gno** is a deterministic, Go-like smart-contract language. Code is deployed as **packages** to `gno.land`:
  - `/p/...` = **pure packages** (libraries, no persistent state, importable).
  - `/r/...` = **realms** (stateful contracts; persistent global vars survive across calls; expose `Render(path string) string` for read views).
- **Calls & deploys** happen via signed transactions: `MsgCall` (invoke an exported realm function) and `MsgAddPackage` (deploy new source). Memba's frontend assembles these and hands them to **Adena** for client-side signing — the backend never holds keys.
- **Reads** happen via ABCI queries over JSON-RPC: `vm/qrender` (calls `Render`), `vm/qeval` (evaluates an expression/function), `bank/balances` (coin balances). Memba parses the markdown/string output of `Render` client-side — a large and brittle parsing surface.
- **Caller identity & money** are the two danger zones:
  - Caller is obtained via `std.PreviousRealm()/PrevRealm()` (newer interrealm API: `unsafe.PreviousRealm().Address()`) or legacy `std.GetOrigCaller()`. **Mixing these inconsistently is an access-control smell** (and we see it: `offers.gno` uses `PrevRealm` in one function and `GetOrigCaller` in another).
  - Coin movement uses a **banker** (`std.GetBanker(...).SendCoins(...)`). The cardinal rule is **CEI** (Checks-Effects-Interactions): mutate realm state *before* sending coins. Most Memba code follows this; the exception (`AcceptFloorOffer`) is exactly where the fund-loss bug lives.
- **Immutability is real and unforgiving.** There is no in-place upgrade: a fix is a *new realm path* (`escrow` → `escrow_v2`, `…_market_v3` → `v3_1`). `realm-versions.json` tracks deployed state per network. Some realms are explicitly **irreversible ledgers** (`memba_collections` holds the NFT ledger) — a bug there is permanent. This raises the bar on pre-deploy review to near-formal levels.
- **Codegen is the real contract author.** Most realms Memba deploys are **generated at runtime in TypeScript** (`frontend/src/lib/*Template.ts`) by interpolating user input (DAO name, addresses, symbols) into Gno source strings. This makes the **template sanitizer a security boundary equivalent to a compiler front-end** — a string-literal escape there is remote code injection into a deployed contract.

The implication that shapes the whole plan: **Memba's most security-critical code is not its Go backend — it is the TypeScript that writes Gno, and the Gno that moves coins.** The audit weights accordingly.

---

## 3. Threat model (abridged)

| Actor | Capability | Primary targets | Worst case |
|-------|-----------|-----------------|------------|
| **Anonymous web user** | Hit public RPCs/proxies, read Render output | `/api/analyst`, `/metrics`, render proxy, public reads | Cost-drain, info disclosure, RPC abuse |
| **Authenticated user (valid wallet)** | Any authed RPC, deploy realms via Adena | `MultisigInfo`, quests, `CompleteTransaction`, codegen inputs | Read others' multisig membership; farm XP; mark txs executed; inject into generated realm |
| **Malicious DAO creator** | Controls codegen inputs (names, roles, addresses) | Template sanitizer, generated DAO/escrow/channel | Code injection into a deployed realm if escaping is incomplete |
| **Malicious counterparty (commerce)** | Make/accept offers, fund escrow milestones | `offers.gno`, generated escrow | Fund loss / stranded escrow via incomplete settlement |
| **Compromised dependency / CI** | Supply-chain via `@latest`/`@master` installs | deploy workflows w/ `FLY_API_TOKEN` | Backdoored deploy artifact |
| **XSS foothold (hypothetical)** | Run JS in the SPA origin | `localStorage` auth token | Session theft until 24h expiry |

The two highest-value, lowest-effort attack paths are: **(a)** deploy/register the broken `offers_v1` realm and strand buyer funds, and **(b)** abuse the log-only multisig signature path / unverified completion hash to corrupt coordination state. Both are addressed in Wave 0.

---

## 4. Consolidated findings register

Severity scale: **P0** = fund loss / auth bypass / RCE-class · **P1** = high security/correctness · **P2** = medium · **P3** = low/hygiene. Each item carries verified `file:line` evidence.

### 4.1 On-chain / fund handling (highest weight)

| ID | Sev | Finding | Evidence |
|----|-----|---------|----------|
| **CHN-1** | **P0** | `AcceptFloorOffer` removes the offer and emits `OfferAccepted` **without** transferring the NFT, paying the seller, splitting fees, or refunding on failure. Escrowed buyer `ugnot` (locked at `MakeFloorOffer`) can be left with no corresponding order → **stranded/lost funds**. Settlement is a `// Simulate` stub. | `contracts/memba_nft_offers_v1/offers.gno:126-155` |
| **CHN-2** | **P0** | Generated escrow realm omits `ClaimRefund` / dispute-timeout logic, but `marketplace/builders.ts` exposes `buildClaimRefundMsg` / `buildClaimDisputeTimeoutMsg` targeting functions **absent** from the generated source → milestone funds can stall with no on-chain exit if wired. `AutoRefundBlocks`/`autoResolveBlocks` constants are embedded but never used. | `frontend/src/lib/escrowTemplate.ts:173`; `frontend/src/lib/marketplace/builders.ts:136-171` |
| **CHN-3** | **P1** | `offers.gno` inconsistent caller guards: `MakeFloorOffer` uses `PrevRealm`+`GetOrigCaller` IsUserCall guard; `CancelFloorOffer` uses only `GetOrigCaller()`. `MaxOffers`/`MaxOffersPerAddr` constants declared but **never enforced** → unbounded AVL growth / gas DoS. `paused` has no setter (dead state). | `contracts/memba_nft_offers_v1/offers.gno:51-55,98,21-26,17` |
| **CHN-4** | **P1** | Generated DAO `executeAddMember` does **not** apply `assertRole` to each role string (unlike `executeAssignRole`) → a passed proposal can assign arbitrary roles outside `allowedRoles`, escalating governance privileges. | `frontend/src/lib/daoTemplate.ts:550-564` vs `:595` |
| **CHN-5** | **P1** | Generated DAO voting finalizes **instantly** on a single qualifying vote (status flips to `ACCEPTED`/`REJECTED` inside `VoteOnProposal` once the math is hit) — no minimum voting-period floor, so an early voter with sufficient power locks the outcome before others vote. Reject threshold is **asymmetric** (`YesVotes*100/tpow >= threshold` vs `NoVotes*100/tpow > (100-threshold)`); `ABSTAIN` counts toward quorum but not toward resolution. Tally uses power at vote time (no snapshot). | `frontend/src/lib/daoTemplate.ts:451-461` |
| **CHN-6** | **P2** | Live **test12** `agent_registry` v1 `UseCredit` has **no caller guard** — anyone can burn any user's credits. The in-repo template *is* hardened; the deployed realm is not. | `realm-versions.json:36-42`; fix present in `frontend/src/lib/agentTemplate.ts:309-312` |
| **CHN-7** | **P2** | Generated `boardTemplate` calls `parent.IsMember(addr)`, but the generated DAO exports no `IsMember()` → board realm fails to compile against its DAO. Compile gate (`templates.compile.test.ts`) only runs when `gno` is on PATH (often skipped locally). Board rate-limiting is a no-op placeholder. | `frontend/src/lib/boardTemplate.ts:286-291,302-305` |
| **CHN-8** | **P2** | Generated candidature template lacks deposits/withdraw/admin ACL present in the deployed `memba_dao_candidature_v2` → unsafe if deployed verbatim. Generator/deployed divergence is a recurring theme (agent_registry, escrow, candidature). | `frontend/src/lib/candidatureTemplate.ts:327-346` |
| **CHN-9** | **P2** | Escrow/agent **admin & fee-recipient addresses** are interpolated raw (`"${config.adminAddress}"`) with no `isValidGnoAddress` check inside the generator — safe via the wizard, injectable if the generator is ever called directly. Fee inconsistency: escrow/NFT use 2% while token flows advertise 2.5%. | `frontend/src/lib/escrowTemplate.ts:170-174`; `frontend/src/lib/grc20.ts:15` |
| **CHN-10** | **P3** | No `offers_test.gno`; no Gno tests for fee math or DAO voting simulation; no `*_filetest.gno` anywhere. Fund-logic correctness is largely unverified at the Gno layer. | `contracts/` tree |

> **Exposure note (important nuance):** `memba_nft_offers_v1` is **not** in `REALM_ALLOWLIST.test13` (`frontend/src/lib/config.ts:216-245`), and the floor-offers design doc states deploy + `RegisterMarket` are *post-audit*. So CHN-1 is **latent**: the frontend gates the modals off today. The danger is that the committed stub reads as "done" and gets deployed. Treat it as P0-on-deploy and either complete it correctly or quarantine it.

### 4.2 Backend (Go / ConnectRPC / SQLite)

| ID | Sev | Finding | Evidence |
|----|-----|---------|----------|
| **BE-1** | **P1** | **Broken object-level authorization:** `MultisigInfo` only calls `authenticate()` — no membership check — so any authenticated user can read any multisig's `pubkey_json` + full member address list. Contrast `GetTransaction`, which requires joined membership. | `backend/internal/service/multisig_rpc.go:163-213` |
| **BE-2** | **P1** | **Multisig signature verification is log-only in production.** `SignTransaction` verifies the member signature but only rejects when `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1`, and `fly.toml` deliberately holds it off → invalid/garbage signatures are stored. | `backend/internal/service/tx_rpc.go:337-349`; `backend/fly.toml` |
| **BE-3** | **P1** | `CompleteTransaction` accepts a **client-supplied `final_hash`** and only checks `sigCount >= threshold` — it never verifies the hash on-chain. Any joined member can mark a tx "executed" with an arbitrary hash, corrupting coordination state/UI truth. | `backend/internal/service/tx_rpc.go:365-427` |
| **BE-4** | **P1** | **Quest XP farming:** `off_chain` (and legacy) quests fall through to a low-trust `return nil` accept in `CompleteQuest`/`SyncQuests` → authenticated users self-grant XP for `connect-wallet`, `visit-5-pages`, `weekly-login`, etc., corrupting leaderboard/rank integrity. | `backend/internal/service/quest_verify.go:131-146` |
| **BE-5** | **P2** | **Auth tokens have no server-side revocation/replay tracking** — a stolen 24h token is valid until expiry; token nonce is signed but never checked post-issuance. Legacy tokens with empty `chain_id` still accepted under a grace window. | `backend/internal/auth/crypto.go:446-457,507-512` |
| **BE-6** | **P2** | `/metrics` is **public unless `METRICS_BEARER` is set**, and it is not set in `fly.toml` → exposes auth-login ratios, quest rate-limit counters, Go runtime internals. | `backend/cmd/memba/main.go:446-457` |
| **BE-7** | **P2** | **Hardcoded default quest admin** address when `QUEST_ADMIN_ADDRESSES` is unset → privileged claim-review fallback baked into source. | `backend/internal/service/quest_rpc.go:818-820` |
| **BE-8** | **P2** | Rate-limit **proxy-trust** auto-enables on Fly; if the app is ever reachable off the Fly edge, `X-Forwarded-For`/`Fly-Client-IP` spoofing bypasses per-IP limits. Render proxy `realm` param is prefix-checked but not regex-validated (unlike `path`) → ABCI wire-format abuse. GitHub OAuth code exchange uses **GET** with code in query string. | `backend/internal/ratelimit/limiter.go:186-208`; `backend/internal/service/render_proxy.go:205-217`; `backend/internal/service/github_oauth.go:131` |
| **BE-9** | **P2** | **SQLite single-writer** (`SetMaxOpenConns(1)`) shared by RPC + NFT tailer + periodic WAL checkpoint → write contention/deadlock risk under load (already worked-around in `team_rpc.go`). `transactions` has **no FK** to `multisigs` → orphan rows possible. | `backend/internal/db/db.go:14-26`; `backend/internal/db/migrations/001_initial.sql` |
| **BE-10** | **P3** | `GetAgentStats` is unauthenticated and increments view counts per call (trivial inflation); `/health` discloses version/uptime/DB/WAL sizes/memory; `abciQuery` ignores caller context (no cancel on disconnect); empty global ConnectRPC interceptors mean every new RPC must remember to call `authenticate()` itself (latent enforcement gap). | `marketplace_rpc.go:93-100`; `main.go:553-565`; `render_proxy.go:134-135`; `main.go:192-193` |

> **Conditional P0:** If `MEMBA_ALLOW_UNSIGNED_AUTH=1` were ever set in prod, empty *and invalid* signatures are accepted → full impersonation of any known address (`crypto.go:364-385`). Production relies on the secure default (unset). **Action: assert via Fly secrets inventory that it is never set, and add a startup guard that refuses to boot with unsigned-auth enabled when `FLY_APP_NAME` is present.**

### 4.3 Frontend (React 19 / Vite / TypeScript)

| ID | Sev | Finding | Evidence |
|----|-----|---------|----------|
| **FE-1** | **P1** | Auth token persisted in `localStorage` (full server-signed token) → any XSS exfiltrates a working session until expiry. | `frontend/src/hooks/useAuth.ts:14-22` |
| **FE-2** | **P2** | Unsigned login fallback: if wallet signing is declined, the client still attempts address-only login; correctness rests entirely on the backend's `MEMBA_ALLOW_UNSIGNED_AUTH` default. | `frontend/src/components/layout/Layout.tsx:96-125` |
| **FE-3** | **P2** | Inconsistent sanitizer use across the **three** markdown/HTML render pipelines: `GnoloveMilestone` renders `renderMarkdown()` via `dangerouslySetInnerHTML` **without** DOMPurify; `LegacyCollectionView` does regex→tag wrapping with unescaped `$1` before DOMPurify. 8 `dangerouslySetInnerHTML` sites across 7 files (6 wrap DOMPurify). | `frontend/src/pages/gnolove/GnoloveMilestone.tsx:54-60`; `frontend/src/pages/LegacyCollectionView.tsx:126-136` |
| **FE-4** | **P2** | CSP `img-src` allows any HTTPS origin (`https:`) → image-beacon exfiltration vector if HTML injection ever lands; dev CSP uses `'unsafe-inline'` for scripts (prod uses sha256). | `frontend/index.html:24-35`; `netlify.toml:43-56` |
| **FE-5** | **P2** | God-files & type debt: `lib/validators.ts` (1,116 LOC, 38 explicit `any` + 41 eslint-disable), `lib/channelTemplate.ts` (836), `components/layout/Layout.tsx` (463). ~63 explicit `any` across 14 files. Five React-Compiler hook rules disabled (`set-state-in-effect`, `purity`, …) → latent effect bugs. | `frontend/eslint.config.js:23-28` |
| **FE-6** | **P2** | **Core multisig pages have zero unit tests** (`CreateMultisig`, `ImportMultisig`, `MultisigView`, `ProposeTransaction`, `TransactionView`) — only UI-level E2E. The money-path UI is the least tested. No Vitest coverage thresholds configured despite v8 coverage installed. | `frontend/src` (absence); `vite.config.ts:108-113` |
| **FE-7** | **P3** | Unused `remotion`/`@remotion/player` runtime deps (bloat/supply-chain surface); `recharts` not lazy-loaded on Validators/Gnolove; App prefetch `setTimeout` not cleared on unmount. | `frontend/package.json`; `frontend/src/App.tsx:169-184` |

> **Positive controls confirmed (do not regress):** RPC trust gate + chain-ID broadcast block (`grc20.ts:141-160`), tx confirmation modal, IPFS upload auth (`ipfs.ts:184-195`), SSRF path validation (`gnowebSource.ts:39-44`), Sentry PII scrubbing (`main.tsx:37-50`), build-time fund-safety flag gate (`safeFlags.ts`), 27-vector DOMPurify regression suite, no `eval()`/`innerHTML`.

### 4.4 Infra / CI / supply chain / API / MCP

| ID | Sev | Finding | Evidence |
|----|-----|---------|----------|
| **INF-1** | **P1** | **Supply chain:** deploy/CI workflows install release-critical tooling unpinned — `flyctl-actions/setup-flyctl@master` on the workflow holding `FLY_API_TOKEN`; `govulncheck@latest`, `golangci-lint@latest`, `gno@latest`, `gosec@latest`. CI signal is non-reproducible and a poisoned upstream tag reaches a token-bearing job. | `.github/workflows/deploy-backend.yml:56`; `ci.yml:55-59`; `gno-test.yml:39`; `codeql.yml:29` |
| **INF-2** | **P1** | **SAST gap masquerading as coverage:** README "Security" badge → `codeql.yml`, which runs **gosec only**. No `github/codeql-action` for JS/TS despite a frontend that writes Gno and renders untrusted markdown. | `.github/workflows/codeql.yml:1-32`; `README.md:6` |
| **INF-3** | **P2** | MCP `dao-analyst` docs advertise a "free tier" while backend `/api/analyst/analyze` requires a Memba auth token → broken/confusing contract; setup docs recommend `npx @samouraiworld/dao-analyst-mcp@latest` (unpinned agent supply chain). MCP servers + `packages/gno-rpc` have **no CI** (tests exist locally only). | `mcp-server-dao-analyst/README.md:29,67-75`; `backend/cmd/memba/main.go:234,425-437` |
| **INF-4** | **P2** | Stale `test12` defaults in `docker-compose.yml:34-35` and `frontend/Dockerfile:13-14` vs prod test13; branch protection / CODEOWNERS appears convention-only (single owner `* @zxxma`); `golangci-lint` path mismatch between CI and deploy workflows. | as cited |
| **INF-5** | **P3** | `docs/API.md` documents ~10 RPCs; proto defines 30+. `docs/AGENTIC.md` omits the dao-analyst MCP. Test-count claims diverge across `README` (3200+), `ROADMAP` (2,399), `DISCLAIMER` (1,777+). Lighthouse non-blocking; frontend coverage uploaded but not gated. | `docs/API.md`; `docs/AGENTIC.md:47`; `DISCLAIMER.md:14` vs `ROADMAP.md:14` |

> **Positive controls:** E2E *is* in CI (Playwright), Buf breaking checks, dependency-review on PRs, `npm audit --audit-level=high`, bundle budget, AAA feature-flag safety gates, dependabot grouping, real `SECURITY.md` disclosure process (`security@samourai.coop`, 48h ack). Memba's CI is materially more mature than a typical alpha; the gaps are pinning and SAST labeling.

### 4.5 Cross-cutting themes (the "why" behind the findings)

1. **Generator ↔ deployed drift.** The single most dangerous *systemic* pattern: in-repo templates diverge from canonical `samcrew-deployer` source (agent_registry hardened in repo / unhardened live; escrow refund functions in builders / absent in generator; candidature simplified). There is no automated parity check, and `realm-versions.json` does not pin the deployer commit SHA. **Consequence:** the repo cannot reproduce what is on-chain, and "fixed in template" ≠ "fixed on-chain."
2. **Flags that protect, held off.** Two of the strongest controls are *already implemented and disabled in prod* (multisig sig enforcement BE-2; the offers allowlist gate as the only thing standing between CHN-1 and live funds). Security that depends on an env var staying unset is one misconfiguration from breach.
3. **The money UI is the least-tested UI.** Multisig pages (FE-6) and fund-handling Gno (CHN-10) have the weakest test coverage in the repo, inverting where rigor should concentrate.
4. **Breadth as a risk multiplier.** Each new realm/marketplace engine is a new immutable fund surface with its own ACL, fee, and settlement logic. The product is adding these faster than it is adding Gno-level fund tests.

---

## 5. The AAA implementation plan

**Governing principle:** *Stop the bleeding, prove it with tests, then expand.* Work is organized into five waves. **Waves are dependency-ordered, not time-boxed.** Wave 0 and Wave 1 are a hard gate: no net-new fund-handling realm ships until both close.

### Wave 0 — Stop fund-loss & auth-integrity bleeding (release gate)

> Blast radius: 2 Gno files + 3 backend handlers + 2 config flags. Invasiveness: surgical. Risk: low (mostly flipping already-built controls + quarantining a stub). **Nothing here adds features.**

| Task | Addresses | Concrete change | Acceptance criteria |
|------|-----------|-----------------|---------------------|
| **W0.1 Quarantine the offers stub** | CHN-1 | Replace `AcceptFloorOffer`'s simulated body with `panic("not implemented")` (so it can never silently strand funds), OR move `offers.gno` out of `contracts/` into a clearly-marked `unsafe/` design sketch. Add a CI assertion that `memba_nft_offers_v1` is absent from every `REALM_ALLOWLIST` and that the two NFT offer modals remain gated. | `gno test` shows no settlement path that removes an offer without a transfer+payment+refund; CI fails if the realm is allowlisted; modals unreachable in built app. |
| **W0.2 Enforce multisig signature verification** | BE-2 | Set `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` in `fly.toml`; first run a one-time log-analysis to confirm the `multisig_sig_verify` mismatch rate is ~0 for legitimate clients (avoid lockout). Add a regression test asserting an invalid signature is rejected when enforcement is on. | Invalid sig → `CodeInvalidArgument`; valid sig → stored; prod metric `multisig_sig_verify{result="mismatch"}` ≈ 0 before flip. |
| **W0.3 Lock down `MultisigInfo`** | BE-1 | Add the same joined-membership check used by `GetTransaction` before returning pubkey/members. | Non-member authed request → `CodePermissionDenied`; member → full info; unit test for both. |
| **W0.4 Verify completion hash** | BE-3 | In `CompleteTransaction`, query the chain (`/tx` or `abci_query`) to confirm the supplied `final_hash` corresponds to a committed tx for this multisig/sequence before persisting; reject otherwise. (Interim hardening if on-chain lookup is heavy: store hash as *claimed*, mark `verified=false`, and reconcile via the existing indexer.) | Fabricated hash → rejected (or stored unverified, never surfaced as confirmed); real hash → confirmed. |
| **W0.5 Close quest XP farming** | BE-4 | Change the `default`/`off_chain` branch from auto-accept to require proof or on-chain verification; for genuinely off-chain quests, gate XP behind admin attestation (reuse the existing attestation voucher flow). | `CompleteQuest`/`SyncQuests` for an `off_chain` quest without proof → no XP granted; test covers it. |
| **W0.6 Boot guard on unsigned auth** | BE (conditional P0) | If `FLY_APP_NAME` is set and `MEMBA_ALLOW_UNSIGNED_AUTH=1`, refuse to start. Add Fly-secrets inventory check to the deploy runbook. | Server panics/exits on misconfig in prod; documented in `SECRETS_ROTATION.md`. |

**Wave 0 Definition of Done:** all six tasks merged with tests; a short signoff report (mirroring the existing `v7.1-phaseN-signoff.md` shape) recording the pre-flip `multisig_sig_verify` mismatch metric and the Fly-secrets assertion.

### Wave 1 — Governance correctness & generator/deployed parity

> Blast radius: DAO/escrow/board/candidature generators + a new parity-check harness + realm-versions schema. Invasiveness: moderate (touches generated Gno semantics — requires Gno-level tests). Risk: medium (governance semantics are subtle; changes are immutable-on-deploy).

| Task | Addresses | Concrete change | Acceptance criteria |
|------|-----------|-----------------|---------------------|
| **W1.1 DAO voting hardening** | CHN-4, CHN-5 | (a) Apply `assertRole` to every role in `executeAddMember`. (b) Introduce a minimum voting-period floor (`MinVotingBlocks`) so a proposal cannot finalize before it elapses, OR make finality explicit (`Finalize()` callable after period/quorum) instead of inline-on-vote. (c) Make reject threshold symmetric and document the supermajority semantics. (d) Decide ABSTAIN semantics explicitly (quorum-only is fine, but document it). | New `*_test.gno` (or extended TS structural+compile tests) simulating: early-vote-lock prevented; arbitrary role rejected; symmetric pass/reject at boundary; abstain behavior asserted. |
| **W1.2 Escrow refund/timeout completeness** | CHN-2, CHN-9 | Implement `ClaimRefund` + dispute-timeout in `generateEscrowCode` to match the calls `marketplace/builders.ts` already emits; wire `AutoRefundBlocks`/`autoResolveBlocks`; add `isValidGnoAddress` validation on admin/fee fields inside the generator; reconcile fee constants (2% vs 2.5%) into one source of truth. | Builders and generated source are call-compatible (a test asserts every builder target exists in generated code); CEI preserved; address validation unit-tested; single fee constant. |
| **W1.3 Generator↔deployed parity harness** | Cross-cut #1, CHN-6/7/8 | Build a CI job that, for each realm, diffs the in-repo generator output / stub against the canonical `samcrew-deployer` source (vendored or submoduled at a pinned SHA) and fails on drift. Record the deployer commit SHA + gno toolchain commit in `realm-versions.json` (fill `pendingFields`). | CI red on any generator/deployed divergence; `realm-versions.json` reproducibly maps repo→on-chain. |
| **W1.4 Board template fix** | CHN-7 | Export `IsMember()` from generated DAO (or change board to a supported cross-realm member check); make `templates.compile.test.ts` **non-skippable in CI** by ensuring `gno` is installed in the CI image. | Board+DAO pair compiles in CI (gate cannot silently skip). |
| **W1.5 Offers engine — correct or delete** | CHN-1, CHN-3, CHN-10 | If floor offers stay on the roadmap: implement real settlement (`MarketTransfer` + `SplitProceeds` + fee + refund-on-failure, CEI-ordered), enforce `MaxOffers*`, add `SetPaused` admin, unify caller guards, and write `offers_test.gno` covering accept/cancel/expire/refund and the fee math. Otherwise delete the stub (W0.1 already neutralized it). | If kept: full `offers_test.gno` green incl. fund-conservation invariant (sum of refunds+payouts+fees == escrowed). |
| **W1.6 agent_registry redeploy** | CHN-6 | Redeploy `agent_registry` from the hardened template to a new path; update `realm-versions.json`; deprecate the unhardened test12 instance in the allowlist. | Live `UseCredit` rejects non-creator/non-admin; allowlist points at the new path. |

**Wave 1 DoD:** every fund-handling Gno path has a Gno-level test asserting **fund conservation** and **access control**; parity harness green; signoff report.

### Wave 2 — Backend & frontend hardening

> Blast radius: backend middleware/config + frontend auth/render/test scaffolding. Invasiveness: low–moderate. Risk: low.

| Task | Addresses | Change | Acceptance |
|------|-----------|--------|------------|
| **W2.1 Token revocation + chain-id grace sunset** | BE-5 | Add a server-side token nonce/jti denylist (in-DB) for logout/rotation; set a date to drop the empty-`chain_id` grace window. | Revoked token rejected; legacy-token acceptance removed after sunset; tests. |
| **W2.2 Lock `/metrics` + remove hardcoded admin** | BE-6, BE-7 | Set `METRICS_BEARER` in Fly; require `QUEST_ADMIN_ADDRESSES` (fail-closed if unset in prod) instead of a baked-in default. | `/metrics` 401 without bearer; no admin fallback in prod. |
| **W2.3 Proxy/OAuth hardening** | BE-8 | Regex-validate render-proxy `realm`; move GitHub OAuth code exchange to POST/body; document `TRUSTED_PROXY` invariant + add a self-check that warns if running without the Fly edge. | Malformed realm rejected; code no longer in query string; tests. |
| **W2.4 DB integrity** | BE-9 | Add FK `transactions → multisigs` (migration); evaluate moving NFT tailer to a separate read replica/connection or serializing via a write queue to cut contention. | Orphan tx impossible; contention metric improves under load test. |
| **W2.5 Auth token storage hardening** | FE-1, FE-2 | Move the auth token to an in-memory + short-lived pattern (or at minimum reduce TTL and add refresh); make the unsigned fallback a hard client-side block when a pubkey is available. | Token not readable from `localStorage` after change (or TTL ≤ short window); declined-sign blocks login; tests. |
| **W2.6 Unify the render/sanitize pipeline** | FE-3, FE-4 | Single `renderSafeMarkdown()` helper that always escapes-then-renders-then-DOMPurifies; replace all 8 `dangerouslySetInnerHTML` sites; tighten CSP `img-src` to the specific origins actually needed (gateway + data:). | One pipeline; sanitize-regression suite extended to cover every call site; CSP test updated. |
| **W2.7 Multisig UI unit tests** | FE-6 | Add Vitest coverage for `ProposeTransaction`, `TransactionView`, `MultisigView`, `Create/Import` (tx assembly, signature combine, threshold math, error states). Add Vitest coverage thresholds to `vite.config.ts`. | Money-path UI logic covered; CI enforces a frontend coverage floor. |

### Wave 3 — Supply chain, CI/SAST, MCP, docs truth

> Blast radius: `.github/workflows`, MCP packages, docs. Invasiveness: low. Risk: low. High leverage.

| Task | Addresses | Change | Acceptance |
|------|-----------|--------|------------|
| **W3.1 Pin everything that deploys** | INF-1 | SHA-pin `setup-flyctl`; pin `govulncheck`/`golangci-lint`/`gno`/`gosec` to explicit versions consistently across all workflows; reconcile govulncheck version between `ci.yml` and `govulncheck.yml`. | No `@latest`/`@master` in any workflow that holds a secret or gates a deploy. |
| **W3.2 Real SAST** | INF-2 | Add `github/codeql-action` for JavaScript/TypeScript (+ keep gosec for Go); rename the workflow so the README badge is truthful, or update the badge. | CodeQL JS/TS runs on PR; badge matches reality. |
| **W3.3 MCP/packages in CI + auth doc fix** | INF-3 | Wire `mcp-server`, `mcp-server-dao-analyst`, `packages/gno-rpc` into CI (lint+test+build); fix the dao-analyst "free tier" docs to match the auth requirement; pin the recommended `npx` invocation. | CI covers all packages; docs match `/api/analyst` auth. |
| **W3.4 Config hygiene** | INF-4 | Replace stale `test12` defaults in `docker-compose.yml`/`frontend/Dockerfile` with test13; fix the `golangci-lint` path mismatch; document branch-protection rules + expand CODEOWNERS per-path; capture an immutable branch-protection evidence artifact. | No stale network defaults; CODEOWNERS scoped; protection documented. |
| **W3.5 Documentation truth pass** | INF-5 | Regenerate `docs/API.md` from the proto (all 30+ RPCs); add dao-analyst to `AGENTIC.md`; reconcile the test-count claims to a single CI-derived number surfaced in `README`. | Docs match code; one canonical test count. |

### Wave 4 — Structural debt & resilience (continuous)

> Not gating, but compounding value. Tackle opportunistically once Waves 0–3 close.

- **Decompose god-files** (`validators.ts`, `channelTemplate.ts`, `Layout.tsx`) into typed, testable modules; drive down the ~63 `any` usages; re-enable the disabled React-Compiler hook rules file-by-file behind tests (FE-5).
- **Remove dead deps** (`remotion*`), lazy-load `recharts`, fix the prefetch-timer cleanup (FE-7).
- **Backend layering:** introduce a thin repository layer + a global auth interceptor so authorization can't be forgotten on new RPCs (BE-10); add request-context to `abciQuery`.
- **HA story for SQLite/Fly** (single-machine today): document RTO/RPO, validate Litestream restore on a clean boot, consider a read replica for the indexer.
- **Gno fuzz/property tests** for fee math and vote tallies; extend `FuzzMakeADR36SignDoc`-style fuzzing to the template sanitizer.

---

## 6. Sequencing & dependency graph

```
W0 (fund-loss + auth integrity)  ──┐  [HARD GATE — must fully close]
                                   │
W1 (governance + parity) ◄─────────┘  depends on W0.1 (offers decision)
   │  W1.3 parity harness unblocks safe future realm deploys
   ▼
W2 (backend/frontend hardening)    can start in parallel with W1 (no shared files except config)
   │
W3 (supply chain / SAST / docs)    independent; do early — cheapest risk reduction, unblocks trustworthy CI for W0–W2 verification
   │
W4 (structural debt)               continuous, non-gating
```

**Recommended actual order of execution:** **W3.1 + W3.2 first** (make CI trustworthy and reproducible — cheap, unblocks confident verification of everything else), then **W0** (stop bleeding), then **W1** + **W2** in parallel, then the rest of **W3**, then **W4** continuously.

---

## 7. Quality gates / Definition of Done (applies to every wave)

A change is "AAA done" only when:

1. **Tested at the right layer** — fund logic has a Gno test asserting fund conservation + access control; backend auth has a rejection test; frontend money-path has a unit test. No fix lands on assertion alone.
2. **Reproducible CI** — pinned tooling; the gate that would have caught the class of bug now exists (e.g., parity harness for drift, non-skippable compile gate for board).
3. **No new immutable surface without a parity entry** — every deployed realm has a `realm-versions.json` entry with deployer SHA + toolchain commit.
4. **Docs match code** — proto-derived API docs, accurate badges, single test-count source.
5. **Signoff artifact** — an immutable per-wave report (goal vs outcome, PRs, metrics, residual risk), matching the existing `docs/reports/v7.1-phaseN-signoff.md` convention the team already practices.

---

## 8. What is explicitly *out of scope* / deferred

- A **formal third-party security audit** of the on-chain realms before any mainnet/value-bearing deployment. This document reduces risk and makes such an audit cheaper; it does not replace it. The `DISCLAIMER.md` "unaudited" posture must remain until that happens.
- **New marketplace engines** (auctions, sweeps, the floor-offers engine if not completed in W1.5) — frozen until Wave 0+1 close per the governing principle.
- **Mainnet custody/M-of-N finalization** — already tracked in `MAINNET_PREPARATION.md`; a hard prerequisite gated outside this plan.

---

## 9. Appendix — verification log (what I personally confirmed vs. reported)

Directly read and confirmed at source (not just reported by sub-audits):

- **BE-1** `MultisigInfo` — confirmed only `authenticate()`, no membership check (`multisig_rpc.go:163-213`).
- **BE-2** — confirmed log-only branch and enforcement flag (`tx_rpc.go:337-349`).
- **BE-3** — confirmed `final_hash` persisted after threshold check only, no chain verification (`tx_rpc.go:365-427`).
- **CHN-1** — confirmed `AcceptFloorOffer` removes offer + emits event with a `// Simulate` settlement comment, no transfer/payment/refund (`offers.gno:126-155`); confirmed inconsistent caller guards and unenforced `MaxOffers*` (`:51-55,98,21-26`).
- **CHN-5** — confirmed inline finality + asymmetric thresholds in `VoteOnProposal` (`daoTemplate.ts:451-461`).
- **Exposure nuance** — confirmed `memba_nft_offers_v1` absent from `REALM_ALLOWLIST.test13` (`config.ts:216-245`) and present only in design docs as a post-audit deploy.

Domain sub-audits (frontend, backend, Gno/codegen, infra) produced the remaining `file:line` evidence; spot-checks were consistent with their reports.

---

*Prepared as a cross-perspective audit (Security · Engineering · UX/Product · Governance) and reviewed through a CTO lens. The plan is intentionally dependency-ordered and effort-described in technical terms rather than calendar time, so it can be executed by autonomous agents or humans without re-baselining.*
