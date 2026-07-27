# Marketplace — Go-Live Checklist (test13)

Operational record + the remaining manual steps for lighting the unified NFT marketplace.
Status legend: ✅ done · ⏳ remaining (needs wallet/Netlify — yours).

---

## ✅ Done (engineering, on-chain, merged)

### Realms (test13, 2-of-2 multisig `samcrew-core-test1` = zooma + adena-zxxma)
- ✅ `memba_market_core_v2` — `gno.land/p/samcrew/memba_market_core_v2` (split math, `SplitProceedsBPS` + `MaxFeeBPS=500`). Seq 51.
- ✅ `memba_market_config` — `gno.land/r/samcrew/memba_market_config` (per-lane fee + treasury). Seq 52.
- ✅ `memba_nft_market_v3_1` — `gno.land/r/samcrew/memba_nft_market_v3_1`, addr **`g1hu6u2qrt69umc85g8vjuvp7dhfkfexw9tteef0`**. Seq 53.
- ✅ Registered as the **sole** market on `memba_collections`; old v3 (`g1pucv5…`) `UnregisterMarket`'d.

### On-chain verification (live queries)
- ✅ `GetFeeBPS`: nft=200, service=200, token=50
- ✅ `GetTreasury()` = `GetAdmin()` = `g10kw7e55e9wc8j8v6904ck29dqwr9fm9u280juh` (samourai-crew multisig)
- ✅ `MarketAddress()` = `g1hu6u2q…`
- ✅ `core_v2.SplitProceedsBPS(1e6, 200, 0)` = 20000 (2%)
- ✅ `IsRegisteredMarket(v3.1)` = true · `IsRegisteredMarket(old v3)` = false
- ✅ gnodev settlement harness 55/55 · local read-path browser check (gate opens, live `testy` collection renders)

### Repos
- ✅ **samcrew-deployer**: #36/#41 (fee spine + engine), #40 (quests SetSigner), #42 (runbook), #43 (`_v2` rename), #44 (registration script). Zero open PRs. `deploy.sh` complete for next-network deploys.
- ✅ **memba**: #612 (full marketplace) MERGED — dark in prod. #588/#592 closed (folded). `realm-versions.json` + CHANGELOG updated.

---

## ⏳ Remaining — the go-live (3 steps, yours)

> The marketplace is on `main` but **dark**: the trade surface needs `VITE_ENABLE_NFT=true`, which is force-false in prod. PR **#617** (draft) removes the build-time gate.

### 1. G1 — verify on a deploy-preview (needs Adena)
- In Netlify, set `VITE_ENABLE_NFT=true` for the **Deploy previews** context **only** (not Production).
- Open #617's deploy-preview. Connect Adena.
- **List** `testy` Token #0 → confirm the trade modal shows **Platform Fee (2.0%)** (read from chain).
- **Buy** it from a second wallet → confirm: ownership moves, the `Sale` event carries `feeBps=200` + `treasury=g10kw7e…`, and the treasury balance rises by 2%.

### 2. Arm prod
- Merge **#617** (un-draft) → `VITE_ENABLE_NFT` leaves `SAFETY_GATED_FLAGS`, so the prod build will accept the flag.

### 3. Light prod (needs Netlify)
- Set `VITE_ENABLE_NFT=true` for the **Production** context in Netlify → next prod build surfaces the marketplace on memba.samourai.app.

**⚠️ Order is load-bearing:** never set the Production flag before #617 is merged — while the flag is still in `SAFETY_GATED_FLAGS`, a true value **aborts the prod build** (the freeze this gate exists to prevent). Deploy is Netlify-native (`netlify.toml`), never the GitHub Action.

**Rollback:** set the Production flag back to `false` — instant, no redeploy of realms.

---

## Notes / next
- **Services lane** (W2) and **Token-OTC / Agents** (v1.1/v1.2) are future waves — the shell already renders only live lanes, so they appear when built.
- Backlog: default/fallback images for items with no artwork (so cards never show an empty placeholder).
- Toolchain to re-run the gnodev harness: binaries at `/tmp/memba_nft_itest/bin/`, `GNOROOT` = the gno checkout at `a870686e4` (`-resolver`-capable; #5604 removed it on master).
