# VALIDATORS — Valoper Profile Cards: Audit & AAA Implementation Plan

- **Date:** 2026-06-24
- **Status:** DRAFT — awaiting review (no code changed; this doc only)
- **Scope:** Note **A) Validators** — "clicking valoper cards (Candidates + Active) shows *unknown address* instead of the profile."
- **Branch (proposed):** `feat/valoper-profile-detail` off `main` (do **not** commit on `main`)
- **Conflict surface:** isolated to the Validators page + valoper lib (see §7). Low overlap risk with home/light-theme/NFT sessions.

---

## 0. TL;DR (root cause is confirmed)

The valoper cards **do** fetch rich, correct data from test13. The only user-facing action on a card — the **"View profile ↗"** link — is **hardcoded to the mainnet gnoweb host** (`https://gno.land`). test13 valopers are not registered on mainnet, so mainnet gnoweb returns *"unknown address / 404"* for **100%** of them.

```
ValoperPanel.tsx:25-26
  const profileUrl = (operatorAddress) =>
      `https://gno.land/r/gnops/valopers:${operatorAddress}`   // ← mainnet host, always wrong on test13
```

**Live reproduction (2026-06-24):**

| URL clicked | Result |
|---|---|
| `https://gno.land/r/gnops/valopers:g1…` (current code, **mainnet**) | **404 / not found** ❌ |
| `https://gnoweb.test-13.gnoland.network/r/gnops/valopers:g1n9y62…` (**canonical test13**, user-verified) | renders **samourai-crew-1** full profile ✅ |
| `https://test13.testnets.gno.land/r/gnops/valopers:g1078xslm…` (current config default) | rendered Santala-Research in an earlier probe — **RE-VERIFY** (see §1.4) |

**Host correction (user, 2026-06-24):** the canonical test13 gnoweb is **`https://gnoweb.test-13.gnoland.network`** (verified live for `samourai-crew-1` = `g1n9y62agq998jt8w59az60xcqlftjknjg2grhn4`). `https://gno.land` is wrong (mainnet / resolves to gnoland1 data). Note: the code's `getExplorerBaseUrl()` / `getGnowebUrl("test13")` currently default to a **different** host, `https://test13.testnets.gno.land` ([config.ts:336](../../frontend/src/lib/config.ts), [gnoweb.ts:28](../../frontend/src/lib/gnoweb.ts)) — both are env-overridable. `gnoweb.test-13.gnoland.network` is already covered by the `gnoland.network` trusted-domain suffix ([config.ts:427](../../frontend/src/lib/config.ts)).

The sibling `ValidatorDetail` page already routes its gnoweb link through `getExplorerBaseUrl()` ([validators.ts:163](../../frontend/src/lib/validators.ts)); **only `ValoperPanel` regressed to a hardcoded mainnet URL.** So the fix is: route the valoper link through the config helper **and** pin the helper's test13 default to the user-verified host (§1.4 + Phase 0).

→ **P0 fix is small.** The user's framing ("display profiles *when we click on cards*", "AAA standards") points beyond a link fix to an **in-app valoper detail view** (the rich data is already fetched) — which also removes the external-host dependency entirely. Both are planned below.

---

## 1. Evidence & root-cause analysis

### 1.1 Data flow (verified end-to-end)

1. **List:** `fetchValopers()` → `queryRender(rpc, "gno.land/r/gnops/valopers", "")` → `parseValoperList()` extracts `{moniker, operatorAddress}` for all 47 registered valopers. ([valopers.ts:94-101](../../frontend/src/lib/valopers.ts))
2. **Per-valoper detail:** for each operator → `queryRender(rpc, realm, operatorAddress)` → `parseValoperDetail()` extracts moniker, description, operator/signing address, signing pubkey, server type. ([valopers.ts:102-116](../../frontend/src/lib/valopers.ts))
3. **Status:** `computeValoperStatus(signingAddress, activeConsensusSet)` → `active | candidate`. ([valopers.ts:84-89](../../frontend/src/lib/valopers.ts))
4. **Render:** `ValoperPanel` maps each `ValoperWithStatus` to a card showing moniker, status pill, server type, description, operator+signing addresses, and a **"View profile ↗"** link. ([ValoperPanel.tsx:88-135](../../frontend/src/components/validators/ValoperPanel.tsx))

