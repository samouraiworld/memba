# Memba v7.0 — AAA SWE Implementation Plan (Rev7 FINAL)

> **Date:** 2026-04-20
> **Revision:** Rev7 — CTO Deep Crosscheck with source code verification
> **Methodology:** Git-pulled all 6 repos + cloned gnolang/gno master + verified every breaking change claim against actual source code + scanned 20+ upstream PRs/issues
> **Live checks:** Networks probed at 2026-04-20T09:48Z
> **Experts:** CTO + GnoVM ×2 + Gno Core ×2 + Memba CTO

---

## TABLE OF CONTENTS

1. [Rev7 Corrections](#1-rev7-corrections)
2. [Upstream Breaking Change Matrix](#2-upstream-breaking-change-matrix)
3. [Live Network Status](#3-live-network-status)
4. [Repository Status](#4-repository-status)
5. [Corrected Issue Registry](#5-corrected-issue-registry)
6. [Implementation Plan](#6-implementation-plan)
7. [Architecture Decisions](#7-architecture-decisions)
8. [Risk Assessment](#8-risk-assessment)
9. [Roadmap](#9-roadmap)
10. [Documentation Updates](#10-documentation-updates)

---

## 1. Rev7 Corrections

### ✅ COMPAT-02 RESOLVED — GovDAO Vote Function Is Safe

**Rev6 claimed:** PR #5222 merged → `MustVoteOnProposalSimple` may have been renamed
**Rev7 VERIFIED:** Cloned `gnolang/gno` master, searched source code.

```
examples/gno.land/r/gov/dao/proxy.gno:
  func MustVoteOnProposalSimple(cur realm, pid int64, option string) {
```

**`MustVoteOnProposalSimple` STILL EXISTS** with the exact same signature. PR #5222 changed GovDAO T1 to use multisig governance but did NOT rename the voting API. Memba's `GOVDAO_VOTE_FUNC = "MustVoteOnProposalSimple"` in `builders.ts` is **100% correct**.

> **Action:** COMPAT-02 is REMOVED from the plan. No code change needed.

---

### 🟢 COMPAT-01 DOWNGRADED (HIGH → LOW)

**Rev6 claimed:** PR #5037 merged → boards2 Render() format change → Memba parser breaks
**Rev7 VERIFIED:** Examined `boards2/v1/render.gno` from master.

The boards2 Render() function uses a `mux.Router` with named routes:
```go
router.HandleFunc("", renderBoardsList)
router.HandleFunc("{board}", renderBoard)
router.HandleFunc("{board}/{thread}", renderThread)
router.HandleFunc("{board}/{thread}/{reply}", renderReply)
// ... same URL structure as before
```

PR #5037 added **safe READ functions** as additional APIs:
- `GetBoardIDFromName()` — safe board lookup by name
- `GetBoard()` — safe board getter
- `GetRealmPermissions()` — safe permissions getter
- `hub/NewSafeThread()` — safe thread wrapper

These are **ADDITIONAL functions** for realm/off-chain integration. They do **NOT change** the Render() markdown output format. Memba's `parserV1.ts` regex should work unchanged.

> **Action:** COMPAT-01 downgraded to P2. parserV2 is a nice-to-have optimization (use safe functions instead of parsing Render() markdown), NOT a mandatory fix. Moved from Sprint 2 to Sprint 5 (polish).

---

### 🆕 NEW: PR #5307 — Account Sessions (Game-Changer)

**Author:** Jae Kwon | **Status:** OPEN | **Updated:** 2026-04-20

> *"Implement account sessions: users can authorize limited-capability signing keys for dApps, scoped by time, realm path, and spending limits."*

This is a **transformative feature** for Memba's UX:
- Users could authorize Memba to sign on their behalf without Adena popup for every action
- Session keys have spend limits and path restrictions (e.g., only `r/samcrew/*`)
- Sessions are separate subaccounts at `/a/<master>/s/<session>`
- Realms can introspect via `runtime.GetSessionInfo()`

**Impact:** No immediate code change, but this should be tracked as a **v8.0 strategic feature**. When merged, Memba could offer "gasless-feeling" UX for DAO voting, channel posting, etc.

---

## 2. Upstream Breaking Change Matrix (CORRECTED)

| Prio | PR | Status | Memba Impact | Action |
|------|-----|--------|-------------|--------|
| 🟢 ~~P0~~ **P2** | **#5037** boards2 safe functions | ✅ MERGED | ~~HIGH~~ → **LOW**: Render() format unchanged. Safe functions are additive. | parserV2 optional (Sprint 5) |
| ~~🔴 P0~~ **RESOLVED** | **#5222** GovDAO T1 multisig | ✅ MERGED | **NONE**: `MustVoteOnProposalSimple` still exists, same signature | ✅ No action needed |
| 🔴 **P0** | **#5415** gas storage refactor | OPEN | HIGH: all gas costs will change | Monitor. gasConfig.ts is flexible |
| 🟡 **P1** | **#5511** hardfork mechanism v3 | OPEN | MED: enables chain upgrades | Monitor |
| 🟡 **P1** | **#5546** GRC20/721 spec META | OPEN | MED: may change token interfaces | Monitor (feature-flagged) |
| 🟡 **P1** | **#5307** account sessions | OPEN | **POSITIVE**: transformative UX | Track for v8.0 |
| 🟢 **P2** | **#5504** GRC721 royalty basis pts | OPEN | LOW: nft_market feature-flagged | Monitor |
| 🟢 **P2** | **#5544** dedupe type persistence | OPEN | LOW: chain-level | Monitor |
| 🟢 **P2** | **#5547** ufmt perf | OPEN | **POSITIVE**: lower gas | No action |
| 🟢 **P2** | **#5475** bptree | OPEN | NONE: optional AVL alternative | Future |
| 🟢 **P2** | **#5112** gas-fee-margin | OPEN | LOW: gnokey tooling | Monitor |
| ℹ️ | **#5543** gnoweb URL after deploy | OPEN | NONE: DX improvement | N/A |

> [!TIP]
> **Good news from Rev7:** Both P0 tracked PRs (#5037, #5222) that merged to master are **NON-BREAKING** for Memba. The plan's mandatory COMPAT tasks have been resolved/downgraded. No emergency work needed before next chain upgrade.

---

## 3. Live Network Status (2026-04-20T09:48Z)

| Network | Block | Δ from Apr 18 | Rate | Status |
|---------|-------|---------------|------|--------|
| **test12** (Samourai) | **391,129** | +24,934 (48h) | ~7.3s/block | 🟢 ALIVE |
| **gnoland1** (Samourai) | **769,175** | +37,302 (48h) | ~4.6s/block | 🟢 ALIVE |
| **gnoland1** (moul/aeddi) | 769,175 | synced | — | 🟢 ALIVE |
| **test12** (public) | — | — | — | 🔴 STILL DOWN |

Both chains healthy and progressing normally. test12 public RPC has been down for 48h+ — confirms INFRA-01 (SPOF risk).

---

## 4. Repository Status

| Repository | Branch | Up to Date | Key Finding |
|-----------|--------|------------|-------------|
| **Memba** | `fix/v6-error-messages-theme` | ✅ | PR #314 ready to merge (+1 commit ahead) |
| **samcrew-deployer** | `fix/mainnet-security-audit-v3` | ⚠️ | **Never pushed to origin** — local only, 5 commits ahead |
| **tokenfactory** | `main` | ✅ | No changes |
| **HyperGno** | `main` | ✅ | No upstream tracking |
| **zkgno** | `main` | ✅ | No changes |

**Key:** React Query 5.99.0 already installed in Memba (PR #307). cosmos-sdk bumped to 0.54.0 (PR #308).

---

## 5. Corrected Issue Registry

### HIGH — 5 issues (down from 7 in Rev6 — 2 COMPAT tasks resolved)

| ID | Issue | Impact | Sprint |
|----|-------|--------|--------|
| **DEPLOY-01** | Deployer branch never pushed + not merged (5 commits) | BLOCKS deployment | 0.1 |
| **CHANNELS-01** | channels_v2 PreviousRealm() owner + missing events/pause | BLOCKS v3 | 1 |
| **INFRA-01** | test12 ZERO fallback RPCs (48h public RPC outage proves risk) | SPOF | 0.4 |
| **QUAL-01** | Backend test coverage 22% → 40% | QUALITY | 3 |
| **DOC-STALE** | 5 stale docs + breaking changes tracker needs MERGED markers | CONFUSION | 0.3 |

### MEDIUM — 11 issues (down from 14 — removed resolved/duplicate items)

| ID | Issue | Sprint |
|----|-------|--------|
| **GAS-WATCH** | PR #5415 gas refactor — monitor | Ongoing |
| **GRC-WATCH** | #5546 GRC20/721 spec — monitor | Ongoing |
| **CFG-01** | test12 no fallback RPCs in config.ts | 0.4 |
| **CFG-04** | channelsPath defaults to _v2 | 1.3 |
| **DATA-01** | React Query migration (deps already installed) | 2 |
| **QUAL-02** | Frontend coverage 56% → 60% | 3 |
| **BETA-01** | Betanet realm deployment (gnoland1 empty) | 4 |
| **DATA-02** | WAL file in repo | 0.3 |
| **OSS-01** | CODEOWNERS single person | 5 |
| **DOC-12** | gnoland1 transfer lock status unknown | 0.6 |
| **FLAG-01** | Feature flags still false (marketplace/NFT/services) | 4.5 |

---

## 6. Implementation Plan

### Sprint 0: Merge & Housekeeping (Days 1-3)

| Step | Task | Day |
|------|------|-----|
| **0.1** | `git push origin fix/mainnet-security-audit-v3` → PR → merge to main | 1 |
| **0.2** | Merge Memba PR #314 → main | 1 |
| **0.3** | Update 5 stale docs + mark #5037/#5222 as MERGED in breaking changes tracker | 2 |
| **0.4** | chainHealth fallback order → `["gnoland1", "test12"]` + add test12 fallback when alive | 2 |
| **0.5** | WAL/SHM → .gitignore + git rm --cached | 2 |
| **0.6** | Check gnoland1 transfer lock status (gates Sprint 4) | 3 |

**Gate:** Both branches merged, docs updated, transfer lock known.

---

### Sprint 1: Channels v3 on test12 (Days 4-6)

| Step | Task | Day |
|------|------|-----|
| **1.1** | Copy channels_v2 → channels_v3, update package/gno.mod | 4 |
| **1.2** | `gno test` + `gno lint` — verify locally | 4 |
| **1.3** | Deploy via `rpc.testnet12.samourai.live` (10M fee, 150M wanted, 100M deposit) | 5 |
| **1.4** | On-chain verify: Render, ACL, pause | 5 |
| **1.5** | Update frontend channelsPath → _v3, run tests, deploy | 6 |

**Gate:** channels_v3 LIVE on test12, frontend pointing to v3, all 1,777+ tests green.

---

### Sprint 2: React Query Migration (Days 7-17)

> React Query 5.99.0 already installed — no dependency step needed.

| Step | Task | Days |
|------|------|------|
| **2.1** | QueryClientProvider + queryKeys.ts + useGnoQuery/useGnoMutation | 7-8 |
| **2.2** | DAO hooks: useDAOConfig, useDAOMembers, useDAOProposals, useVoteMutation | 8-12 |
| **2.3** | Multisig hooks: useMultisigs, useSignMutation, useBroadcastMutation | 12-14 |
| **2.4** | Token hooks: useTokenList, useTokenBalance, useGNOTBalance | 14-17 |

---

### Sprint 3: Quality (Days 10-20, overlaps Sprint 2)

- [ ] Backend coverage 22% → 40%
- [ ] Frontend coverage 56% → 60%
- [ ] GnoBuilders admin review UI
- [ ] CI threshold ramp

---

### Sprint 4: Betanet Deployment (Days 18-23)

> **GATED on Sprint 0.6** — gnoland1 transfer lock must be UNLOCKED.

| Step | Task | Day |
|------|------|-----|
| **4.1** | Fund deployer key ~60 GNOT (no faucet) | 18 |
| **4.2** | Pre-flight: `./samcrew-verify.sh betanet` | 18 |
| **4.3** | Deploy in PREFLIGHT order (gnodaokit → tokenfactory → memba_dao → candidature → channels → badges) | 19-20 |
| **4.4** | Frontend network support + realm-versions.json | 21 |
| **4.5** | Feature flag activation via Netlify env (after realm verification) | 22 |

**Gas config (gnoland1):** 10M fee, **80M** wanted, 1M deposit.

---

### Sprint 5: Polish & Release (Days 23-28)

- [ ] Optional: parserV2 (use boards2 safe functions — nice-to-have, not mandatory)
- [ ] CSP `unsafe-inline` removal planning
- [ ] Jargon audit
- [ ] CODEOWNERS update
- [ ] Full regression (both chains)
- [ ] Bundle < 600KB, TS 0 errors, lint 0 errors
- [ ] v7.0.0 tag + deploy + verify

---

## 7. Architecture Decisions

| ID | Decision | Evidence |
|----|----------|----------|
| **AD-01** | React Query: page-by-page, financial first | RQ 5.99.0 already installed (PR #307) |
| **AD-02** | channels_v3: flat suffix `_v3` | realm-versions.json pattern confirmed |
| **AD-03** | boards2 parserV2: OPTIONAL (Sprint 5) | Rev7 verified: Render() format unchanged, safe funcs are additive |
| **AD-04** | GovDAO vote func: NO CHANGE NEEDED | Rev7 verified: `MustVoteOnProposalSimple` exists in master |
| **AD-05** | Account sessions (#5307): track for v8.0 | Jae Kwon, game-changer UX, OPEN |
| **AD-06** | Gas monitoring: watch #5415 | gasConfig.ts is user-configurable |
| **AD-07** | Betanet deploy order: follow PREFLIGHT.md | Strict dependency graph |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **test12 sentry outage** (48h public RPC outage proves risk is real) | MEDIUM | CRITICAL | Sprint 4: deploy to gnoland1 as backup |
| **gnoland1 transfer lock active** | MEDIUM | HIGH | Sprint 0.6 checks. If locked → defer Sprint 4 |
| **Gas costs change (#5415)** | MEDIUM | MEDIUM | gasConfig.ts is flexible, user-configurable |
| **GRC20/721 spec changes (#5546)** | LOW-MED | LOW | Feature-flagged |
| **gnoland1 chain reset** | LOW | VERY HIGH | Validators re-added via GovDAO |
| **channels_v3 deploy fails** | LOW | MEDIUM | Test locally first, deployer idempotent |
| **React Query regressions** | LOW | MEDIUM | Gnolove pattern proven, page-level tests |
| ~~boards2 format breaks~~ | ~~HIGH~~ | ~~HIGH~~ | **RESOLVED**: format unchanged |
| ~~GovDAO vote func renamed~~ | ~~MEDIUM~~ | ~~HIGH~~ | **RESOLVED**: function still exists |

---

## 9. Roadmap

| Month | Version | Focus |
|-------|---------|-------|
| **1** | **v7.0.0** | This plan: channels_v3 + React Query + betanet |
| **2** | v7.1.0 | React Query completion + test12 fallback RPC |
| **3** | v7.2.0 | Integration tests + CSP nonce |
| **4** | v8.0.0 | Progressive decentralization + account sessions exploration (#5307) |
| **5-6** | v8.x | Ecosystem contributions + mainnet prep |

---

## 10. Documentation Updates

| Document | Update | When |
|----------|--------|------|
| `GNO_CORE_BREAKING_CHANGES.md` | #5037 → MERGED (safe, additive). #5222 → MERGED (vote func unchanged). Add #5415, #5307 | Sprint 0.3 |
| `DEPLOYMENT_RUNBOOK.md` | Add 5 missing realms to inventory | Sprint 0.3 |
| `MAINNET_PREPARATION.md` | gnoland1: HALTED → LIVE (block 769K+) | Sprint 0.3 |
| `ROADMAP.md` | gnoland1: halted → live | Sprint 0.3 |
| `realm-versions.json` | Fix stale notes | Sprint 0.3 |

---

> **Rev7 is FINAL.**
>
> **Key delta from Rev6:** Two mandatory COMPAT tasks RESOLVED after source code verification. Plan is now LEANER (5 HIGH issues, down from 7). Both #5037 and #5222 are confirmed non-breaking. New strategic opportunity identified (#5307 account sessions).
>
> This plan has undergone **7 revision rounds**, verified against **25+ docs**, **20+ upstream PRs**, **live RPC queries**, and **actual gnolang/gno master source code**.
>
> **Ready for approval and execution.**
