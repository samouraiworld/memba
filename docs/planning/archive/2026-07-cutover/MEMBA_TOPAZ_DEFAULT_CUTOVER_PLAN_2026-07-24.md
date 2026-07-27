# Memba — Topaz-as-default cutover plan

**Date:** 2026-07-24 · **Status:** PLAN for owner approval — I will not flip prod without an explicit go. **Owns the timing:** owner (needs Fly secrets I can't set).

## 0. Why this is not a one-liner (verified live 2026-07-24)
test13 and topaz-1 RPCs are BOTH live right now — test13 is a *planned* shutdown, not done. Making topaz the default is a **coordinated frontend + backend change**; a frontend-only flip is actively broken.

| Surface | Current (verified) | Why it must change in lockstep |
|---|---|---|
| Frontend default | `netlify.toml VITE_GNO_CHAIN_ID="test13"`, `.env`, `resolveDefaultNetwork()` fallback `"test13"` | 3 places set the landing network |
| Frontend home snapshot | `config.ts SNAPSHOT_NETWORK="test13"` (gates `useHomeSnapshot`) | on topaz the home snapshot query never fires → home loses its snapshot data |
| Backend auth allowlist | `fly.toml MEMBA_ACCEPTED_CHAIN_IDS='test-13'` | **`ValidateToken` REJECTS any token whose chain isn't listed** — a topaz-1 login fails until this includes `topaz-1` |
| Backend chain id | `fly.toml GNO_CHAIN_ID='test-13'` | server-side default chain for challenges + arcade attester |
| Backend feed/nft indexers | `FEED_RPC_URL`→`NFT_RPC_URL`→`GNO_RPC_URL` all = test13 (`rpc.testnet13.samourai.live`) | the feed/NFT projections index ONE chain regardless of the frontend selector; leaving them on test13 means "network says topaz, feed shows test13 content" |
| Backend home snapshot | `homeSnapshotRPCURL()` (env) reads test13 | must read topaz or the home snapshot is cross-chain |

## 1. The big consequence — commerce goes dark
topaz's `REALM_ALLOWLIST` (config.ts) has **9 realms, NO commerce** (no escrow/NFT/OTC/tokenfactory — deferred to the commerce-v2 ceremony). Flipping default to topaz makes all commerce features self-gate OFF in the UI (they already predicate on `isRealmValidOn`). The **feed realm on topaz is empty** (verified live: "Live posts: 0"). So on day 1 of a topaz cutover: no commerce, near-empty feed, near-empty everything until activity accrues. **This is the load-bearing owner decision** — is that acceptable now, or wait until commerce-v2 + some seeding?

## 2. Recommended shape — dual-run transition, not a hard swap
Because both chains are live and auth is chain-bound, do NOT hard-cut. Instead:

### Phase A — make topaz *selectable and auth-valid* without changing the default (low risk, mergeable now)
- Backend Fly: `MEMBA_ACCEPTED_CHAIN_IDS='test-13,topaz-1'` (verify the parser splits on comma — see §5). This lets topaz-1 logins succeed while test13 still works. **Owner action** (Fly secret).
- Frontend: topaz is already in `NETWORKS` + visible in the selector (shipped #983). No change needed. Users can opt into topaz today; it just isn't the default.
- Result: no default change, no commerce regression, topaz fully usable for anyone who selects it. Reversible instantly.

### Phase B — flip the default (the actual cutover; owner-gated, after the §1 decision)
Frontend PR (I prepare, owner merges when ready — merging IS the prod flip):
- `netlify.toml`: `VITE_GNO_CHAIN_ID="topaz"` (this is the prod landing network).
- `.env`: `VITE_GNO_CHAIN_ID=topaz` (+ RPC vars) for local parity.
- `config.ts resolveDefaultNetwork()` fallback `"test13"` → `"topaz"` (belt-and-suspenders default).
- `config.ts SNAPSHOT_NETWORK` `"test13"` → `"topaz"` (or gate it so the snapshot self-hides until the backend serves topaz).
- Optionally set test13 `hidden: true` (keep it reachable by URL for the wind-down, out of the selector) — the `hidden` field already exists in `NetworkConfig`.

Backend Fly env, in the SAME window (owner action):
- `GNO_CHAIN_ID='topaz-1'`, `GNO_RPC_URL`/`NFT_RPC_URL`/`FEED_RPC_URL` → topaz RPCs (`rpc.topaz.testnets.gno.land` primary, `rpc.topaz.samourai.live` fallback), `homeSnapshotRPCURL` env → topaz.
- Keep `MEMBA_ACCEPTED_CHAIN_IDS='test-13,topaz-1'` through the transition (drop `test-13` only after test13 is truly dead).
- Set `FEED_START_BLOCK` (and `NFT_START_BLOCK` if switching NFT) to a value **≤ topaz's current height** — ideally topaz's `memba_feed_v1` deploy block, else `0`. The `260000` default is a test13 value and will very likely brick the tailer on topaz.
- **⛔ MANDATORY indexer reset (else the feed bricks — see §5).** Because the indexer cursor is chain-agnostic (`realm_path`-keyed), the switch must reset the cursor AND wipe the test13 projection so topaz re-scans clean and the two chains' posts don't mix. Do this against a **FRESH backend DB/volume** (keep the test13 DB intact for instant rollback), or snapshot first:
  ```sql
  DELETE FROM feed_indexer_state; DELETE FROM feed_posts; DELETE FROM feed_raw_events;
  DELETE FROM feed_flags; DELETE FROM feed_reactions;
  DELETE FROM feed_blocklist; DELETE FROM feed_serving_overrides;  -- test13 post_ids won't match topaz
  ```
- **NFT indexer: don't switch it.** topaz has no NFT/commerce realms, so leave `NFT_RPC_URL` on test13 (or disable the NFT tailer) until the commerce-v2 topaz ceremony — switching it now just idles on a stale cursor for nothing.

### Phase C — decommission test13 (after it's actually shut down)
- Remove the test13 `NETWORKS` entry (or leave `hidden`), drop `test-13` from `MEMBA_ACCEPTED_CHAIN_IDS`, retire test13 RPC envs. Mirror the historical test12→test13 "HARD CUTOVER" cleanup (the `fly.toml` comment documents that pattern).

## 3. What I do vs. what the owner does
- **I do:** the frontend Phase-B PR (netlify/.env/config.ts), reviewed + tests, held unmerged with a "coordinated cutover — do not merge until backend env is set" banner. Any config.ts test updates (`resolveDefaultNetwork`, SNAPSHOT).
- **Owner does:** every Fly secret change (`MEMBA_ACCEPTED_CHAIN_IDS`, `GNO_CHAIN_ID`, the RPC URLs) — I cannot set these. And the §1 commerce-dark go/no-go + timing.

## 4. Rollback
- Phase A is instantly reversible (remove topaz-1 from the allowlist).
- Phase B rollback = revert the frontend PR (Netlify redeploys test13 default) + restore the Fly env to test13 values. **Critical:** because the indexer cursor is chain-AGNOSTIC and the reset wipes the test13 projection, do the Phase-B reset against a **fresh Fly volume** and keep the old test13 volume intact — then rollback is just re-pointing the backend at the old volume (instant, lossless). If instead you reset in-place, you MUST have a DB snapshot first, or the test13 projection is gone. [[reference_fly_volume_recovery]]

## 5. Open verification items (confirm before executing — don't trust this doc blindly)
- **MEMBA_ACCEPTED_CHAIN_IDS comma-parsing:** confirm the backend splits `'test-13,topaz-1'` into a set (read the flag/env parse in `main.go` + `service.go`). If it treats the whole string as one chain id, use whatever separator it expects.
- **Indexer chain-switch safety — ⛔ CONFIRMED HAZARD (verified 2026-07-24, was the highest-risk unknown).** `feed_indexer_state` and `nft_indexer_state` are keyed by `realm_path` (PRIMARY KEY) — **chain-agnostic**. `memba_feed_v1` is the *same path* on test13 and topaz, so `loadFeedCursor` (feed_tailer.go:201) returns test13's stored `last_processed_block` (a high height) even after the RPC is re-pointed at topaz. topaz is a fresh, far-shorter chain, so `feedTailOnce` (feed_tailer.go:104-114) finds `latest < cursor` → **no blocks above the cursor → the tailer idles forever and topaz never indexes.** (The reorg check then just fails to fetch the nonexistent height.) Compounding it: `FEED_START_BLOCK`/`NFT_START_BLOCK` default to `260000` (a test13-era value); even after a cursor reset, if that default exceeds topaz's current height the tailer still idles. → **A naive env-only flip bricks the feed indexer.** See the required reset in §2 Phase B.
- **Home snapshot builder:** confirm `assembleHomeSnapshot` reads only realms that exist on topaz (it must not hard-depend on a commerce realm).
- **topaz endpoint stability:** memory notes topaz endpoints were "pre-release"; re-verify `rpc.topaz.testnets.gno.land` is the settled canonical before pinning.
- **topaz-1 funding:** the owner-blocked "fund a single key on topaz-1" item gates REALM= deploys, not this cutover — but confirm no cutover step needs an on-chain tx.

## 6. Recommendation
Ship **Phase A now** (owner sets `MEMBA_ACCEPTED_CHAIN_IDS='test-13,topaz-1'`; zero frontend change, zero regression, topaz becomes fully usable-on-selection). Hold **Phase B** until the owner signs off on commerce-dark (§1) and the indexer chain-switch (§5) is verified. This delivers "topaz is real and usable" immediately while keeping the risky default-flip owner-gated.
