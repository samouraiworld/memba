# Memba V6 — AAA SWE Implementation Plan

> **Date:** 2026-04-16
> **Revision:** v2 (post triple cross-review: CTO, Security Architect, Gno Core Engineer)
> **Author:** CTO Expert Panel synthesis (26 expert perspectives across 6 specialized panels + 3 independent cross-reviewers)
> **Methodology:** 6 parallel expert panels → synthesis → 3 independent cross-reviews → corrections incorporated → final plan
> **Scope:** Post-v5 full-stack assessment: security, architecture, UX, Gno compatibility, ecosystem, community
> **Baseline:** v5.0 merged (PR #292), 1,628 tests, 88 security fixes shipped, branch `fix/security-audit-v5-realm-fixes` (4 commits ahead of main)

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Panel Findings Summary](#2-panel-findings-summary)
3. [Consolidated Issue Registry](#3-consolidated-issue-registry)
4. [Implementation Plan](#4-implementation-plan)
   - Phase 0: Critical Security — Same-Day Hotfix (Days 1-2)
   - Phase 1a: Infrastructure & CI (Days 3-8)
   - Phase 1b: Gno Templates & Realms (Days 9-16)
   - Phase 2: UX & Quality (Days 12-22) — overlaps 1b, see parallelization notes
   - Phase 3: Ecosystem & Community (Days 23-30)
   - Phase 4: Release (Days 31-35)
5. [Architecture Decisions](#5-architecture-decisions)
6. [Risk Assessment](#6-risk-assessment)
7. [Roadmap Realism (6-Month View)](#7-roadmap-realism)
8. [Appendix A: Expert Panel Roster](#appendix-a-expert-panel-roster)
9. [Appendix B: Cross-Reference Matrix](#appendix-b-cross-reference-matrix)

---

## 1. Executive Summary

Memba v5.0 shipped 88 fixes across 14 P0 critical vulnerabilities and is the most feature-complete DAO governance platform in the Gno ecosystem. This V6 plan addresses the **next layer of issues** discovered by 6 independent expert panels (26 perspectives total):

### Key Findings

> *v3 correction: Counts updated to reflect cross-review additions and severity adjustments.*

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Security | 6 | 7 | 9 | 2 | 24 |
| Architecture | 1 | 3 | 6 | 5 | 15 |
| UX/Accessibility | 0 | 5 | 18 | 10 | 33 |
| Gno Ecosystem | 4 | 2 | 2 | 0 | 8 |
| DeFi/Governance | 1 | 1 | 5 | 6 | 13 |
| Community/OSS | 0 | 0 | 4 | 8 | 12 |
| Testing/CI | 0 | 2 | 0 | 1 | 3 |
| **Total** | **12** | **20** | **44** | **32** | **108** |

### Top 5 Urgent Actions

1. **AUTH-01**: ADR-036 signature verification is bypassed — pubkey-without-signature path is a **zero-click account takeover** (same-day hotfix required)
2. **SEC-01**: Remove eval proxy (`/api/eval`) entirely — arbitrary on-chain state enumeration
3. **SEC-02**: IPFS upload endpoint has no authentication — API key abuse at scale
4. **SEC-NEW-01**: JSON injection in `abciQuery` via `fmt.Sprintf` — must use `json.Marshal`
5. **GNO-NEW-01**: AVL import path split (`p/demo/avl` vs `p/nt/avl/v0`) — blocks all template deployments

### Overall Architecture Grade: **B+** (up from B in v5 after 88 fixes)

The hybrid ABCI-direct + ConnectRPC backend architecture is sound. The main risks are concentrated in three areas:
1. Unauthenticated backend endpoints exposing third-party API keys
2. Frontend auth relying on pubkey presence without signature verification
3. Gno realm scalability (Render() pagination, template data structures)

### Cross-Review Corrections (v2)

Three independent cross-reviewers validated the plan and identified:
- **7 new security vulnerabilities** missed by all 6 panels (JSON injection, open ABCI relay, expression injection, ConnectRPC body limit, marketplace ID injection, no token revocation, LLM prompt injection)
- **3 severity adjustments**: SEC-04 CRITICAL→HIGH (AllowCredentials:false), SEC-05 CRITICAL→MEDIUM (feature-gated), SEC-08 HIGH→MEDIUM
- **1 promotion**: DEFI-01 (escrow dispute) HIGH→CRITICAL (direct fund loss vector)
- **1 new GNO P0**: AVL import path inconsistency across templates vs deployed contracts
- **Timeline correction**: 28 days → 35-40 days (Phase 1 split into 1a infrastructure + 1b Gno work)
- **AD-01 correction**: Investigate `signArbitrary` before committing to signAmino (better UX)
- **SEC-01 correction**: Remove `/api/eval` entirely rather than auth-gate it
- **Missing from plan**: CSRF protection, secrets rotation runbook, incident response for AUTH-01, memory budget for 256MB VM

---

## 2. Panel Findings Summary

### Panel 1: CTO + Senior Fullstack Engineer
- 17 findings: ADR-036 bypass (P0), SQLite single-point-of-failure (P0), backup on same volume (P1), no page component tests (P1), monolithic pages (P1), deploy CI skips tests (P1), IPFS no auth (P1), fragmented state management (P2), bundle weight (P2), contract stubs drift (P2), 46 CSS files without modules (P2), ED25519 startup guard (P2), cosmos-sdk heavy dep (P3), render proxy no cache (P3), E2E no TX flows (P3), gno lint ignored (P3), rate limiter memory (P3)

### Panel 2: CSO + Black Hat Team
- 17 findings: Eval proxy unauthenticated (CRITICAL), IPFS upload no auth (HIGH), analyst no auth (HIGH), CORS wildcard pattern (HIGH), OriginSend verification needed (HIGH), single admin SPOF (HIGH), CSP unsafe-inline (MEDIUM), NFTGallery post-sanitization XSS (MEDIUM), ED25519 no rotation (MEDIUM), localStorage auth token (MEDIUM), candidature bio unsanitized (MEDIUM), channels unsanitized render (MEDIUM), Fly.io cold start DoS (MEDIUM), render proxy path sanitization (MEDIUM), X-Forwarded-For spoofing (LOW), escrow MaxContracts DoS (LOW)

### Panel 3: UX/UI Expert + Desktop/Mobile Users
- 31 findings: No 320px breakpoint (BLOCKS), air-gapped sig hidden (BLOCKS), no `:focus-visible` styles (BLOCKS), sidebar information overload (DEGRADES), mobile bottom sheet UX (DEGRADES), ProposeDAO 52 inline styles (DEGRADES), no vote confirmation dialog (DEGRADES), command palette no ARIA (DEGRADES), onboarding no back button (DEGRADES), skeleton loaders theme-broken (DEGRADES), ErrorToast stacking (DEGRADES), no optimistic updates for voting (DEGRADES), ConnectingLoader blocks content (DEGRADES), dual design token systems (COSMETIC), hardcoded hex colors (COSMETIC)

### Panel 4: Gno Core + VM Engineers + DevRel
- 7 critical items: Template-generated DAOs use slices not AVL (P0), Render() needs pagination (P0), import path audit needed (P0), `gno build` CI for templates (P1), cross-realm membership gap documentation (P1), gnodaokit extraction (P2), review storage pattern optimization (P2)

### Panel 5: DeFi/DAO/Blockchain Experts + Users
- 31 findings: NFT non-atomic buy (HIGH), escrow dispute bias toward freelancer (HIGH), wallet onboarding gap (HIGH), terminology overload for non-tech users (HIGH), multi-DAO batch voting absent (MEDIUM), treasury view-only (MEDIUM), GRC20 fee client-side only (MEDIUM), no delegation (MEDIUM), voting period block-based not time-based (MEDIUM), no AMM/swap (LOW), DAO wizard missing governance models (LOW), validator dashboard missing slashing data (LOW)

### Panel 6: OSS Contributors + DevRel + Manfred/Jae Perspectives
- 12 recommendations: Extract gnodaokit as community package, add coverage reporting, publish gno-rpc to npm, standardize package manager, create good-first-issue labels, replace cosmos-sdk dependency, document progressive decentralization, move profiles/quests on-chain, add "View Generated Code" to wizard, publish MCP to npm directory, reconcile Node version in docs, add integration test suite

---

## 3. Consolidated Issue Registry

Issues are deduplicated and assigned canonical IDs. Cross-references to panel findings are in Appendix B.

### CRITICAL (12 issues — fix before any deployment)

> *v2 update: 3 new critical issues added from cross-reviews. SEC-04 downgraded to HIGH. SEC-05 downgraded to MEDIUM. DEFI-01 promoted to CRITICAL.*

| ID | Issue | Panels | Impact |
|----|-------|--------|--------|
| **AUTH-01** | ADR-036 signature verification bypassed — empty signature accepted, pubkey-only auth. **ZERO-CLICK ACCOUNT TAKEOVER.** | CTO P0-1, Security XR | Any user's auth token forgeable with their public key |
| **SEC-01** | Eval proxy `/api/eval` unauthenticated — arbitrary qeval on any realm. **REMOVE ENTIRELY.** | CSO #1, Security XR | Full on-chain state enumeration via Memba's backend |
| **SEC-02** | IPFS upload `/api/upload/avatar` unauthenticated | CSO #2, CTO P1-5 | Lighthouse API key abuse, quota exhaustion |
| **SEC-03** | DAO Analyst `/api/analyst/analyze` unauthenticated | CSO #3 | LLM provider quota burn, DoS for legitimate users |
| **SEC-NEW-01** | JSON injection in `abciQuery` via `fmt.Sprintf` — user-controlled data can break JSON-RPC payload | Security XR MISSED-01 | Potential SSRF / JSON-RPC parameter injection |
| **DEFI-01** | Escrow dispute auto-resolves for freelancer — **direct fund loss** | DeFi HIGH→CRITICAL (CTO XR) | Malicious freelancer delivers nothing, waits timeout, drains escrow |
| **GNO-01** | Template-generated DAOs use `[]Member`/`[]Proposal` slices (O(n)). **Scope: also boardTemplate and channelTemplate threads.** | Gno P0, Gno XR | Gas DoS at 100+ members, unusable at 500+ |
| **GNO-02** | All realm Render() functions iterate entire data sets (no pagination). **Also includes DAO template renderHome().** | Gno P0, Gno XR | Gnoweb DoS at 200+ threads/contracts/agents |
| **GNO-03** | Import paths (`chain/runtime`, `chain/banker`) may break on betanet | Gno P0 | All realms and templates fail on new chains |
| **GNO-NEW-01** | AVL import path split: templates use `p/demo/avl`, deployed contracts use `p/nt/avl/v0` — **blocks all template deployments** if target chain has only one path | Gno XR | Template-generated realm deploy fails on test12 |
| **SEC-NEW-04** | LLM prompt injection — analyst passes user-controlled prompts directly to LLM providers | Security XR MISSED-07 | AI verdict manipulation, general-purpose LLM proxy abuse |
| **SEC-NEW-03** | ConnectRPC handler has no body size limit | Security XR MISSED-04 | Memory exhaustion DoS on 256MB VM |

### HIGH (21 issues — fix this sprint)

> *v2 update: SEC-04 moved from CRITICAL to HIGH. SEC-05 moved from CRITICAL to MEDIUM. DEFI-01 promoted to CRITICAL. 4 new findings added from cross-reviews.*

| ID | Issue | Panels | Impact |
|----|-------|--------|--------|
| **INFRA-01** | SQLite backups on same Fly.io volume as production | CTO P1-1 | Volume failure = total data loss |
| **INFRA-02** | `min_machines_running=0` — cold start DoS | CTO P0-2, CSO #14 | 3-8s first-request latency, perpetual unavailability under attack |
| **INFRA-03** | Deploy-frontend CI skips tests | CTO P1-4 | Broken frontend can deploy to production |
| **SEC-04** | CORS wildcard `https://*--memba-multisig.netlify.app` | CSO #4 | ~~CRITICAL~~ → HIGH (Security XR: AllowCredentials:false limits impact) |
| **SEC-06** | X-Forwarded-For spoofing bypasses rate limits | CSO #16 | All rate limiting defeated by header injection |
| **SEC-07** | CSP `unsafe-inline` negates XSS protection | CSO #8 | Any injection vector becomes exploitable |
| **SEC-08** | Auth token in localStorage — XSS exfiltration | CSO #11 | ~~HIGH~~ → MEDIUM (Security XR: standard SPA pattern, requires pre-existing XSS). **But: add token revocation mechanism (SEC-NEW-05)** |
| **SEC-09** | Candidature bio/skills unsanitized in Render() | CSO #12 | Markdown injection via gnoweb |
| **SEC-10** | Channels thread/reply content unsanitized in Render() | CSO #13 | Markdown injection via gnoweb |
| **SEC-11** | Render proxy path param unsanitized | CSO #15 | Potential JSON-RPC confusion |
| **SEC-12** | Single admin key for all realm operations (SPOF) | CSO #7 | Total system compromise on key loss |
| **SEC-NEW-02** | Marketplace agentID query param injection into render path | Security XR MISSED-05 | Path traversal in ABCI queries |
| **SEC-NEW-05** | No token revocation mechanism — compromised tokens valid for full 24h | Security XR MISSED-06 | No way to invalidate stolen sessions |
| **UX-01** | No `:focus-visible` styles — keyboard users blocked | UX F7.1 | WCAG 2.1 AA violation, inaccessible |
| **UX-02** | No 320px breakpoint — small devices overflow | UX F2.1 | Content cut off on older/small devices |
| **UX-03** | Air-gapped signature paste is hidden/secondary | UX F6.1 | Core multisig feature undiscoverable |
| **UX-04** | No vote confirmation dialog — irreversible on-chain action | UX F5.2 | Accidental votes with gas cost |
| **GNO-04** | `gno build` not in CI for template-generated code | Gno P1 | Templates can produce uncompilable Gno code |
| **DEFI-02** | GRC20 fee is client-side only, bypassable via gnokey | DeFi MEDIUM | Revenue loss, unfair advantage for CLI users |
| **TEST-01** | No page component tests (0 of 44 pages tested) | CTO P1-2 | Financial transaction paths completely uncovered |
| **TEST-02** | No coverage reporting in CI | OSS #2 | No visibility into testing gaps |

### MEDIUM (34 issues)

| ID | Issue | Panels |
|----|-------|--------|
| **SEC-13** | ED25519_SEED no rotation mechanism | CSO #10, CTO P2-5 |
| **SEC-14** | OriginSend() semantics need re-verification on deployed chain | CSO #5-6 |
| **SEC-15** | Escrow MaxContracts=500 global DoS | CSO #17 |
| **ARCH-01** | Fragmented state management (localStorage/sessionStorage/useState) | CTO P2-1 |
| **ARCH-02** | Monolithic page components (6 pages > 500 LOC) | CTO P1-3 |
| **ARCH-03** | 46 CSS files without CSS Modules | CTO P2-4 |
| **ARCH-04** | Contract stubs may drift from deployed realms | CTO P2-3 |
| **ARCH-05** | cosmos-sdk dependency is heavy (80+ transitive deps) | CTO P3-1, OSS #6 |
| **ARCH-06** | Remotion for landing page animations is heavyweight | CTO P2-2 |
| **ARCH-07** | Dual design token systems (`tokens.css` vs `index.css` Kodera) | UX F8.2 |
| **UX-05** | ProposeDAO has 52 inline style declarations | UX F8.1 |
| **UX-06** | Mobile bottom sheet missing swipe-to-dismiss | UX F2.4 |
| **UX-07** | Onboarding wizard no back button | UX F4.1 |
| **UX-08** | Command palette no ARIA combobox/listbox pattern | UX F3.2 |
| **UX-09** | Skeleton loaders use hardcoded dark-mode colors | UX F7.2 |
| **UX-10** | ErrorToast stacking (multiple errors overlap) | UX F9.1 |
| **UX-11** | No optimistic updates for voting/signing | UX F10.2 |
| **UX-12** | ConnectingLoader blocks entire content for 10s | UX F10.3 |
| **UX-13** | Proposal templates show raw markdown in textarea | UX F5.1 |
| **UX-14** | "Awaiting execution" unclear for non-technical users | UX F5.3 |
| **UX-15** | CreateMultisig pubkey error message too technical | UX F6.4 |
| **UX-16** | Bottom sheet inline styles break light theme | UX F2.3 |
| **UX-17** | Broadcast failure error suggests CLI with no guidance | UX F9.3 |
| **UX-18** | Terminology overload (GRC20, ABCI, realm path, ugnot) | DeFi HIGH |
| **UX-19** | No batch voting across multiple DAOs | DeFi MEDIUM |
| **UX-20** | Voting period shows block numbers, not estimated dates | DeFi MEDIUM |
| **UX-21** | Realm path input should auto-generate from DAO name | DeFi MEDIUM |
| **UX-22** | No "What is a DAO?" explanation in wizard | DeFi MEDIUM |
| **GNO-05** | Cross-realm membership sync gap (channels/candidature vs DAO) | Gno P1 |
| **GNO-06** | Review storage as slice values in AVL (expensive at scale) | Gno P2 |
| **OSS-01** | No `good first issue` labels or curated entry points | OSS #5 |
| **OSS-02** | Mixed package managers (pnpm workspace + npm in frontend) | OSS #4 |
| **OSS-03** | Node version inconsistency across docs (20 vs 22) | OSS #11 |
| **OSS-04** | No generated API docs from proto comments | OSS DevRel #2 |

### LOW (26 issues — backlog)

| ID | Issue | Panels |
|----|-------|--------|
| **ARCH-08** | Rate limiter memory growth unbounded | CTO P3-5 |
| **ARCH-09** | Gno lint failures silently ignored in CI (`\|\| true`) | CTO P3-4 |
| **ARCH-10** | E2E can't test TX flows without Adena mock | CTO P3-3 |
| **ARCH-11** | Render proxy no caching (open relay to Gno RPC) | CTO P3-2 |
| **UX-23** | Command palette shows no per-command shortcuts | UX F3.3 |
| **UX-24** | Mobile tab bar "Home" disappears when connected | UX F2.5 |
| **UX-25** | Onboarding wizard doesn't mention Cmd+K | UX F4.2 |
| **UX-26** | No empty states for DAOList/TokenDashboard/MultisigHub | UX F9.2 |
| **UX-27** | Sidebar collapse not responsive at 1024px | UX F3.1 |
| **UX-28** | "Already Signed" button looks enabled when disabled | UX F6.3 |
| **UX-29** | Broadcast button hardcoded color breaks light theme | UX F6.2 |
| **UX-30** | Skeleton loaders don't match final layout | UX F10.1 |
| **DEFI-03** | No delegation mechanism | DeFi LOW |
| **DEFI-04** | Proposal enrichment capped at 10 | DeFi LOW |
| **DEFI-05** | No AMM/swap/liquidity features post-token-creation | DeFi LOW |
| **DEFI-06** | Missing validator slashing data | DeFi MEDIUM |
| **DEFI-07** | Missing validator set change notifications | DeFi INFO |
| **DEFI-08** | No DAO-to-DAO interaction | DeFi INFO |
| **DEFI-09** | No upgrade path for deployed template DAOs | DeFi LOW |
| **DEFI-10** | No "my validator" pinned view | DeFi MEDIUM |
| **OSS-05** | DISCLAIMER.md test count stale ("285" vs 1,588) | OSS #1 |
| **OSS-06** | CODEOWNERS is single person (bus factor = 1) | OSS #1 |
| **OSS-07** | No Storybook or component showcase | OSS DevRel #3 |
| **OSS-08** | Publish gno-rpc package to npm | OSS DevRel #1 |
| **OSS-09** | Publish DAO Analyst MCP to npm + MCP directory | OSS DevRel #5 |
| **OSS-10** | Add "View Generated Code" step to DAO wizard | OSS Jae #2 |

---

## 4. Implementation Plan

### Parallel Track Structure (per CTO recommendation)

```
Track A: Security & Auth      ─── Days 1-10 ──────────────────────────►
Track B: Infrastructure       ─── Days 1-10 ──────────────────────────►
Track C: UX & Accessibility   ────────────── Days 11-18 ─────────────►
Track D: Gno & Ecosystem      ────────────── Days 11-25 ─────────────►
Track E: Community & Polish   ─────────────────────────── Days 19-28 ─►
```

### Phase 0: Critical Security — SAME-DAY HOTFIX (Day 1-2)

**Goal:** Eliminate all attack vectors that allow impersonation, data exfiltration, or API key abuse.
**Urgency:** AUTH-01 is a zero-click account takeover. Do not deploy any other changes until this is patched.

#### V5 Overlap Clarification

> *v3 addition (CTO #2 cross-review): V5's P0-14 removed the **address-only** auth path (`crypto.go:221-233`). V6's AUTH-01 addresses a **separate bypass** where the pubkey+empty-signature path still issues tokens without cryptographic proof. These are different code paths targeting different attack vectors.*

#### Step 0.0: Incident Assessment (Before coding — 30 min)

> *Added by CTO cross-review: AUTH-01 may already have been exploited.*

- [ ] Audit backend logs for auth token issuance with empty-signature requests
- [ ] Determine if any forged tokens are currently active
- [ ] Plan: after AUTH-01 fix, rotate `ED25519_SEED` to invalidate ALL existing tokens
- [ ] Document rotation procedure: generate new seed → redeploy → all sessions invalidated
- [ ] Notify users that all sessions will be invalidated (testnet — acceptable scope)

#### Step 0.1: Auth Bypass Fix (AUTH-01) — DAY 1, FIRST THING

**Problem:** `crypto.go:206` accepts empty signature when Adena returns `UNSUPPORTED_TYPE` for `sign/MsgSignData`. The frontend sends `""` as signature. Backend skips verification. **Anyone who knows a target's public key (publicly on-chain) can forge their auth token.**

**Fix strategy (priority order — try each, fallback to next):**

| Priority | Option | Description | Effort | UX |
|----------|--------|-------------|--------|-----|
| **1st** | **signArbitrary** | **CONFIRMED AVAILABLE** — already implemented at `useAdena.ts:244` and exported. Cleanest UX: "Sign this login message" | 1-2h | Best — clear auth prompt |
| **2nd** | **signAmino** | Sign a zero-value MsgSend with challenge as memo | 2-3h | Confusing — user sees a "send" TX popup |
| **3rd** | **signDirect** | Use signDirect with a custom proto message | 3-4h | Complex, best security |

> *v3 update (CTO #3 verification): `signArbitrary` IS already implemented in `useAdena.ts:244` and exported. This is the simplest fix — no research needed, just wire it into the auth flow. Effort reduced to 1-2h.*

**Rollback plan:** If `signArbitrary` fails in testing against Adena (unexpected format, browser compatibility):
1. Deploy temporary mitigation: rate-limit token issuance to 1/min per pubkey and log all issuances
2. Continue research on signAmino/signDirect while mitigation is live
3. Do NOT leave the empty-signature path open while researching

**Tasks:**
- [ ] Research which Adena signing method works for arbitrary data (check signArbitrary first)
- [ ] Implement the chosen method in `frontend/src/hooks/useAuth.ts`
- [ ] Update `backend/internal/auth/crypto.go:206` to HARD REJECT empty signatures
- [ ] Verify `chain_id` in signed message matches expected chain
- [ ] Add negative test: assert empty-signature request returns 401
- [ ] Add negative test: assert valid-pubkey-wrong-signature returns 401
- [ ] Test against Adena extension in browser

#### Step 0.2: Rate Limit Fix + JSON Injection Fix — DAY 1 (1 hour total)

> *Cross-review: Fix rate limiting FIRST so the endpoint auth in Step 0.3 is not bypassed.*

**SEC-06 — Rate Limit Bypass (30 min):**
- [ ] Switch `limiter.go:132-138` from first X-Forwarded-For entry to `Fly-Client-IP` header
- [ ] Fallback chain: `Fly-Client-IP` → last `X-Forwarded-For` entry → `X-Real-IP` → `RemoteAddr`
- [ ] Add test: spoofed X-Forwarded-For does not bypass limits

**SEC-NEW-01 — JSON Injection in abciQuery (30 min):**
> *Discovered by Security cross-review. `render_proxy.go:40-51` uses `fmt.Sprintf` to construct JSON-RPC payload. User-controlled `data` param containing `"` or `}` can inject additional JSON-RPC parameters.*
- [ ] Replace `fmt.Sprintf` JSON construction with proper `json.Marshal` struct serialization
- [ ] Add test: realm name containing `"` does not break JSON-RPC payload

#### Step 0.3: Endpoint Lockdown (SEC-01, SEC-02, SEC-03) — DAY 1-2

**SEC-01 — REMOVE Eval Proxy Entirely:**
> *Cross-review consensus: Remove `/api/eval`, don't auth-gate it. No frontend use case requires arbitrary qeval. `/api/render` covers all legitimate needs.*
- [ ] Remove `/api/eval` handler from `main.go:115` and `render_proxy.go:130-168`
- [ ] Verify no frontend code calls `/api/eval` (grep for the route)
- [ ] Add `renderPath` validation to `/api/render` — only alphanumeric, `/`, `-`, `_`, `.` (SEC-11)

**SEC-02 — Auth on IPFS Upload:**
- [ ] Add auth token requirement to `/api/upload/avatar` (`ipfs_proxy.go:26`)
- [ ] Add file hash deduplication to prevent repeated uploads
- [ ] Add uploader address logging for audit trail

**SEC-03 — Auth on Analyst:**
- [ ] Add auth token requirement to `/api/analyst/analyze` (`analyst.go:502-623`)
- [ ] Add per-user (not just per-IP) daily rate limit
- [ ] Cap total daily requests across all IPs (match OpenRouter free tier: 200/day)

**SEC-NEW-02 — Marketplace agentID Injection:**
> *Discovered by Security cross-review. `render_proxy.go:225-243` passes unsanitized `agentID` query param into render path.*
- [ ] Validate `agentID` against alphanumeric + `-` + `_` pattern before passing to render

#### Step 0.4: CORS Fix (SEC-04) — DAY 2

> *Cross-review severity adjustment: CRITICAL → HIGH. `AllowCredentials: false` in `main.go:148` means credentialed CSRF is not possible. Still fix the wildcard.*

- [ ] Remove wildcard `https://*--memba-multisig.netlify.app` from CORS_ORIGINS in `fly.toml:14`
- [ ] Replace with explicit staging origin or remove entirely

#### ~~Step 0.5: XSS Fix (SEC-05)~~ — MOVED TO PHASE 2, Step 2.0

> *v3 correction (CTO #2): MEDIUM severity, feature-gated. Moved to Phase 2 where it belongs.*

#### Step 0.5: ConnectRPC Body Size Limit (SEC-NEW-03) — DAY 2

> *Discovered by Security cross-review. ConnectRPC handler has no body size limit.*
- [ ] Add body size limit interceptor to ConnectRPC handler in `main.go:107` (e.g., 1MB max)
- [ ] Note: analyst endpoint already has its own 512KB limit (`analyst.go:512`) — this is for the protobuf RPC handler

#### Step 0.6: Deploy CI Test Gate (INFRA-03) — DAY 2 (one-line fix)

> *v3 correction (CTO #2): This is a one-line fix that prevents broken code from deploying. Should not wait for Phase 1a.*
- [ ] Add `npm test` step to `deploy-frontend.yml` after lint, before build
- [ ] Also verify: does `deploy-backend.yml` run Go tests before deploying? If not, add `go test ./...`

#### Phase 0 Gate (24h review window)
- [ ] AUTH-01 fixed and verified (zero-click account takeover eliminated)
- [ ] Rate limiting no longer spoofable
- [ ] Eval proxy removed
- [ ] IPFS + analyst endpoints require auth
- [ ] JSON injection in abciQuery fixed
- [ ] CORS wildcard removed
- [ ] All tests green
- [ ] ED25519_SEED rotated (invalidates all pre-fix tokens)
- [ ] **REVIEW: Security-focused code review of all changes**

---

### Phase 1a: Infrastructure & CI (Days 3-8)

> *Cross-review correction: Phase 1 was too aggressive. Split into 1a (infrastructure/CI) and 1b (Gno template work).*

**Goal:** Make the production deployment resilient and establish quality gates.

#### Step 1a.1: Backup & Resilience (INFRA-01, INFRA-02)

**Tasks:**
- [ ] Set `min_machines_running = 1` in `fly.toml`
- [ ] Consider bumping to 512MB RAM (CTO cross-review: 256MB is tight with SQLite + Go runtime + rate limiter maps)
- [ ] Add external backup destination after VACUUM INTO:
  - Option A: Litestream continuous WAL replication to S3/R2
  - Option B: Post-backup upload to Cloudflare R2 (simpler, 24h RPO)
- [ ] Add startup health check that FAILS if `ED25519_SEED` is empty in production (SEC-13)
- [ ] Add `/healthz` endpoint: DB connectivity + RPC node reachability + last block height
- [ ] Document ED25519_SEED rotation runbook: generate new seed → redeploy → all sessions invalidated

#### Step 1a.2: CI Quality Gates (INFRA-03, TEST-02, GNO-04, ARCH-09)

**Tasks:**
- [ ] Add `npm test` to `deploy-frontend.yml` — **one-line fix, should have been Phase 0** (Gno cross-review)
- [ ] Add `--coverage` to Vitest and publish as CI artifact
- [ ] Add `--coverage` to Go tests and publish as CI artifact
- [ ] Set initial coverage thresholds: frontend 60%, backend 60% (increase over time)
- [ ] Add CI step that generates template code and runs `gno build` on it (GNO-04)
  - Requires `gno mod download` for external deps (Gno cross-review)
- [ ] Remove `|| true` from `gno lint` in `gno-test.yml` (fix existing warnings first)
- [ ] Add bundle size budget enforcement (fail CI if main chunk > 200KB gzip)

#### Step 1a.3: Realm Content Sanitization (SEC-09, SEC-10)

**Tasks:**
- [ ] Add `sanitizeForRender()` to candidature bio and skills fields before Render() output
  - File: `contracts/memba_candidature_stub/candidature.gno:377-396`
- [ ] Add `sanitizeForRender()` to channel thread titles, bodies, and reply bodies
  - File: `contracts/memba_channels_stub/channels.gno:720-755`
- [ ] Apply same `sanitizeForRender()` used in escrow/agent_registry
- [ ] Add tests: markdown link injection, code injection, HTML injection

#### Step 1a.4: Page Component Tests (TEST-01)

**Priority order (financial paths first):**
- [ ] `TransactionView.tsx` — sign flow, broadcast flow, error states (537 LOC)
- [ ] `ProposalView.tsx` — vote flow, execution flow, AI analysis (530 LOC)
- [ ] `ProposeTransaction.tsx` — all 6 TX types, validation
- [ ] `CreateMultisig.tsx` — member addition, pubkey fetch, threshold
- [ ] `CreateToken.tsx` — amount validation, fee calculation, BigInt handling
- [ ] Target: 15+ page-level tests covering critical user flows

#### Step 1a.5: CSRF Protection & Secrets Rotation (v3 additions)

> *v3 addition (CTO #2): Both were noted as missing from the plan.*

**CSRF Protection:**
- [ ] Verify that ConnectRPC's content-type requirement (`application/proto` or `application/json`) provides implicit CSRF protection
- [ ] If insufficient: add CSRF token validation to state-mutating ConnectRPC endpoints
- [ ] Document the CSRF protection strategy in SECURITY.md

**Secrets Rotation Runbook:**
- [ ] Create `docs/SECRETS_ROTATION.md` covering:
  - ED25519_SEED rotation procedure (generate → redeploy → sessions invalidated)
  - Lighthouse API key rotation (update Fly.io secret → redeploy)
  - OpenRouter API key rotation (update Fly.io secret → redeploy)
  - Clerk secret key rotation (update Fly.io secret → redeploy)
  - Emergency: "if any key is compromised, do X within Y minutes"

#### Step 1a.6: Orphaned HIGH Issue Resolution

> *v3 addition (CTO #2 cross-review): 5 HIGH issues had no implementation tasks. Resolved here.*

**SEC-07 — CSP `unsafe-inline` removal:**
- [ ] Configure Vite production build to generate CSP nonces (or use `vite-plugin-csp`)
- [ ] Update `netlify.toml` CSP header to use nonce-based script-src instead of `unsafe-inline`
- [ ] Keep `unsafe-inline` only in `index.html` meta tag for local dev

**SEC-NEW-05 — Token revocation mechanism:**
- [ ] Add server-side token blocklist (in-memory map with periodic cleanup)
- [ ] Add `POST /api/revoke` endpoint (auth required) to blocklist the caller's current token
- [ ] Check blocklist in auth middleware before accepting tokens
- [ ] Alternative: Reduce token TTL from 24h to 1h with a refresh-token pattern

**SEC-12 — Single admin key SPOF (DEFERRED with documented trigger):**
- [ ] Document: SEC-12 is deferred until mainnet preparation. Trigger: when real funds > 1000 GNOT flow through any realm
- [ ] Phase 1 (betanet): Add 24h timelock on admin dispute resolution
- [ ] Phase 2 (mainnet): Migrate admin to DAO governance proposals
- [ ] **Requires its own planning document + testnet dry-run before execution**

**DEFI-02 — GRC20 fee enforcement on-chain:**
- [ ] Audit whether the `grc20factory` realm on test12 enforces fees at the contract level
- [ ] If not: add fee enforcement to the factory realm code (requires realm redeploy)
- [ ] If yes: document that CLI bypass is a non-issue
- [ ] Add test: mint via gnokey CLI, verify fee is deducted

**SEC-15 — Escrow MaxContracts=500 global DoS:**
- [ ] Add per-address contract limit (e.g., max 50 contracts per address)
- [ ] Or: require a deposit to create an escrow contract (refunded on completion)

#### Step 1a.6: LLM Prompt Injection Mitigation (SEC-NEW-04)

> *Discovered by Security cross-review. Analyst endpoint passes user-provided systemPrompt and userPrompt directly to LLM providers.*

- [ ] Remove user-controllable `systemPrompt`/`userPrompt` params from analyst API
- [ ] Analyst should only accept structured proposal data (realm_path, proposal_id, chain_id)
- [ ] Backend generates its own analysis prompts from structured data (no pass-through)

#### Phase 1a Gate
- [ ] Backups verified on external storage
- [ ] CI runs tests before deploy, coverage reported
- [ ] Realm stubs updated with sanitization
- [ ] 15+ new page-level tests for financial paths
- [ ] **REVIEW: Infrastructure + testing review**

---

### Phase 1b: Gno Template & Realm Work (Days 9-16)

> *Cross-review correction: AVL migration and pagination are 3-5 day tasks each. Separated from infrastructure work.*

**Goal:** Fix Gno-specific scalability and compatibility issues.

#### Step 1b.0: AVL Import Path Unification (GNO-NEW-01) — FIRST THING

> *Discovered by Gno cross-review. This is the REAL P0: templates use `gno.land/p/demo/avl` but deployed contracts use `gno.land/p/nt/avl/v0`. If the target chain only has one path, all template deployments fail.*

**Current state (verified by CTO #3):**
- `gno.land/p/demo/avl` — used by: `channelTemplate.ts`, `nftTemplate.ts`, `escrowTemplate.ts`, `agentTemplate.ts`, `nftMarketplaceTemplate.ts`, `prologue.ts` type definition
- `gno.land/p/nt/avl/v0` — used by: `grc1155Template.ts` (already correct!), `contracts/escrow.gno`, `contracts/agent_registry.gno`
- `prologue.ts:25` itself hardcodes `"gno.land/p/demo/avl"` in the `GnoImport` type — must also be fixed

**Tasks:**
- [ ] Use `grc1155Template.ts` as reference — it already uses the correct `p/nt/avl/v0` path
- [ ] Update `prologue.ts:25` GnoImport type: `"gno.land/p/demo/avl"` → `"gno.land/p/nt/avl/v0"`
- [ ] Update all 5 templates using `p/demo/avl` to `p/nt/avl/v0`
- [ ] Update `daoTemplate.ts` to use `generateImportBlock()` from prologue (currently hardcodes imports — defeats DRY)
- [ ] Also check `boardTemplate.ts` import paths (not audited in original cross-review)
- [ ] Add CI check: all generated template code uses the same import paths as deployed contracts

#### Step 1b.1: Gno Template Migration — Slices to AVL (GNO-01)

> *Gno cross-review: Scope expanded. boardTemplate and channelTemplate also use slices for threads.*

**Problem:** Template-generated DAOs store members and proposals in slices (O(n)). Additionally, `boardTemplate.ts` and `channelTemplate.ts` store threads in slices despite using AVL for members.

**Tasks:**
- [ ] Rewrite `daoTemplate.ts` to use `avl.Tree` for members (key: address string)
- [ ] Rewrite `daoTemplate.ts` to use `avl.Tree` for proposals (key: zero-padded ID string, e.g., `ufmt.Sprintf("%010d", id)` for ordered iteration)
- [ ] Rewrite `boardTemplate.ts` to use `avl.Tree` for channels and threads
- [ ] Rewrite `channelTemplate.ts` thread storage to use `avl.Tree` (members already use AVL)
- [ ] Update vote dedup to use AVL lookup instead of linear scan
- [ ] Update all template tests to verify AVL-based code compiles
- [ ] Run `gno build` on generated output in CI

#### Step 1b.2: Render() Pagination (GNO-02)

> *Gno cross-review corrections: Use `Render("page:N")` with colon separator (slash conflicts with existing routes). Also add pagination to DAO template's renderHome().*

**Tasks (realm stubs — actual deploys blocked on chain availability):**
- [ ] Define standard: `Render("page:N")` with `const RenderPageSize = 20`
- [ ] Add pagination to channels stub `renderChannel()` (20 threads per page)
- [ ] Add pagination to escrow stub `renderHome()` (20 contracts per page)
- [ ] Add pagination to agent_registry stub `renderHome()` (20 agents per page)
- [ ] Add pagination to nft_market stub `Render()` (20 listings per page)
- [ ] Add pagination to DAO template `renderHome()` (20 proposals per page) — **missed in original plan**
- [ ] Update frontend parsers to request paginated data and handle pagination metadata
- [ ] Document pagination format for gnoweb compatibility

#### Step 1b.3: Escrow Dispute Default Fix (DEFI-01) — PROMOTED TO CRITICAL

> *CTO cross-review: Direct fund loss vector. Malicious freelancer delivers nothing, waits for timeout, auto-wins.*

**Problem:** `ClaimDisputeTimeout` auto-resolves in favor of freelancer after ~28 days.

**Tasks:**
- [ ] Change auto-resolve default: funds refund to CLIENT (protective default), not release to freelancer
- [ ] Or: Extend timeout + escalate to DAO vote instead of auto-resolving
- [ ] Add test: dispute timeout refunds client, not freelancer
- [ ] Document dispute resolution process for users

#### Phase 1b Gate
- [ ] All AVL import paths unified across templates and stubs
- [ ] Template-generated code uses AVL trees, verified compilable in CI
- [ ] Render() pagination on all realm stubs
- [ ] Escrow dispute default fixed
- [ ] **REVIEW: Gno Core Engineer review of templates and realm patterns**

---

### Phase 2: UX & Quality (Days 12-22)

**Goal:** Fix accessibility blockers, mobile breakpoints, and critical UX friction.

> *v3 parallelization guidance (CTO #2): Steps 2.1-2.5 are frontend-only work and can start on Day 12 in parallel with Phase 1b (Gno template work). Step 2.6 (onboarding, CreateDAO wizard) depends on Phase 1b AVL import unification. The Phase 1b gate blocks Phase 4 (realm deployment), not Phase 2.*

**Definition of Done (all phases):**
- All new code has tests
- No new lint/TS warnings introduced
- PR reviewed by at least one person
- CHANGELOG updated for user-facing changes

#### Step 2.0: NFTGallery XSS Fix (SEC-05) — moved from Phase 0

> *v3 correction (CTO #2): SEC-05 is MEDIUM severity and feature-gated. Does not belong in Phase 0.*

- [ ] Replace regex-based markdown→HTML chain with a proper markdown library (marked/remark + rehype-sanitize)
- [ ] Then sanitize the output with DOMPurify
- [ ] Add test: malicious on-chain metadata does not produce executable HTML

#### Step 2.1: Accessibility — WCAG 2.1 AA Compliance (UX-01, UX-08)

**Tasks:**
- [ ] Add `:focus-visible` styles to `index.css` for all interactive elements
  - Outline: `2px solid var(--color-k-accent)`, offset: `2px`
  - Apply to: buttons, links, inputs, selects, custom controls
- [ ] Add `role="combobox"`, `role="listbox"`, `aria-activedescendant` to CommandPalette
- [ ] Fix BottomSheet focus trap (trap Tab key within modal while open)
- [ ] Add `aria-required`, `aria-invalid`, `aria-describedby` to all form inputs
- [ ] Verify 44px minimum touch targets on all buttons (audit top 10 pages)
- [ ] Run axe-core on top 10 pages, fix all critical/serious violations

#### Step 2.2: Mobile Responsiveness (UX-02, UX-06, UX-16)

**Tasks:**
- [ ] Add 320px breakpoint with `overflow-x: hidden` guards
- [ ] Fix ProposeTransaction 6-tab bar overflow at 320px (stack vertically or use dropdown)
- [ ] Fix BottomSheet inline styles to use theme tokens instead of hardcoded colors
- [ ] Add swipe-to-dismiss gesture to BottomSheet (touch drag on handle element)
- [ ] Fix skeleton loaders to use theme tokens (`var(--color-k-panel)`)
- [ ] Fix ErrorToast max-width guard for mobile (ensure doesn't overflow viewport)

#### Step 2.3: Vote & Sign UX (UX-03, UX-04, UX-11)

**Tasks:**
- [ ] Add confirmation dialog before vote broadcast: "Vote YES on Proposal #X? This costs gas and cannot be undone."
- [ ] Make air-gapped signature paste a first-class option in TransactionView (visible tab, not hidden toggle)
- [ ] Add optimistic update for voting: immediately show vote badge with "confirming..." spinner
- [ ] Add optimistic update for signing: immediately show signature count +1 with "confirming..."
- [ ] Fix "Already Signed" button opacity to look properly disabled
- [ ] Add "Go to your DAO" button after DAO creation (replace `setTimeout` redirect)

#### Step 2.4: CSS & Theme Consolidation (ARCH-03, ARCH-07, UX-05)

**Tasks:**
- [ ] Extract ProposeDAO.tsx 52 inline styles to `proposedao.css`
- [ ] Audit and merge dual token systems: consolidate `tokens.css` and `index.css` Kodera tokens
  - Choose one namespace (`--color-k-*` recommended since it's more widely used)
  - Find/replace the other across all CSS files
- [ ] Replace hardcoded hex colors in `proposetransaction.css` with token variables
- [ ] Fix broadcast button in TransactionView.tsx to use theme token instead of `#00e6bb`

#### Step 2.5: Error & Loading States (UX-10, UX-12, UX-17)

**Tasks:**
- [ ] Implement ErrorToast queue: stack vertically with 8px gaps, max 3 visible
- [ ] Replace ConnectingLoader full-page block with non-blocking overlay (allow content browsing)
- [ ] Improve broadcast failure message: link to gnokey documentation, show example command
- [ ] Improve CreateMultisig pubkey error: add "How to activate an account" expandable section
- [ ] Add "Awaiting execution" explanation: who can execute, what happens after, inline help text

#### Step 2.6: Onboarding & Discovery (UX-18, UX-21, UX-22)

**Tasks:**
- [ ] Add glossary tooltip for technical terms (GRC20, realm, GNOT, ugnot) — hover/click reveals plain explanation
- [ ] Auto-generate realm path from DAO name in CreateDAO wizard (with "Advanced" toggle for custom)
- [ ] Add "What is a DAO?" expandable section at top of CreateDAO wizard
- [ ] Add back button to onboarding wizard
- [ ] Add non-connected user onboarding (browsing tour for users without wallet)

#### Phase 2 Gate
- [ ] axe-core audit passing on top 10 pages (0 critical/serious violations)
- [ ] 320px viewport tested and working
- [ ] Vote confirmation dialog in place
- [ ] Theme tokens consolidated to single system
- [ ] Error/loading states improved across key paths
- [ ] **REVIEW: UX/accessibility review with screen reader testing**

---

### Phase 3: Ecosystem & Community (Days 19-25)

**Goal:** Prepare for betanet, contribute to ecosystem, reduce bus factor.

#### Step 3.1: Gno Betanet Preparation (GNO-03)

**Tasks:**
- [ ] Create import path migration script: `chain/runtime` → TBD, `chain/banker` → TBD, `chain` → TBD
- [ ] Add chain-version detection to template generators (gno.mod version check)
- [ ] Test all template generators against latest GnoVM stdlib
- [ ] Add betanet config to `frontend/src/lib/config.ts` (when chain params known)
- [ ] Update `realm-versions.json` with betanet realm deployment status
- [ ] Run gas budget tests: Render() with 200 members, 500 proposals, 500 threads per channel

#### Step 3.2: Ecosystem Contribution (OSS-08, OSS-09, OSS-10)

**Tasks:**
- [ ] Extract `packages/gno-rpc` as publishable npm package with README and examples
- [ ] Add "View Generated Code" step to CreateDAO wizard (before deploy confirmation)
- [ ] Publish DAO Analyst MCP server to npm: `@samouraiworld/dao-analyst-mcp`
- [ ] Submit to MCP server directory (modelcontextprotocol.io/servers)
- [ ] Add security notice to wizard: "Review generated code before deploying to mainnet"

#### Step 3.3: Repository Health (OSS-01 through OSS-06)

**Tasks:**
- [ ] Reconcile Node version: update CONTRIBUTING.md to match README (Node >= 22)
- [ ] Update DISCLAIMER.md test count (285 → 1,700+)
- [ ] Standardize on pnpm across monorepo (or npm — pick one, document in CONTRIBUTING)
- [ ] Add second CODEOWNER for `/frontend/` and `/backend/`
- [ ] Create 5-10 issues labeled `good first issue` with clear scope:
  - "Add unit test for blockTime utility edge cases"
  - "Extract inline styles from TokenView to CSS"
  - "Add aria-label to Validators table headers"
  - "Fix hardcoded hex colors in proposetransaction.css"
  - "Add empty state to MultisigHub page"

#### Step 3.4: Progressive Decentralization Document

**Tasks:**
- [ ] Write `docs/PROGRESSIVE_DECENTRALIZATION.md` covering:
  - Current centralization points (backend, admin key, API keys)
  - Phase 1: Move profiles on-chain (realm-based profile storage)
  - Phase 2: Move quest completions on-chain (GRC721 badges as source of truth)
  - Phase 3: Multi-backend resilience (frontend discovers/failovers between backends)
  - Phase 4: Admin migration to DAO governance
  - Timeline and prerequisites for each phase

#### Step 3.5: Cross-Realm Membership Documentation (GNO-05)

**Tasks:**
- [ ] Document the channels/candidature membership desync as a known design trade-off
- [ ] Add `SyncMembers` utility to channels realm (batch add/remove from DAO state)
- [ ] Add frontend "Sync Members" button for DAO admins (calls SyncMembers on channels realm)
- [ ] Document the long-term fix: cross-realm `IsMember()` check when Gno supports dynamic imports

#### Phase 3 Gate
- [ ] Betanet import paths validated
- [ ] gno-rpc and MCP published to npm
- [ ] Good-first-issue labels created
- [ ] Progressive decentralization plan documented
- [ ] **REVIEW: Gno Core Engineer review of templates and realm patterns**

---

### Phase 4: Release (Days 26-28)

#### Step 4.1: Realm Deployments (when test12 chain available)

**Tasks:**
- [ ] Deploy `memba_dao_channels_v3` (ACL + sanitization + pagination)
- [ ] Deploy `memba_dao_candidature_v3` (ACL + sanitization + deposit return on approval)
- [ ] Update all frontend realm path references
- [ ] Update `realm-versions.json`
- [ ] On-chain smoke test: verify ACL rejects unauthorized callers
- [ ] On-chain smoke test: verify Render() pagination works

#### Step 4.2: Release Process

**Tasks:**
- [ ] Full regression test suite (target: 1,800+ tests)
- [ ] E2E smoke tests on staging
- [ ] Bundle size verification (< 200KB gzip main chunk)
- [ ] Update CHANGELOG.md with v6.0.0 entry
- [ ] Update README.md feature list and test counts
- [ ] Version bump to v6.0.0
- [ ] PR to main
- [ ] Deploy verification on production

#### Step 4.3: Post-Release

- [ ] Security audit summary document update
- [ ] Deployment report update
- [ ] Tag v6.0.0 release on GitHub

---

## 5. Architecture Decisions

### AD-01: Auth Strategy

**Decision:** Investigate Adena `signArbitrary` first; fall back to `signAmino` only if unavailable.

**Rationale:** ADR-036 MsgSignData is unsupported by Adena. `signArbitrary` provides the cleanest UX ("Sign this login message: ...") if supported — check `useAdena.ts:244` where it may already be used for multisig. `signAmino` with a zero-value MsgSend is the fallback, but creates UX confusion (user sees a "send transaction" popup when just logging in).

> *Security cross-review addition:* If using signAmino, verify `chain_id` in the signed message matches the expected chain. Also ensure the signer address derived from the amino signature matches the pubkey-derived address.

**Alternative rejected:** Challenge-response via window.crypto — this would bypass wallet signing entirely and not prove blockchain key ownership.

### AD-02: State Management

**Decision:** Adopt React Query as global data layer in v6.1 (not v6.0).

**Rationale:** The Gnolove section's React Query pattern (`GnoloveLayout.tsx`) is validated. Extending it app-wide is the right move but too large for v6.0 scope. Migration can be done page-by-page without a big-bang rewrite.

**Plan:** Phase 1 (v6.1) migrates financial paths (multisig, DAO, token). Phase 2 (v6.2) migrates remaining pages.

### AD-03: Template Data Structures

**Decision:** Migrate template-generated DAOs from slices to AVL trees.

**Rationale:** O(n) lookups become O(log n). Gas cost reduction is significant at 100+ members. The avl/v0 package is stable and widely used. The migration changes the generated code but not the user-facing wizard.

### AD-04: CSS Strategy

**Decision:** Consolidate to single token namespace (`--color-k-*`), begin CSS Modules migration.

**Rationale:** Two overlapping token systems (`tokens.css` + Kodera `index.css`) create maintenance confusion. Pick Kodera namespace (more widely used), find/replace the other. CSS Modules (`.module.css`) prevent class name collisions and can be adopted incrementally.

### AD-05: Backup Strategy

**Decision:** Post-VACUUM-INTO upload to Cloudflare R2.

**Rationale:** Litestream is ideal but adds operational complexity. R2 upload after each 24h backup provides adequate RPO for a testnet/early-betanet product. Upgrade to Litestream when user base justifies the complexity.

---

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Auth bypass exploitation (AUTH-01) | HIGH | CRITICAL | Phase 0, Day 1 same-day hotfix |
| JSON injection in abciQuery (SEC-NEW-01) | HIGH | HIGH | Phase 0, Day 1 (30 min fix) |
| AVL import path split blocks deployments (GNO-NEW-01) | HIGH | HIGH | Phase 1b, Day 9 |
| Eval proxy data exfiltration (SEC-01) | HIGH | HIGH | Phase 0, Day 1 (remove endpoint) |
| Escrow dispute drains funds (DEFI-01) | MEDIUM | CRITICAL | Phase 1b, realm fix |
| Fly.io volume loss (INFRA-01) | LOW | CRITICAL | Phase 1a, external backups |
| Template-generated DAO gas DoS (GNO-01) | MEDIUM | HIGH | Phase 1b, AVL migration |
| Gno betanet import path changes (GNO-03) | HIGH | HIGH | Phase 3, migration script |
| Admin key migration botched (SPOF) | LOW | CRITICAL | Deferred — needs own plan + testnet dry-run |
| Adena wallet API changes | MEDIUM | HIGH | Monitor Adena releases |
| LLM prompt injection via analyst (SEC-NEW-04) | MEDIUM | MEDIUM | Phase 1a, structured prompts only |
| 256MB VM OOM under load | MEDIUM | MEDIUM | Phase 1a, consider 512MB bump |
| test12 chain reset | MEDIUM | MEDIUM | Realm deployment playbook exists |
| OpenRouter free tier exhaustion | MEDIUM | LOW | Rate limiting + caching in place |
| Contributor bus factor = 1 | HIGH | MEDIUM | Phase 3, CODEOWNERS + good-first-issues |

---

## 7. Roadmap Realism (8-Month View)

> *Cross-review correction: Original 6-month timeline was 2-3 months too aggressive for a 2-3 person team. Extended to 8 months with more realistic phase durations. Betanet date is speculative — plan for it but don't depend on it.*

For a 2-3 person team, based on current velocity (40+ shipped versions in ~6 weeks):

### Month 1: V6 Security + Infrastructure (THIS PLAN — Phases 0-1a)
- Week 1: Phase 0 critical security hotfixes (AUTH-01 Day 1, endpoint lockdown Day 1-2)
- Week 2-3: Phase 1a infrastructure (backups, CI gates, page tests, realm sanitization)
- Deploy: v6.0.0-alpha (security fixes)

### Month 2: Gno Templates + UX (THIS PLAN — Phases 1b-2)
- Week 1-2: Phase 1b Gno template work (AVL import unification, slices→AVL, pagination, escrow fix)
- Week 3-4: Phase 2 UX (accessibility, mobile, vote confirmation, theme consolidation)
- Deploy: v6.0.0-beta

### Month 3: Community + Release (THIS PLAN — Phases 3-4)
- Week 1-2: Phase 3 ecosystem (betanet prep, npm publications, good-first-issues)
- Week 3: Phase 4 release (realm deploys, regression, release)
- Deploy: v6.0.0

### Month 4: Stability + Data Layer
- React Query migration for financial paths (multisig, DAO, token) — 6-8 weeks realistic
- CSS Modules migration (gradual, page-by-page)
- Deploy: v6.1.0

### Month 5: Data Layer Completion + Quality
- React Query migration completion (remaining pages)
- Gno betanet compatibility testing (if chain params announced)
- Integration test suite (backend + frontend together)
- Deploy: v6.2.0

### Month 6: Ecosystem Contribution
- Standardize common realm patterns (ACL, pause, sanitize) into shared package — prerequisite for gnodaokit
- gno-rpc npm publication
- MCP server npm publication
- First community contributions
- Deploy: v7.0.0-alpha

### Month 7: Betanet Readiness (if chain available)
- Deploy realms to betanet
- Replace cosmos-sdk with lighter crypto libs
- Progressive decentralization Phase 1 (on-chain profiles)
- Deploy: v7.0.0-beta

### Month 8: Polish + Growth
> *CTO cross-review: Admin key migration to multisig governance is a separate milestone. It requires social coordination, key ceremony, and testnet dry-run. Do NOT combine with betanet migration.*
- Admin key migration planning + testnet dry-run (separate milestone doc)
- Adena mock for E2E testing
- Tutorial content (Build a Gno DAO Plugin, Query Gno from AI)
- Conference demo preparation
- Deploy: v7.0.0

### What to DEFER (beyond 8 months):
- Admin key migration execution (needs its own dedicated plan + testnet dry-run)
- NFT Marketplace production enablement (keep feature-gated)
- IBC transfer integration (blocked on Gno IBC2)
- GnoSwap slippage tolerance (deferred post-betanet)
- Conviction voting / optimistic governance models
- Full WCAG 2.1 AAA compliance
- Remotion replacement with lighter animations
- On-chain quest completion (progressive decentralization Phase 2)
- gnodaokit extraction as community package (Gno cross-review: premature — two divergent DAO implementations exist, standardize first)

---

## Appendix A: Expert Panel Roster

| Panel | Perspectives | Focus |
|-------|-------------|-------|
| **1. CTO + FSE** | CTO, Senior Fullstack Engineer | Architecture, scaling, tech debt, deployment, testing |
| **2. CSO + Black Hat** | CSO, Penetration Testers | Attack surfaces, exploit vectors, threat modeling |
| **3. UX/UI** | UX Lead, Desktop User ×2, Mobile User ×2 | Navigation, accessibility, mobile, error states |
| **4. Gno Core + VM** | Gno Core Engineer, GnoVM Engineer, DevRel | Realm patterns, cross-realm, breaking changes, ecosystem |
| **5. DeFi/DAO/Blockchain** | DeFi User, DAO User, DAO Founder, SC Hacker, Validator Expert ×2, Non-tech User ×2 | Governance, economic attacks, validator tools, onboarding |
| **6. OSS + Community** | OSS Contributor ×2, DevRel, Manfred Touron perspective, Jae Kwon perspective | Repo health, docs, philosophy, ecosystem contribution |

**Total: 26 expert perspectives across 6 independent panels**

---

## Appendix B: Cross-Reference Matrix

| Canonical ID | Panel 1 (CTO) | Panel 2 (CSO) | Panel 3 (UX) | Panel 4 (Gno) | Panel 5 (DeFi) | Panel 6 (OSS) |
|-------------|---------------|---------------|--------------|---------------|----------------|---------------|
| AUTH-01 | P0-1 | — | — | — | — | — |
| SEC-01 | — | #1 | — | — | — | — |
| SEC-02 | P1-5 | #2 | — | — | — | — |
| SEC-03 | — | #3 | — | — | — | — |
| SEC-04 | — | #4 | — | — | — | — |
| SEC-05 | — | #9 | — | — | — | — |
| SEC-06 | — | #16 | — | — | — | — |
| SEC-07 | — | #8 | — | — | — | — |
| INFRA-01 | P1-1 | — | — | — | — | — |
| INFRA-02 | P0-2 | #14 | — | — | — | — |
| INFRA-03 | P1-4 | — | — | — | — | — |
| GNO-01 | — | — | — | P0 | MEDIUM | — |
| GNO-02 | — | — | — | P0 | — | — |
| GNO-03 | — | — | — | P0 | — | — |
| GNO-04 | — | — | — | P1 | — | — |
| UX-01 | — | — | F7.1 | — | — | — |
| UX-02 | — | — | F2.1 | — | — | — |
| UX-03 | — | — | F6.1 | — | — | — |
| UX-04 | — | — | F5.2 | — | — | — |
| TEST-01 | P1-2 | — | — | — | — | — |
| TEST-02 | — | — | — | — | — | #2 |
| DEFI-01 | — | — | — | — | HIGH | — |
| ARCH-01 | P2-1 | — | — | — | — | — |
| ARCH-05 | P3-1 | — | — | — | — | #6 |
| OSS-01 | — | — | — | — | — | #5 |
