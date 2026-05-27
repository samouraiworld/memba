# Memba v4 — Next Phase Implementation Proposal

> **Date:** 2026-04-07 (revised 2026-04-07 v2)
> **Author:** CTO Review Board (25 expert perspectives) + CTO Expert Review pass
> **Status:** PROPOSAL v2 — Awaiting CTO approval before any code is written
> **Scope:** Priorities, phasing, and detailed implementation plan for Memba's next cycle

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Assessment](#2-current-state-assessment)
3. [CTO Expert Review — Corrections & Reordering](#3-cto-expert-review)
4. [Critical Issues (Fix Immediately)](#4-critical-issues)
5. [25-Expert Review Panel](#5-expert-review-panel)
6. [Priority Matrix](#6-priority-matrix)
7. [Implementation Phases](#7-implementation-phases)
8. [Detailed Sprint Plans](#8-detailed-sprint-plans)
9. [NEW FEATURE — GnoBuilders: The Gno Developer Game](#9-gnobuilders)
10. [Risk Register](#10-risk-register)
11. [Success Metrics](#11-success-metrics)
12. [Decision Log](#12-decision-log)

---

## 1. Executive Summary

Memba is at an inflection point. With v3.3 shipped (1,495+ tests, 6 on-chain realms, AI governance, NFT marketplace, teams, quests), the product is **feature-rich but has critical security gaps and unrealized deployed features**. The next cycle must:

1. **Fix 2 critical on-chain security vulnerabilities** in realm source code (can do NOW, no deployment needed)
2. **Redeploy samcrew realms on test12** when chain stabilizes (BLOCKED — test12 not yet stable)
3. **Ship GnoBuilders** — 60+ quest gamified onboarding with NFT badges, ranks, and DAO access
4. **Activate gated features** (NFT, Marketplace, Services) — code exists, realms need deployment
5. **Prepare for mainnet** (H2 2026) — upstream compatibility, staging, key rotation
6. **Ship revenue infrastructure** — subscription realms, GnoSwap integration

**Estimated timeline:** 7 phases over ~10-12 weeks

> **IMPORTANT — test12 status:** As of 2026-04-07, testnet12 is still not stable and not fully restarted. Realm redeployment is BLOCKED until chain stability is confirmed. All code-side work (security fixes, feature development, tests) can proceed immediately. Deployment is decoupled from development.

---

## 2. Current State Assessment

### 2.1 What's Working Well

| Area | Status | Evidence |
|------|--------|----------|
| Test coverage | Excellent | 1,495 unit + 87 backend + 18 E2E |
| CI/CD pipeline | Green | All runs passing, auto-deploy to Netlify + Fly.io |
| Code quality | Clean | 0 TODO/FIXME, 0 lint errors, 0 TS errors |
| Documentation | Comprehensive | 40+ markdown files, SKILL.md for agents |
| Feature breadth | Very strong | DAO, multisig, tokens, NFT, validators, channels, teams, AI, quests |
| Architecture | Sound | Clear separation, ConnectRPC, strategy patterns for upstream compat |

### 2.2 What Needs Attention

| Area | Severity | Detail |
|------|----------|--------|
| **On-chain ACL (channels)** | CRITICAL | Write operations have zero membership checks |
| **On-chain ACL (candidature)** | CRITICAL | MarkApproved/MarkRejected callable by anyone |
| **test12 realm state** | HIGH | Rollback to block 234,887 wiped samcrew realms |
| **Gated features unused** | MEDIUM | NFT, Marketplace, Services implemented but feature-flagged |
| **No staging environment** | MEDIUM | Changes go directly to production |
| **GnoSwap integration incomplete** | MEDIUM | Slippage spec exists, not implemented |
| **Upstream drift risk** | MEDIUM | boards2 #5037, GovDAO #5222 pending |
| **Single auth key** | LOW | ED25519_SEED has no rotation mechanism |

### 2.3 Ecosystem State

| Dependency | Status | Impact on Memba |
|------------|--------|-----------------|
| **test12** | Rolled back (block 234,887) | Realms wiped, need redeployment |
| **gnoland1 (betanet)** | HALTED (consensus bug) | Cannot test betanet features |
| **gnodaokit** | Active (upgradable DAOs, crossing DAO) | New capabilities available |
| **gnomonitoring** | Active (Telegram bot, interactive menus) | Deeper integration possible |
| **tokenfactory** | Stable | Deployed, 11 tests passing |
| **Security Guard** | Sprint 2 complete (91 tests) | Can audit Memba realms |
| **Upstream gno** | boards2 permission changes, govdao rejection, halt_height | Monitor for breaking changes |

---

## 3. CTO Expert Review — Corrections & Reordering

### 3.1 Structural Corrections to v1 Proposal

The v1 proposal had **Phase 0 (Security & Recovery)** as a single week including both code fixes AND realm redeployment. This is incorrect because:

1. **test12 is not stable.** Redeployment cannot happen until the chain is fully restarted and confirmed stable. This is an external blocker with no ETA.
2. **Code fixes and deployment are independent.** Security fixes to realm source code, new tests, and Security Guard scans can all proceed NOW in the samcrew-deployer repo — no chain needed.
3. **Feature development is NOT blocked by redeployment.** Most Memba frontend/backend work (UX, quests, dark mode, mobile, upstream compat) doesn't require on-chain realms.

### 3.2 Revised Phase Structure

**Old (v1):**
```
Phase 0: Security + Redeployment   [Week 1]     ← WRONG: redeployment is blocked
Phase 1: Feature Activation        [Weeks 2-3]  ← WRONG: blocked by redeployment
Phase 2: UX & Polish              [Weeks 4-5]
Phase 3: Mainnet Preparation      [Weeks 5-6]
Phase 4: DAO Power Features       [Weeks 7-8]
Phase 5: Ecosystem & OSS          [Weeks 9-10]
```

**New (v2) — decoupled from chain availability:**
```
Phase 0: Security Code Fixes       [Week 1]      ← Code-only, no chain needed
Phase 1: GnoBuilders Quest System  [Weeks 2-4]   ← Major new feature, no chain needed
Phase 2: UX & Polish              [Weeks 3-5]    ← Parallel with Phase 1
Phase 3: Realm Redeployment       [When test12 stable] ← External trigger
Phase 4: Feature Activation        [After Phase 3] ← Needs realms live
Phase 5: Mainnet Preparation      [Weeks 6-8]
Phase 6: DAO Power Features + OSS [Weeks 9-12]
```

**Key insight:** Phases 1 and 2 can run in parallel since they touch different areas of the codebase. GnoBuilders is mostly `lib/quests.ts`, quest components, and backend RPCs. UX work is layout, CSS, mobile responsiveness.

### 3.3 Accuracy Corrections

| v1 Claim | Correction |
|----------|------------|
| "6 on-chain realms" in summary | Accurate but currently WIPED. Say "6 realm codebases ready, awaiting redeployment" |
| Phase 0 Sprint 0.2 "Day 3: Full redeployment" | Cannot schedule — depends on external chain stability |
| Phase 1 "Enable VITE_ENABLE_NFT flag" | Needs realm live first. Move to Phase 4 |
| GnoSwap slippage "2-4h" in P1 | Correct estimate but also needs GnoSwap deployed on target chain. Verify availability |
| "Deploy GRC721 seed collection" | Blocked by chain. Move to Phase 4 |
| MASTER_ROADMAP "stale at v2.28" | Should be updated as part of Phase 0, not Phase 5 |
| "1,495+ tests" | Accurate as of v3.3 |
| samcrew-deployer issues #2 and #3 | Code fixes can proceed. Closing issues requires deployment + verification |

### 3.4 What We CAN Do Right Now (No Chain Dependency)

| Work Item | Dependencies | Notes |
|-----------|-------------|-------|
| Fix candidature realm code + tests | samcrew-deployer repo only | PR ready for when chain is up |
| Fix channels realm code + tests | samcrew-deployer repo only | PR ready for when chain is up |
| Run Security Guard on realm code | Local analysis only | No chain needed |
| GnoBuilders quest system (full) | Memba frontend + backend | Offline-first design |
| Mobile responsiveness audit + fixes | Frontend only | CSS changes |
| Dark mode | Frontend only | CSS variables |
| Onboarding wizard | Frontend only | No chain data needed for wizard flow |
| Progressive sidebar | Frontend only | UI reorganization |
| Network maintenance banner | Frontend only | Actually addresses the current situation |
| Backend test coverage increase | Backend only | SQLite tests |
| AI analyst rate limiting | Backend only | Rate limit logic |
| Update MASTER_ROADMAP | Docs only | Housekeeping |
| ConnectRPC API versioning | Backend only | Path prefix change |
| Upstream compat (proposalRejected, halt_height) | Frontend only | UI state additions |
| GnoSwap slippage spec implementation | Frontend only | MsgCall builder + UI, can test with mock |
| Proposal templates | Frontend + backend | No chain dependency for templates |

---

## 4. Critical Issues

### 3.1 CRITICAL — samcrew-deployer Issue #3: Channels ACL Bypass

**Vulnerability:** All write operations in `memba_dao_channels.gno` (PostThread, PostReply, CreateChannel, RemoveThread, FlagThread) lack access control. Any address can post/moderate.

**Fix:** Import basedao membership check. Verify caller has appropriate WriteRole for the channel before allowing mutations.

**Effort:** 2-4h (realm code + tests + redeploy)

### 3.2 CRITICAL — samcrew-deployer Issue #2: Candidature Admin Bypass

**Vulnerability:** `MarkApproved()` and `MarkRejected()` have zero access control. Any address can approve their own candidature.

**Fix:** Verify `runtime.PreviousRealm().PkgPath()` matches the parent DAO realm, or maintain an admin allowlist.

**Effort:** 1-2h (realm code + tests + redeploy)


### 3.3 HIGH — test12 Realm Redeployment

**Context:** test12 rolled back to block 234,887 on 2026-04-07. All samcrew realms (memba_dao, candidature, channels, tokenfactory, nft_market, escrow) are wiped.

**Action:** Full redeployment via samcrew-deployer after security fixes are applied.

**Effort:** 1-2h (deploy + smoke test)

> **IMPORTANT:** Security fixes MUST be applied to realm source code BEFORE redeployment. On-chain code is immutable — deploying buggy code again wastes the path and requires versioned paths (e.g., `/v2`).

---

## 5. 25-Expert Review Panel

### 4.1 CSO (Chief Security Officer)

**Assessment: 7/10 — Strong foundations, critical on-chain gaps**

Strengths:
- Challenge-response auth with ed25519, 24h tokens, nonce replay prevention
- CSP hardened (wasm-unsafe-eval documented, not unsafe-eval)
- friendlyError() prevents internal path leakage
- Sentry with PII scrubbing
- Input validation at RPC boundary (25+ Zod schemas)

Critical findings:
1. **Channels + Candidature ACL bypass is a show-stopper.** If this were mainnet, any address could spam channels or self-approve DAO membership. Fix before anything else.
2. **ED25519_SEED single-key risk.** Acceptable for testnet phase but needs rotation plan before mainnet. Recommend `ED25519_SEED_V{N}` versioning with graceful migration.
3. **No rate limiting on AI analyst endpoint.** OpenRouter is free-tier but 10-model consensus = 10 API calls per request. A malicious user could drain quota.
4. **IPFS avatar uploads** — no file size or type validation documented. Could store arbitrary data.

Recommendations:
- Fix #2 and #3 immediately, redeploy with fixes
- Add rate limiting to AI analyst (1 report/DAO/hour frontend-enforced, backend cache already helps)
- Document IPFS upload constraints
- Begin ED25519 rotation plan for mainnet track

### 4.2 Black Hat Team (Offensive Security)

**Assessment: Attack surface analysis**

Attack vectors tested (theoretical):

| Vector | Status | Notes |
|--------|--------|-------|
| Self-approve candidature | EXPLOITABLE | Issue #2, zero access control |
| Spam channels as non-member | EXPLOITABLE | Issue #3, no membership check |
| Sybil flag-to-hide content | EXPLOITABLE | 3 accounts auto-hide, no cost |
| AI analyst prompt injection | LOW RISK | Render() data is structured, but LLM could hallucinate |
| Cross-chain cache poisoning | FIXED (v3.3) | chain_id now in analyst_reports |
| SSRF via gnoweb fetcher | MITIGATED | SSRF guard + allowlist in v3.2 |
| Session token theft | LOW | Fly.io secret, 24h expiry, nonce prevents replay |
| Escrow drain | NOT DEPLOYED | Template hardened (CEI pattern, exact payment) |
| NFT marketplace price manipulation | NOT DEPLOYED | 2.5% fee, offer timeout safety valve |

Priority exploits to close:
1. Candidature self-approval (trivial to exploit)
2. Channel spam (griefing, content flooding)
3. Flag sybil attack (3 accounts = content hidden, low cost)

Recommendations:
- Fix issues #2 and #3
- Add economic cost to flagging (stake GNOT to flag, slash if flag rejected)
- Consider reputation-gated posting thresholds
- Run Security Guard automated scan on all realm code before redeployment

### 4.3 UX/UI Expert

**Assessment: 8/10 — Feature-rich, needs polish for mainstream adoption**

Strengths:
- Kodera design system provides visual consistency
- Cmd+K palette (14 commands) is a power-user delight
- Offline resilience (localStorage persistence) is excellent
- Multi-network switching with ChainMismatchBanner is clear
- Quest system gamifies onboarding effectively

Issues identified:
1. **Feature overload for new users.** Sidebar has 12+ items. New users see DAOs, Tokens, Validators, Channels, Teams, Quests, Gnolove, Directory, Extensions, NFTs, Services, Marketplace. Consider progressive disclosure.
2. **Coming Soon gates** — 3 sidebar items show "Coming Soon" badges. This signals incompleteness. Either hide them entirely or show a teaser landing page with email capture.
3. **AI Reports UX** — Copy/Download buttons added (PR #272) but no "Share via link" option. DAO governance reports should be shareable.
4. **Mobile responsiveness** — Not tested in recent PRs. Bundle is 496KB (good), but complex layouts (heatmap, candidature bridge, NFT gallery) may break on small screens.
5. **Onboarding flow** — No guided tour/wizard for first-time users. Quest system exists but requires discovery.

Recommendations:
- Implement progressive sidebar (collapse gated features by default, expand when enabled)
- Add onboarding wizard (3-step: connect wallet → join DAO → complete first quest)
- Test all pages on 375px/428px viewports
- Add shareable report links (hash-based URLs for AI reports)

### 4.4 Gno Core Team Perspective

**Assessment: 8.5/10 — Best-in-class Gno dApp, good upstream tracking**

Strengths:
- Strategy pattern for boards V1/V2 parser is the correct approach
- Configurable GovDAO vote function constants handle upstream API drift
- ABCI query layer is well-abstracted (`queryRender`, `queryEval`)
- `getUserRegistryPath()` ready for `r/gnoland/users` → `r/sys/users` migration
- Multi-network support (test12, test11, gnoland1, portal-loop) is exemplary

Concerns:
1. **boards2 permissions change (#5346)** — New storage-efficient permission model. Memba's `parserV2.ts` skeleton may need updates. Monitor closely.
2. **GovDAO proposal rejection on execution error (#5261)** — Memba should surface this new state in proposal detail views.
3. **halt_height config (#5334)** — For validator dashboard: show planned halt height if configured.
4. **`r/sys/users` migration** — 13 references in Memba. The abstraction is ready but migration hasn't been triggered. Wait for testnet upgrade.
5. **GRC721 standard** is still evolving. NFT gallery should be defensive about metadata format changes.

Recommendations:
- Subscribe to gno release notes for testnet upgrade announcements
- Add `proposalRejected` state handling in proposal detail UI
- Surface halt_height in validator dashboard when present
- Keep GRC721 parser flexible (schema validation, not hard types)

### 4.5 Senior Gno Core Engineer

**Assessment: Technical deep-dive on realm architecture**

Realm code review (samcrew-deployer):

| Realm | LOC | Tests | Quality | Issues |
|-------|-----|-------|---------|--------|
| memba_dao | ~300 | 61 | Good | None |
| memba_dao_candidature | ~180 | 61 | CRITICAL | No ACL on approve/reject |
| memba_dao_channels | ~340 | 61 | CRITICAL | No ACL on writes |
| tokenfactory | ~250 | 11 | Good | None |
| nft_market | ~400 | — | Good | CEI pattern correct |
| escrow | ~200 | — | Good | Exact payment, FeeRecipient validated |
| agent_registry | ~150 | — | OK | Not deployed |

Architecture observations:
1. **Dependency graph is correct.** gnodaokit → tokenfactory → memba_dao → candidature → channels. Deploy order matches.
2. **ACL fix approach:** Use `crossing()` + `std.PreviousRealm()` pattern. The candidature realm should check that the caller is the DAO admin or a designated approver role from basedao.
3. **Channel ACL:** Import `basedao.HasRole()` or cross-call `memba_dao.IsAdmin()`. Check WriteRoles against caller's roles.
4. **Immutability warning:** Current paths are burned after rollback redeploy. If security fixes change the API surface, consider versioned paths (`/v2`) to avoid confusion.

Recommendations:
- Use `crossing()` guard pattern consistently across all realm entry points
- Add fuzz tests for realm entry points (unexpected inputs, edge cases)
- Consider realm upgrade pattern from gnodaokit's new `upgradable daos` feature (#57)

### 4.6 Senior GnoVM Engineer

**Assessment: Runtime compatibility analysis**

Recent GnoVM changes that affect Memba:

| Change | PR | Impact | Action |
|--------|-----|--------|--------|
| Reject `chan` type at preprocess | #5238 | None (Memba doesn't use channels in Gno) | No action |
| Go-compliant variable init order | #5247 | LOW — could affect realm init if complex init deps | Verify realm init order after redeployment |
| Amino error instead of panic for malformed type_url | #5399 | Improves error handling for ABCI queries | Memba already handles ABCI errors gracefully |

GnoVM considerations for Memba's realm code:
1. **Storage costs** — boards2 #5346 reduces storage for permissions. Memba's channel ACL should follow the same pattern (bitfield roles instead of string arrays).
2. **Crossing realm calls** — gnodaokit's `crossing dao` (#55) is the recommended pattern for inter-realm auth. Use this for candidature/channels ACL fix.
3. **Gas estimation** — Memba uses 150M gas_wanted on test12. With realm complexity growing (NFT market, escrow), monitor actual gas usage and adjust.

### 4.7 Senior DevRel

**Assessment: 7.5/10 — Strong product, needs better developer onboarding**

Strengths:
- SKILL.md is excellent for AI agent integration
- CONTRIBUTING.md exists with clear workflow
- MCP server (9 tools) enables programmatic access
- ARCHITECTURE.md and API.md are comprehensive

Gaps:
1. **No developer quickstart video or interactive tutorial.** README has text instructions but a 5-minute video would 10x onboarding.
2. **No example integrations.** Show how to build a custom DAO plugin using Memba's MCP server.
3. **CHANGELOG is 142KB.** Consider splitting into per-version files or a searchable web changelog.
4. **No public demo instance.** test12 requires Adena wallet setup. A read-only demo mode would lower the barrier.
5. **gnodaokit documentation** — 10 open issues include "Add README for every package" (#50). Memba depends on this.

Recommendations:
- Create `/demo` route with mock data (no wallet required)
- Record 3 video walkthroughs: (1) Create DAO, (2) Manage treasury, (3) Use AI analyst
- Split CHANGELOG into `changelogs/v3.3.md`, `changelogs/v3.2.md`, etc.
- Contribute to gnodaokit docs (benefits Memba's own documentation)

### 4.8 Senior Fullstack Engineer

**Assessment: 8.5/10 — Clean architecture, some technical debt**

Frontend (React + Vite):
- React 19 + TypeScript 6 + Vite 7.3 — bleeding edge, well-maintained
- 259 test files with Vitest — excellent coverage
- Vanilla CSS (Kodera design system) — consistent but harder to maintain than utility-first
- Bundle 496KB (143KB gzip) — within ceiling, but watch Remotion (446KB dep)
- React Query with offline persistence (PR #270) — solid data layer

Backend (Go + ConnectRPC):
- Clean proto-first API design
- SQLite WAL mode — appropriate for single-instance, but limits horizontal scaling
- 87 tests — good but could be higher for backend complexity
- No database connection pooling documented — SQLite handles this internally but should be explicit

Technical debt identified:
1. **Remotion dependency** (446KB) for landing page animation. Consider lazy-loading or replacing with CSS animations.
2. **BoardView 676 LOC** — deferred decomposition from v2.6. Still stable but a maintenance risk.
3. **13 `r/gnoland/users` references** — migration abstraction ready but not triggered.
4. **No API versioning** — ConnectRPC services have no version prefix. Future breaking changes will be painful.

Recommendations:
- Lazy-load Remotion (only needed on landing page)
- Add ConnectRPC service versioning (`/v1/`) before adding more RPCs
- Increase backend test coverage to match frontend quality bar
- Consider SQLite → Turso/LibSQL for read replicas if scaling needed

### 4.9 Senior Smart Contract Hacker

**Assessment: Realm security deep-dive**

Realm-by-realm security review:

**memba_dao.gno** — PASS
- Proper basedao integration
- Role-based access control
- Admin functions protected

**memba_dao_candidature.gno** — FAIL
- `MarkApproved()` / `MarkRejected()`: No caller verification. Any address can call.
- `Apply()`: No duplicate application check (can spam applications).
- Missing: Re-candidature cost enforcement mentioned in design but not in code.
- Fix: Add `assertCallerIsDAO()` helper using `std.PreviousRealm().PkgPath()`.

**memba_dao_channels.gno** — FAIL
- All 5 write functions lack ACL checks despite roles being defined in data structures.
- `FlagThread()`: 3 flags = auto-hide. No cost to flagging. Trivial sybil attack.
- `RemoveThread()`: Moderation action with zero permission check.
- Fix: Add role checks for each write operation. Add stake-to-flag mechanism.

**nft_market.gno** — PASS (not deployed)
- CEI (Checks-Effects-Interactions) pattern followed
- 2.5% platform fee correctly calculated
- Offer escrow with 7-day timeout safety valve
- Exact payment verification (no overpay vulnerability)

**escrow.gno** — PASS (not deployed)
- Milestone-based payments correctly structured
- FeeRecipient validation present
- Input limits enforced

**tokenfactory.gno** — PASS
- 2.5% fee correctly applied
- 24h faucet rate limiting
- Admin-only mint/burn

Recommendations:
1. Fix candidature and channels before redeployment (BLOCKER)
2. Add `assertCallerIsDAO()` pattern to all admin functions
3. Add economic cost to flagging (stake requirement)
4. Run Security Guard automated scan on all realm code
5. Consider formal verification for escrow (handles real value)

### 4.10 DeFi User Perspective

**What I want from Memba:**

1. **Swap execution** — I can see GnoSwap prices but can't swap from Memba. The "List on GnoSwap" button exists but slippage tolerance isn't implemented. This is the #1 gap.
2. **Treasury analytics** — I want to see DAO treasury value over time, not just current balance. Historical charts would help governance decisions.
3. **Token vesting** — DAOs need to distribute tokens with vesting schedules. No support currently.
4. **Yield display** — If a DAO treasury holds staked GNOT, show the staking rewards/APR.
5. **Cross-chain assets** — IBC is blocked but when it ships, I need to see all assets across chains in one view.

Priority ranking: Swap execution > Treasury analytics > Token vesting > Yield display > Cross-chain

### 4.11 DAO User Perspective

**What I want from Memba:**

1. **Proposal notifications** — I get notifications but they're poll-based (30s). I want instant push notifications (email/Telegram) when a proposal I care about is created or near deadline.
2. **Delegation** — I want to delegate my voting power when I'm unavailable. Not implemented.
3. **Proposal templates** — Creating proposals is freeform. I want templates: "Treasury Transfer", "Add Member", "Change Parameter".
4. **Discussion threads on proposals** — I can see proposals but can't discuss them within Memba. I have to go to channels separately.
5. **Voting reminders** — Automated "you haven't voted on Proposal #X, deadline in 24h" nudges.

Priority ranking: Proposal templates > Discussion on proposals > Delegation > Voting reminders > Notifications

### 4.12 DAO Founder Perspective

**What I need from Memba to launch my DAO:**

1. **One-click DAO deployment** — The create-DAO flow exists but still requires manual realm deployment via samcrew-deployer. I want a self-service deploy.
2. **Custom branding** — DAOs should have custom colors/logos, not just the default Memba theme.
3. **Governance-as-a-Service** — White-label option so my DAO's URL is `dao.myproject.com`, not `memba.samourai.app/dao/...`.
4. **Analytics dashboard** — How active is my DAO? Member growth, proposal cadence, treasury flow, engagement metrics.
5. **Recruitment tools** — The candidature system is great but I need a way to actively invite specific addresses.

Priority ranking: Self-service deploy > Analytics > Custom branding > Recruitment > White-label

### 4.13 Desktop User #1 (Power User — macOS)

**UX feedback:**

- Cmd+K palette is fantastic. I use it more than the sidebar.
- Validator heatmap loads slowly on first visit (~3-5s for chunked batch fetching). Needs a skeleton loader.
- AI governance reports are interesting but I can't compare reports over time. Show trend lines.
- The Quest system feels disconnected — I complete quests but the XP doesn't unlock anything visible beyond candidature threshold.
- Dark mode? The white theme is tiring during late-night governance sessions.

### 4.14 Desktop User #2 (Casual User — Windows)

**UX feedback:**

- I don't understand what "Gnolove" means. The name is confusing. Need a subtitle explaining it's "Open Source Contributor Analytics".
- "Coming Soon" badges on sidebar items make the app feel unfinished. Either hide them or give me a waitlist to join.
- When test12 was rolled back, the app showed empty states with no explanation. Need a "network maintenance" banner.
- I tried the NFT section but it says "Coming Soon". Disappointing after seeing it in the changelog.
- The landing page animation (Remotion) is cool but takes 2s to load. Maybe it should be optional.

### 4.15 Mobile User #1 (iOS Safari)

**UX feedback:**

- Sidebar doesn't collapse properly on mobile. It overlaps content.
- Validator heatmap is unreadable on phone screens. Needs horizontal scroll or a different visualization.
- Can't scan QR codes for wallet connect on mobile (desktop-first design).
- Touch targets on proposal vote buttons are too small (< 44px).
- Bottom navigation bar would be more natural than a hamburger menu.

### 4.16 Mobile User #2 (Android Chrome)

**UX feedback:**

- Page loads are fast (496KB bundle is great).
- The NFT gallery grid doesn't adapt to portrait mode — cards are cut off.
- AI report text overflows on small screens.
- Channel messages have no swipe-to-reply gesture.
- No PWA install prompt — I'd like to "Add to Home Screen" with a proper icon.

### 4.17 Manfred Touron (Head of Engineering, Gno)

**Perspective: Ecosystem alignment & upstream coordination**

What Memba does well:
- Best DAO tooling in the Gno ecosystem right now
- Strategy pattern for upstream compatibility is the gold standard — other dApps should follow this
- Multi-network support demonstrates Gno's multi-chain vision
- gnodaokit integration is tight and correct

What I'd want to see next:
1. **Contribute upstream.** Memba's board parser, validator data layer, and ABCI query patterns could be extracted into reusable Gno packages.
2. **Support betanet launch.** When gnoland1 relaunches, Memba should be one of the first dApps live with verified functionality.
3. **Improve GovDAO integration.** The new proposal rejection feature (#5261) should surface in Memba. The halt_height feature (#5334) should show in validator dashboard.
4. **Documentation contribution.** Memba's SKILL.md and ARCHITECTURE.md patterns should be recommended for other Gno projects.
5. **Self-service realm deployment.** The samcrew-deployer model is good for operators but doesn't scale for community DAO creation.

### 4.18 Jae Kwon (Founder of Gno)

**Perspective: Vision alignment & philosophical coherence**

Gno's philosophy is about **simplicity, transparency, and on-chain governance**. Memba should align with:

1. **Minimize off-chain state.** SQLite backend for profiles, quests, teams is pragmatic but aim to move more data on-chain as Gno matures. Profiles should be realm-based.
2. **Governance purity.** The AI analyst is useful but should be clearly labeled as "advisory" — never suggest it replaces human deliberation. Governance is a human activity.
3. **Open participation.** Feature gates and "Coming Soon" badges create artificial scarcity. If the code works, ship it. Let the community discover and test.
4. **Composability.** Memba's realms should be usable independently. A DAO shouldn't need "Memba the product" to use "Memba the smart contracts."
5. **GnoVM-native patterns.** Use `crossing()`, `std.PreviousRealm()`, and realm-based state over external databases where possible.

### 4.19 Blockchain Validator Expert #1

**Assessment: Validator dashboard review**

Strengths:
- Dual-RPC strategy (Samourai sentry + public fallback) is production-grade
- Block heatmap with signer counts is unique and useful
- Validator detail pages with performance metrics match what I use gnockpit for
- Health engine with threshold-based alerting is solid

Missing:
1. **Slashing history** — I need to see if a validator was ever slashed and for what.
2. **Commission rate display** — Not visible in current validator cards.
3. **Governance participation rate** — How often does this validator vote on proposals?
4. **Validator set changes** — Historical view of entries/exits from the active set.
5. **Integration with gnomonitoring alerts** — I want validator-specific alert configuration from within Memba.

### 4.20 Blockchain Validator Expert #2

**Assessment: Operational perspective**

The validator dashboard is the best I've seen for Gno. Feedback:

1. **Real-time block production** — Current 10-block heatmap is good but I want live block streaming (WebSocket or 3s polling for latest block).
2. **Peer count visibility** — The hacker view shows peers but I can't see which specific peers a validator is connected to.
3. **Upgrade coordination** — With halt_height (#5334) coming, validators need to see "chain will halt at block X" prominently displayed. This is safety-critical.
4. **Multi-chain validator tracking** — I validate on test12 AND gnoland1. I want a unified view across chains.
5. **Export metrics** — Prometheus-compatible endpoint for validator health data to integrate with my existing monitoring stack.

### 4.21 Non-Tech Gno.land User #1

**Feedback:**

- I don't understand what a "realm" is. The app uses this word everywhere but never explains it.
- When I click "Create Token," I'm asked for technical details (symbol, decimals). I just want to name my community token.
- The treasury page shows "ugnot" — what is a "ugnot"? Show me the value in a human denomination.
- I want to invite my community to our DAO but the invite flow requires everyone to install a browser extension (Adena). This is a massive barrier.
- The AI governance report uses phrases like "proposal throughput" and "member churn rate" — too technical for community managers.

### 4.22 Non-Tech Gno.land User #2

**Feedback:**

- The app loaded fast and looks professional. First impression is good.
- I couldn't figure out how to join an existing DAO. The directory shows DAOs but there's no "Join" button — I had to find the candidature page separately.
- Notifications work but I don't understand what "Board Post: Re: General Discussion #5" means. Show me the actual message preview.
- The Quest system is fun but the XP feels meaningless after the candidature threshold (100 XP). What else can I unlock?
- I want a mobile app. Using a wallet browser extension on mobile is confusing.

### 4.23 Senior Open Source Contributor #1

**Assessment: OSS health check**

Repository health:
- MIT license — good for adoption
- CONTRIBUTING.md with clear workflow — good
- CODE_OF_CONDUCT.md — good
- No open issues (tracked internally?) — bad for community engagement
- Only 1 open PR (dependabot) — suggests single-team development
- No "good first issue" labels — barrier for new contributors
- No DISCUSSION tab or community forum — missed engagement opportunity

Recommendations:
1. Create 10-15 "good first issue" labels for community onboarding
2. Open GitHub Discussions for feature requests and Q&A
3. Add a `CONTRIBUTORS.md` celebrating contributions
4. Set up a community call cadence (monthly demo + roadmap review)
5. Extract reusable modules (board parser, ABCI client, validator data layer) as standalone packages

### 4.24 Senior Open Source Contributor #2

**Assessment: Code quality & contribution experience**

Tried to contribute:
- Clone → `make setup` → works immediately on macOS. Great DX.
- Test suite runs in ~45s. Acceptable.
- Code style is consistent, ESLint + TypeScript strict mode enforced.
- Proto-first API is well-documented in `api/` directory.
- MCP server has 9 tools — impressive for agent integration.

Issues:
1. **Monorepo structure is implicit.** Frontend/backend/contracts/api are siblings without a workspace manager (nx, turborepo). Hard to understand build dependencies.
2. **No integration tests** that test frontend ↔ backend ↔ chain together. Unit tests are great but the integration boundary is untested.
3. **142KB CHANGELOG** in a single file is unwieldy. Git log is better for historical context.
4. **Stale master roadmap** — MASTER_ROADMAP.md says "last updated v2.28" but project is at v3.3. Confusing.

### 4.25 CTO Synthesis (Your Perspective)

**Overall Assessment: 8/10 — Production-ready with critical security gaps to close**

Memba has achieved remarkable feature completeness for a Gno dApp. The codebase is clean, well-tested, and architecturally sound. The team's discipline in maintaining zero lint/TS errors across 40+ releases is exceptional.

However, the project is at a crossroads:

**Path A — Feature velocity:** Continue shipping new features (revenue, premium, white-label). Risk: security debt compounds, gated features rot.

**Path B — Hardening & activation:** Fix security issues, redeploy realms, activate gated features, prepare for mainnet. Risk: slower visible progress, but foundations are solid.

**Recommendation: Path B first, then A.** The next 4-6 weeks should focus on hardening, activation, and mainnet preparation. Revenue features (v2.3, v3.5) can follow once the foundation is bulletproof.

---

## 6. Priority Matrix

### P0 — Must Do Before Anything Else (Week 1)

| # | Item | Effort | Owner | Blocker? |
|---|------|--------|-------|----------|
| 1 | Fix candidature ACL (issue #2) | 1-2h | Realm dev | Yes — blocks redeployment |
| 2 | Fix channels ACL (issue #3) | 2-4h | Realm dev | Yes — blocks redeployment |
| 3 | Run Security Guard scan on all realm code | 1h | Automation | Yes — validates fixes |
| 4 | Redeploy all realms on test12 (with fixes) | 1-2h | Deployer | Yes — blocks everything |
| 5 | Smoke test all Memba features on new realms | 2h | QA | Yes — validates deployment |

### P1 — High Priority (Weeks 2-3)

| # | Item | Effort | Rationale |
|---|------|--------|-----------|
| 6 | Activate NFT feature gate | 2-4h | Code exists, just needs flag flip + seed collections |
| 7 | Activate Services feature gate | 4-8h | Escrow realm now deployed (with fixes), wire to live data |
| 8 | Activate Marketplace feature gate | 4-8h | Agent registry deployed, replace mock data |
| 9 | Implement GnoSwap slippage tolerance | 2-4h | Spec exists, ~2h core + tests |
| 10 | Add proposalRejected state (upstream #5261) | 2h | Gno merged this, Memba should handle it |
| 11 | Surface halt_height in validator dashboard | 1-2h | Safety-critical for validators |
| 12 | Network maintenance banner | 2h | For events like test12 rollback |
| 13 | Update MASTER_ROADMAP to v3.3+ | 1h | Currently stale at v2.28 |

### P2 — Medium Priority (Weeks 4-6)

| # | Item | Effort | Rationale |
|---|------|--------|-----------|
| 14 | Staging environment (Netlify + Fly.io) | 4-8h | Reduce risk of production bugs |
| 15 | Proposal templates (Treasury Transfer, Add Member, etc.) | 8-12h | Most-requested DAO user feature |
| 16 | Mobile responsiveness audit + fixes | 8-12h | 4 users flagged mobile issues |
| 17 | Progressive sidebar (hide gated features by default) | 2-4h | UX declutter |
| 18 | Dark mode | 8-12h | Power user request, late-night governance |
| 19 | Onboarding wizard (3-step) | 4-8h | Reduce drop-off for new users |
| 20 | Backend test coverage increase | 8-12h | Currently 87 tests vs 1,495 frontend |
| 21 | AI analyst rate limiting | 2-4h | Prevent quota abuse |
| 22 | Lazy-load Remotion | 2-4h | Reduce landing page load time |

### P3 — Lower Priority (Weeks 7-10)

| # | Item | Effort | Rationale |
|---|------|--------|-----------|
| 23 | ConnectRPC API versioning (/v1/) | 4-8h | Prevent future breaking changes |
| 24 | Glossary/tooltips for non-tech terms | 4-8h | "realm", "ugnot", "ABCI" confuse users |
| 25 | "Good first issue" labels + GitHub Discussions | 2h | OSS community engagement |
| 26 | Treasury analytics (historical charts) | 8-12h | DeFi user priority |
| 27 | Validator slashing history + commission | 4-8h | Validator expert requests |
| 28 | Discussion threads on proposals | 8-12h | DAO user priority |
| 29 | Shareable AI report links | 2-4h | UX improvement |
| 30 | PWA manifest + install prompt | 2-4h | Mobile user request |
| 31 | ED25519 key rotation plan | 4-6h | Pre-mainnet security |
| 32 | Extract reusable packages (board parser, ABCI client) | 8-12h | OSS contribution + ecosystem value |

### Deferred (Post-Mainnet / H2 2026+)

| Item | Notes |
|------|-------|
| Self-service realm deployment | Requires Gno tooling maturity |
| Governance-as-a-Service / white-label | v3.5 track |
| Token vesting schedules | Needs realm support |
| Voting delegation | Needs gnodaokit support |
| Inter-DAO bridge | v4.0 horizon |
| On-chain profiles (replace SQLite) | When Gno has efficient key-value patterns |
| CSP nonce-based (remove unsafe-inline) | When build tooling supports it |
| Separate Clerk apps (dev/prod) | When team grows beyond 3 |

---

## 7. Implementation Phases

```
Phase 0: Security Code Fixes      [Week 1]              ← Code-only, no chain needed
Phase 1: GnoBuilders Quest System  [Weeks 2-4]           ← Major new feature, no chain needed
Phase 2: UX & Polish              [Weeks 3-5, parallel]  ← Mobile, dark mode, onboarding
Phase 3: Realm Redeployment       [When test12 stable]   ← External trigger, decoupled
Phase 4: Feature Activation        [After Phase 3]        ← NFT, Services, Marketplace, GnoSwap
Phase 5: Mainnet Preparation      [Weeks 6-8]            ← Staging, upstream compat, key rotation
Phase 6: DAO Power Features + OSS [Weeks 9-12]           ← Templates, analytics, packages
```

---

## 8. Detailed Sprint Plans

### Phase 0 — Security & Recovery (Week 1)

**Goal:** Fix critical vulnerabilities, redeploy realms, verify production.

**Sprint 0.1 — Realm Security Fixes (Day 1-2)**

```
Task 0.1.1: Fix memba_dao_candidature ACL
  File: samcrew-deployer/projects/memba/realms/memba_dao_candidature/memba_dao_candidature.gno
  Change: Add assertCallerIsDAO() check to MarkApproved() and MarkRejected()
  Pattern: std.PreviousRealm().PkgPath() == "gno.land/r/samcrew/memba_dao"
  Tests: Add tests for unauthorized caller rejection
  
Task 0.1.2: Fix memba_dao_channels ACL
  File: samcrew-deployer/projects/memba/realms/memba_dao_channels/memba_dao_channels.gno
  Change: Add membership/role checks to PostThread, PostReply, CreateChannel, RemoveThread, FlagThread
  Pattern: Cross-call memba_dao to verify membership, check WriteRoles against caller roles
  Tests: Add tests for unauthorized access attempts per operation
  
Task 0.1.3: Add flag-cost mechanism (stretch)
  Change: Require GNOT stake to flag content. Slash if flag rejected by moderators.
  Prevents: Sybil flag-to-hide attacks (currently 3 accounts = auto-hide)

Task 0.1.4: Run Security Guard scan
  Command: cd "Samourai Gno Security Guard" && go run ./cmd/guard scan ../samcrew-deployer/projects/memba/realms/
  Verify: All HIGH/CRITICAL findings resolved
```

**Sprint 0.2 — Redeployment (Day 3)**

```
Task 0.2.1: Pre-deploy validation
  - Verify realm tests pass locally: make test-all
  - Run samcrew-deployer pre-flight checks
  - Confirm deploy key balance on test12
  
Task 0.2.2: Full redeployment
  - Deploy order: gnodaokit (4 pkg) → tokenfactory → memba_dao → candidature → channels → nft_market → escrow
  - Use samcrew-deployer: make deploy-all NETWORK=test12
  - 3s TX spacing, verify each artifact
  
Task 0.2.3: Post-deploy smoke tests
  - Verify Render() output for each realm
  - Test MsgCall for key operations
  - Verify Memba frontend loads DAO data from new deployment
  - Run E2E test suite against new deployment
```

**Sprint 0.3 — Verification (Day 4-5)**

```
Task 0.3.1: End-to-end verification
  - Create a test DAO via Memba UI
  - Submit and approve a candidature
  - Post in channels (verify ACL blocks unauthorized)
  - Create a GRC20 token
  - Submit and vote on a proposal
  
Task 0.3.2: Document deployment
  - Update DEPLOYMENT_RUNBOOK.md with new block numbers
  - Update CHANGELOG.md with security fixes
  - Close samcrew-deployer issues #2 and #3
```

### Phase 1 — Feature Activation (Weeks 2-3)

**Goal:** Flip feature gates for already-implemented features, wire to live on-chain data.

**Sprint 1.1 — NFT Activation (Week 2, Days 1-3)**

```
Task 1.1.1: Deploy GRC721 seed collection on test12
  - Use nft_market realm (already in samcrew-deployer)
  - Mint 3-5 test NFTs with IPFS metadata
  
Task 1.1.2: Enable VITE_ENABLE_NFT flag
  - Update .env.production: VITE_ENABLE_NFT=true
  - Verify NFT Gallery renders collection metadata
  - Verify Marketplace tab shows listings
  - Verify Activity tab shows transfer history
  
Task 1.1.3: Test NFT operations end-to-end
  - List NFT for sale → Buy → Verify transfer
  - Make offer → Accept → Verify escrow release
  - Cancel listing → Verify state rollback
```

**Sprint 1.2 — Services Activation (Week 2, Days 3-5)**

```
Task 1.2.1: Verify escrow realm on test12
  - Confirm escrow is deployed (from Phase 0 redeployment)
  - Test milestone creation, funding, completion
  
Task 1.2.2: Replace mock data in FreelanceServices.tsx
  - Wire to on-chain escrow ABCI queries
  - Replace agentRegistry.ts mock with real data
  
Task 1.2.3: Enable VITE_ENABLE_SERVICES flag
  - Update .env.production: VITE_ENABLE_SERVICES=true
  - Verify service listings render
  - Test bounty posting flow
```

**Sprint 1.3 — Marketplace Activation (Week 3, Days 1-3)**

```
Task 1.3.1: Verify agent_registry realm on test12
  - Confirm deployment, test registration flow
  
Task 1.3.2: Replace mock data in Marketplace.tsx
  - Wire to on-chain agent_registry ABCI queries
  - Real agent cards instead of mock data
  
Task 1.3.3: Enable VITE_ENABLE_MARKETPLACE flag
  - Update .env.production: VITE_ENABLE_MARKETPLACE=true
  - Verify agent listings render
  - Test install/uninstall per-DAO flow
```

**Sprint 1.4 — GnoSwap Integration (Week 3, Days 3-5)**

```
Task 1.4.1: Implement slippage tolerance
  - Follow spec in docs/planning/GNOSWAP_SLIPPAGE.md
  - Add slippage input (0.5%, 1%, 3% presets + custom)
  - Add price impact warning (>5% = yellow, >10% = red)
  - Calculate minimum received amount
  
Task 1.4.2: Build swap execution MsgCall
  - MsgCall builder for GnoSwap ExactIn/ExactOut
  - Integrate with Adena signing flow
  
Task 1.4.3: Tests
  - Unit tests for slippage calculation
  - Unit tests for MsgCall builder
  - E2E test for swap flow (mock signing)
```

### Phase 2 — UX & Polish (Weeks 4-5)

**Sprint 2.1 — Mobile Responsiveness (Week 4)**

```
Task 2.1.1: Audit all pages at 375px and 428px viewports
  - Document all breakages
  - Priority fix list
  
Task 2.1.2: Fix critical mobile issues
  - Sidebar collapse behavior
  - Validator heatmap horizontal scroll
  - NFT gallery portrait mode
  - Touch target sizes (minimum 44px)
  - AI report text overflow
  
Task 2.1.3: Add PWA manifest
  - manifest.json with icons
  - Service worker for offline caching
  - Install prompt on mobile
```

**Sprint 2.2 — Onboarding & Navigation (Week 4-5)**

```
Task 2.2.1: Progressive sidebar
  - Collapse gated/coming-soon items by default
  - Show items only when feature flag is enabled
  - Add "Explore more features" expandable section
  
Task 2.2.2: Onboarding wizard
  - Step 1: Connect Adena wallet (with fallback instructions)
  - Step 2: Browse and join a DAO (or create one)
  - Step 3: Complete first quest
  - Dismissible, stores completion in localStorage
  
Task 2.2.3: Network maintenance banner
  - Component: NetworkStatusBanner
  - Check backend health endpoint + chain RPC status
  - Show "Network under maintenance" when chain is down or rolled back
  - Dismissible per-session
  
Task 2.2.4: Glossary tooltips
  - Add tooltip component wrapping technical terms
  - "realm" → "A smart contract on Gno"
  - "ugnot" → "Micro-GNOT (1 GNOT = 1,000,000 ugnot)"
  - "ABCI" → (hide from users, use "blockchain query")
```

**Sprint 2.3 — Dark Mode (Week 5)**

```
Task 2.3.1: CSS custom properties refactor
  - Extract all color values to CSS variables in :root
  - Create [data-theme="dark"] override set
  - Kodera design system dark palette
  
Task 2.3.2: Theme toggle
  - Settings page toggle
  - localStorage persistence
  - System preference detection (prefers-color-scheme)
  - Cmd+K command: "Toggle dark mode"
  
Task 2.3.3: Test all pages in dark mode
  - Charts (Recharts) — custom theme
  - Code blocks (Gno syntax highlighting) — dark palette
  - Modals, dropdowns, tooltips
```

### Phase 3 — Mainnet Preparation (Weeks 5-6)

**Sprint 3.1 — Infrastructure (Week 5-6)**

```
Task 3.1.1: Staging environment
  - Netlify branch deploy for `staging` branch
  - Separate Fly.io app: memba-backend-staging
  - Own SQLite volume
  - VITE_API_URL pointing to staging backend
  
Task 3.1.2: Upstream compatibility updates
  - Handle proposalRejected state from govdao #5261
  - Add halt_height display in validator dashboard (#5334)
  - Monitor boards2 #5037 and govdao #5222
  
Task 3.1.3: r/sys/users migration prep
  - getUserRegistryPath() already abstracted
  - Add feature flag: VITE_USER_REGISTRY_PATH
  - Default: "gno.land/r/gnoland/users"
  - Override to "gno.land/r/sys/users" when testnets upgrade
  
Task 3.1.4: ED25519 key rotation plan
  - Design ED25519_SEED_V{N} versioning
  - Implement graceful migration (accept V{N} and V{N-1} during transition)
  - Document rotation procedure in deployment runbook
```

**Sprint 3.2 — Backend Hardening (Week 6)**

```
Task 3.2.1: Increase backend test coverage
  - Target: 150+ backend tests (from current 87)
  - Focus: auth challenge-response, team RPCs, quest sync
  - Add integration tests: frontend mock → backend → SQLite
  
Task 3.2.2: AI analyst rate limiting
  - Backend: max 1 fresh report per DAO per hour (cache serves otherwise)
  - Frontend: debounce button, disable during generation
  - Add retry-after header when rate limited
  
Task 3.2.3: ConnectRPC API versioning
  - Add /v1/ prefix to all service paths
  - Backward-compatible: old paths redirect to /v1/
  - Document in API.md
```

### Phase 4 — DAO Power Features (Weeks 7-8)

**Sprint 4.1 — Proposal Templates (Week 7)**

```
Task 4.1.1: Template engine
  - ProposalTemplate interface: { name, description, fields[], buildMsg() }
  - Built-in templates:
    - "Treasury Transfer" — recipient, amount, denomination
    - "Add Member" — address, role
    - "Remove Member" — address
    - "Change Parameter" — key, value
    - "Custom" — freeform (current behavior)
  
Task 4.1.2: Template selection UI
  - ProposalCreatePage: template picker step before form
  - Template-specific form fields with validation
  - Preview step showing the generated MsgCall
  
Task 4.1.3: Tests
  - Unit tests for each template's buildMsg()
  - E2E test for template-based proposal creation
```

**Sprint 4.2 — Treasury Analytics (Week 7-8)**

```
Task 4.2.1: Historical balance tracking
  - Backend: periodic snapshot of DAO treasury balances (hourly cron)
  - New table: treasury_snapshots (dao_path, chain_id, balance, token, timestamp)
  - API: GetTreasuryHistory(dao_path, range)
  
Task 4.2.2: Treasury charts
  - Line chart: balance over time (7d, 30d, 90d, 1y)
  - Breakdown by token (stacked area chart)
  - Inflow/outflow indicators
  
Task 4.2.3: Treasury value display
  - Convert ugnot to GNOT for display (÷ 1,000,000)
  - Show approximate USD value if price feed available
```

**Sprint 4.3 — Proposal Discussions (Week 8)**

```
Task 4.3.1: In-proposal discussion thread
  - Reuse channel infrastructure (PostThread/PostReply)
  - Auto-create discussion thread when proposal is created
  - Show discussion count on proposal card
  
Task 4.3.2: Discussion UI
  - Expandable section on ProposalDetail page
  - Reply form with markdown support
  - Thread-based (top-level comments + replies)
```

### Phase 5 — Ecosystem & OSS (Weeks 9-10)

**Sprint 5.1 — Package Extraction (Week 9)**

```
Task 5.1.1: Extract board parser as standalone package
  - @memba/gno-board-parser
  - V1/V2 strategy pattern
  - Published to npm
  
Task 5.1.2: Extract ABCI query client
  - @memba/gno-abci-client
  - queryRender, queryEval, queryBank abstractions
  - Multi-network configuration
  
Task 5.1.3: Extract validator data layer
  - @memba/gno-validators
  - Health engine, heatmap data, dual-RPC strategy
```

**Sprint 5.2 — Community Engagement (Week 9-10)**

```
Task 5.2.1: Create 15 "good first issue" labels
  - UI tweaks, documentation, test coverage gaps
  - Each with clear description and acceptance criteria
  
Task 5.2.2: Enable GitHub Discussions
  - Categories: Feature Requests, Q&A, Show & Tell, Announcements
  - Seed with 3-5 discussion topics
  
Task 5.2.3: CHANGELOG split
  - Create changelogs/ directory
  - Split 142KB file into per-major-version files
  - Keep CHANGELOG.md as index pointing to individual files
  
Task 5.2.4: Update MASTER_ROADMAP.md
  - Bring up to v3.3+ status
  - Add Phase 0-5 milestones
  - Clean up stale quality gate numbers
```

---

## 9. NEW FEATURE — GnoBuilders: The Gno Developer Game

### 9.1 Vision

**GnoBuilders** is a gamified quest system that transforms Memba into the definitive onboarding platform for the Gno ecosystem. It expands the current 10-quest/125-XP system into a **60-100 quest experience** spanning developer challenges, community participation, and on-chain mastery.

**Why now:**
- The current quest system (10 quests, 125 XP) is too shallow — users hit the 100 XP candidature threshold quickly and then XP becomes meaningless
- Gno's biggest bottleneck is developer onboarding — GnoBuilders solves this with progressive, hands-on quests
- NFT infrastructure already exists (GRC721/GRC1155 templates, marketplace) — badges are a natural use case
- No chain dependency for most quest logic — can build NOW while test12 stabilizes
- Memba becomes the "front door" to the Gno ecosystem, not just a DAO tool

**Core loop:**
```
Complete Quest → Earn XP + Badge NFT → Unlock Rank → Display on Profile
                                    → Unlock DAO Access (candidature)
                                    → Unlock Cosmetics (frames, titles)
                                    → Climb Leaderboard
```

### 9.2 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     QUEST ENGINE                         │
│                                                          │
│  Quest Registry (60-100 quests)                          │
│    ├── Category: Developers (~30 quests)                 │
│    ├── Category: Everyone (~30 quests)                   │
│    ├── Category: Community Champion (~15 quests)         │
│    └── Category: Hidden / Seasonal (~10-15 quests)       │
│                                                          │
│  Verification Layer                                      │
│    ├── On-chain verifier (ABCI queries)                  │
│    ├── Off-chain verifier (backend checks)               │
│    ├── Social verifier (OAuth / link proof)              │
│    └── Self-report verifier (manual claim + review)      │
│                                                          │
│  Reward Engine                                           │
│    ├── XP Calculator (per-quest, bonus multipliers)      │
│    ├── Badge Minter (GRC721 NFT per achievement)         │
│    ├── Rank System (Bronze → Diamond, 8 tiers)           │
│    └── Cosmetics Unlocker (profile frames, titles)       │
│                                                          │
│  Display Layer                                           │
│    ├── Quest Hub (browseable catalog, filters, progress) │
│    ├── Profile Achievements (badge gallery, rank badge)  │
│    ├── Leaderboard (global + per-DAO + per-category)     │
│    └── DAO Candidature (rank-gated, not just XP-gated)   │
└─────────────────────────────────────────────────────────┘
```

### 9.3 Quest Catalog — Complete List

#### Category 1: Developers (~30 quests)

**Package Deployment Series (10 quests, progressive difficulty):**

| # | Quest ID | Title | Description | XP | Verification |
|---|----------|-------|-------------|----|----|
| D1 | `deploy-hello-pkg` | Hello Gno | Deploy a "Hello World" package on Gno | 20 | On-chain: ABCI verify package exists at user's path |
| D2 | `deploy-counter-pkg` | State Machine | Deploy a package with mutable state (counter) | 25 | On-chain: verify package + call Increment() |
| D3 | `deploy-avl-pkg` | Tree Builder | Deploy a package using AVL trees for storage | 30 | On-chain: verify avl import in package |
| D4 | `deploy-interface-pkg` | Abstraction Master | Deploy a package that exports an interface | 30 | On-chain: verify interface in Render() |
| D5 | `deploy-test-pkg` | Test-Driven Dev | Deploy a package with passing tests (gno test) | 35 | Off-chain: user submits proof (screenshot/link) |
| D6 | `deploy-import-pkg` | Dependency Chain | Deploy a package that imports another user's package | 35 | On-chain: verify cross-package import |
| D7 | `deploy-event-pkg` | Event Emitter | Deploy a package that uses std.Emit() events | 40 | On-chain: verify event emission pattern |
| D8 | `deploy-ownable-pkg` | Access Control | Deploy a package with owner-only functions | 40 | On-chain: verify Ownable pattern |
| D9 | `deploy-upgradable-pkg` | Evolving Code | Deploy a package using gnodaokit's upgradable pattern | 50 | On-chain: verify upgrade mechanism |
| D10 | `deploy-governance-pkg` | Governance Architect | Deploy a full DAO with basedao + custom conditions | 60 | On-chain: verify basedao integration |

**Realm Deployment Series (10 quests, progressive difficulty):**

| # | Quest ID | Title | Description | XP | Verification |
|---|----------|-------|-------------|----|----|
| D11 | `deploy-hello-realm` | Realm Rookie | Deploy your first realm with Render() | 20 | On-chain: ABCI query Render("") returns content |
| D12 | `deploy-grc20-realm` | Token Creator | Deploy a GRC20 token realm | 30 | On-chain: verify GRC20 interface functions |
| D13 | `deploy-grc721-realm` | NFT Artist | Deploy a GRC721 NFT collection realm | 35 | On-chain: verify GRC721 interface |
| D14 | `deploy-board-realm` | Forum Builder | Deploy a realm with board/post functionality | 30 | On-chain: verify board Render() |
| D15 | `deploy-dao-realm` | DAO Deployer | Deploy a DAO realm using gnodaokit | 40 | On-chain: verify DAO Render() members |
| D16 | `deploy-crossing-realm` | Cross-Realm Caller | Deploy a realm that calls another realm | 45 | On-chain: verify crossing() pattern |
| D17 | `deploy-escrow-realm` | Trust Machine | Deploy an escrow realm with milestone payments | 50 | On-chain: verify escrow state machine |
| D18 | `deploy-marketplace-realm` | Market Maker | Deploy a marketplace realm with listings | 50 | On-chain: verify listing + buy flow |
| D19 | `deploy-multisig-realm` | Multi-Signer | Deploy a realm with multi-signature execution | 55 | On-chain: verify signature collection |
| D20 | `deploy-full-dapp` | Full Stack Gno | Deploy a complete dApp (realm + frontend integration) | 75 | Off-chain: submit link to working dApp |

**Advanced Developer Quests (10 quests):**

| # | Quest ID | Title | Description | XP | Verification |
|---|----------|-------|-------------|----|----|
| D21 | `write-10-tests` | Test Warrior | Write 10+ passing tests for your realm | 30 | Off-chain: submit test output |
| D22 | `fix-upstream-bug` | Upstream Contributor | Get a PR merged to gnolang/gno | 100 | Off-chain: GitHub PR link verification |
| D23 | `audit-realm` | Security Auditor | Use Security Guard to audit a realm and fix findings | 40 | Off-chain: submit scan report |
| D24 | `deploy-3-chains` | Multi-Chain Dev | Deploy the same package on 3 different networks | 45 | On-chain: verify on test12 + test11 + portal-loop |
| D25 | `build-mcp-tool` | Agent Builder | Create a custom MCP tool that queries Gno | 50 | Off-chain: submit MCP tool code |
| D26 | `gas-optimization` | Gas Golfer | Reduce gas usage of a realm operation by 20%+ | 40 | Off-chain: submit before/after gas comparison |
| D27 | `render-masterclass` | Render Wizard | Deploy a realm with rich Render() output (tables, links, formatting) | 30 | On-chain: verify Render() richness |
| D28 | `gnodaokit-extension` | Kit Extender | Create a gnodaokit extension module | 60 | Off-chain: submit extension code |
| D29 | `deploy-ibc-realm` | Bridge Builder | Deploy a realm that handles IBC messages | 75 | On-chain: verify IBC handler (when IBC2 available) |
| D30 | `mentor-developer` | Gno Mentor | Help 3 other developers complete their first quest | 50 | Off-chain: verification by mentees |

#### Category 2: Everyone (~30 quests)

**Getting Started (10 quests):**

| # | Quest ID | Title | Description | XP | Verification |
|---|----------|-------|-------------|----|----|
| E1 | `connect-wallet` | Wallet Connected | Connect your Adena wallet to Memba | 10 | Off-chain: existing auth check (KEEP from v1) |
| E2 | `setup-profile` | Identity | Set up your Memba profile (bio + avatar) | 15 | Off-chain: backend profile has bio + avatar_url |
| E3 | `register-username` | Named | Register a @username on gno.land | 20 | On-chain: verify r/gnoland/users registration |
| E4 | `first-transaction` | First Transaction | Make any transaction on Gno | 15 | On-chain: verify tx count > 0 for address |
| E5 | `visit-5-pages` | Explorer | Visit 5 different pages in Memba | 10 | Off-chain: existing page tracking (KEEP from v1) |
| E6 | `use-cmdk` | Power User | Use the Cmd+K command palette | 10 | Off-chain: existing tracking (KEEP from v1) |
| E7 | `switch-network` | Network Hopper | Switch between two networks | 15 | Off-chain: existing tracking (KEEP from v1) |
| E8 | `view-validator` | Validator Watcher | View a validator's detail page | 10 | Off-chain: existing tracking (KEEP from v1) |
| E9 | `faucet-claim` | Free Tokens | Claim tokens from the testnet faucet | 10 | On-chain: verify faucet claim tx |
| E10 | `read-docs` | Scholar | Visit the Gno documentation site | 10 | Off-chain: track link click to docs.gno.land |

**DAO Participation (10 quests):**

| # | Quest ID | Title | Description | XP | Verification |
|---|----------|-------|-------------|----|----|
| E11 | `join-dao` | DAO Member | Join any DAO (via candidature or direct add) | 25 | On-chain: verify DAO membership |
| E12 | `create-dao` | DAO Founder | Create your own DAO using Memba | 30 | On-chain: verify new DAO realm exists |
| E13 | `vote-proposal` | First Vote | Cast your first vote on a DAO proposal | 20 | On-chain: verify vote tx |
| E14 | `create-proposal` | Proposal Author | Create a governance proposal | 25 | On-chain: verify proposal in DAO |
| E15 | `vote-5-proposals` | Active Voter | Vote on 5 different proposals | 30 | On-chain: verify 5 vote txs |
| E16 | `execute-proposal` | Executor | Execute an approved proposal | 25 | On-chain: verify execution tx |
| E17 | `post-board` | Forum Poster | Post a message on a DAO board | 15 | On-chain: verify board post exists |
| E18 | `reply-board` | Conversationalist | Reply to a board post | 10 | On-chain: verify reply post |
| E19 | `browse-proposals` | Governance Viewer | Browse a DAO's proposals page | 15 | Off-chain: existing tracking (KEEP from v1) |
| E20 | `submit-candidature` | Applicant | Submit a candidature to join a DAO | 20 | On-chain: verify candidature submission |

**Token & NFT (5 quests):**

| # | Quest ID | Title | Description | XP | Verification |
|---|----------|-------|-------------|----|----|
| E21 | `create-token` | Token Minter | Create a GRC20 token using the token factory | 25 | On-chain: verify token realm exists |
| E22 | `send-tokens` | Token Sender | Send tokens to another address | 15 | On-chain: verify transfer tx |
| E23 | `mint-nft` | NFT Collector | Mint or buy your first NFT | 20 | On-chain: verify NFT ownership |
| E24 | `list-nft` | NFT Trader | List an NFT for sale on the marketplace | 20 | On-chain: verify marketplace listing |
| E25 | `hold-5-tokens` | Portfolio Builder | Hold 5+ different GRC20 tokens | 25 | On-chain: verify multiple token balances |

**Social & Community (5 quests):**

| # | Quest ID | Title | Description | XP | Verification |
|---|----------|-------|-------------|----|----|
| E26 | `follow-twitter` | Gno Follower | Follow @_gnoland on Twitter/X | 10 | Social: OAuth or link proof |
| E27 | `join-discord` | Community Member | Join the Gno Discord server | 10 | Social: OAuth or link proof |
| E28 | `share-link` | Ambassador | Share a Memba link with someone | 10 | Off-chain: existing tracking (KEEP from v1) |
| E29 | `submit-feedback` | Voice Heard | Submit feedback via the Feedback page | 20 | Off-chain: existing tracking (KEEP from v1) |
| E30 | `invite-member` | Recruiter | Invite someone to join your team via invite code | 15 | Off-chain: verify team join via invite |

#### Category 3: Community Champion (~15 quests)

| # | Quest ID | Title | Description | XP | Verification |
|---|----------|-------|-------------|----|----|
| C1 | `complete-all-everyone` | Completionist | Complete all "Everyone" quests | 50 | Off-chain: check all E-category done |
| C2 | `top-10-leaderboard` | Top 10 | Reach the top 10 on the global leaderboard | 50 | Off-chain: leaderboard rank check |
| C3 | `earn-500-xp` | XP Hunter | Accumulate 500 XP total | 25 | Off-chain: XP threshold check |
| C4 | `earn-1000-xp` | XP Master | Accumulate 1,000 XP total | 50 | Off-chain: XP threshold check |
| C5 | `3-dao-member` | Multi-DAO | Be a member of 3+ different DAOs | 35 | On-chain: verify membership across DAOs |
| C6 | `create-team` | Team Captain | Create a team and have 3+ members join | 30 | Off-chain: backend team check |
| C7 | `10-board-posts` | Prolific Poster | Write 10+ board posts across DAOs | 30 | On-chain: verify post count |
| C8 | `treasury-contributor` | Generous | Contribute funds to a DAO treasury | 25 | On-chain: verify treasury deposit tx |
| C9 | `gnolove-top-20` | Open Source Star | Be in the Gnolove top 20 contributors | 40 | Off-chain: gnolove API leaderboard check |
| C10 | `ai-report-reader` | Data-Driven | Read 5 AI governance reports for different DAOs | 20 | Off-chain: track report views |
| C11 | `multisig-signer` | Co-Signer | Participate in a multisig transaction signing | 30 | On-chain: verify signature on multisig tx |
| C12 | `channel-active` | Chat Champion | Send 20+ messages in DAO channels | 25 | On-chain: verify channel post count |
| C13 | `weekly-login` | Dedicated | Log in to Memba 7 days in a row | 20 | Off-chain: track daily auth timestamps |
| C14 | `help-newcomer` | Welcomer | Reply to a newcomer's first board post | 15 | On-chain: verify reply to first-time poster |
| C15 | `validator-delegator` | Staker | Delegate GNOT to a validator | 30 | On-chain: verify delegation tx |

#### Category 4: Hidden & Seasonal (~10 quests)

| # | Quest ID | Title | Description | XP | Verification |
|---|----------|-------|-------------|----|----|
| H1 | `easter-egg-konami` | Retro Gamer | Enter the Konami code on any Memba page | 15 | Off-chain: keypress detection |
| H2 | `night-owl` | Night Owl | Complete a quest between 2 AM and 5 AM local time | 10 | Off-chain: timestamp check |
| H3 | `speed-runner` | Speed Runner | Complete 5 quests in a single session (< 1 hour) | 25 | Off-chain: timestamp check |
| H4 | `first-100-users` | Early Adopter | Be among the first 100 users to connect a wallet | 50 | Off-chain: user count check |
| H5 | `perfect-week` | Perfect Week | Complete at least 1 quest every day for 7 days | 30 | Off-chain: daily quest check |
| H6 | `directory-deep-dive` | Deep Diver | Visit every tab in the Directory + view 10 DAOs | 20 | Off-chain: tracking (extends existing) |
| H7 | `all-networks` | Network Master | Connect to all available networks (test12, test11, gnoland1) | 25 | Off-chain: network switch tracking |
| H8 | `genesis-dao-voter` | Genesis Voter | Vote on a proposal in the first DAO created on a new chain | 35 | On-chain: verify vote on genesis DAO |
| H9 | `bug-hunter` | Bug Hunter | Report a verified bug via the feedback system | 40 | Off-chain: admin-approved claim |
| H10 | `season-1-complete` | Season 1 Legend | Complete 50+ quests during Season 1 | 100 | Off-chain: quest count check |

**TOTAL: 85 quests, ~2,400+ XP possible**

### 9.4 Rank System

| Rank | Tier | XP Required | Badge Color | NFT Rarity | Perks |
|------|------|-------------|-------------|------------|-------|
| **Newcomer** | 0 | 0 | Grey | — | Base access |
| **Bronze Explorer** | 1 | 50 | Bronze | Common | Profile border |
| **Silver Builder** | 2 | 150 | Silver | Uncommon | Custom title |
| **Gold Architect** | 3 | 350 | Gold | Rare | Candidature unlock + profile glow |
| **Platinum Master** | 4 | 600 | Platinum | Epic | Leaderboard highlight |
| **Diamond Sage** | 5 | 1,000 | Diamond | Legendary | Custom profile frame + mentor badge |
| **Obsidian Legend** | 6 | 1,500 | Obsidian | Mythic | All cosmetics + DAO founder discount |
| **Gno Guardian** | 7 | 2,000+ | Prismatic | Unique | Special role in MembaDAO + ecosystem badge |

**Note:** Candidature XP threshold moves from 100 → 350 (Gold rank). This means users need meaningful engagement, not just 8 clicks. Existing users who already passed 100 XP are grandfathered.

### 9.5 NFT Badge System

**Architecture:**

```
Badge Collection (GRC721) — "GnoBuilders Badges"
  ├── Rank Badges (8 NFTs, one per rank)
  │     Minted automatically on rank-up
  │     Soulbound (non-transferable) — admin-only transfer
  │     Metadata: rank name, XP threshold, award date, user address
  │
  ├── Quest Badges (per-quest achievement NFTs)
  │     Minted on quest completion
  │     Transferable (can trade, gift, or display)
  │     Metadata: quest name, category, difficulty, completion date
  │
  └── Special Badges (seasonal, hidden, milestone)
        Limited edition mints
        Metadata: season, rarity, special condition
```

**Badge Metadata (IPFS):**
```json
{
  "name": "Deploy Hello Realm",
  "description": "Deployed their first Gno realm with a working Render() function",
  "image": "ipfs://Qm.../quest-d11-deploy-hello-realm.svg",
  "attributes": [
    { "trait_type": "Category", "value": "Developer" },
    { "trait_type": "Difficulty", "value": "Beginner" },
    { "trait_type": "XP Reward", "value": 20 },
    { "trait_type": "Quest ID", "value": "deploy-hello-realm" },
    { "trait_type": "Completed", "value": "2026-04-15T14:30:00Z" }
  ]
}
```

**Badge Display on Profile:**
- New "Achievements" section on ProfilePage
- Grid of badge NFT thumbnails with hover details
- Rank badge prominently displayed next to username
- Badge count visible on user cards in Directory/Leaderboard

### 9.6 Verification System — Detailed Design

#### On-Chain Verifier

For quests like "Deploy your first realm" or "Vote on a proposal":

```typescript
interface OnChainVerifier {
  // Verify a package/realm exists at the user's namespace
  verifyDeployment(address: string, realmPath: string): Promise<boolean>
  
  // Verify the user has voted on N proposals
  verifyVoteCount(address: string, minVotes: number): Promise<boolean>
  
  // Verify the user is a member of a DAO
  verifyDAOMembership(address: string, daoPath: string): Promise<boolean>
  
  // Verify the user holds an NFT
  verifyNFTOwnership(address: string, collectionPath: string): Promise<boolean>
  
  // Verify the user has a balance of a specific token
  verifyTokenBalance(address: string, tokenPath: string, minBalance: number): Promise<boolean>
  
  // Verify a transaction was sent by the user
  verifyTransaction(address: string, txType: string): Promise<boolean>
}
```

**Implementation:** ABCI queries via existing `queryRender()` and `queryEval()` infrastructure. Cached with React Query (5min staleTime for verification queries).

**Challenge:** On-chain verification requires the chain to be available. For quests that need on-chain proof:
- **While chain is down:** Queue verification, show "Pending verification" badge
- **When chain is up:** Batch-verify all pending quests
- **Fallback:** Accept self-reported proof (screenshot/link) with admin review queue

#### Off-Chain Verifier

For quests tracked by Memba's own frontend/backend:

```typescript
interface OffChainVerifier {
  // Check page visit count (existing infrastructure)
  verifyPageVisits(address: string, minPages: number): boolean
  
  // Check backend profile completeness
  verifyProfileSetup(address: string): Promise<boolean>
  
  // Check team membership/creation
  verifyTeamStatus(address: string, condition: string): Promise<boolean>
  
  // Check quest completion count (meta-quests)
  verifyQuestCount(address: string, category: string, minCount: number): boolean
  
  // Check XP threshold
  verifyXPThreshold(address: string, minXP: number): boolean
  
  // Check login streak
  verifyLoginStreak(address: string, minDays: number): Promise<boolean>
}
```

**Implementation:** Extends existing `quests.ts` localStorage tracking + backend `quest_completions` table.

#### Social Verifier

For quests like "Follow @_gnoland on Twitter":

```typescript
interface SocialVerifier {
  // Verify Twitter follow (OAuth or link proof)
  verifyTwitterFollow(address: string, targetHandle: string): Promise<boolean>
  
  // Verify Discord server membership (OAuth)
  verifyDiscordMembership(address: string, serverId: string): Promise<boolean>
}
```

**Options:**
- **Option A — OAuth verification (preferred):** Use existing Clerk OAuth (Discord, GitHub already configured) to verify membership. Clean, reliable.
- **Option B — Link proof:** User submits screenshot/link. Admin review queue. Lower barrier but manual work.
- **Option C — Honor system:** User clicks "I did it" — simplest but gameable.

**Recommendation:** Option A for Discord (Clerk already has OAuth), Option B for Twitter (no reliable API), Option C for low-value quests (< 15 XP).

### 9.7 Database Schema Changes

```sql
-- Migration 010: GnoBuilders quest expansion
-- Extends existing quest_completions table

-- Quest categories and metadata
CREATE TABLE IF NOT EXISTS quest_registry (
    quest_id        TEXT PRIMARY KEY,
    category        TEXT NOT NULL CHECK (category IN ('developer', 'everyone', 'champion', 'hidden')),
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    xp              INTEGER NOT NULL,
    difficulty      TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced', 'expert')),
    verification    TEXT NOT NULL CHECK (verification IN ('on_chain', 'off_chain', 'social', 'self_report')),
    badge_image_cid TEXT,          -- IPFS CID for badge image
    prerequisite    TEXT,          -- quest_id that must be completed first
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    season          INTEGER DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- User ranks (cached, recalculated on XP change)
CREATE TABLE IF NOT EXISTS user_ranks (
    address         TEXT PRIMARY KEY,
    rank_tier       INTEGER NOT NULL DEFAULT 0,
    rank_name       TEXT NOT NULL DEFAULT 'Newcomer',
    total_xp        INTEGER NOT NULL DEFAULT 0,
    quests_completed INTEGER NOT NULL DEFAULT 0,
    rank_badge_nft  TEXT,          -- NFT token ID if minted
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Badge NFT minting log
CREATE TABLE IF NOT EXISTS badge_mints (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    address         TEXT NOT NULL,
    quest_id        TEXT NOT NULL,
    nft_token_id    TEXT,          -- On-chain token ID (null if not yet minted)
    mint_status     TEXT NOT NULL DEFAULT 'pending' CHECK (mint_status IN ('pending', 'minted', 'failed')),
    metadata_cid    TEXT,          -- IPFS CID for badge metadata
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    minted_at       DATETIME,
    UNIQUE(address, quest_id)
);

-- Login streak tracking
CREATE TABLE IF NOT EXISTS login_streaks (
    address         TEXT PRIMARY KEY,
    current_streak  INTEGER NOT NULL DEFAULT 0,
    longest_streak  INTEGER NOT NULL DEFAULT 0,
    last_login_date DATE NOT NULL,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Self-report verification queue (admin review)
CREATE TABLE IF NOT EXISTS quest_claims (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    address         TEXT NOT NULL,
    quest_id        TEXT NOT NULL,
    proof_url       TEXT,          -- Screenshot, link, or description
    proof_text      TEXT,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by     TEXT,
    reviewed_at     DATETIME,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(address, quest_id)
);

CREATE INDEX IF NOT EXISTS idx_badge_mints_address ON badge_mints (address);
CREATE INDEX IF NOT EXISTS idx_quest_claims_status ON quest_claims (status);
CREATE INDEX IF NOT EXISTS idx_quest_registry_category ON quest_registry (category);
```

### 9.8 Backend API Additions

```protobuf
// New RPCs for GnoBuilders

// Quest discovery
rpc ListQuests(ListQuestsRequest) returns (ListQuestsResponse);
rpc GetQuestDetail(GetQuestDetailRequest) returns (GetQuestDetailResponse);

// Quest completion (extends existing CompleteQuest)
rpc VerifyOnChainQuest(VerifyOnChainQuestRequest) returns (VerifyOnChainQuestResponse);
rpc SubmitQuestClaim(SubmitQuestClaimRequest) returns (SubmitQuestClaimResponse);

// Ranks & leaderboard
rpc GetUserRank(GetUserRankRequest) returns (GetUserRankResponse);
rpc GetLeaderboard(GetLeaderboardRequest) returns (GetLeaderboardResponse);

// Badge management
rpc GetUserBadges(GetUserBadgesRequest) returns (GetUserBadgesResponse);
rpc MintBadgeNFT(MintBadgeNFTRequest) returns (MintBadgeNFTResponse);

// Admin (for self-report review)
rpc ReviewQuestClaim(ReviewQuestClaimRequest) returns (ReviewQuestClaimResponse);
rpc ListPendingClaims(ListPendingClaimsRequest) returns (ListPendingClaimsResponse);

// Messages
message QuestDefinition {
  string quest_id = 1;
  string category = 2;       // developer, everyone, champion, hidden
  string title = 3;
  string description = 4;
  uint32 xp = 5;
  string difficulty = 6;     // beginner, intermediate, advanced, expert
  string verification = 7;   // on_chain, off_chain, social, self_report
  string badge_image_url = 8;
  string prerequisite = 9;   // quest_id or empty
  bool completed = 10;       // for the requesting user
  string completed_at = 11;  // RFC3339 or empty
}

message RankInfo {
  uint32 tier = 1;            // 0-7
  string name = 2;            // "Gold Architect"
  uint32 total_xp = 3;
  uint32 quests_completed = 4;
  uint32 next_rank_xp = 5;   // XP needed for next rank
  string badge_nft_id = 6;   // On-chain NFT token ID
}

message LeaderboardEntry {
  string address = 1;
  string username = 2;
  uint32 rank_tier = 3;
  string rank_name = 4;
  uint32 total_xp = 5;
  uint32 quests_completed = 6;
  string avatar_url = 7;
}
```

### 9.9 Frontend Components

**New Pages:**
- `/quests` — Quest Hub (full-page quest catalog with category tabs, filters, search)
- `/quests/:questId` — Quest Detail (description, requirements, verification flow, badge preview)
- `/leaderboard` — Global leaderboard with rank badges
- `/profile/:address/achievements` — Badge gallery for any user

**New Components:**
- `QuestCatalog.tsx` — Filterable quest grid (by category, difficulty, status)
- `QuestCard.tsx` — Quest preview card (icon, title, XP, difficulty, status badge)
- `QuestDetail.tsx` — Full quest view (description, steps, verification, badge preview)
- `QuestVerification.tsx` — Multi-type verification UI (auto-check, claim form, social connect)
- `RankBadge.tsx` — Rank display component (tier icon + name, used everywhere)
- `AchievementGrid.tsx` — Profile badge gallery (NFT thumbnails in grid)
- `XPProgressBar.tsx` — Visual XP bar showing progress to next rank
- `LeaderboardTable.tsx` — Sortable leaderboard with rank badges and avatars
- `QuestClaimForm.tsx` — Self-report quest claim with proof upload
- `BadgeMintButton.tsx` — "Mint Badge NFT" CTA (post-quest-completion)

**Modified Components:**
- `QuestProgress.tsx` — Expand from 10 quests to full catalog link + summary stats
- `ProfilePage.tsx` — Add Achievements section with badge gallery
- `CandidatureUnlock.tsx` — Update threshold from 100 XP → 350 XP (Gold rank)
- `Layout.tsx` — Add Quest Hub to sidebar navigation
- `Sidebar.tsx` — Quest progress indicator (rank badge + XP bar)
- `UserCard.tsx` — Show rank badge next to username in Directory/Leaderboard

### 9.10 Implementation Sprints (Phase 1 Detail)

**Sprint 1.1 — Quest Engine Foundation (Week 2, Days 1-3)**

```
Task 1.1.1: Expand quest registry
  File: frontend/src/lib/quests.ts
  Change: Expand from 10 quests to 85 quests with full metadata
  Add: QuestDefinition type with category, difficulty, verification, prerequisite
  Add: RANK_THRESHOLDS constant with 8 tiers
  Backward compat: Existing 10 quests keep same IDs, existing completions preserved
  Tests: +40 unit tests for new quest definitions, XP calculations, rank thresholds

Task 1.1.2: Database migration 010
  File: backend/internal/db/migrations/010_gnobuilders.sql
  Change: Add quest_registry, user_ranks, badge_mints, login_streaks, quest_claims tables
  Seed: INSERT all 85 quest definitions into quest_registry
  Tests: Migration up/down, seed data validation

Task 1.1.3: Backend quest RPCs
  File: backend/internal/service/quest_rpc.go
  Change: Add ListQuests, GetQuestDetail, GetUserRank, GetLeaderboard RPCs
  Extend: Existing CompleteQuest to handle new quest types
  Add: Rank calculation logic (recalculate on every XP change)
  Tests: +20 backend tests for new RPCs
```

**Sprint 1.2 — Verification Layer (Week 2, Days 3-5)**

```
Task 1.2.1: On-chain verifier
  File: frontend/src/lib/questVerifier.ts (NEW)
  Functions: verifyDeployment, verifyVoteCount, verifyDAOMembership, verifyTokenBalance
  Uses: Existing queryRender() and queryEval() infrastructure
  Caching: React Query with 5min staleTime
  Fallback: Return "pending" when chain is unavailable
  Tests: +15 unit tests with mocked ABCI responses

Task 1.2.2: Off-chain verifier
  File: frontend/src/lib/questVerifier.ts (extend)
  Functions: verifyProfileSetup, verifyTeamStatus, verifyQuestCount, verifyLoginStreak
  Uses: Backend RPCs + localStorage
  Tests: +10 unit tests

Task 1.2.3: Self-report claim system
  File: backend/internal/service/quest_claims.go (NEW)
  RPCs: SubmitQuestClaim, ReviewQuestClaim, ListPendingClaims
  Flow: User submits proof → admin reviews → approve/reject → XP awarded
  Tests: +10 backend tests for claim lifecycle
```

**Sprint 1.3 — Quest Hub UI (Week 3, Days 1-3)**

```
Task 1.3.1: Quest catalog page
  File: frontend/src/pages/QuestHub.tsx (NEW)
  Route: /quests
  Features: Category tabs (All, Developer, Everyone, Champion, Hidden)
            Difficulty filter, status filter (completed, available, locked)
            Search by quest name
            Summary stats: X/85 completed, Y XP, rank badge
  Tests: +5 E2E tests for quest hub navigation

Task 1.3.2: Quest detail page
  File: frontend/src/pages/QuestDetail.tsx (NEW)
  Route: /quests/:questId
  Features: Full description, step-by-step guide
            Verification button (auto-check or claim form)
            Badge preview (image + metadata)
            Prerequisite chain visualization
  Tests: +3 E2E tests

Task 1.3.3: Quest components
  Files: QuestCard.tsx, QuestVerification.tsx, QuestClaimForm.tsx, XPProgressBar.tsx, RankBadge.tsx
  CSS: quest-hub.css, quest-card.css, rank-badge.css
  Tests: +15 unit tests for component rendering
```

**Sprint 1.4 — Rank System & Leaderboard (Week 3, Days 3-5)**

```
Task 1.4.1: Rank calculation engine
  File: frontend/src/lib/ranks.ts (NEW)
  Functions: calculateRank(xp), getNextRankThreshold(currentRank), getRankPerks(tier)
  Constants: RANK_TIERS array with names, XP thresholds, colors, perks
  Tests: +10 unit tests for rank boundaries

Task 1.4.2: Leaderboard page
  File: frontend/src/pages/Leaderboard.tsx (NEW)
  Route: /leaderboard
  Features: Global ranking table (top 100)
            Per-category sub-leaderboards
            User's own rank highlighted
            Rank badge + avatar display
  Tests: +3 E2E tests

Task 1.4.3: Profile achievements section
  File: frontend/src/components/profile/AchievementGrid.tsx (NEW)
  Placement: ProfilePage.tsx after QuestProgress widget
  Features: Badge grid (thumbnails of completed quest badges)
            Rank badge prominently displayed
            Total XP + quests completed stats
            "View all achievements" link to full page
  Tests: +5 unit tests
```

**Sprint 1.5 — Badge NFT Integration (Week 4, Days 1-3)**

```
Task 1.5.1: Badge collection realm
  File: samcrew-deployer/projects/memba/realms/gnobuilders_badges/
  Realm: GRC721 collection "GnoBuilders Badges"
  Features: Admin-only minting, per-quest token URI, soulbound rank badges
  DEPLOY: Queued for when test12 stabilizes
  Tests: +15 realm tests

Task 1.5.2: Badge minting flow (backend)
  File: backend/internal/service/badge_rpc.go (NEW)
  RPCs: MintBadgeNFT, GetUserBadges
  Flow: Quest completed → badge_mints row → queue mint tx → update NFT token ID
  Note: Minting is async (queued when chain is down, processed when up)
  Tests: +10 backend tests

Task 1.5.3: Badge display UI
  File: frontend/src/components/profile/BadgeCard.tsx (NEW)
  Features: Badge thumbnail with hover tooltip (quest name, date, rarity)
            "Mint as NFT" button if badge is unminted
            NFT link if already minted
  Tests: +5 unit tests
```

**Sprint 1.6 — Integration & Polish (Week 4, Days 3-5)**

```
Task 1.6.1: Update existing quest triggers
  File: frontend/src/lib/quests.ts
  Change: All existing 10 quest triggers continue working
  Add: New triggers for E2-E4, E9-E10, E11-E20, E21-E25 (off-chain trackable)
  Add: Quest notification toast on completion ("Quest Completed! +20 XP")
  Tests: Verify backward compatibility with existing quest completions

Task 1.6.2: Sidebar integration
  File: frontend/src/components/layout/Sidebar.tsx
  Change: Add "Quests" nav item with rank badge + XP progress bar
  Change: Add "Leaderboard" nav item
  Change: Show mini rank badge next to username in sidebar header

Task 1.6.3: Candidature threshold migration
  File: frontend/src/lib/quests.ts
  Change: CANDIDATURE_XP_THRESHOLD from 100 → 350
  Migration: Existing users with 100+ XP are grandfathered (backend flag)
  File: frontend/src/components/quests/CandidatureUnlock.tsx
  Change: Update copy to reference "Gold rank" instead of "100 XP"
  Tests: +5 tests for migration logic

Task 1.6.4: Cmd+K integration
  File: frontend/src/components/CommandPalette.tsx
  Add: "View Quests" command → /quests
  Add: "View Leaderboard" command → /leaderboard
  Add: "View My Badges" command → /profile/{addr}/achievements

Task 1.6.5: Documentation
  Files: README.md, SKILL.md, CHANGELOG.md
  Add: GnoBuilders feature description
  Add: Quest API documentation in SKILL.md
  Add: Badge collection realm path in deployment docs
```

### 9.11 Quest Verification — On-Chain Proof Patterns

For developer quests that require on-chain verification, here's how each proof type works:

```
Quest: "Deploy your first realm"
Proof: queryRender("gno.land/r/{userNamespace}/...", "") returns non-empty
Challenge: User must provide their realm path → we query it
Fallback: Self-report with txhash

Quest: "Vote on a proposal"  
Proof: Parse DAO Render("proposals") → check vote records contain user address
Challenge: Must specify which DAO → check all known DAOs or user specifies
Fallback: Self-report with txhash

Quest: "Create a GRC20 token"
Proof: queryEval("gno.land/r/{namespace}/token", "Name()") returns a name
Fallback: Self-report with deployment txhash

Quest: "Hold 5 different tokens"
Proof: For known tokens, queryEval("BalanceOf(userAddr)") > 0 for 5+ tokens
Challenge: We need to know which tokens exist → use token registry
Fallback: Self-report with balance screenshots
```

### 9.12 Cosmetics & Visual Rewards

| Rank | Unlocks |
|------|---------|
| **Bronze (50 XP)** | Bronze profile border, "Explorer" title |
| **Silver (150 XP)** | Silver border, custom title (user-chosen from list), animated XP counter |
| **Gold (350 XP)** | Gold border + glow effect, candidature unlock, "Architect" title |
| **Platinum (600 XP)** | Platinum border, leaderboard name highlight, badge showcase (3 featured) |
| **Diamond (1,000 XP)** | Diamond frame with particles, custom profile background color, mentor tag |
| **Obsidian (1,500 XP)** | Animated obsidian frame, all cosmetics, DAO creation fee discount |
| **Gno Guardian (2,000+ XP)** | Prismatic animated frame, special "Guardian" role in MembaDAO, ecosystem-wide badge |

**CSS Implementation:**
```css
/* Profile border by rank */
.profile-card[data-rank="gold"] {
  border: 2px solid var(--rank-gold);
  box-shadow: 0 0 12px var(--rank-gold-glow);
}

/* Rank badge next to username */
.rank-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
.rank-badge[data-tier="3"] { /* Gold */
  background: linear-gradient(135deg, #FFD700, #FFA500);
  color: #1a1a1a;
}
```

### 9.13 Season System (Future-Proofing)

GnoBuilders supports seasons to keep engagement fresh:

- **Season 1:** Launch quests (85 base quests). Season 1 runs until mainnet launch.
- **Season 2 (post-mainnet):** Mainnet-specific quests (deploy on mainnet, participate in mainnet governance, etc.)
- **Seasonal quests:** Time-limited quests that rotate (monthly challenges, hackathon quests, etc.)
- **Season badges:** Limited-edition NFTs for season completionists

Season data stored in `quest_registry.season` column. Seasonal quests have `enabled` toggle.

### 9.14 Impact on Existing Features

| Existing Feature | Impact | Migration |
|-----------------|--------|-----------|
| Quest system (10 quests) | REPLACED by 85 quests | IDs preserved, completions preserved |
| XP system | EXPANDED (125 → 2,400+ max) | Existing XP carries over |
| Candidature threshold | CHANGED (100 → 350) | Grandfathered for existing eligible users |
| Profile page | ENHANCED | New Achievements section added |
| Sidebar | ENHANCED | Quest Hub + Leaderboard nav items |
| Cmd+K palette | ENHANCED | 3 new commands |
| Backend quest_completions | EXTENDED | New tables added, existing data preserved |
| Proto definitions | EXTENDED | New RPCs added, existing RPCs unchanged |

### 9.15 Estimated Effort

| Sprint | Effort | Description |
|--------|--------|-------------|
| 1.1 Quest Engine Foundation | 12-16h | Registry, DB migration, backend RPCs |
| 1.2 Verification Layer | 8-12h | On-chain, off-chain, claim system |
| 1.3 Quest Hub UI | 12-16h | Pages, components, CSS |
| 1.4 Rank System & Leaderboard | 8-12h | Rank engine, leaderboard, profile badges |
| 1.5 Badge NFT Integration | 8-12h | Realm, minting flow, display |
| 1.6 Integration & Polish | 8-12h | Triggers, sidebar, migration, docs |
| **Total** | **~56-80h** | **~3 weeks of focused development** |

### 9.16 Test Plan

| Area | Test Type | Count |
|------|-----------|-------|
| Quest registry (85 quests) | Unit | +40 |
| XP calculation & rank thresholds | Unit | +15 |
| On-chain verifier (mocked) | Unit | +15 |
| Off-chain verifier | Unit | +10 |
| Claim lifecycle | Backend | +10 |
| New RPCs (7 RPCs) | Backend | +20 |
| Quest Hub page | E2E | +5 |
| Quest detail & verification | E2E | +3 |
| Leaderboard | E2E | +3 |
| Profile achievements | Unit | +5 |
| Rank badge rendering | Unit | +5 |
| Badge mint flow | Backend | +10 |
| Backward compatibility | Unit | +10 |
| **Total new tests** | | **~150** |
| **New total** | | **~1,650+** |

---

## 10. Risk Register

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| R1 | Realm redeployment fails (path conflict) | Medium | HIGH | Use versioned paths (/v2) if original paths are taken post-rollback |
| R2 | Upstream gno breaks Memba parser | Medium | HIGH | Strategy pattern V1/V2 already in place. Add V3 when needed. |
| R3 | gnoland1 stays halted through mainnet | Low | HIGH | Continue on test12. Memba is chain-agnostic by design. |
| R4 | OpenRouter free tier rate limits hit | Medium | LOW | 6h cache already mitigates. Add backend rate limit. |
| R5 | Mobile responsiveness fixes cause desktop regressions | Medium | MEDIUM | Visual regression tests (Playwright screenshots). |
| R6 | Dark mode introduces color contrast issues | Medium | LOW | WCAG 2.1 AA contrast checker in CI. |
| R7 | GRC721 standard changes break NFT gallery | Medium | MEDIUM | Schema validation (not hard types) + defensive parsing. |
| R8 | Feature activation reveals bugs in gated code | High | MEDIUM | Thorough E2E testing in Phase 4 sprints. |
| R9 | samcrew-deployer deploy key runs out of funds | Low | HIGH | Pre-flight balance check + alert threshold. |
| R10 | SQLite locks under concurrent load post-feature-activation | Low | HIGH | WAL mode handles reads. Monitor write contention. |
| R11 | test12 stays unstable for weeks | Medium | HIGH | All Phase 0-2 work is chain-independent. Phase 3-4 wait. No wasted effort. |
| R12 | GnoBuilders quest XP inflation | Medium | MEDIUM | Fixed XP per quest, server-calculated. No user-settable values. |
| R13 | On-chain verification unavailable (chain down) | High | MEDIUM | Queue verification, process when chain is up. Self-report fallback. |
| R14 | Badge NFT mint failure | Medium | LOW | Async minting queue with retry. Badge shown in UI regardless of mint status. |
| R15 | Candidature threshold change breaks existing users | Low | HIGH | Grandfathering: existing 100+ XP users keep eligibility via backend flag. |
| R16 | Quest gaming/cheating (fake completions) | Medium | MEDIUM | On-chain quests are provable. Off-chain quests are low-value. Self-report has admin review. |

---

## 11. Success Metrics

### Phase 0 (Security Code Fixes)
- [ ] 0 CRITICAL/HIGH findings in Security Guard scan
- [ ] Candidature ACL fix PR ready in samcrew-deployer
- [ ] Channels ACL fix PR ready in samcrew-deployer
- [ ] All realm tests pass locally

### Phase 1 (GnoBuilders)
- [ ] 85 quests defined and registered in backend
- [ ] Quest Hub page live with category filters
- [ ] Rank system functional (8 tiers, automatic calculation)
- [ ] Leaderboard page live
- [ ] Profile Achievements section displays badges
- [ ] Badge NFT realm code ready (deployment queued)
- [ ] 1,650+ total tests (from 1,495)
- [ ] Existing 10 quest completions preserved (backward compat)

### Phase 2 (UX)
- [ ] All pages render correctly at 375px viewport
- [ ] Dark mode available
- [ ] Onboarding wizard reduces time-to-first-action by 50%
- [ ] Network maintenance banner auto-shows during outages

### Phase 3 (Realm Redeployment — when test12 stable)
- [ ] All samcrew realms deployed and functional on test12
- [ ] samcrew-deployer issues #2 and #3 closed
- [ ] GnoBuilders badge collection deployed
- [ ] Smoke tests pass on new deployment

### Phase 4 (Feature Activation — after Phase 3)
- [ ] NFT, Services, Marketplace features live (no "Coming Soon")
- [ ] GnoSwap swap execution works end-to-end
- [ ] On-chain quest verification functional

### Phase 5 (Mainnet Preparation)
- [ ] Staging environment operational
- [ ] 150+ backend tests (from 87)
- [ ] ED25519 rotation plan documented
- [ ] Upstream PRs #5261 and #5334 changes reflected in UI

### Phase 6 (DAO Power Features + OSS)
- [ ] 5 proposal templates available
- [ ] Treasury historical charts for 30d+ range
- [ ] 3 standalone npm packages published
- [ ] 15+ "good first issue" labels
- [ ] MASTER_ROADMAP.md current

---

## 12. Decision Log

Decisions requiring CTO approval before implementation:

| # | Decision | Options | Recommendation | Rationale |
|---|----------|---------|----------------|-----------|
| D1 | Realm versioning after rollback | (A) Redeploy same paths, (B) Use /v2 paths | **A if paths available**, B as fallback | Simpler frontend config, no migration needed |
| D2 | Flag-to-hide mechanism | (A) Free flagging (current), (B) Stake-to-flag, (C) Moderator-only | **B (Stake-to-flag)** | Prevents sybil attacks while keeping community moderation |
| D3 | Dark mode approach | (A) CSS custom properties, (B) Separate CSS files, (C) Tailwind migration | **A (CSS custom properties)** | Least disruptive, works with Kodera design system |
| D4 | Staging environment | (A) Netlify branch + Fly.io app, (B) Docker Compose local, (C) Skip | **A (Netlify + Fly.io)** | Matches production architecture, catches deploy issues |
| D5 | CHANGELOG management | (A) Keep single file, (B) Split per-version, (C) Auto-generate from git | **B (Split per-version)** | Reduces file size, easier to navigate |
| D6 | API versioning | (A) /v1/ prefix now, (B) Version when breaking change needed, (C) Skip | **A (Prefix now)** | Cheap to add now, expensive to add later |
| D7 | Package extraction timing | (A) Phase 5 (after features), (B) Phase 2 (before features), (C) Never | **A (Phase 5)** | Don't slow down feature work with refactoring |
| D8 | Mobile strategy | (A) Responsive web only, (B) PWA, (C) React Native | **B (PWA)** | Low effort, good mobile UX, no app store friction |
| D9 | Treasury analytics backend | (A) Periodic snapshots, (B) On-demand historical query, (C) External indexer | **A (Periodic snapshots)** | Simple, reliable, no external dependency |
| D10 | Proposal discussions | (A) Reuse channels infra, (B) Separate discussion realm, (C) Off-chain only | **A (Reuse channels)** | Code reuse, consistent UX, on-chain persistence |
| D11 | GnoBuilders quest count | (A) 50 quests, (B) 85 quests, (C) 100+ quests | **B (85 quests)** | Balanced: enough variety without dilution. Can add seasonal quests later |
| D12 | Badge NFTs transferable? | (A) All transferable, (B) Rank = soulbound / Quest = transferable, (C) All soulbound | **B (Mixed)** | Ranks are reputation (non-tradeable). Quest badges are collectibles (tradeable) |
| D13 | Candidature threshold | (A) Keep 100 XP, (B) 350 XP (Gold rank), (C) Remove XP gate | **B (350 XP)** | Meaningful engagement required. Existing users grandfathered |
| D14 | Social quest verification | (A) OAuth (Clerk), (B) Link proof, (C) Honor system | **A for Discord, B for Twitter, C for < 15 XP quests** | Pragmatic mix based on available infrastructure |
| D15 | Quest verification when chain is down | (A) Block all on-chain quests, (B) Queue + verify later, (C) Self-report fallback | **B (Queue + verify)** | Best UX. User doesn't wait for chain. Verification async |
| D16 | Season system | (A) Ship with seasons from day 1, (B) Add seasons later, (C) No seasons | **B (Schema ready, ship seasons later)** | Season column in DB, but Season 1 is "launch to mainnet" |

---

## Appendix A — Upstream PRs to Monitor

| PR | Title | Status | Impact | Action When Merged |
|----|-------|--------|--------|-------------------|
| [gno#5037](https://github.com/gnolang/gno/pull/5037) | boards2 safe functions | Open | HIGH | Update parserV2.ts, run 959+ test regression |
| [gno#5222](https://github.com/gnolang/gno/pull/5222) | GovDAO T1 multisig | Open | MED-HIGH | Update GOVDAO_VOTE_FUNC constant |
| [gno#5261](https://github.com/gnolang/gno/pull/5261) | GovDAO proposal rejection | **Merged** | MEDIUM | Add rejected state to proposal detail UI |
| [gno#5334](https://github.com/gnolang/gno/pull/5334) | halt_height config | **Merged** | MEDIUM | Show halt height in validator dashboard |
| [gno#5346](https://github.com/gnolang/gno/pull/5346) | boards2 less storage perms | Open | LOW | Monitor, may affect channel permission model |
| [gno#5349](https://github.com/gnolang/gno/pull/5349) | boards2 update required amount | Open | LOW | Monitor for fee model changes |
| [gno#5194](https://github.com/gnolang/gno/pull/5194) | r/gnoland/users removed | Pending | MEDIUM | Migrate 13 references to r/sys/users |

## Appendix B — gnodaokit Opportunities

| Issue | Title | Memba Relevance |
|-------|-------|-----------------|
| #57 | Upgradable DAOs | Could enable realm upgrades without path versioning |
| #55 | Crossing DAO | Enables inter-realm auth pattern for ACL fixes |
| #43 | Base action to add new role | Simplifies candidature approval flow |
| #38 | Colors on roles | Visual role badges in Memba UI |
| #17 | daostats module | Could replace Memba's custom analytics |
| #15 | Expose DAO interface | Important for composability vision |

## Appendix C — File Impact Map

Files most likely to change across all phases:

| File | Phases | Changes |
|------|--------|---------|
| `frontend/src/config.ts` | 0,1,3 | Network URLs, feature flags, registry paths |
| `frontend/src/lib/builders.ts` | 1,4 | GnoSwap MsgCall, proposal templates |
| `frontend/src/pages/Validators.tsx` | 1,3 | halt_height, slashing history |
| `frontend/src/pages/ProposalDetail.tsx` | 3,4 | Rejected state, discussions |
| `frontend/src/components/Layout.tsx` | 2 | Progressive sidebar, dark mode toggle |
| `frontend/src/App.tsx` | 2 | Onboarding wizard, network banner |
| `backend/internal/api/` | 3,4 | API versioning, treasury snapshots |
| `samcrew-deployer/projects/memba/realms/` | 0 | Security fixes |
| `.env.production` | 1 | Feature flag activation |

---

*This proposal covers ~8-10 weeks of work across 6 phases. Phase 0 (security) is non-negotiable. Phases 1-5 can be reordered based on CTO priorities. No code will be written until this proposal is reviewed and approved.*
