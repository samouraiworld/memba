# test12 → test13 Winddown / Cutover Runbook

> **Status:** STAGED (this PR is the chain-flip). **DO NOT MERGE until Precondition 1 passes.** The flip is reversible (revert this PR) but a premature merge can 401 logins if a test13 wallet doesn't produce valid signatures. Derived from `MEMBA_STATE_AUDIT_AND_PLAN_2026-06-23.md` Track 3 (decision **D3 = staged**).

## Why staged
The on-wire `chain_id` is embedded in the ADR-036 auth sign-doc, so **backend and frontend must flip together** (same release) or authed RPCs 401. Auth currently runs in the deliberate **lockout-safe Phase 1** (unsigned accepted + logged). The chain flip alone keeps Phase 1 (no lockout); the **auth-enforce flip is a separate, later step** done only after signed logins are observed.

## Precondition 1 — auth validation (YOUR step, needs a wallet) — GATES THIS PR
- [ ] Connect Adena with a **test13-transacted** wallet; hit `auth_login`; confirm the backend returns **`result=signed`** (not `signed_invalid` / unsigned). Per `TEST13_GO_LIVE_NOTE.md §🔶.1`.
- [ ] If it does **not** return `signed`, do NOT merge — diagnose first (the wallet/sign path), else legit users get locked out once enforce is flipped.

## Precondition 2 — ledger backfill (parallel, not blocking the chain flip)
- [ ] Record the test13 realms in `realm-versions.json` (currently **zero** test13 entries). Verify each `REALM_ALLOWLIST.test13` path live via `vm/qfile <pkgpath>`; record path/version/ACL-guard-counts now, block/txHash as recoverable-later (deploy blocks aren't in the go-live note). Tracked as audit Task 2.3.

## What THIS PR changes (the chain flip)
**Backend — `backend/fly.toml`:**
- `GNO_CHAIN_ID` `test12` → **`test-13`** (on-wire, hyphen).
- `GNO_RPC_URL` testnet12 → **`rpc.testnet13.samourai.live:443`** (samourai's own test13 node; swap to `rpc.test13.testnets.gno.land` if preferred).
- `MEMBA_ACCEPTED_CHAIN_IDS` `test12,test-13` → **`test-13`** (drops test12 — 401s any lingering test12 client, intended).
- Auth-enforce flags left at lockout-safe defaults (see follow-up).

**Frontend — `.github/workflows/deploy-frontend.yml`:**
- `VITE_GNO_CHAIN_ID` `test12` → **`test13`** (network KEY; on-wire `test-13` + RPC resolve from `NETWORKS["test13"]`).
- `VITE_GNO_RPC_URL` → test13 (note: currently unused by `src/`; kept in sync).
- `VITE_DAO_REALM_PATH` `samourai_dao` → **`gno.land/r/samcrew/memba_dao`** (fixes a stale/invalid path bug, independent of cutover).

## Merge + deploy sequence (after Precondition 1)
1. Merge this PR → backend (Fly) + frontend (Netlify) redeploy on the SAME release.
2. Verify a fresh visitor lands on test13; a connected wallet logs in (`result=signed`); authed RPCs (token create, candidature, channels) succeed.
3. Smoke: home snapshot populates; DAO/channels/candidature/token-factory render on test13.

## Follow-up A — auth enforcement (separate, after observing signed logins)
- [ ] Once `result=signed` is the norm in logs, add to `fly.toml` and redeploy:
  `MEMBA_ALLOW_UNSIGNED_AUTH = '0'` · `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY = '1'`.

## Follow-up B — config.ts test12 cleanup (cosmetic; breaks test12-hardcoded tests)
- [ ] Remove `NETWORKS.test12` (config.ts ~83); change `||"test12"` fallbacks → `test13` at `DEFAULT_NETWORK` (~163), `GNO_CHAIN_ID` (~257), `getExplorerBaseUrl` (~343/348), `FEATURED_DAO_REALM.test12` (~547); `directory.ts:133`, `traction.ts:89`, `chainHealth.ts:110`.
- [ ] test12-specific UI: `ChainHaltedBanner.tsx:59`, `gnolove/teams/TeamHubHeader.tsx:53`, backend `analyst_consensus.go:504`.
- [ ] Update the ~30 test files that hardcode `"test12"` (golden-vectors can stay; they test chain-id binding generically). Archive the `test12` block in `realm-versions.json` once `test13` is recorded.

## Rollback
Revert this PR → backend/frontend redeploy on test12 (default restored). No on-chain state changes are made by the cutover.
