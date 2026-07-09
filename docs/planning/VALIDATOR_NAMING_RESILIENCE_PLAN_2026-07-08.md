# Validator Naming Resilience — Root Cause + Cross-Repo Implementation Plan

**Date:** 2026-07-08
**Author:** engineering (with cross-perspective expert panel)
**Status:** DRAFT — owner review pending. Nothing coded yet.
**Symptom:** On `/test13/validators`, `/test13/validators/:addr`, and everywhere validators/candidates render, active-validator **names collapsed to bare addresses** ("g15sys…vwpves" instead of "gfanton-1"). Broke overnight 2026-07-07→08, self-healed, flapping.

---

## 1. Executive summary

There are **two independent root causes**, at two layers, both of which must be fixed:

1. **gnomonitoring (the true source of THIS incident, and the highest-leverage fix).**
   The `/Participation` name resolves via `COALESCE(am.moniker, combined.addr)` — it reads the name from the `addr_monikers` table and **falls back to the raw address** when that table has no row for a validator. The *sibling* streak query already falls back to the frozen `daily_participations` moniker first (`COALESCE(am.moniker, s.dp_moniker, '')`); the participation query does not. So whenever `addr_monikers` is empty/stale for `test-13`, every name becomes an address — even though the correct name is still sitting in `daily_participations`. Fixing this restores names **at the source, for all consumers** (Memba, Telegram alerts, dashboards).

2. **Memba frontend (no resilience — a single dependency blanks all names).**
   Active validators are **not** in the on-chain valopers realm (Candidates panel: "0 active · 45 candidates"), so gnomonitoring is effectively the *only* name source for the 60 active validators. The frontend has zero fallback: if `/Participation` returns nothing, `fetchAllMonitoringData` returns an empty map (`gnomonitoring.ts:404 if (!participation) return result`) and the UI truncates the address. There is no last-good cache and no guard against a "name that is actually an address."

**Recommendation:** ship the gnomonitoring SQL fix as the P0 root-cause fix, and the Memba resilience layer as the P0 safety net. They are independent and can land in parallel.

---

## 2. Evidence (verified, not assumed)

- **Data is healthy when up:** active set `/validators` and gnomonitoring `/Participation?chain=test-13` overlap **60/60**; addresses match exactly.
- **No on-chain fallback for active validators:** Candidates panel = "0 active · 45 candidates" → the 60 active validators are genesis/GovDAO validators, absent from `r/gnops/valopers`. `mergeValoperMonikers` therefore contributes nothing for them.
- **Live repro:** blocking only `monitoring.gnolove.world` → 0 names, all addresses truncated; "gfanton-1" → `g15sys…vwpves`. Exactly the reported symptom.
- **gnomonitoring code (current local `main`):**
  - `backend/internal/database/db_metrics.go:203` — `MAX(COALESCE(am.moniker, combined.addr)) AS moniker` (participation rate query; **addr fallback, no frozen-moniker fallback**).
  - `db_metrics.go:153` — `COALESCE(am.moniker, s.dp_moniker, '')` (streak query; **correct** frozen-moniker fallback). Asymmetry confirmed.
  - Also `db_metrics.go:266` and `:285` use `COALESCE(am.moniker, ...addr)` variants — audit all three.
  - `backend/internal/gnovalidator/valoper.go:436-440` — `InitMonikerMap` upserts resolved names into `addr_monikers`, including the literal `"unknown"` placeholder (`resolveMoniker` returns `"unknown"` when nothing resolves).
  - Recent commits that reworked this: `#105 fix/valoper-signing-address-moniker`, `fix(alerts): resolve alert monikers from addr_monikers`, `fix(metrics): resolve missed-blocks moniker from addr_monikers via join`.
