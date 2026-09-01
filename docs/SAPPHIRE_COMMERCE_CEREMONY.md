# Sapphire Commerce Ceremony — Prep Brief

> **Status:** decisions RULED by owner 2026-08-16 — **D3(b) = wire to fee spine · engine = v3.2 only · legacy v2 stack = skip**. Prep MERGED (Memba #1082, deployer #138).
> **⚠️ PIVOT 2026-08-23: this ceremony does NOT run on sapphire.** Pearl (RC) launches 2026-08-26 and supersedes sapphire; the commerce set deploys in the combined Pearl ceremony — see `docs/PEARL_CUTOVER_PLAN.md`. Every mechanic below applies verbatim; only the chain name, heights and sequences change.
> 🗄️ **EXECUTED on pearl-1 2026-08-31** within the combined ceremony (sequences 0–34, heights 98865–100538; see `docs/PEARL_CUTOVER_PLAN.md` + `realm-versions.json`'s `pearl` section). The mechanics below remain the of-record procedure.
> **Scope:** deploy the fund-custody commerce set to `sapphire-1` and de-gate the lanes deliberately.
> **Actors:** multisig `samcrew-core-test1` (`g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0`, signers zooma + adena-zxxma; "next sequence 25" was the sapphire-era figure — on pearl the multisig's fresh account ran sequences 0–34 in the ceremony and now sits past 35), deployer repo `samcrew-deployer` @ `f1b033b`.
> **Sources:** `samcrew-deployer/projects/memba/realms.manifest`, `TEST13_CEREMONY_2026-07-10.md`, `W1_MARKETPLACE_DEPLOY_RUNBOOK.md`, `V3_1_UNREGISTER_RUNBOOK.md`, Memba `config.ts` sapphire block + `docs/features/NFT_V3_TRADING_GOLIVE_RUNBOOK.md`, 2026-08-15 ceremony logs.

---

## 1. Owner decisions — RULED 2026-08-16 (rationale preserved below)

| Decision | Ruling |
|---|---|
| D3(b) fee config | **B — wire to fee spine** (`GetFeeBPS("token")` + `GetTreasury()` from `memba_market_config`, clamped, local fallback) |
| Engine generation | **v3.2 only** (manifest edit; `FinalizeSaleSeed()` at ceremony) |
| Legacy v2 stack | **Skip both** (`memba_nft_v2`, `memba_nft_market_v2` stay undeployed on sapphire) |
| D-config init values | Confirm at ceremony (fee lanes + treasury/admin multisig — §D-config below) |

### D3(b) — `tokenfactory_v2` applyFee ruling

**Facts** (`samcrew-deployer/projects/memba/realms/tokenfactory_v2/tokenfactory.gno:40-43,420`):

- `feeRate = 25` per-mille (**2.5%**) and `feeRecipient = g1pavqfezrge9kgkrkrahqm982yhw5j45v0zw27v`, both package vars with **no setter** — a deploy bakes them forever.
- The fee is **minted as additional supply of the created token** (recipient gets full amount, feeRecipient gets +2.5% on top) on `New` (when `initialMint > 0`) and every `Mint`. Burn/faucet/transfer are free. The "treasury" therefore accumulates arbitrary third-party token units, and every token's supply inflates 2.5% per mint.
- `g1pavqfe…` is a **third address**: not the samcrew-core deploy multisig (`g1x7k…`), not the DAO fee-spine treasury (`g10kw7e55…` in `memba_market_config`).
- `tokenfactory_v2` is the **only commerce realm that ignores the `memba_market_config` fee spine** — which already carries a token lane (`GetFeeBPS("token") = 50` = 0.5% on test13).
- **Blocking consequence:** `memba_token_otc_v2` imports `r/samcrew/tokenfactory_v2` — the OTC realm cannot even `AddPackage` until the factory is on-chain. D3 holds two lanes, not one.

**Options:**

| | Option | Consequence |
|---|---|---|
| A | Deploy as-is | 2.5% to `g1pavqfe…`, permanent, ungoverned. Fast but bakes the exact config the hold was declared over. |
| **B** | **Patch to read the fee spine** — `resolveFee()` pattern from v3.1/v3.2: `cfg.GetFeeBPS("token")` + `cfg.GetTreasury()`, clamped, local fallback | Fee rate and recipient become **governed parameters** adjustable via `memba_market_config` without redeploy. Rate 0 is then a config call, not a ceremony. Requires: source patch + oracle-test update + **manifest reorder** (factory must move after `memba_market_config`; today it sits at lane position 2, config at 9) + a predeploy review pass. |
| C | Patch constants only (recipient → DAO treasury, rate ruled once) | Smaller diff; still permanent. |
| D | Zero the fee (`feeRate = 0`) | Simplest if the mint-fee mechanic isn't wanted at all; permanent. |

**Recommendation: B.** It's the fleet-consistent pattern, converts an irreversible bake into governance, and subsumes D (set the token lane to 0 later if desired). The mint-fee *mechanic* (fee paid in units of the created token) stays — if that mechanic itself is unwanted, say so and B ships with the spine value set to 0.

### D-gen — NFT engine generation

**Facts:** the `--commerce-v2` lane still deploys **v3.1 by default** (`realms.manifest:180`); v3.2 is `explicit`-only — the manifest answers "v3.1" by omission, which is the trap. v3.2 deltas over v3.1: `TotalLiabilities()` solvency getters (the solvency monitor can only balance-watch v3.1), **two-step ownership** (v3.1's admin is a hardcoded constant — the same disease as D3), the `SetFeeRecipient("")` brick fix, and the purchase-query index (unlocks purchase-gated reviews). Both read the fee spine identically. Frontend already points at v3_2 (`nftConfig.ts:45,:54`); realm addresses are pkgpath-deterministic, so the pinned addr stays valid on sapphire (verify with `RealmAddress()` at ceremony).

**Recommendation: v3.2, unambiguous.** Manifest edit: move `memba_nft_market_v3_2` onto the commerce-v2 lane, remove `memba_nft_market_v3_1` from it. On a fresh chain there is no sales history: call `FinalizeSaleSeed()` at ceremony to permanently seal the migration latch.

### D-legacy — deploy the legacy v2 NFT stack on sapphire?

The lane also carries `memba_nft_v2` + `memba_nft_market_v2` (the superseded v2 engine pair) — on topaz they existed for continuity with live inventory. Sapphire has **no legacy inventory**.

**Recommendation: skip both.** Less fund-custody surface (v2 market measured 3/16/7 bankers/OriginSend/SendCoins on the topaz audit), nothing references them in the v3 dependency tree, and the frontend v2 lane simply stays gated (`isNftMarketValid()` fails closed — same as today). The "NFT stack moves as one unit" rule then covers the v3.2-consistent set: `grc721`, `memba_collections`, `memba_market_core_v2`, `memba_market_config`, `memba_nft_market_v3_2`. If parity is preferred instead, deploy them but allowlist them dark.

### D-config — `memba_market_config` init values (baked by post-deploy txs, adjustable later)

To confirm at ceremony: fee lanes (`nft=200`, `service=200`, `token=50` bps were the test13 values) and **treasury/admin address**. On test13 both were `g10kw7e55…` (samourai-crew 2-of-2) — a *different* multisig from the deploy key. Confirm that multisig's signers are still available, or rule a new treasury.

---

## 2. Prep work before ceremony day (code, in dependency order)

**samcrew-deployer:**
1. **Drain-precondition preflight** (ROADMAP commitment; `config.ts:488-506` makes it a listing precondition for escrow/OTC). Today it's a bare `log_warn` (`projects/memba/deploy.sh:210`). Generalize the existing fail-closed pattern from `samcrew-nft-unregister-v3_1.sh:126-141` (IsPaused + zero-balance + TOCTOU re-read + fail-closed on unreadable) into the `deploy_with_retry` chokepoint (`lib/deploy.sh:497` — same site as the fund-safety gate, unbypassable), with a predecessor map via a `# supersedes: <pkgpath>` manifest annotation. On sapphire the check is vacuous (no predecessors exist) — it must exist anyway, and green-by-vacuity is the correct first run.
2. **Manifest edits per rulings:** v3_2 onto the lane, v3_1 off it, legacy v2 pair off it (D-legacy), `tokenfactory_v2` moved after `memba_market_config` (if D3=B) with its source patch + oracle test.
3. Note: `MAINNET_READINESS.md` has an **uncommitted modification** sitting in the deployer working tree — resolve before ceremony commits.

**Memba backend:**
4. **`memba nft-reset` subcommand** — required, no workaround: the image ships no sqlite3 CLI (`feedreset.go:29-30`) and `SeedRealmCursor` is `INSERT OR IGNORE` (never rewinds), while stale test13/topaz rows (~260k heights) would pin the tailer **above** sapphire's head → "silently indexes nothing" (`main.go:241-246`). Mirror `ResetFeedState`: one transaction wiping `nft_indexer_state`, `nft_raw_events`, `nft_listings`, `nft_sales`, `nft_offers`, `nft_ownership_history`, `nft_collections`, `nft_tokens`, `nft_activity`.
5. **Default-env traps to fix/override at flip time:** `NFT_START_BLOCK` code default is **260000** (test13-era; `main.go:293`); `defaultNFTWatchedRealms` still includes v2 pair + v3_1 (`main.go:660-669`) — set explicit Fly env instead (see §4). `NFT_RPC_URL` needs a **dedicated node** (public canonical node 403-throttles sustained polling — `fly.toml:87-91`).
6. Optional hardening: add an `NFT_INDEXED_NETWORK` guard analogous to `FEED_INDEXED_NETWORK`/`isFeedWritable()` (`config.ts:1030,1044`) — the NFT surface currently has no frontend guard against reading a chain the backend isn't indexing.

**Memba frontend (the de-gate PR — held until after on-chain verification):**
7. Template = the two parked branches (`feat/topaz-allowlist-nft-stack`, `feat/topaz-allowlist-escrow-otc`), retargeted to the **sapphire** allowlist block (`config.ts:610-626`). All realm paths are global constants (no per-network maps), so same-path redeploys need **no** path edits — only allowlist entries.
8. Full de-gate diff inventory: sapphire allowlist entries per lane; `safeFlags.ts:13-32` remove `VITE_ENABLE_NFT` (+ `safeFlags.test.ts:29-53`); `ci.yml:125` + `deploy-frontend.yml:55` flag lists; `.env.example:102`; Netlify dashboard env (`VITE_ENABLE_NFT`, `VITE_ENABLE_SERVICES`, `VITE_ENABLE_TOKENS`); tests pinned to the gate: `config.test.ts:405-456`, `e2e/token.spec.ts:78-91` (flip back to the form assertion), `grc20.test.ts:127-128` if the path ever changes.
9. Known stale docs to fix in passing: `NFT_V3_TRADING_GOLIVE_RUNBOOK.md` seed-spec separator is wrong (`realm:height` → parser wants `realm@height`, `main.go:622`) and its steps still name test13 realms; `marketplace/builders.ts:4` references the v1 escrow path.
10. Post-ceremony follow-up (not the de-gate PR): repoint `.env.e2e` from test13 to sapphire — today the commerce e2e suite proves nothing about the live chain (`config.test.ts:816-836` documents this).

**Merge-blocking rule:** every sapphire allowlist entry must have a chain-proof record in `realm-versions.json`'s sapphire section **before** the list merges (`config.ts:590-593`).

---

## 3. Ceremony day — deploy sequence

Pattern proven 2026-08-15 (`./samcrew-deploy.sh sapphire memba [--flag]`, dry-run rehearsal first; logs → `logs/deploy-sapphire-memba-<ts>.log`; gas 150M; storage deposits ~100 ugnot/byte from the 10k GNOT budget; argv flags only — env forms are ignored, and unknown args fail closed).

**Invocation 1 — commerce-v2 lane** (after manifest edits; dependency order verified from imports):
`grc721` (pkg) → `memba_collections` → `memba_market_core_v2` (pkg) → `memba_market_config` → `tokenfactory_v2` (patched, now after config) → `memba_nft_market_v3_2`.

**Invocation 2 — p0-guards lane, SEPARATE and AFTER** (documented dependency inversion — a combined run AddPackage-fails on an immutable path): `escrow_v3` → `memba_token_otc_v2`.

**Post-deploy on-chain config (deploying ≠ activating):**
1. `memba_market_config`: set fee lanes + treasury per D-config; verify `GetFeeBPS`/`GetTreasury` by qeval.
2. `memba_nft_market_v3_2`: verify `RealmAddress()` matches `nftConfig.ts:54`; verify fee recipient non-empty; `FinalizeSaleSeed()` (seal the latch — fresh chain, nothing to seed).
3. `memba_collections.RegisterMarket(v3_2_addr)` — **only after the backend indexer is confirmed tailing** (Step order rule from the go-live runbook: indexer before registration, or permanent event gap).
4. **Pre-stage the abort txs** (signed, stored): `v3_2.Pause`, `collections.UnregisterMarket(v3_2)` — single-broadcast abort under pressure.
5. Record everything in `realm-versions.json` sapphire section (seq/height/txHash per artifact, `vm/qfile` verification) — manual transcription, review-enforced.

---

## 4. Backend re-enable (between deploy and RegisterMarket)

1. Ship + run `memba nft-reset` (wipes stale cursor + projections; home snapshot degrades cleanly to `StaleSources` until caught up).
2. Fly env: unset `NFT_INDEXER_DISABLED`; `NFT_START_BLOCK=<v3_2 deploy height>`; `NFT_WATCHED_REALMS=memba_nft_market_v3_2,memba_collections` (full paths); `NFT_SALE_VOLUME_REALMS=memba_nft_market_v3_2`; `NFT_SEED_REALM_CURSOR=<realm>@<deployHeight>` per realm (**`@` separator**); `NFT_RPC_URL=<dedicated node>` (samourai sentry — two-node rule).
3. **Arm alerts BEFORE the flip** — `memba_indexer_*{indexer="nft"}` starts emitting the moment the tailer starts, and the first catch-up scan fires a large lag. Alert per label, never on the unlabeled family (OPS_RUNBOOK §3.4).
4. Verify: `memba_indexer_last_block{indexer="nft"}` advancing, lag → 0, then proceed to `RegisterMarket`.

---

## 5. Live-money verification (before any flag flips)

The 2-wallet E2E from the go-live runbook, on sapphire with two real funded wallets (A seller / B buyer):
`CreateCollection` (createFee) → `Mint` → `SetApprovalForAll(v3_2)` → `ListNFT` → `BuyNFT` — verify on-chain: ownership moved, seller got `price − fee − royalty`, treasury `+fee`, royalty recipient `+royalty`; indexer shows one `nft_sales` row and volume/floor. Repeat once via `MakeOffer` → `AcceptOffer`, then check `TotalLiabilities()` returns to 0 and the solvency monitor (with v3_2's `pkgpath|addr` added to `samcrew-realm-solvency.sh`) reconciles.
Token lane: `New` a token via the patched factory; verify fee minted per ruling (`GetFeeConfig`/spine read). Escrow/OTC: one `CreateContract`+`FundMilestone` round-trip and one `ListTokens`→`Fill` (needs the factory live first — D3 dependency).

## 6. De-gate order (two independent locks, released deliberately)

1. Merge the de-gate PR (allowlist + `SAFETY_GATED_FLAGS` removal + CI lists + tests) — **after** §5 passes; the PR carries the realm-versions.json proof.
2. Netlify env flips (`VITE_ENABLE_NFT=true`, `VITE_ENABLE_SERVICES`, `VITE_ENABLE_TOKENS` as ruled) — remember the PWA stale-build caveat: hard-reload before judging.
3. Smoke on prod; watch `nft` indexer labels + Sentry.

**Rollback levers (compose, fastest first):** flag off / allowlist drop (frontend, no chain tx) → `v3_2.Pause()` (value-exits stay open) → `UnregisterMarket(v3_2)` (kills all settlement, proven on topaz) → `collections.Pause()` (global halt).

## 7. Scheduling constraints

- OPS_RUNBOOK §6: no risky merges Friday 15:00 → Monday 09:00. Today is Sunday — prep can land; the ceremony itself belongs on a weekday window.
- 24h change-freeze around chain-mutating ceremony txs (§5 freeze policy) — pin the window in `#memba`.
- Autoheal footgun: disable the validator timer during any coordinated window; never restart the validator to "fix" a mid-ceremony halt.
- Multisig funding-gate waiver: the reference key can't sign the simulate-only budget probe — expect the F-16 waiver warning, or supply `PREFLIGHT_BUDGET_KEY=<funded single key>`.
