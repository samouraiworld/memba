# Memba v4.1 — Implementation Plan (v2 — REVISED)

> **Date:** 2026-04-09 (revised after live chain verification)
> **Author:** CTO Review Board (25 expert perspectives) + CTO Expert Review
> **Status:** PROPOSAL v2 — Awaiting approval before any code is written
> **Base:** v4.0.0 (main @ 03f89a1) — 1,588 frontend + 155 gnolove tests

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Snapshot (Verified)](#2-current-state-snapshot)
3. [Phase A — UI/UX Polish & Fixes](#3-phase-a)
4. [Phase B — Realm Audit & Deployment](#4-phase-b)
5. [25-Expert Review Panel](#5-expert-review-panel)
6. [CTO Expert Review](#6-cto-expert-review)
7. [Risk Register](#7-risk-register)
8. [Sprint Execution Order](#8-sprint-execution-order)

---

## 1. Executive Summary

This plan addresses two critical needs:

**Phase A (UI/UX Polish):** Fix the light theme contrast issues (100+ hardcoded colors), hide the unfinished Teams feature, overhaul the Gnolove report to match the gno-skills markdown format, and stop Adena wallet popup harassment on page navigation.

**Phase B (Realm Audit & Deployment):** test12 is confirmed live and stable (block 235,854, 7 validators, 6 peers, ~5-7s block time). Most samcrew realms **survived the rollback** and are still live on-chain. The scope is:
- Fix ACL vulnerabilities and deploy candidature/channels at **v2 paths** (on-chain code is immutable — old paths are burned)
- Deploy missing realms: `nft_market`, `gnobuilders_badges`
- Deploy missing packages: `daocond/v2`, `proposal_store`
- Update Memba frontend to point to v2 realm paths
- Make Memba fully functional with all realms verified

**Estimated scope:** Phase A = 5 sprints (~15-20h). Phase B = 4 sprints (~14-18h).

---

## 2. Current State Snapshot (VERIFIED — 2026-04-09 07:30 UTC)

### 2.1 Repository States (all on main, clean working trees)

| Repo | Branch | Last Commit | Key State |
|------|--------|-------------|-----------|
| **Memba** | main | 03f89a1 (gnolove.css theme tokens) | v4.0.0, 1,588+155 tests, 0 lint/TS errors |
| **samcrew-deployer** | main | Network-aware dep checks | 2 open security issues (#2 candidature, #3 channels) |
| **tokenfactory** | main | GRC20 factory + test12 changelog | Stable, 11 tests |
| **Security Guard** | main | Sprint 2B (API server) | 91 tests, ready to scan realms |
| **gnomonitoring** | main | Alert pipeline fix | New branch: Feat/add-chain-id-info-in-msg-govdao |
| **gnolove** | main | Typed ChatMessage fix | Stable |
| **gnodaokit** | main | Upgradable DAOs, crossing DAO | 14 open issues (enhancements) |
| **gno (upstream)** | master | gas-model-improvements-storage2 updated | boards2, govdao changes in flight |
| **gno-skills** | main | Weekly report skill + scripts | Report format reference, security reviews |
| **gno-docs** | main | WIP GnoVM architecture | David's reference docs |

### 2.2 Open PRs on Memba

| PR | Title | Status |
|----|-------|--------|
| #267 | chore(deps): bump remotion suite to 4.0.446 | OPEN (dependabot) |

### 2.3 test12 Chain Status (VERIFIED LIVE)

| Check | Result |
|-------|--------|
| **Chain running** | YES — block 235,854, ~5-7s block time |
| **Catching up** | No — fully synced |
| **Blocks since rollback** | ~967 (rollback was at block 234,887) |
| **Validators** | 7 active (all power=1) |
| **Peers** | 6 (gnocore, berty, gfanton, samourai, moul, aeddi) |
| **Samourai sentry RPC** | HEALTHY |
| **Public gno.land RPC** | DOWN (SSL error) |
| **tx-indexer** | DOWN |
| **gnoweb (test12.gno.land)** | DOWN |

### 2.4 On-Chain Realm Status (VERIFIED via ABCI queries)

| Artifact | Status | Notes |
|----------|--------|-------|
| `p/samcrew/realmid` | LIVE | |
| `p/samcrew/basedao` | LIVE | |
| `p/samcrew/daocond` | LIVE | v1 only |
| `p/samcrew/daokit` | LIVE | |
| `p/samcrew/daocond/v2` | **NOT DEPLOYED** | Needed for newer realms |
| `p/samcrew/proposal_store` | **NOT DEPLOYED** | Needed for newer realms |
| `r/samcrew/tokenfactory` | LIVE | |
| `r/samcrew/memba_dao` | LIVE | Renders correctly |
| `r/samcrew/memba_dao_candidature` | LIVE **⚠️ BUGGY** | ACL bypass (issue #2) — immutable, needs v2 path |
| `r/samcrew/memba_dao_channels` | LIVE **⚠️ BUGGY** | ACL bypass (issue #3) — immutable, needs v2 path |
| `r/samcrew/agent_registry` | LIVE | |
| `r/samcrew/escrow` | LIVE | |
| `r/samcrew/nft_market` | **NOT DEPLOYED** | Source exists in samcrew-deployer |
| `r/samcrew/gnobuilders_badges` | **NOT DEPLOYED** | test11 only so far (multisig required on test12) |

**Critical insight:** The rollback to block 234,887 did NOT wipe samcrew realms — they were deployed before that block and survived. However, the buggy candidature and channels realms are **immutable on-chain** — we cannot patch them in place. Security fixes require deploying to new paths.

### 2.5 Deploy Key Balances (VERIFIED)

| Key | Address | Balance |
|-----|---------|---------|
| Default (genesis) | `g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5` | ~9.2 quadrillion ugnot |
| samcrew-core-test1 (multisig) | `g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0` | ~10M GNOT |

Funding is NOT a blocker. Both keys have more than enough for deployment.

### 2.6 Issues Identified for This Session

| # | Issue | Severity | Phase |
|---|-------|----------|-------|
| 1 | Light theme contrast — white/light text unreadable on white backgrounds | HIGH | A |
| 2 | Light theme — hardcoded colors in 100+ locations (CSS + inline styles) | HIGH | A |
| 3 | Teams feature not production-ready — should be hidden | MEDIUM | A |
| 4 | Gnolove report: default view should be "report" not "table" | MEDIUM | A |
| 5 | Gnolove report: markdown format doesn't match gno-skills standard | MEDIUM | A |
| 6 | Gnolove report: repo ordering (gnolang/gno on top, then Samourai priority) | MEDIUM | A |
| 7 | Gnolove report: multi-select for repositories instead of single select | MEDIUM | A |
| 8 | Gnolove report: merged PRs should appear above other statuses | MEDIUM | A |
| 9 | Gnolove report: weekly should ONLY show current week activity | MEDIUM | A |
| 10 | Gnolove report: merged status dot should not be red | LOW | A |
| 11 | Adena wallet popup triggered on every page navigation | HIGH | A |
| 12 | samcrew-deployer issue #2: candidature ACL bypass (immutable on-chain) | CRITICAL | B |
| 13 | samcrew-deployer issue #3: channels ACL bypass (immutable on-chain) | CRITICAL | B |
| 14 | Missing deployments: nft_market, gnobuilders_badges, daocond/v2, proposal_store | HIGH | B |
| 15 | Memba frontend must update realm paths to v2 after redeployment | HIGH | B |

---

## 3. Phase A — UI/UX Polish & Fixes

### Sprint A.1 — Light Theme Complete Overhaul

**Goal:** Make the light theme 100% functional with proper contrast across all pages.

**Problem Analysis:**

The light theme has CSS variable overrides in `tokens.css:95-115` and `index.css:34-53`, but ~100+ locations bypass them with hardcoded hex values.

**Critical Contrast Failures (white/light text on white backgrounds):**

| File | Line(s) | Issue |
|------|---------|-------|
| `questhub.css` | 299, 566 | `color: #fff` — invisible on white bg |
| `validators.css` | 814, 824 | Incident badge `color: #fff` — safety-critical |
| `nft-gallery.css` | 27, 283 | `color: #fff` on cards |
| `freelance.css` | 122 | Button `color: #fff` |
| `nft-launchpad.css` | 360 | `color: #fff` |
| `notification-bell.css` | 40 | Badge `color: white` |
| `landing.css` | 33 | Hero title `color: #ffffff` |

**Dark backgrounds that break light theme:**

| File | Line(s) | Issue |
|------|---------|-------|
| `index.css` | 1274 | `.jitsi-pip { background: #000 }` |
| `landing.css` | 183 | Feature card `background: #000` |
| Board plugin loaders | Various | `background: #111` shimmer divs |

**Inline styles in TSX (70+ instances):**

| Area | Files | Common Patterns |
|------|-------|-----------------|
| Settings page | Settings.tsx (14 instances) | `color: #444`, `#888`, `#f0f0f0` |
| Board plugin | boardHelpers, BoardView, ThreadList, etc. (32+) | Hardcoded grays |
| Leaderboard | LeaderboardView.tsx (6 instances) | `#f0f0f0`, `#888` |
| GnoSwap | SwapView.tsx | Hardcoded accent colors |
| Various components | 60+ files | Non-adaptive `rgba()` values |

**Implementation Tasks:**

```
A.1.1: CSS hardcoded color audit & fix (~35 CSS files)
  - Replace all hardcoded #fff, #000, #f0f0f0, #888, #555, #444, #111
    with appropriate CSS variables
  - Priority: contrast-breaking white-on-white and black-on-black first
  - Key variables: --color-text, --color-bg, --color-text-secondary,
    --color-text-muted, --color-bg-card, --color-border

A.1.2: Inline style migration (~70+ TSX instances)
  - Replace hardcoded inline colors with CSS classes using variables
  - Priority files: Settings.tsx, Board plugin files, LeaderboardView.tsx
  - For dynamic styles (Recharts, conditionals): use var() or a
    useThemeColors() helper

A.1.3: Add missing light theme tokens
  - --color-shimmer for skeleton loaders (replaces #111)
  - --color-glass for overlay/backdrop effects
  - Verify glass/overlay/shimmer effects adapt to light theme

A.1.4: Component-level light theme fixes
  - PR state badges in gnolove.css: ensure contrast in light mode
  - ComingSoonGate overlay
  - CommandPalette glass effect
  - Recharts chart palette (provide light-theme-aware colors)

A.1.5: Visual regression testing
  - Manual audit of ALL pages in light theme at 1440px, 768px, 375px
  - Verify no contrast ratio below WCAG AA (4.5:1 text, 3:1 large text)
  - Test both themes after each change to prevent dark theme regression
```

**Estimated effort:** 4-6h

---

### Sprint A.2 — Hide Teams Feature

**Goal:** Remove Teams from all navigation until the feature is polished.

**Current State:**
- Sidebar shows Teams when wallet connected (Sidebar.tsx:219, badge "beta")
- Org mode indicator shows in sidebar (Sidebar.tsx:206-212)
- Route exists at `/:network/organizations` → shows ComingSoonGate when flag unset
- Feature flag: `VITE_ENABLE_TEAMS` (currently empty = disabled)

**Implementation Tasks:**

```
A.2.1: Hide Teams sidebar entry
  - Remove or conditionally hide the Teams SidebarLink (Sidebar.tsx:219)
  - Hide org mode badge indicator (Sidebar.tsx:206-212)
  - Keep route/page intact but unreachable from UI

A.2.2: Block direct URL access
  - Add redirect from /organizations → home when VITE_ENABLE_TEAMS is not "true"
  - Prevents users from stumbling onto the unfinished feature via URL

A.2.3: Remove from CommandPalette
  - Check if Teams appears in Cmd+K commands, remove if present

A.2.4: Clean up quest references
  - Check if any quests reference Teams, skip them if Teams is hidden
```

**Estimated effort:** 30min-1h

---

### Sprint A.3 — Gnolove Report Overhaul

**Goal:** Make report view the default, match gno-skills markdown format, fix ordering/filtering/display.

**Reference:** The exact target format is defined in `gno-skills/skills/weekly-report.md` and demonstrated in `gno-skills/reports/weekly/2026-04-08/report.md`. The Memba report should produce copy-paste-ready markdown matching this structure.

**Current State (GnoloveReport.tsx, 619 lines):**
- Default view: "table" → Should be "report"
- Markdown structure: flat (Highlights → Stats → By Repository → Blockers)
- Target structure: categorized sections (Highlight, Security, GnoVM/TM2, Docs, Packages, Gnoweb, Tools, Other, In Progress, Merged, Validators/Infrastructure)
- Repo filter: single `<select>` → Should be multi-select
- Repo ordering: Map iteration order (arbitrary) → Should be priority-ordered
- PR ordering in "all" tab: mixed → Merged should be first
- Weekly scope: may include stale PRs → Should only show current week activity
- Merged badge: purple (#a855f7) — NOT red, this is correct ✓

**Implementation Tasks:**

```
A.3.1: Default view to "report"
  File: GnoloveReport.tsx:68
  Change initial state:
    FROM: searchParams.get("view") === "report" ? "report" : "table"
    TO:   searchParams.get("view") === "table" ? "table" : "report"

A.3.2: Markdown format overhaul (gno-skills format)
  - Restructure NarrativeReportView and generateReportMd() to produce:

    ```markdown
    From DD/MM to DD/MM : Samourai crews

    > ⚠️ High priority · ✅ Approved · 📥 Waiting for first review

    ## Gno Core (/gnolang/gno)

    **⭐ Highlight**
    - ...

    **🛡️ PR Waiting for review (HackenProof / Security)**
    - ...

    **⚙️ PR Waiting for review (GnoVM / TM2)**
    - ...

    [... other categories, omitted if empty ...]

    **🚧 PR In Progress:**
    - ...

    **🎉 PR Merged**
    - ...

    **🖥️ Validators / Infrastructure Tools:**
    - [samouraiworld/* PRs]

    **📝 NOTE:**
    ```

  - PR classification: title-based regex rules from weekly-report.md skill:
    1. Security: title contains `fix` + security keywords
    2. Documentation: title starts with `docs`
    3. Packages: title contains `(example`, `(avl)`, `(govdao)`, etc.
    4. GnoVM/TM2: title contains `(gnovm)`, `(tm2)`, `(consensus)`, etc.
    5. Gnoweb: title contains `(gnoweb)`
    6. Tools: title contains known tool names
    7. Other: everything else
  - Review stats format: (N ✅, N 💬, N 🔄)
  - Merged section: placed ABOVE In Progress (user preference overrides
    gno-skills template which puts Merged near bottom)
  - Period-aware headers: adapt for monthly ("Monthly Report — April 2026"),
    yearly ("Annual Report — 2026")

A.3.3: Repository priority ordering
  - Define REPO_PRIORITY_ORDER constant:
    ["gnolang/gno", "samouraiworld/gnomonitoring", "samouraiworld/gnodocs",
     "samouraiworld/gno-validator-tools", "samouraiworld/gnodaokit",
     "samouraiworld/memba", ...]
  - Sort byRepo entries using this priority (unranked repos at end, alphabetical)
  - Apply in both rendered view and generated markdown

A.3.4: Multi-select repository filter
  - Replace single <select> with checkbox dropdown component
  - State: selectedRepos: Set<string> (empty = all repos)
  - Filter logic: pr matches if repo is in selectedRepos or set is empty
  - UI: "All Repositories" toggle + individual checkboxes
  - Show count: "3 repos selected"

A.3.5: Merged PRs ordering in "all" tab
  - Reorder prs array in filteredPrs: Merged → In Progress → Waiting → Reviewed → Blocked
  - In NarrativeReportView: render Merged section before other status sections

A.3.6: Weekly scope — only current week activities
  - The gnolove API filters by date range (start/end)
  - Add client-side filtering to exclude PRs where ALL timestamps
    (createdAt, mergedAt, updatedAt) fall outside the selected week
  - Ensures stale/inactive PRs from prior weeks don't appear

A.3.7: Monthly and yearly report format adaptation
  - Monthly: header "Monthly Report — April 2026",
    group by week within month, show weekly sub-summaries
  - Yearly: header "Annual Report — 2026",
    group by month, show monthly sub-summaries
  - Stats adapt: totals + averages per sub-period
```

**Estimated effort:** 6-8h

---

### Sprint A.4 — Adena Wallet Popup Fix

**Goal:** Adena popup should ONLY trigger when the user explicitly wants to connect.

**Root Cause Analysis:**

`useAdena.ts:131-139`: The `connect()` function tries `GetAccount()` silently first. If it fails (wallet locked, not whitelisted), it falls through to `AddEstablish("Memba")` which shows the popup.

`useAdena.ts:216-227`: Auto-reconnect on mount calls `connect()` — which can trigger the popup if the wallet is locked.

`Layout.tsx:142-145`: `performLogin()` fires when `adena.connected && !auth.isAuthenticated` — this can re-trigger after auth token expiry.

The user experiences: every page load → auto-reconnect attempt → wallet locked → `AddEstablish` popup → password prompt.

**Implementation Tasks:**

```
A.4.1: Split connect into silent vs interactive modes
  - Add `silent` parameter to connect():
    connect(opts?: { silent?: boolean })
  - When silent=true: only try GetAccount(), never call AddEstablish()
  - If silent GetAccount() fails → set connected=false, no popup
  - Auto-reconnect (line 224) uses connect({ silent: true })
  - Manual "Connect Wallet" button uses connect() (default: interactive)

A.4.2: Guard performLogin against reconnect loops
  - Layout.tsx: add cooldown (don't re-attempt within 30s of failure)
  - Track loginAttemptedRef more carefully across effect re-runs
  - Ensure auth token expiry doesn't trigger popup cascade

A.4.3: Wallet action gating
  - For actions requiring wallet (vote, propose, sign, create token):
    show ConnectWalletPrompt instead of auto-triggering Adena
  - User must explicitly click "Connect Wallet" to see the Adena popup
  - Free browsing without interruption when wallet is disconnected or locked
```

**Estimated effort:** 2-3h

---

### Sprint A.5 — Additional Polish

**Goal:** Fix remaining theme/UX issues discovered during audit.

```
A.5.1: Fix shimmer/skeleton loaders for light theme
  - Add --color-shimmer token (dark: #111, light: #e5e7eb)
  - Replace hardcoded #111 background in loader divs
  - Files: board/index.tsx, BoardView.tsx, LeaderboardView.tsx, gnoswap/index.tsx

A.5.2: Fix glass/overlay effects for light theme
  - CommandPalette overlay, modal backdrops, glass panels
  - Verify Kodera light theme overrides cover all glass effects

A.5.3: Complete gnolove.css theme token migration
  - PR #284 started migration but TODOs remain
  - Finish replacing remaining hardcoded colors in gnolove.css
```

**Estimated effort:** 2-3h

---

## 4. Phase B — Realm Audit & Deployment

### Key Architectural Decision: v2 Paths

On-chain Gno code is **immutable**. The buggy `memba_dao_candidature` and `memba_dao_channels` realms at their current paths **cannot be patched**. The fix requires:

1. Deploy security-fixed versions at **new paths** (e.g., `gno.land/r/samcrew/memba_dao_candidature_v2`)
2. Update Memba frontend to query the v2 paths instead of v1
3. The old v1 realms remain on-chain (inert/abandoned) — no way to remove them

**Path naming convention decision needed:**
- Option A: `gno.land/r/samcrew/memba_dao_candidature_v2` (suffix)
- Option B: `gno.land/r/samcrew/v2/memba_dao_candidature` (prefix)
- Option C: `gno.land/r/samcrew/memba/candidature` (reorganized namespace)

Recommendation: **Option A** — simplest, matches existing conventions, the deploy script already handles it.

### Sprint B.1 — Security Fixes in samcrew-deployer

**Goal:** Fix ACL vulnerabilities in realm source code, prepare v2 deployments.

```
B.1.1: Fix memba_dao_candidature ACL (Issue #2)
  File: samcrew-deployer/projects/memba/realms/memba_dao_candidature/
  Changes:
    - Add crossing() to MarkApproved() and MarkRejected()
    - Add assertCallerIsDAO() check:
      caller := std.PreviousRealm().PkgPath()
      if caller != "gno.land/r/samcrew/memba_dao" { panic("unauthorized") }
    - Note: std.PreviousRealm().PkgPath() returns "" for direct MsgCall
      (user calls), returns the calling realm path for cross-realm calls.
      The DAO realm is the only legitimate caller for approve/reject.
  Tests:
    - Unauthorized caller (direct MsgCall) → panic
    - Unauthorized caller (wrong realm) → panic
    - Authorized caller (DAO realm cross-call) → success
    - Duplicate application check (Apply() called twice by same address)

B.1.2: Fix memba_dao_channels ACL (Issue #3)
  File: samcrew-deployer/projects/memba/realms/memba_dao_channels/
  Changes:
    - Add crossing() to ALL write functions
    - PostThread: verify caller is DAO member
    - PostReply: verify caller is DAO member
    - CreateChannel: verify caller is admin
    - RemoveThread: verify caller is admin or moderator
    - FlagThread: verify caller is member + can't flag own content +
      can't flag same content twice
  Tests:
    - Each function: unauthorized caller → panic
    - Each function: authorized caller → success
    - Role-specific: non-admin can't CreateChannel, non-mod can't RemoveThread
    - Flag edge cases: self-flag blocked, double-flag blocked

B.1.3: Update deploy paths for v2
  - Create v2 realm directories or update gnomod.toml to target new paths
  - Update import paths in v2 realms to reference correct dependencies
  - Ensure memba_dao (v1, still live) can interact with v2 candidature/channels
    OR deploy memba_dao_v2 as well if cross-realm imports change

B.1.4: Run Security Guard scan
  - Scan all realm code in samcrew-deployer
  - Verify 0 HIGH/CRITICAL findings after fixes
  - Document any MEDIUM findings for future fix

B.1.5: Run full test suite
  - All realm tests locally: gno test ./...
  - Verify 100% pass rate
```

**Estimated effort:** 4-6h

### Sprint B.2 — Deploy Missing Packages & Realms

**Goal:** Deploy everything that's missing on test12.

**Already live (no action needed):**
- `p/samcrew/realmid`, `basedao`, `daocond` (v1), `daokit`
- `r/samcrew/memba_dao`, `tokenfactory`, `agent_registry`, `escrow`
- `r/samcrew/_deps/demo/profile`, `_deps/onbloc/uint256`, `_deps/onbloc/json`
- All daodemo realms, all lz-oapp artifacts

**Needs deployment:**

| Artifact | Type | Dependency | Notes |
|----------|------|------------|-------|
| `p/samcrew/daocond/v2` | Package | basedao | New daocond version |
| `p/samcrew/proposal_store` | Package | basedao | New package |
| `r/samcrew/memba_dao_candidature_v2` | Realm | memba_dao, basedao | ACL-fixed |
| `r/samcrew/memba_dao_channels_v2` | Realm | memba_dao, basedao | ACL-fixed |
| `r/samcrew/nft_market` | Realm | basedao | New realm |
| `r/samcrew/gnobuilders_badges` | Realm | — | Requires multisig on test12 |

**Implementation Tasks:**

```
B.2.1: Pre-deployment verification
  - Verify all dependencies for each artifact
  - Dry-run: make deploy-dry NETWORK=test12 PROJECT=memba
  - Verify deploy key is accessible: gnokey list | grep samcrew
  - Verify RPC connectivity to Samourai sentry

B.2.2: Deploy packages first
  Deploy order:
    1. p/samcrew/daocond/v2
    2. p/samcrew/proposal_store
  Verify each with: gnokey query vm/qfile --data "gno.land/p/samcrew/..."

B.2.3: Deploy v2 realms
  Deploy order:
    3. r/samcrew/memba_dao_candidature_v2
    4. r/samcrew/memba_dao_channels_v2
  Verify each with: Render() output via ABCI query

B.2.4: Deploy missing realms
    5. r/samcrew/nft_market
    6. r/samcrew/gnobuilders_badges (if multisig flow possible)
  Verify each

B.2.5: Post-deploy status check
  - Run: make status NETWORK=test12
  - Verify all new artifacts show ✅ LIVE
  - Record deployed block numbers for each TX
```

**Estimated effort:** 3-4h

### Sprint B.3 — Memba Frontend Path Updates

**Goal:** Point Memba frontend to v2 realm paths.

```
B.3.1: Update realm path references
  - Find all references to memba_dao_candidature and memba_dao_channels
    in Memba frontend + backend
  - Update to v2 paths
  - Files likely affected:
    - ABCI query constructors (queryRender, queryEval calls)
    - MsgCall builders (vote, approve, post, etc.)
    - Config/constants files with realm paths
    - Backend gnoweb proxying if applicable

B.3.2: Test with live v2 realms
  - Verify candidature flow: Apply → (ACL blocks unauthorized approval) → Admin approves → success
  - Verify channels flow: Non-member post → blocked. Member post → success
  - Verify all existing features still work with new paths

B.3.3: Feature flag for nft_market
  - If nft_market deployed successfully, evaluate flipping VITE_ENABLE_NFT=true
  - Smoke test NFT gallery rendering with live on-chain data
```

**Estimated effort:** 3-4h

### Sprint B.4 — Verification & Documentation

**Goal:** Full end-to-end verification and documentation update.

```
B.4.1: Comprehensive smoke test
  - Create test DAO via Memba UI
  - Submit candidature → verify ACL blocks unauthorized approval
  - Post in channels → verify ACL blocks non-members
  - Create GRC20 token
  - Submit and vote on proposal
  - Verify gnolove data flows from gnolang/gno
  - Verify validator dashboard data from Samourai sentry

B.4.2: Run full test suites
  - Memba frontend: npm test (expect 1,588+)
  - Memba backend: go test ./... (expect 87+)
  - Gnolove: npm test (expect 155+)
  - E2E: npx playwright test (expect 18+)

B.4.3: Documentation updates
  - Update DEPLOYMENT_RUNBOOK.md with new block numbers and v2 paths
  - Update CHANGELOG.md with security fixes
  - Close samcrew-deployer issues #2 and #3
  - Update MASTER_ROADMAP.md to v4.1 status
  - Update test12 rollback memory (realms survived, v2 deployed)

B.4.4: Feature activation assessment
  - Document which features are now safe to activate
  - Plan phased activation for next session (NFT, Marketplace, Services)
```

**Estimated effort:** 3-4h

---

## 5. 25-Expert Review Panel

### 5.1 CSO (Chief Security Officer)

**Assessment: APPROVED — v2 path approach is correct**

Critical corrections from v1 plan:
- v1 plan assumed realms were wiped and could be redeployed at same paths. **Wrong.** Realms survived and are immutable. v2 plan correctly uses new paths.
- The v2 approach means old buggy paths still exist on-chain. Acceptable for testnet — on mainnet, this would be more concerning. Document the abandoned paths clearly.

Strengths:
- Silent connect for Adena (A.4) eliminates a social engineering vector — repeated popups train users to click approve reflexively
- ACL fix uses `crossing()` + `std.PreviousRealm()` — correct Gno security pattern
- Security Guard scan as deployment gate

Concerns:
1. Old v1 candidature/channels are still callable. Anyone can still spam the old channels or self-approve on the old candidature. While the frontend won't use them, direct on-chain calls still work. **Mitigation:** This is testnet — acceptable risk. Document as known issue.
2. Ensure the v2 candidature still references the original `memba_dao` realm for admin checks — don't accidentally point to a non-existent `memba_dao_v2`.

### 5.2 Black Hat Team (Offensive Security)

**Assessment: Attack surface analysis of v2 approach**

| Vector | Risk | Notes |
|--------|------|-------|
| Old v1 channels still spammable | LOW | Testnet, frontend ignores v1 paths |
| Old v1 candidature self-approval | LOW | Frontend won't show v1 candidatures |
| Path confusion (v1 vs v2 data) | MEDIUM | Ensure frontend NEVER mixes v1/v2 queries |
| Adena silent→interactive race condition | LOW | Ref-guarded, single attempt |
| Report markdown injection | LOW | Content already escaped in generateReportMd() |

New attack vector in v2 plan: **Cross-realm path mismatch.** If `memba_dao_candidature_v2` imports `memba_dao` (v1), but `memba_dao`'s admin list hasn't changed, the ACL check works. If `memba_dao` itself needs updating, we'd need `memba_dao_v2` too — creating a cascading v2 migration. **Verify the import chain before deployment.**

### 5.3 UX/UI Expert

**Assessment: 9/10 — Plan addresses the right issues**

Strengths:
- Light theme overhaul is systematic (CSS → inline → missing tokens → components → testing)
- Hiding Teams via sidebar + direct URL block is complete
- Multi-select repo filter with checkbox dropdown is correct UX

Concerns:
1. The multi-select dropdown should have a "Select All" / "Clear All" toggle
2. The report format is complex (12+ sections from gno-skills). Consider collapsible sections in the rendered HTML view for easier scanning
3. Merged at top: confirmed the user wants this, which deviates from gno-skills template. Make this a UI preference, not a hard-coded override, so the generated markdown can optionally follow gno-skills order for external sharing

Recommendations:
- Add keyboard navigation to the multi-select dropdown
- Add a tooltip on the period selector explaining "Weekly shows Mon-Sun"

### 5.4 Gno Core Team Perspective

**Assessment: v2 path approach is sound**

- `memba_dao_candidature_v2` importing `memba_dao` (v1) for admin checks is valid — Gno supports cross-realm calls to any deployed realm regardless of version
- `daocond/v2` deployment is needed — verify the v2 API is compatible with existing `memba_dao` references
- `crossing()` is mandatory in newer GnoVM — all v2 realm entry points MUST use it
- The `proposal_store` package may have dependencies on `daocond/v2` — deploy `daocond/v2` first

### 5.5 Senior Gno Core Engineer

**Assessment: Import chain verification required**

The v2 candidature realm needs to import `memba_dao` to check admin status. Verify:

```
memba_dao_candidature_v2 imports:
  → gno.land/r/samcrew/memba_dao        (for admin check — v1, LIVE)
  → gno.land/p/samcrew/basedao          (for types — v1, LIVE)
  → gno.land/p/samcrew/daocond          (v1 or v2?)
```

If the v2 candidature requires `daocond/v2`, that package must deploy first. If it can use `daocond` (v1), the dependency chain is simpler.

**Recommendation:** Check the actual import paths in the fixed realm source code before planning deployment order.

### 5.6 Senior GnoVM Engineer

**Assessment: No GnoVM concerns for Phase A. Phase B notes:**

- `crossing()` is MANDATORY for functions using `std.PreviousRealm()`. Without it, GnoVM panics on newer test12 builds. Confirm test12's GnoVM version supports `crossing()`.
- Storage costs for v2 realms: deploying new realms at new paths consumes fresh storage. No conflict with v1 storage.
- `std.PreviousRealm().PkgPath()` returns `""` for direct `MsgCall` from a user. Returns the calling realm's pkgpath for cross-realm calls. The ACL check should handle BOTH cases:
  - Direct call from admin address → check `std.PreviousRealm().Addr()` against admin list
  - Cross-realm call from DAO realm → check `std.PreviousRealm().PkgPath()` against DAO path
  - This dual check is important — don't forget the direct admin case.

### 5.7 Senior DevRel

**Assessment: Report format alignment is high-value**

The gno-skills format is the Samourai team's external communication standard. Having Memba auto-generate it means:
- No manual reformatting for weekly standups
- Reports can be directly committed to gno-skills repo
- Consistency across team communications

The classification rules (Security, GnoVM/TM2, Docs, Packages, etc.) are specific to gnolang/gno. For Samourai repos, use a simpler grouping or a "Validators / Infrastructure" catch-all section as the gno-skills template does.

### 5.8 Senior Fullstack Engineer

**Assessment: Technical review of revised plan**

**Light Theme (A.1):** Sound approach. One optimization: create a `theme-audit.sh` script that greps for hardcoded hex colors in CSS/TSX files — useful for CI enforcement to prevent regression.

**Report Overhaul (A.3):** The PR classification logic is ~7 regex rules. Implement as a pure function `classifyPR(title: string): PRCategory` for easy testing. Unit test each classification rule independently.

**Adena Fix (A.4):** The `silent` parameter approach is clean. One edge case: if the wallet was previously whitelisted but is now locked, `GetAccount()` may throw or return a failure — make sure `silentConnect()` catches both.

**Phase B Frontend Updates (B.3):** This is the riskiest part. All realm path references need updating simultaneously — a partial update would break the app. Recommend:
- Create a central `REALM_PATHS` config object
- All components import paths from there
- Single-point update for v2 migration
- Feature flag to toggle between v1/v2 paths during transition

### 5.9 Senior Smart Contract Hacker

**Assessment: v2 ACL fix — detailed design review**

The dual-check pattern (Senior GnoVM Engineer, 5.6) is critical:

```go
func MarkApproved(candidateAddr std.Address) {
    crossing()
    caller := std.PreviousRealm()
    
    // Case 1: Cross-realm call from DAO
    if caller.PkgPath() == "gno.land/r/samcrew/memba_dao" {
        // Authorized — DAO realm is calling
    } else if caller.PkgPath() == "" {
        // Case 2: Direct MsgCall — check if caller is admin
        if !isAdmin(caller.Addr()) {
            panic("unauthorized: only DAO realm or admin can approve")
        }
    } else {
        panic("unauthorized: unknown realm caller")
    }
    // ... proceed with approval
}
```

This handles: (a) DAO governance flow (cross-realm), (b) admin override (direct call), (c) reject everything else.

For channels, the membership check should also support both call patterns.

**Flag sybil attack** (3 accounts = auto-hide): Deferred to future sprint. Current fix focuses on ACL — flag abuse is a separate issue requiring economic design.

### 5.10-5.16 — User Perspectives (DeFi, DAO, Desktop, Mobile)

**Summary of user-relevant impacts:**

| User Type | Impact | Notes |
|-----------|--------|-------|
| DeFi User | None direct | GnoSwap integration deferred |
| DAO User | HIGH positive | ACL fixes make governance trustworthy |
| DAO Founder | HIGH positive | Realms are live, secure candidature/channels |
| Desktop Power User | HIGH positive | Light theme fix, Adena popup fix |
| Desktop Casual User | MEDIUM positive | Teams hidden (less confusing), light theme |
| Mobile iOS | HIGH positive | Light theme is default on iOS, contrast fix critical |
| Mobile Android | MEDIUM positive | Light theme fix, Adena popup fix |

### 5.17 Manfred Touron (Head of Engineering, Gno)

- v2 path approach is acceptable for testnet. For mainnet, consider gnodaokit's upgradable DAO pattern (#57) instead of path versioning.
- Report format alignment with gno-skills is excellent — standardizes team reporting.
- ACL fix patterns are correct Gno idioms.

### 5.18 Jae Kwon (Founder of Gno)

- Immutable on-chain code forcing v2 paths is by design — it encourages careful deployment. The lesson: always deploy with ACL checks. No shortcuts.
- The `crossing()` pattern is required for security. All realm entry points must use it.

### 5.19-5.20 Blockchain Validator Experts

- Light theme fix for incident badges (validators.css) is safety-critical — validators need to distinguish CRITICAL from RESOLVED at a glance
- Public gno.land RPC and tx-indexer being down doesn't affect Memba since it uses Samourai sentry, but it limits validator tooling outside Memba

### 5.21-5.22 Non-Tech Gno.land Users

- Light theme fix directly improves first impressions
- Adena popup fix is the #1 UX complaint — browsing freely without wallet prompts is essential
- Teams being hidden reduces confusion

### 5.23-5.24 Senior Open Source Contributors

- The plan is well-structured. The v2 path approach is clear and documented.
- Suggest: add "breaking change" notice in CHANGELOG when realm paths change
- The PR classification logic for reports could be extracted as a reusable module

### 5.25 CTO Synthesis

**Overall Assessment: 8.5/10 — Significant improvement over v1 plan**

Key corrections from v1:
1. Realms were NOT wiped — v1 plan assumed they were. v2 plan correctly verifies on-chain state.
2. Immutable code requires v2 paths — v1 plan didn't address this. v2 plan has clear path strategy.
3. Deploy key balance verified — v1 plan flagged this as risk. v2 confirms funding is not an issue.
4. Missing packages identified — v1 missed `daocond/v2` and `proposal_store`.

**No further structural changes needed.** Proceed to CTO Expert Review.

---

## 6. CTO Expert Review

### 6.1 Safety Assessment

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Reversibility** | HIGH | Phase A: CSS/UI, git revertable. Phase B: realm deploys are irreversible but on testnet. |
| **Blast radius** | LOW | Phase A: frontend-only. Phase B: new realm paths, old paths untouched. |
| **Test coverage** | STRONG | 1,588 + 87 + 155 + 18 E2E. New changes add tests. |
| **Dependency risk** | LOW | No new external dependencies. All changes use existing patterns. |
| **Rollback plan** | CLEAR | Phase A: git revert. Phase B: frontend can revert to v1 paths if v2 realms fail. |
| **Data integrity** | SAFE | v2 realms start fresh (no data migration). v1 data remains accessible if needed. |

### 6.2 Structural Review

**Correct ordering confirmed:**
1. **A.1 Light theme** → Highest visual impact, zero risk
2. **A.2 Hide teams** → 30min quick win, reduces UI noise
3. **A.3 Report overhaul** → Medium complexity, high stakeholder value
4. **A.4 Adena fix** → Requires careful hook refactoring, do after simpler fixes
5. **A.5 Additional polish** → Mop-up, no dependencies
6. **B.1 Security fixes** → Prerequisite for B.2 (realm code must be fixed before deploy)
7. **B.2 Deploy** → Requires B.1 complete, chain must be live (verified)
8. **B.3 Frontend updates** → Requires B.2 (need live v2 paths to test against)
9. **B.4 Verification** → Final gate before shipping

**No reordering needed.** Dependencies are correct.

### 6.3 Accuracy Verification

| Claim | Verified? | Method |
|-------|-----------|--------|
| test12 is live and producing blocks | YES | ABCI /status query, block progression confirmed |
| 7 validators, 6 peers | YES | /validators and /net_info queries |
| Realms survived rollback | YES | ABCI qrender queries — all return data |
| candidature has ACL bug | YES | Issue #2 still open, code unchanged |
| channels has ACL bug | YES | Issue #3 still open, code unchanged |
| nft_market not deployed | YES | ABCI query returns InvalidPkgPathError |
| gnobuilders_badges not deployed | YES | ABCI query returns InvalidPkgPathError |
| daocond/v2 not deployed | YES | vm/qfile query returns nothing |
| proposal_store not deployed | YES | vm/qfile query returns nothing |
| Deploy key has sufficient funds | YES | Bank balance query: millions of GNOT |
| 100+ hardcoded colors in light theme | YES | Grep audit found 35+ CSS, 70+ inline |
| Report default is "table" | YES | GnoloveReport.tsx:68 |
| Merged badge is purple not red | YES | gnolove.css:501-504, #a855f7 |
| Adena auto-reconnect can trigger popup | YES | connect() falls through to AddEstablish |
| Public gno.land RPC is down | YES | SSL error on connection |
| tx-indexer is down | YES | Empty response |

### 6.4 Critical Items Added After v1

1. **v2 path naming convention** — Must decide before B.1 starts. Recommendation: Option A (suffix: `_v2`).
2. **Import chain verification** — Before deploying v2 realms, verify all import paths resolve to live packages. A missing import = deployment failure.
3. **Dual ACL check pattern** — The `PreviousRealm()` pattern must handle both direct MsgCall (admin address check) and cross-realm calls (pkgpath check). v1 plan only mentioned pkgpath.
4. **Central REALM_PATHS config** — Frontend should import realm paths from one place, not scatter them across files. This makes v2 migration a single-point change.
5. **gnobuilders_badges multisig requirement** — test12 deployment requires multisig flow. Verify multisig signing is operational before attempting.

### 6.5 What's NOT in This Plan (Explicitly Deferred)

| Item | Reason |
|------|--------|
| GnoSwap slippage integration | Needs GnoSwap deployed on target chain |
| Feature flag activation (NFT, Services, Marketplace) | Assessment in B.4, activation in next session |
| Staging environment | Infrastructure work, separate initiative |
| Upstream compat (proposalRejected, halt_height) | Monitoring only, no urgent need |
| ED25519 key rotation | Pre-mainnet, not pre-testnet |
| Flag sybil attack fix | Requires economic design, separate sprint |
| BoardView decomposition | Stable at 676 LOC, not urgent |
| Progressive sidebar | Related to Teams hide, can revisit when Teams ships |

### 6.6 Final CTO Verdict

**APPROVED.** The plan is safe, accurately reflects verified on-chain state, correctly handles the immutability constraint with v2 paths, and addresses all 15 identified issues in a logical sequence.

**Branch strategy:**
- Phase A: single branch `feat/v4.1-polish` from main, one PR
- Phase B (samcrew-deployer): branch `fix/security-acl-v2` for realm fixes
- Phase B (Memba frontend): branch `feat/v4.1-realm-v2-paths` for path updates
- Each gets its own PR. Never commit to main directly.

**Hard rules (permanent):**
- Never commit on main — always branch → PR
- Zero Claude co-author/co-signer/branding anywhere in git history or GitHub UI

---

## 7. Risk Register

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| 1 | Light theme fix breaks dark theme | LOW | MEDIUM | Test both themes after each change |
| 2 | Report format changes break export workflows | LOW | LOW | Preserve CSV/PDF alongside new MD |
| 3 | Adena hook refactor causes auth regression | MEDIUM | HIGH | Test: fresh, reconnect, locked, switched accounts |
| 4 | test12 becomes unstable during Phase B | LOW | HIGH | Phase A independent; Phase B can pause |
| 5 | v2 realm import chain breaks at deploy | MEDIUM | HIGH | Dry-run first, verify all deps before deploy |
| 6 | v2 ACL fix introduces regression in happy path | LOW | CRITICAL | Full test coverage, post-deploy smoke tests |
| 7 | Frontend v1→v2 path migration misses a reference | MEDIUM | MEDIUM | Central REALM_PATHS config, grep audit |
| 8 | gnobuilders_badges multisig flow fails on test12 | MEDIUM | LOW | Can defer to next session, non-blocking |
| 9 | Old v1 realms still exploitable via direct calls | LOW | LOW | Testnet only, no real assets at risk |
| 10 | Public gno.land RPC stays down | HIGH | LOW | Memba uses Samourai sentry, not public RPC |

---

## 8. Sprint Execution Order

```
Phase A (no chain dependency — start immediately):
  A.1  Light Theme Overhaul          [4-6h]   ← Highest visual impact
  A.2  Hide Teams                    [30min]  ← Quick win
  A.3  Gnolove Report Overhaul       [6-8h]   ← Stakeholder value
  A.4  Adena Wallet Popup Fix        [2-3h]   ← UX critical
  A.5  Additional Polish             [2-3h]   ← Mop-up

Phase B (requires samcrew-deployer changes + test12 live):
  B.1  Security Fixes + v2 Realms    [4-6h]   ← Code + tests in samcrew-deployer
  B.2  Deploy Missing Pkgs & Realms  [3-4h]   ← On-chain deployment
  B.3  Frontend Path Updates         [3-4h]   ← Memba points to v2
  B.4  Verification & Documentation  [3-4h]   ← End-to-end validation

Total estimated: Phase A ~15-20h, Phase B ~14-18h
```

---

*This plan will not be executed until explicit user approval is received.*