### 1.2 Live chain truth (test13, probed 2026-06-24)

- The realm `gno.land/r/gnops/valopers` on **test13** returns **47 valopers, all with complete profiles** (moniker, description, addresses, pubkey, server type). Data is **not** sparse.
- The realm string `"unknown address " + addr` is emitted **only by the realm's `Render(addr)`** when `valopers.Get(addr)` misses ([gno/.../r/gnops/valopers/valopers.gno:411](../../../gno/examples/gno.land/r/gnops/valopers/valopers.gno)). It is **not** a Memba UI string (grep of `frontend/src` confirms: the phrase appears only in a code comment and a test fixture).
- ∴ The user can only be seeing "unknown address / not found" from **gnoweb**, reached via the card's link → **confirms the host bug, not a parse/data bug.**

### 1.3 Why the parse layer is *not* the cause

`parseValoperList` / `parseValoperDetail` regexes match the live Render output exactly (verified against real bytes). Existing unit tests in [valopers.test.ts](../../frontend/src/lib/valopers.test.ts) encode the correct shapes. No change needed there for the bug — but we add a **regression test** so the host can never silently revert to mainnet (§6).

### 1.4 Host strategy — which test13 gnoweb to point at (the one open data question)

Three hosts are in play:

| Host | Status | Used by |
|---|---|---|
| `gno.land` | ❌ wrong (mainnet/gnoland1) — the current bug | hardcoded in `ValoperPanel` only |
| `gnoweb.test-13.gnoland.network` | ✅ **user-verified canonical** for valopers | (not yet referenced in code) |
| `test13.testnets.gno.land` | ⚠️ config default; rendered a valoper in one probe — **re-verify** | `getExplorerBaseUrl()`, `getGnowebUrl("test13")` → validator-profile links, directory namespace listing, home traction |

**Decision driver:** `getExplorerBaseUrl()`/`getGnowebUrl()` are **shared** — they also build `/r/demo/profile:u/…` links and the directory's `/r/<namespace>` listing. So before changing their default host we must confirm the new host serves **all** those paths, not just valopers. Two implementation shapes:

- **U (unify) — preferred if verified:** point the test13 default at `gnoweb.test-13.gnoland.network` (env override already exists: `VITE_TEST13_GNOWEB_URL` / `VITE_TEST13_EXPLORER_URL`). One canonical host; `ValoperPanel` then just uses `getGnowebUrl(GNO_CHAIN_ID)`. **Gate:** live-verify the host also renders `/r/demo/profile:u/<addr>` and `/r/samcrew` listing (else directory/home/validator-profile links regress).
- **N (narrow) — zero blast radius fallback:** keep the shared default as-is; have `ValoperPanel` build its link from a dedicated, env-overridable valoper-gnoweb constant defaulting to `gnoweb.test-13.gnoland.network`. Touches only the valoper path; no risk to other consumers.

**Pending live re-verification (classifier outage at audit time):** (a) does `test13.testnets.gno.land` render `/r/gnops/valopers:<addr>`? (b) does `gnoweb.test-13.gnoland.network` render `/r/demo/profile:u/<addr>` and `/r/<namespace>`? Answers pick U vs N. See **D5**.

---

## 2. Secondary findings (in scope, lower priority)

