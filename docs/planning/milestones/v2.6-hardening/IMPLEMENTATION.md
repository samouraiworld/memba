# v2.6 Implementation — Hardening, OSS Prep & Revenue Foundation

> **Date**: 2026-03-08
> **Branch**: `dev/v2` (or feature branch TBD)
> **Predecessor**: v2.5 Channels & Comms (PR #79, 14 milestones shipped)
> **Source**: 22-perspective deep audit + live bug report

---

## 🔴 Phase 0: Critical Bug Fix (Board Deploy Failure)

### Problem

Deploying a DAO with Board plugin fails on test11:
```
ERROR: gno.land/r/.../xploration_board/xploration_board.gno:4:2:
could not import std (unknown import path "std")
```

### Root Cause

Generated Gno code uses bare `import "std"` which is no longer valid on the
current test11 chain version. The chain module system may have changed.

### Affected Files (all 3 realm templates)
- `boardTemplate.ts:76` — `"std"` import in board realm code
- `channelTemplate.ts:165` — `"std"` import in channel realm code
- `candidatureTemplate.ts:234` — `"std"` import in candidature realm code
- `buildDeployBoardMsg()` — `gnomod.toml` format may need `gno.mod` update

### Tasks

| # | Task | Files |
|---|------|-------|
| 0.1 | Investigate test11 chain `std` import requirements | Research |
| 0.2 | Update `gnomod.toml` → `gno.mod` format if needed | `boardTemplate.ts`, `channelTemplate.ts` |
| 0.3 | Fix `import "std"` path in all 3 realm templates | 3 template files |
| 0.4 | Update existing tests to match new import format | 3 test files |
| 0.5 | Live-test deploy on Netlify | Browser verification |

---

## Phase 1: Hardening Sprint

### 1a. Repo Hygiene (CTO-4, CTO-5, OSS-3)

| # | Task | Files |
|---|------|-------|
| 1.1 | Add `backend/memba`, `*.db*` to `.gitignore` | `.gitignore` |
| 1.2 | Remove binary + DB from git tracking | `git rm --cached` |
| 1.3 | Run `bfg` or `git filter-repo` to purge from history | — |

### 1b. Error Resilience (SWE-1, SWE-2, SWE-3)

| # | Task | Files | Tests |
|---|------|-------|-------|
| 1.4 | React Error Boundary wrapper | `components/ErrorBoundary.tsx` [NEW] | 2 |
| 1.5 | Add `React.StrictMode` to `main.tsx` | `main.tsx` | — |
| 1.6 | Audit empty `catch {}` blocks → add Sentry reporting | ~10 files | — |

### 1c. Security (CSO-1, CSO-2)

| # | Task | Files |
|---|------|-------|
| 1.7 | Add CSP meta tag to `index.html` | `index.html` |
| 1.8 | Verify no credential leaks in Sentry breadcrumbs | `main.tsx` |

### 1d. DevOps (BT-1, BT-3, BT-4)

| # | Task | Files | Tests |
|---|------|-------|-------|
| 1.9 | Add `/health` endpoint to backend | `cmd/main.go` | 1 |
| 1.10 | Fix 2 Dependabot alerts | `package.json` / `go.mod` | — |
| 1.11 | Enable Sentry performance monitoring | `main.tsx` | — |

### 1e. Architecture (CTO-1, CTO-2)

| # | Task | Files |
|---|------|-------|
| 1.12 | BoardView decomposition (extract JitsiView, ThreadListView) | `BoardView.tsx` → split |
| 1.13 | Lift `boardInfo` to shared context | `ChannelsPage.tsx`, `BoardView.tsx` |

### 1f. Gno Core (GNO-1, GNO-3, GNO-4)

| # | Task | Files |
|---|------|-------|
| 1.14 | Track `r/sys/users` migration | `lib/userRegistry.ts` |
| 1.15 | Surface ABCI errors to users | `lib/dao/shared.ts` |
| 1.16 | Make gas fees configurable | `lib/config.ts`, `pages/Settings.tsx` |

### 1g. Blockchain (BC-1, BC-4)

| # | Task | Files |
|---|------|-------|
| 1.17 | Add tx retry/resubmit logic | `hooks/useAdena.ts` |
| 1.18 | Document contract upgrade strategy | `docs/ARCHITECTURE.md` |

---

## Phase 2: OSS Launch Prep

### 2a. Documentation (DR-1, DR-2, DR-3, DR-4)

| # | Task | Files |
|---|------|-------|
| 2.1 | Update `README.md` with features + screenshots | `README.md` |
| 2.2 | Create `CONTRIBUTING.md` | `CONTRIBUTING.md` [NEW] |
| 2.3 | Create `SECURITY.md` | `SECURITY.md` [NEW] |
| 2.4 | Create `CODE_OF_CONDUCT.md` | `CODE_OF_CONDUCT.md` [NEW] |
| 2.5 | GitHub issue templates | `.github/ISSUE_TEMPLATE/` [NEW] |
| 2.6 | PR template | `.github/PULL_REQUEST_TEMPLATE.md` [NEW] |

### 2b. Developer Experience (OSS-2, OSS-4)

| # | Task | Files |
|---|------|-------|
| 2.7 | Create `Makefile` | `Makefile` [NEW] |
| 2.8 | Verify/add `LICENSE` file | `LICENSE` |

### 2c. UX Improvements (UX-2, UX-5)

| # | Task | Files | Tests |
|---|------|-------|-------|
| 2.9 | Command palette (Cmd+K) | `components/ui/CommandPalette.tsx` [NEW] | 3 |
| 2.10 | Onboarding tooltip flow | `components/ui/OnboardingFlow.tsx` [NEW] | 2 |
| 2.11 | User-friendly error messages | `lib/errorMessages.ts` [NEW] | 5 |
| 2.12 | "What's New" changelog modal | `components/ui/WhatsNew.tsx` [NEW] | 2 |

---

## Phase 3: Revenue Foundation

### 3a. GnoSwap Slippage + Execution

| # | Task | Files | Tests |
|---|------|-------|-------|
| 3.1 | Slippage tolerance selector | `components/swap/SlippageSelector.tsx` [NEW] | 4 |
| 3.2 | Price impact calculation | `lib/gnoswap.ts` [NEW] | 8 |
| 3.3 | Swap execution via MsgCall | `lib/gnoswap.ts` | 5 |
| 3.4 | Token approval flow | `lib/gnoswap.ts` | 3 |
| 3.5 | Swap confirmation modal | `components/swap/SwapConfirm.tsx` [NEW] | 2 |
| 3.6 | Integration into TokenView | `pages/TokenView.tsx` | 2 |

### 3b. Executable Proposals

| # | Task | Files | Tests |
|---|------|-------|-------|
| 3.7 | Proposal type enum | `lib/proposalTypes.ts` [NEW] | 6 |
| 3.8 | Auto-execute realm template update | `lib/daoTemplate.ts` | 10 |
| 3.9 | Execution status tracking | `pages/ProposalView.tsx` | 3 |
| 3.10 | Execution history timeline | `components/dao/ExecutionTimeline.tsx` [NEW] | 4 |

---

## Finding → Phase Mapping

| Finding ID | Description | Phase |
|-----------|-------------|-------|
| BUG-1 | Board deploy `import "std"` fails | Phase 0 |
| CTO-4 | Binary in repo (53MB) | Phase 1 |
| CTO-5 | SQLite DB in repo | Phase 1 |
| CTO-1 | BoardView 673 LOC | Phase 1 |
| CTO-2 | boardInfo double fetch | Phase 1 |
| CSO-2 | No CSP | Phase 1 |
| SWE-1 | No Error Boundary | Phase 1 |
| SWE-2 | Empty catch blocks | Phase 1 |
| SWE-3 | No StrictMode | Phase 1 |
| GNO-1 | `r/gnoland/users` deprecated | Phase 1 |
| GNO-3 | Silent ABCI errors | Phase 1 |
| GNO-4 | Hardcoded gas | Phase 1 |
| BC-1 | No tx retry | Phase 1 |
| BT-3 | No health endpoint | Phase 1 |
| BT-4 | 2 Dependabot alerts | Phase 1 |
| DR-1 | README outdated | Phase 2 |
| DR-3 | No CONTRIBUTING | Phase 2 |
| OSS-2 | No issue templates | Phase 2 |
| OSS-4 | No Makefile | Phase 2 |
| UX-2 | No command palette | Phase 2 |
| UX-5 | No onboarding flow | Phase 2 |
| CTO-3 | index.css 890 LOC | 🔵 v3.0 |
| CSO-3 | Public Jitsi rooms | 🔵 v4.0 |
| GNO-2 | No `gno test` in CI | 🔵 v3.0 |
| UX-1 | Dark-only mode | 🔵 v3.0 |
| UX-3 | No presence dots | 🔵 v3.0 |
| BT-2 | No structured logging | 🔵 v3.0 |
| BC-3 | No mempool monitoring | 🔵 v3.0 |
