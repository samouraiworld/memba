# Marketplace W1 — PR review, merge order, and go-live

**Date:** 2026-06-27
**Status:** all four PRs built, reviewed (2-lens adversarial, SHIP-WITH-FIXES → fixes applied), verified. Nothing merged. The realm code is gnodev-verified and deploy-ready; the frontend is wired to it and stays dark until deploy.

---

## The four PRs

| PR | Repo | Wave | Contents | Verification |
|---|---|---|---|---|
| [#588](https://github.com/samouraiworld/memba/pull/588) | memba | **W0** safety/foundation | v3 gating fix, parser hardening, token-grid windowing, dead-code purge, recompile + escrow 0-funds audit | 2809 unit tests; build |
| [#36](https://github.com/samouraiworld/samcrew-deployer/pull/36) | deployer | **W1.1** fee spine | `memba_market_config` realm + `SplitProceedsBPS`/`MaxFeeBPS` in `memba_market_core` | `gno test` |
| [#37](https://github.com/samouraiworld/samcrew-deployer/pull/37) | deployer | **W1.2** engine + deploy-prep | `memba_nft_market_v3_1` (config-read fee+treasury, structured getters), rename to new path, manifest, gnodev harness, deploy runbook | **gnodev 55/55** |
| [#592](https://github.com/samouraiworld/memba/pull/592) | memba | **W1.3 shell + W1.4 router** | `UnifiedListing` model, lane registry, NFT adapter, unified `MarketplaceHub`, multi-engine router, TradeModal→router, v3.1 wiring + `v3Reads` structured-read layer | 30+ unit tests; browser-verified |

---

## Dependencies / stacking
- memba: **#592 is stacked on #588** (base = `feat/marketplace-w0-safety`). Merge #588 first, then rebase/merge #592 onto main.
- deployer: **#37 is stacked on #36** (base = `feat/marketplace-w1-fee-spine`). Merge #36 first, then #37.
- Cross-repo: the frontend (#592) targets the realm paths/addresses in #37 (`memba_nft_market_v3_1` / `g1hu6u2qrt69umc85g8vjuvp7dhfkfexw9tteef0`). They don't block each other to merge (the frontend stays dark), but both must land before go-live.

## Recommended review order (cheapest context first)
1. **#36** (fee spine) — small, self-contained realm; sets the model everything reads.
2. **#37** (engine) — read the runbook first, then the v3.1 diff; the gnodev harness is the proof.
3. **#588** (W0) — mechanical safety fixes; the gating fix is the load-bearing one.
4. **#592** (shell+router) — largest, but it's all behind the dark flag; the model + router + adapter are the core.

## Merge order
`#36 → #37` (deployer), and `#588 → #592` (memba). The two repos are independent for merge; the realm deploy is gated on neither merge (it's a separate multisig step).

---

## What's NOT in these PRs (the go-live gate — yours)
1. **Multisig deploy** (deployer, per #37's runbook): `memba_market_core` → `memba_market_config` → `memba_nft_market_v3_1` → pause-first `RegisterMarket(g1hu6u2q…)` → smoke-test.
2. **Go-live wiring** (a small follow-up memba PR I prepare after deploy, ~1 day): add `memba_nft_market_v3_1` to `REALM_ALLOWLIST.test13` + flip `VITE_ENABLE_NFT`, wire `v3Reads` (`fetchListingsPage`/`fetchOffersForToken`/`fetchLaneFeeBps`) into `useCollectionPublic` (offers ON, accept-offer, chain-read fee row, drop the regex scrape), verify on a deploy-preview. The read layer + parsers are already built + golden-tested in #592; this is the thin integration on top, plus confirming the exact `vm/qeval` multi-line string encoding against the live realm.

## Open items to confirm before/at deploy
- **Config admin/treasury = `g10kw7e…`** (the real 2-of-2 multisig) — confirmed; intentionally differs from the legacy realms' single-key `g1x7k…` (pre-existing gap).
- **`memba_market_core` unoccupied** — confirm via `vm/qfile` before deploy (expected not-deployed).
- **Per-lane fees** seeded in config init: nft 200, service 200, token 50. Adjustable via DAO proposal post-handoff (`MaxFeeBPS=500` ceiling).
- **Netlify flag trap (R12):** keep `VITE_ENABLE_NFT` in `SAFETY_GATED_FLAGS` until the realm is live; deploy via `netlify.toml`, never `deploy-frontend.yml`.

## Toolchain note (for re-running the gnodev harness)
Build `gnodev`/`gnokey` from gno commit `a870686e4` (just before #5604 removed `-resolver`). See the harness header. Binaries currently at `/tmp/memba_nft_itest/bin/`.
