# Memba v2.26 → v3.0 — AAA Implementation Plan (Phase 2)

> **Date:** 2026-03-31 · **Version:** v2.25.1 (package.json) · **Effective:** v2.26+ (post Sprint 1-7)
>
> **Baseline:** 1,307 frontend tests (56 files) · 73 backend tests · Build 479KB · 7 CI workflows
>
> **Review:** 26-perspective deep audit → Expert panel → CTO final review
>
> **Previous plan:** Sprints 1-7 COMPLETED (PRs #201-#207 merged)

> [!CAUTION]
> **Mandatory Git Workflow:** NEVER commit or push directly to `main`. Feature branches → PRs → CI → squash merge. No exceptions.

---

## 26-Perspective Deep Audit — Post-Sprint 7 State

### Critical Findings (0)
None. All critical items from Phase 1 audit have been resolved.

### High Findings (5)

| ID | Perspective | Finding | Impact |
|----|------------|---------|--------|
| **H1** | UX Expert, DAO Founder | **Landing page blocks feature preview** — Non-connected users clicking feature cards get redirected to "Install Adena" instead of seeing the feature. Users can't evaluate Memba before installing a wallet. This is a major conversion barrier. | User acquisition |
| **H2** | UX Expert, Head of Design | **Create DAO button buried below grid** — In Directory's DAOs tab, the "Create DAO" button sits at the bottom after all DAO cards. First-time users may never scroll down to find it. | Feature discovery |
| **H3** | Product Manager, VC Expert | **No network status awareness** — Users have no way to know if a network is healthy, halted, or degraded until they try an action and it fails. gnoland1 was halted for days with no in-app notice. | User trust |
| **H4** | CTO, DevRel | **Dependabot backlog** — 4 open Dependabot PRs (#134 jsdom, #138 typescript 6, #177 zod 4, #178 vite 8). Zod 4 and Vite 8 are major version bumps that may have breaking changes. | Technical debt |
| **H5** | DAO Founder, Community Manager | **No Memba DAO community loop** — The canonical Memba DAO exists on-chain but has no onboarding, quests, or incentive structure. No path from "visitor" to "community member" to "contributor". | Community growth |

### Medium Findings (8)

| ID | Perspective | Finding |
|----|------------|---------|
| M1 | Mobile User | Landing page Remotion players may not render on mobile (480x300 fixed aspect) |
| M2 | Red Team | `autoResolveBlocks` in escrow has no minimum — could be set to 1 block |
| M3 | Senior FSE | `package.json` still says v2.25.1, should be bumped to v2.26.0+ |
| M4 | Blue Team | No rate limiting on CSV import — 50 recipients but CSV could have 10K lines parsed |
| M5 | Gno Core Eng | Upstream #5099 (Coins.AmountOf panic for duplicates) may affect MsgSend builders |
| M6 | Junior OSS | No `CONTRIBUTING.md` guide for the new marketplace/ and payroll/ modules |
| M7 | Non-tech User | "ugnot" displayed in payroll forms — users don't understand smallest unit notation |
| M8 | VC Expert | No "early adopter" differentiation — all users look the same regardless of when they joined |

### Good / Exemplary (12)

| Perspective | Finding |
|------------|---------|
| CTO | Clean sprint execution — 7 sprints, 7 PRs, all merged with CI green |
| FSE | 1,307 tests across 56 files with 73 backend tests — exceptional coverage |
| CSO | Per-endpoint rate limiter with /24 subnet bucketing — production-grade |
| Gno Core | Template sanitizer with 10 validators — prevents injection in code generation |
| UX Expert | Cmd+K discovery hint with first-visit localStorage — non-intrusive onboarding |
| UI Expert | Design tokens (HSL color scale, 4px grid, modular type) — scalable system |
| DevRel | Gnoweb live directory with deployment badges — unique in Gno ecosystem |
| SC Engineer | STATE-BEFORE-SEND invariant comments — reentrancy awareness |
| DAO User | Payroll CSV import — practical for operational DAOs |
| Mobile User | Responsive tab bar + sidebar collapse — works on 375px+ |
| Validator | Hacker View with consensus telemetry — world-class for Gno |
| OSS Contributor | MIT license, CONTRIBUTING.md, structured ROADMAP — welcoming |

---

## Expert Panel Proposals

### Proposal 1 — "Create DAO" Button Repositioning

**Panel:** UI/UX Design Expert, Head of Design, FSE Expert

**Current:** Button is at the bottom of the DAOs tab grid (line 210), after all DAO cards. Small (11px font, 6px padding). Easy to miss.

**Recommendation — Option A (unanimous):**

Move "Create DAO" to a **sticky header bar** at the top of the DAOs tab, alongside the search input. This follows the pattern used by GitHub ("New repository"), Linear ("New issue"), and Notion ("New page").

```
┌──────────────────────────────────────────────┐
│ [🔍 Search DAOs...]          [+ Create DAO]  │
├──────────────────────────────────────────────┤
│ Featured DAOs                                │
│ ┌─────┐ ┌─────┐ ┌─────┐                     │
│ │DAO 1│ │DAO 2│ │DAO 3│                      │
│ └─────┘ └─────┘ └─────┘                     │
│ All DAOs (grid)                              │
└──────────────────────────────────────────────┘
```

**Implementation:**
- Move button from `dir-actions` (below grid) to inline with `dir-search` (above grid)
- Use `display: flex; justify-content: space-between` for search + button row
- Button: same `k-btn-primary` class but slightly larger (13px font, 8px 16px padding)
- Mobile: button stays inline but shrinks to icon-only ("+") below 480px

---

### Proposal 2 — Landing Page "Preview Without Wallet"

**Panel:** UI/UX Design Expert, Head of Design, 2× FSE Expert, CTO

**Problem:** Feature cards on landing redirect non-connected users to "Install Adena" instead of showing the feature. Users can't evaluate the product before committing to wallet installation.

**Recommendation — Read-Only Preview Mode (4/5 votes):**

Allow non-connected users to navigate to ANY page. Show full UI with real on-chain data (read-only ABCI queries work without a wallet). Only gate **write actions** (create DAO, vote, transfer) behind a "Connect Wallet" prompt.

**Implementation:**
1. **Remove the redirect** in `HomeRedirect` — always render the app layout
2. **Remove feature card `handleCTA()`** — always navigate to the feature page
3. **Gate write actions** — buttons like "Create DAO", "Vote", "Transfer" show a `ConnectWalletPrompt` modal instead of executing when `!auth.isAuthenticated`
4. **Keep Dashboard gated** — Dashboard is personal (your DAOs, your votes), so redirect to landing when not connected
5. **Add "Connect to interact" banner** — subtle top bar on read-only pages

**Impact:** Users can explore DAOs, browse tokens, view validators, read channels — all without Adena. Dramatically improves first-visit experience.

**CTO note:** This is a major UX improvement but requires touching ~15 pages. Should be a dedicated sprint.

---

### Proposal 3 — Network Status Toast

**Panel:** FSE, CTO

**Recommendation:** Add a `NetworkStatusToast` component that:
1. Polls each configured network's RPC `/status` endpoint every 60s
2. Shows a non-blocking toast when a network is degraded or halted
3. Uses the existing toast positioning system (bottom-right, below WhatsNewToast)
4. Color-coded: green (healthy), yellow (slow blocks > 10s), red (halted > 5 min)
5. Persists per-session (dismissible, but re-shows if status changes)

**Implementation:**
- New `lib/networkStatus.ts` — polls `/status`, compares `latest_block_time` to now
- New `components/ui/NetworkStatusToast.tsx` — renders status for active network
- Integrate into `Layout.tsx` alongside existing toasts

---

### Proposal 4 — Memba DAO Community Vision

**Panel:** DAO Founder, Community Manager, Product Manager, CTO, DevRel

#### Phase 1 — Bootstrap Era (Now → 3 months)

**Goal:** Build the first cohort of 20-50 early testers with skin in the game.

**Quest System:**
Users complete 10 quests to earn candidature rights for Memba DAO:

| # | Quest | Verification | Points |
|---|-------|-------------|--------|
| 1 | Connect wallet | On-chain (address exists) | 10 |
| 2 | Visit 5 different pages | localStorage tracking | 10 |
| 3 | Browse a DAO's proposals | Page visit + ABCI query logged | 15 |
| 4 | View your profile page | Page visit | 10 |
| 5 | Use Cmd+K command palette | localStorage flag | 10 |
| 6 | Switch networks (test12 ↔ another) | localStorage tracking | 15 |
| 7 | Visit the Directory and browse 3 tabs | Tab interaction tracking | 15 |
| 8 | Submit feedback via Feedback page | Backend record | 20 |
| 9 | View a validator's detail page | Page visit | 10 |
| 10 | Share Memba link (copy referral URL) | Clipboard API + localStorage | 10 |

**Total: 125 XP** — Threshold: 100 XP to unlock candidature.

**Ranks:**
| Rank | Requirement | Perks |
|------|------------|-------|
| Explorer | Complete quest 1-3 | Basic profile badge |
| Early Tester | Complete 7/10 quests (100 XP) | Candidature eligibility |
| Memba Pioneer | Accepted as DAO member | Access to alpha features channel, governance participation |
| Core Contributor | 3+ governance votes + feedback | Priority feature requests, potential $MEMBA allocation |

**Dedicated Channels:**
- `#feedback` — Custom board on-chain (gno.land/r/samcrew/memba_dao_channels) for product feedback
- `#announcements` — Read-only, admin-posted updates
- `#alpha-testing` — Members-only testing coordination

**Member Management Dashboard:**
- New admin view showing all Memba DAO members with:
  - Quest completion status
  - Rank badges
  - Activity metrics (last active, votes cast, proposals viewed)
  - Role management (assign/revoke ranks)

#### Phase 2 — Token Era (3-6 months)

- $MEMBA token distribution based on accumulated XP + governance participation
- On-chain XP tracking via a dedicated `memba_xp` realm
- Retroactive airdrop for Bootstrap Era pioneers
- Token-weighted governance for feature prioritization

---

## Remaining Items from Phase 1

| Item | Status | Action |
|------|--------|--------|
| Dependabot #134 jsdom 29 | Open | Merge (dev-only) |
| Dependabot #138 TypeScript 6 | Open | Test + merge (major version) |
| Dependabot #177 Zod 4 | Open | Test + merge (major, tree-shaking) |
| Dependabot #178 Vite 8 | Open | Test + merge (major) |
| PR #185 Freelance v3.0 (draft) | Draft | Close — superseded by Sprint 6 |
| package.json version bump | Outdated | Bump to 2.26.0 |
| 1 critical Dependabot security alert | Open | Review + fix |

---

## Implementation Plan — Phase 2 (8 Sprints)

> [!IMPORTANT]
> Sprints 8-10 are sequential (UX foundation). Sprints 11-12 can parallel. Sprints 13-15 are sequential (community features).

### Sprint 8 — Housekeeping & Dependency Triage (1 session)

| Task | Description |
|------|-------------|
| 8.1 | Bump `package.json` to v2.26.0, update CHANGELOG with Sprint 1-7 summary |
| 8.2 | Merge Dependabot PRs: test each (#134, #138, #177, #178), resolve breaking changes |
| 8.3 | Close draft PR #185 (superseded by Sprint 6 marketplace) |
| 8.4 | Address critical Dependabot security alert |
| 8.5 | Validate `autoResolveBlocks` minimum (M2) — add `>= 1000` guard |
| 8.6 | Add GNOT display helper for payroll (M7) — show "1.5 GNOT" not "1500000 ugnot" |

**Exit Gate:** All Dependabot PRs merged or closed with rationale. version = 2.26.0. 0 critical alerts.

### Sprint 9 — Create DAO Button Repositioning (1 session)

| Task | Description |
|------|-------------|
| 9.1 | Move "Create DAO" button to search row header in DAOs tab |
| 9.2 | Add responsive behavior (icon-only on mobile) |
| 9.3 | Add "Create Token" button to Tokens tab header (same pattern) |

**Exit Gate:** Button visible above fold on desktop and mobile. No scroll needed to find it.

### Sprint 10 — Marketplace Polishing (1-2 sessions)

| Task | Description |
|------|-------------|
| 10.1 | Add sidebar links for Services and NFT under Extensions section (alongside Agents) |
| 10.2 | Create unified `/marketplace-hub` page — entry point linking to all 3 verticals (Agents, Services, NFT) with category cards and search |
| 10.3 | Improve "Hire" and "Register Agent" placeholders — replace alert() with proper `ComingSoon` modal explaining what's needed (escrow/registry realm deployment) |
| 10.4 | Add GNOT display formatting across all marketplace pages — show "5.0 GNOT" not "5000000" |
| 10.5 | Add "View Source" links to agent MCP configs (link to realm on gnoweb when deployed) |
| 10.6 | Cross-link between verticals — "Related services" on agent detail, "Related agents" on service detail |

**Exit Gate:** All 3 marketplace verticals accessible from sidebar. Hub page links all verticals. No raw alert() calls. GNOT formatting consistent.

### Sprint 11 — Read-Only Preview Mode (major UX shift) (2-3 sessions)

| Task | Description |
|------|-------------|
| 11.1 | Remove wallet-gate from `HomeRedirect` — always render Layout for non-connected |
| 11.2 | Remove `handleCTA()` from Landing feature cards — direct navigation |
| 11.3 | Create `ConnectWalletPrompt` modal component |
| 11.4 | Gate write actions: CreateDAO, Vote, Transfer, Mint, Burn, Deploy behind ConnectWalletPrompt |
| 11.5 | Add subtle "Connect wallet to interact" banner on read-only pages |
| 11.6 | Keep Dashboard redirect (personal page = requires auth) |
| 11.7 | Update E2E tests for new non-connected navigation flow |

**Exit Gate:** Non-connected users can navigate to /dao, /tokens, /validators, /directory, /channels. Write buttons show ConnectWalletPrompt. E2E updated.

### Sprint 12 — Network Status Toast (1 session)

| Task | Description |
|------|-------------|
| 12.1 | Create `lib/networkStatus.ts` — poll `/status`, detect halted/slow |
| 12.2 | Create `NetworkStatusToast.tsx` — color-coded network health indicator |
| 12.3 | Integrate into Layout.tsx |
| 12.4 | Add tests for status detection (healthy, slow, halted) |

**Exit Gate:** Toast shows when active network is degraded. Dismissible. Re-shows on status change.

### Sprint 13 — Memba DAO Feedback Channel (1-2 sessions)

| Task | Description |
|------|-------------|
| 13.1 | Create dedicated "Feedback" channel in memba_dao_channels on testnet12 |
| 13.2 | Update FeedbackPage.tsx to post to on-chain channel (not just mailto) |
| 13.3 | Add member list admin view for Memba DAO |
| 13.4 | Add role badges display (Explorer, Early Tester, Pioneer, Core Contributor) |

**Exit Gate:** Feedback posts go to on-chain channel. Admin can view member list with roles.

### Sprint 14 — Quest System Foundation (2-3 sessions)

| Task | Description |
|------|-------------|
| 14.1 | Create `lib/quests.ts` — 10 quest definitions, completion tracking (localStorage + backend) |
| 14.2 | Create `QuestProgress` component — progress bar, completed quests, XP counter |
| 14.3 | Integrate quest tracking hooks into page visits (Directory, Profile, Validators, etc.) |
| 14.4 | Create quest completion backend endpoint (persist to SQLite) |
| 14.5 | Show XP badge on user profile |

**Exit Gate:** Quest progress tracked across 10 quests. XP visible on profile. Persists across sessions.

### Sprint 15 — Candidature Integration (1-2 sessions)

| Task | Description |
|------|-------------|
| 15.1 | Gate Memba DAO candidature behind quest completion (100 XP threshold) |
| 15.2 | Auto-fill candidature with quest completion proof |
| 15.3 | Add "Early Tester" rank assignment on acceptance |
| 15.4 | Create alpha-testing channel (members-only) |

**Exit Gate:** Users need 100 XP to apply. Accepted members get Early Tester rank + channel access.

### Sprint 16 — Member Activity Dashboard (1-2 sessions)

| Task | Description |
|------|-------------|
| 16.1 | Admin view: all Memba DAO members with quest status, rank, activity |
| 16.2 | Role management UI (assign/revoke ranks) |
| 16.3 | Activity metrics: last active, votes cast, feedback submitted |
| 16.4 | Export member list as CSV |

**Exit Gate:** Admin can view, rank, and export member data. Activity tracked.

---

## Sprint Summary

| Sprint | Scope | Sessions | Dependency |
|--------|-------|----------|------------|
| **S8** | Housekeeping: deps, version, security | 1 | — |
| **S9** | Create DAO button UX | 1 | S8 |
| **S10** | Marketplace polishing: sidebar, hub, formatting | 1-2 | S8 |
| **S11** | Read-only preview mode (major UX) | 2-3 | S9 |
| **S12** | Network status toast | 1 | Can parallel S11 |
| **S13** | Memba DAO feedback channel | 1-2 | S8 |
| **S14** | Quest system | 2-3 | S11 + S13 |
| **S15** | Candidature + ranks | 1-2 | S14 |
| **S16** | Member activity dashboard | 1-2 | S15 |
| | **Total** | **12-18 sessions** | |

---

## Deferred Items (Post-Phase 2)

| Item | When |
|------|------|
| $MEMBA token distribution | After quest system proves traction (Phase 2 complete) |
| On-chain XP realm (`memba_xp`) | When GnoVM supports efficient state queries |
| Retroactive airdrop | After token launch |
| i18n (FR/EN) | 3+ months |
| CSP nonce migration | When Vite nonce plugin matures |
| IBC2 token payments | When Gno IBC2 is production-ready |
| Ledger hardware wallet | When Adena supports Ledger |
| Cross-device DAO sync | Post-payroll |

---

## Verification Plan

### Per-Sprint CI Gate (mandatory)
```bash
cd frontend && npx tsc --noEmit           # 0 errors
cd frontend && npx eslint . --quiet       # 0 errors
cd frontend && npx vitest run             # all pass
cd frontend && npm run build              # < 530KB main chunk
cd backend && go test -race -count=1 ./...  # all pass
```

### Git Workflow (MANDATORY)
```
1. git checkout -b feat/sprint-N-description
2. Implement + test + commit (conventional commits)
3. git push -u origin feat/sprint-N-description
4. gh pr create → CI must pass
5. User reviews + approves → squash merge
6. NEVER push directly to main
```