| # | Finding | Evidence | Severity | Action |
|---|---|---|---|---|
| S1 | **Onboarding CTA is also mainnet-hardcoded.** `ONBOARDING_URL = "https://gno.land/r/gnoland/blog:p/validator-test13"` | [ValoperPanel.tsx:29](../../frontend/src/components/validators/ValoperPanel.tsx) | Low | Fix host in P0 (or keep mainnet if the blog post is mainnet-only — **decision D3**). |
| S2 | **All valopers show "Candidate", never "Active".** `fetchValopers(rpc, new Set(vals.map(v => v.gnoAddr)))` compares valoper `signingAddress` to the **consensus** set. On test13 the active set is the gno-core **genesis** validators, which never registered as valopers → 0 matches. | [Validators.tsx:138](../../frontend/src/pages/Validators.tsx), [valopers.ts:84-89](../../frontend/src/lib/valopers.ts) | Low | **Likely correct** (registered valopers genuinely aren't in the active set yet). Verify live; if correct, keep logic and make the identity model legible in the detail view (Phase 2). Do **not** over-engineer a signing→operator join the chain data doesn't currently need. |
| S3 | **Cards-populate-in-browser is unverified.** On-chain data + RPC reachability are confirmed via curl, but the team's own hard rule is *curl ≠ browser* (CORS/CSP `connect-src`). 47 parallel per-valoper ABCI queries also merit a perf/timeout check. | [reference_gno_netinfo_validators](memory) | Med | **Mandatory live browser smoke-test** in Phase 3 before sign-off. |
| S4 | Cards are not clickable as a whole; the moniker is plain text; there is no deep-link to a single valoper. | [ValoperPanel.tsx:88-99](../../frontend/src/components/validators/ValoperPanel.tsx) | UX | Addressed by Phase 1 (in-app detail). |

---

## 3. Gno ecosystem breaking-change audit (fetch-only; no working trees disturbed)

Method: `git fetch` + `log`/`status` across the workspace Gno repos (deliberately **no `git pull`** to avoid colliding with the parallel sessions). Window: 2026-06-10 → 06-24.

| Repo | Git state | Memba-relevant change | Severity |
|---|---|---|---|
| **gno** | ⚠️ **dirty** (uncommitted `examples/gno.land/p/samcrew/*`, `proposal.gno`, `.agent/`) | `0c17a9a58` gnoclient `QuerySessionAccount` return type → `GnoSessionAccount`; `3a06af8c3` revert valset trust-level/cooldown; OOG error UX (`ab4759e79`,`da3229b43`) | **None block Memba.** Memba uses raw RPC (not gnoclient). Valopers/validators realms **unchanged** since Jun 10. RPC/ABCI wire format unchanged. |
| **gnodaokit** | clean | `e8eb41c` new `realmid` pkg (cross-realm member pkgpath) | Watch (future multi-DAO only) |
| **adena-wallet** | clean | session-account tx history, storage migration, v1.19.7 | Benign |
| **samcrew-deployer** | clean | v3 RegisterMarket script, market_core Phase 0 | Benign |
| **tokenfactory** | clean | none since Mar 2026 | Benign |
| **gno-docs** | clean | PR-review tracking only | Benign |

**Verdict: no breaking change blocks this work or current prod.** Safe to `git pull` the **clean** repos; **hold `gno`** (local edits — pull would risk a parallel session's work). The only "watch" with any UX surface is the OOG error-message format, unrelated to validators.

---

## 4. Proposed solution (AAA)

**Recommendation (smarter-CTO option):** ship the **P0 hotfix now**, then build an **in-app Valoper Detail** view so profile display no longer depends on an external gnoweb host at all — eliminating this entire bug class (host/network drift) and giving a consistent, mobile-friendly, deep-linkable experience. gnoweb becomes a *secondary* "View on gnoweb" link (with the correct host).

### Phase 0 — P0 hotfix: correct the gnoweb host (ship same day)

1. **Live re-verify the two open host questions** (§1.4 a/b) → choose shape **U** (unify default on `gnoweb.test-13.gnoland.network`) or **N** (dedicated valoper-gnoweb constant). Default to **N** if verification is inconclusive (zero blast radius).
2. In `ValoperPanel.tsx`, replace the hardcoded `https://gno.land` with the chosen config-driven host (mirroring `ValidatorDetail`'s use of `getExplorerBaseUrl()` at [validators.ts:163](../../frontend/src/lib/validators.ts)). The verified-good value is **`https://gnoweb.test-13.gnoland.network`**.
3. Resolve **D3** for `ONBOARDING_URL` (same hardcode; fix host or confirm it's intentionally mainnet).
4. **Add a regression unit test:** the rendered profile-link host must equal the active-network gnoweb host and **must not** be `gno.land` on test13 (fails if anyone re-hardcodes mainnet).
5. If shape **U**: re-run the directory + home + validator-profile-link smoke paths to confirm no regression on the new host.
- **Outcome:** clicking a valoper card resolves to the real test13 profile (e.g. `gnoweb.test-13.gnoland.network/r/gnops/valopers:g1n9y62…` → samourai-crew-1). Closes the user-reported bug immediately.

### Phase 1 — In-app Valoper Detail (AAA core)

- **Route:** `/validators/valoper/:operatorAddress`, declared **before** `validators/:address` (route-order is already a documented gotcha for `/validators/hacker` at [App.tsx:206-209](../../frontend/src/App.tsx)).
- **Component:** `pages/ValoperDetail.tsx` (+ `valoper-detail.css`), styled consistently with `ValidatorDetail`.
- **Data:** reuse existing code — `queryRender(GNO_RPC_URL, "gno.land/r/gnops/valopers", operatorAddress)` + `parseValoperDetail()` (no new parsing). Optionally pass the already-fetched `ValoperWithStatus` via router state for instant paint, then refresh.
- **Surface:** moniker, status (active/candidate) with explanation, description, **identity model made legible** (Operator address = stable identity vs Signing address = rotatable consensus key), signing pubkey, server type, copy buttons, gno profile link (`/r/demo/profile:u/<operator>`), and a secondary **"View on gnoweb ↗"** (correct host).
- **Make the whole card clickable** → navigates to the detail route; keep an explicit affordance for a11y/keyboard.
- **Graceful states:** loading, not-found (operator no longer registered), error+retry — mirror `ValidatorDetail`'s patterns ([ValidatorDetail.tsx:228-275](../../frontend/src/pages/ValidatorDetail.tsx)).

### Phase 2 — Status accuracy & identity clarity

- Confirm S2 live: is "all candidate" the true test13 state? If yes, **document it** in-UI (e.g. "No registered valoper is in the active set yet — the active set is genesis-seeded") rather than changing logic.
- Only if live data shows a valoper that *is* active but mislabeled, add the `signingRegistry`-based join (consensus signing addr → operator) per the realm's secondary index ([valopers.gno:52-67](../../../gno/examples/gno.land/r/gnops/valopers/valopers.gno)). Gate this on evidence; otherwise it's speculative complexity.

### Phase 3 — Hardening & verification (gate before merge)

- **Live browser smoke-test** (mandatory, per team rule): load `/validators` in the running app, confirm all 47 cards populate with monikers (rule out CORS/CSP/timeout), click into a detail route, click "View on gnoweb" and confirm test13 resolves. Capture a screenshot.
- Perf check on the 47 per-valoper ABCI fan-out (cache TTL already 5 min; confirm no timeout cascade on a slow RPC).
- Full `npm run build` (note: `tsc --noEmit` is a no-op here per project memory) + `vitest` green.

---

## 5. Out of scope (explicitly)

- The consensus-validator list, `/validators/:address` detail, hacker view, network roster — all use the correct host already; untouched.
- No realm/on-chain changes. No backend changes (valoper data is 100% client-side RPC).
- No multisig, no deploy, no env-flag flips.

---

## 6. File-by-file change map (conflict surface)

| File | Phase | Change |
|---|---|---|
| `frontend/src/components/validators/ValoperPanel.tsx` | 0,1 | host fix; make card clickable; link to detail route |
| `frontend/src/components/validators/ValoperPanel.test.tsx` | 0,1 | regression test (link host) + click-nav test |
| `frontend/src/pages/ValoperDetail.tsx` *(new)* | 1 | new detail page |
| `frontend/src/pages/valoper-detail.css` *(new)* | 1 | styles |
| `frontend/src/pages/ValoperDetail.test.tsx` *(new)* | 1 | states + render tests |
| `frontend/src/App.tsx` | 1 | add route (correct ordering) |
| `frontend/src/lib/valopers.ts` | 1 (opt) | optional `fetchValoperByAddress` thin wrapper (reuses parse) |

**Parallel-session note:** none of these are in the home/light-theme/NFT hot paths. `App.tsx` is the only shared file — a single added route line; coordinate the merge of that one line. Recommend a dedicated branch + small, fast PR for Phase 0 so it lands before the bigger Phase 1.

---

## 7. Test & acceptance plan

**Unit (vitest):**
- Profile link host == active-network gnoweb host (regression for the exact bug). 
- Card click navigates to `/validators/valoper/:operatorAddress`.
- `ValoperDetail`: renders parsed profile; loading / not-found / error states.

**Live (browser smoke — required):**
- `/validators` → 47 cards, monikers populated, statuses shown.
- Click card → in-app detail renders rich profile.
- "View on gnoweb ↗" → opens `test13.testnets.gno.land/...` and resolves (no 404).

**Acceptance criteria:**
1. Clicking any Candidate or Active valoper shows accurate profile info in-app. ✅
2. No path leads to mainnet `gno.land` for test13 valoper data. ✅
3. `npm run build` + `vitest` green; live screenshot attached to PR. ✅

---

## 8. Methodology & coordination (per house rules)

- Branch `feat/valoper-profile-detail` off `main`; **never commit on `main`** (and `cd` into the worktree before `git commit` — the hook checks the Bash cwd's branch).
- Two PRs: **PR-A** = Phase 0 hotfix (tiny, fast review, ships the fix); **PR-B** = Phase 1–3 (in-app detail).
- Admin-merge only on **CI-green** + explicit user approval (never merge without it).
- No Claude attribution in commits/PRs.

---

## 9. Open decisions for your review

- **D1 — Depth:** P0 hotfix only, or P0 + AAA in-app detail (recommended)?
- **D2 — Detail UX:** dedicated route `/validators/valoper/:operatorAddress` (deep-linkable, recommended) vs modal/drawer (no route-order risk, no deep-link)?
- **D3 — Onboarding link:** point `ONBOARDING_URL` at the test13 gnoweb host too, or is that blog post intentionally mainnet?
- **D4 — Status (S2):** if "all candidate" is confirmed correct on test13, document-in-UI only (recommended) vs build the signing→operator join now?
- **D5 — Host strategy (§1.4):** unify the shared test13 gnoweb default on the user-verified `gnoweb.test-13.gnoland.network` (shape **U**, cleaner) vs a dedicated valoper-only host constant (shape **N**, zero blast radius)? Pending the two live re-verifications.

---

## Appendix — key references

- Bug: [ValoperPanel.tsx:25-29](../../frontend/src/components/validators/ValoperPanel.tsx) · correct pattern to mirror: [validators.ts:163](../../frontend/src/lib/validators.ts)
- Helpers: [gnoweb.ts:24-38](../../frontend/src/lib/gnoweb.ts) · [config.ts: getExplorerBaseUrl ~330-337, GNO_CHAIN_ID:246](../../frontend/src/lib/config.ts)
- Fetch/parse: [valopers.ts](../../frontend/src/lib/valopers.ts) · tests [valopers.test.ts](../../frontend/src/lib/valopers.test.ts)
- Routes: [App.tsx:206-209](../../frontend/src/App.tsx)
- Realm truth: [gno/examples/gno.land/r/gnops/valopers/valopers.gno](../../../gno/examples/gno.land/r/gnops/valopers/valopers.gno) (struct :69-84, `GetByAddr` :388, `Render`/unknown-address :400-476)
- Prior art: [VALIDATORS_MONITORING_AUDIT_AND_PLAN.md](./VALIDATORS_MONITORING_AUDIT_AND_PLAN.md)