- **Why `addr_monikers` goes empty (candidate triggers, to confirm against the live VPS DB):**
  1. **chain_id string mismatch** — rows written under one chain_id string, read under another (`test-13` vs `test13`). #1 thing to check.
  2. **SQLite→Postgres migration** — `cmd/migrate-sqlite-to-postgres/main.go` exists; a fresh/partly-migrated `addr_monikers` starts empty until `InitMonikerMap` reruns.
  3. **`InitMonikerMap` failing before the upsert loop** — e.g. `/genesis` fetch timeout on test-13 (large genesis), or `/validators` fetch failure.
- **Memba frontend code:**
  - `gnomonitoring.ts:404` — whole map empties if `/Participation` fails (only that endpoint seeds the base map; `/uptime`, `/first_seen`, `/latest_incidents` also carry moniker+addr but are ignored for base seeding).
  - `validators.ts:275` — `mergeValoperMonikers` keys the map by **operator address** but looks up by **signing address** (`v.gnoAddr`); latent mis-key (moot today since sets are disjoint, but wrong).
  - Display: `Validators.tsx:97,587-591` — `{v.moniker || truncateValidatorAddr(v.address)}`; no guard that `v.moniker` might itself be an address string.

---

## 3. Cross-perspective expert panel

**A. Distributed-systems / SRE.** A user-visible label depends on a single third-party endpoint with no cache and no graceful degradation. Correct posture: names are *slowly-changing reference data* — cache last-good aggressively; metrics may degrade, identity must not. Add an availability + correctness SLO and an alert.

**B. Backend / DB (gnomonitoring).** The bug is a fallback-chain asymmetry: one query degrades to the frozen moniker, the sibling degrades to the address. The address should **never** be a name. Root fix = symmetric fallback in all three participation/latest queries. Secondary: don't persist `"unknown"` as a moniker (it pollutes joins and blocks re-resolution semantics); enforce chain_id normalization at the write boundary.

**C. Frontend architect (Memba).** Seed the moniker map from *any* moniker-bearing endpoint, not just `/Participation`. Persist `addr→moniker` to localStorage (long TTL) and backfill on empty/partial fetch. Treat a moniker that `=== address` (or matches `^g1[a-z0-9]+$`) as "no moniker." Fix the operator/signing keying.

**D. Correctness / data-integrity.** Precedence should be explicit and monotone: on-chain valoper > genesis > gnomonitoring live > last-good cache > truncated address (last resort). Never show `"unknown"` or a raw address as a name.

**E. Product / UX.** During degradation the user should see the last-known name, optionally with a subtle "stale" affordance — never a wall of hex. A bare-address roster reads as "the product is broken."

**F. Release / DevOps.** gnomonitoring runs on the VPS via `infra_gnolove` — its deploy is **owner-gated**, separate from Memba's Netlify deploy. Sequence: gnomonitoring fix (root) → verify `addr_monikers` populated + participation returns names → Memba safety net. Add a monitoring alert: fire if `>10%` of `/Participation` monikers match `^g1…$`.

**G. QA / test strategy.** TDD at every layer: (1) gnomonitoring SQL test asserting participation moniker falls back to frozen `daily_participations` value when `addr_monikers` is empty; (2) frontend unit tests for multi-endpoint seeding, sticky cache, addr-as-moniker guard; (3) an e2e that blocks `monitoring.gnolove.world` and asserts names persist from cache.

---

## 4. Implementation plan (layered, TDD, prioritized)

### P0-A — gnomonitoring root-cause fix (repo: `gnomonitoring`, branch `fix/participation-moniker-fallback`)
1. **Failing test** in `db_metrics_test.go`: seed `daily_participations` with a moniker, leave `addr_monikers` empty → assert `GetCurrentPeriodParticipationRate` returns the frozen moniker, **not** the address.
2. Change `db_metrics.go:203` (and audit `:266`, `:285`) to symmetric fallback:
   `MAX(COALESCE(NULLIF(am.moniker,'unknown'), NULLIF(combined.dp_moniker,''), combined.addr))` — i.e. prefer live `addr_monikers`, then the frozen `daily_participations` moniker, then (last resort) the address. Requires threading `dp_moniker` through the `combined` CTE (mirror the streak query at `:144-153`).
3. Stop persisting `"unknown"` as a moniker in `valoper.go:436-440` (skip upsert when `resolveMoniker == "unknown"`), so absence is a clean re-resolve signal.
4. **chain_id normalization audit**: confirm the chain_id written by `UpsertAddrMoniker` == the chain_id read by the participation query == the `chain` param Memba sends (`test-13`). Add a normalization helper + test if they can diverge.
5. Operational: verify the SQLite→Postgres migration carried `addr_monikers`; confirm `InitMonikerMap` runs on schedule and its `/genesis` fetch succeeds on test-13.

### P0-B — Memba frontend safety net (repo: `Memba`, branch `fix/validator-name-resilience`)
1. **`gnomonitoring.ts`**: seed the base moniker map from any moniker-bearing endpoint (participation ∪ uptime ∪ firstSeen ∪ incidents), so one endpoint failing no longer blanks names. Remove the hard `if (!participation) return result` early-out for naming purposes.
2. **Sticky last-good cache**: persist `addr→moniker` to `localStorage` on every success (long TTL, e.g. 7d); on empty/partial fetch, backfill missing names from cache.
3. **addr-as-moniker guard**: a helper `isRealMoniker(m, addr)` → false if `m` is empty, `"unknown"`, equals the address, or matches `^g1[a-z0-9]+$`. Apply in `mergeWithMonitoringData` and at display sites.
4. **Fix keying** in `mergeValoperMonikers` (`validators.ts:275`) — defense-in-depth for when active validators do register on-chain.
5. Tests for each; an e2e (using the existing `abortOnchainReads`/network-block fixture) that blocks `monitoring.gnolove.world` and asserts names persist.

### P1 — observability (repos: `gnomonitoring` + `infra_gnolove`)
- Alert when `>10%` of `/Participation` monikers look like addresses (catches this class before users do).
- Structured log line in `InitMonikerMap`: count of resolved vs `"unknown"` vs addr-fallback per run per chain.

---

## 5. Deploy & verification order
1. Land + review P0-A (gnomonitoring). **Owner deploys** to the VPS (infra_gnolove) — not autonomous.
2. Verify: `GET /Participation?chain=test-13` returns real monikers for all 60; `addr_monikers` row count ≈ active set.
3. Land + merge P0-B (Memba). Netlify native deploy.
4. Verify on the live site with gnomonitoring artificially blocked → names persist from cache.
5. Land P1 alerts; confirm the alert fires on a synthetic empty-`addr_monikers` case.

**Rollback:** each layer is independent; P0-B alone already prevents the user-visible blank-name symptom even if P0-A is reverted.

---

## 6. Open decisions for the owner
1. **Scope** — fix both layers (recommended), or Memba-only safety net now + gnomonitoring later?
2. **gnomonitoring deploy** — who/when on the VPS (owner-gated)? Needs confirmation the SQLite→Postgres migration is complete.
3. **Staleness UX** — show a subtle "cached name" affordance during degradation, or silently use last-good?
4. **Cache TTL** for last-good monikers (default proposed: 7d).
5. Whether to also expose an on-chain/genesis-derived name path in Memba independent of gnomonitoring (fully removes the third-party dependency for naming).

---

## 7. Cross-repo sync status (PENDING — Opus classifier outage blocked live `git fetch`)
Local branch inventory captured this session (33 repos). Naming-relevant:
- **Memba** — `main` (local HEAD advanced to `c9d0592` #834 during session; several WIP worktrees: space-invaders, treasury, e2e-visual, ci, sig-verified, mime).
- **gnomonitoring** — `main` (local HEAD `8ec8e70`, includes the moniker-resolution commits above).
- **gnolove** / **infra_gnolove** — `main` / `master`.
**TODO on Opus recovery:** `git fetch` all + report exact behind/ahead; confirm the `db_metrics.go` line refs against `origin/main` (mechanism holds regardless of drift).
