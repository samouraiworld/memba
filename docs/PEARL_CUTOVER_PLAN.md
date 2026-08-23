# Pearl Cutover & Combined Ceremony Plan — week of 2026-08-24

> **Status:** plan of record, drafted 2026-08-23 (Sunday) from the 2026-08-20 contributors sync.
> **Trigger:** the next gno testnet **Pearl** (released as an **RC**) launches **Wed 2026-08-26**, superseding `sapphire-1` ten days after Memba cut over to it. Memba's 4th chain migration in five weeks (test13 → topaz → sapphire → pearl).
> **Decision already taken (2026-08-23):** the commerce ceremony does **NOT** run on sapphire. Prep is merged and chain-agnostic (Memba #1082, deployer #138); Pearl gets **one combined ceremony** — the phase-1 core set + the commerce set — once the chain is stable.
> **Mechanics reference:** `docs/SAPPHIRE_COMMERCE_CEREMONY.md` (rulings + sequence; every step applies to Pearl verbatim, only the chain name and heights change) · `docs/OPS_RUNBOOK.md` §2 chain-cutover invariants · `MILESTONES.md` (memba-internal): chain resets re-open status, never definitions — M1 and M2 both re-flip on `pearl`.

---

## 0. What we know / what we need (fill as announced)

| Item | Value | Source / owner |
|---|---|---|
| Chain id | **TBD** (`pearl-1`?) | launch announce — fail-closed placeholder in the deployer lane until confirmed |
| Official RPC | **TBD** (`rpc.pearl.testnets.gno.land`? no DNS as of 08-23) | launch announce |
| Samouraï sentry | **TBD** (`rpc.pearl.samourai.live`) — the feed tailer's node (two-node rule) | zxxma · `infra_gno-validator` needs a `chain/pearl` branch (none yet) |
| Launch ref (→ deployer `GNO_REF`) | **TBD** — must be confirmed from the launched chain's `build_version`, not the announce | zxxma (flag-day 2 precedent: re-pin if the chain launched from a different commit) |
| gno#6028 in the launch ref? | **OPEN as of 08-23** (reviews requested "for Pearl") | decides deployer **#139** — see §2 |
| `samcrew` namespace authorized for `g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0` in genesis | **MUST ASK** — the topaz lesson: `r/sys/names` is enforced from block 1 and the ceremony preflight correctly refuses every deploy until the key is authorized | zxxma — you are editing Pearl's genesis anyway (vesting accounts): put the prereg in the same change |
| Deploy multisig funding (storage deposits ~100 ugnot/B, ~10k GNOT did sapphire) | **TBD** — genesis allocation or faucet | zxxma |
| CLA (`r/sys/cla`) enforcing? | preflight gate 2 refuses if unsigned — sign once post-launch if so | zxxma |
| Faucet | hub `faucet.gno.land` (the per-chain subdomain is API-only — 405 to browsers) | verify Pearl is listed **before** the flag flip: activation needs gas |
| Adena | v1.20.3 ships sapphire in its v024 migration; Pearl will need a release. Memba's `useAdena.addNetwork` (AddNetworkParams) can push Pearl into wallets from the app — **never exercised on a chain Adena didn't already ship**; test it on the preview first | zxxma / E2 |

## 1. Timeline

| When | What | Owner |
|---|---|---|
| **Mon 08-24** (contributors follow-up sync) | Pearl-side: vesting accounts in genesis (Antoine/Manfred) · `samcrew` namespace prereg · multisig funding · date/readiness coordination (Guilhem/Thomas) · review gno#6028 | zxxma |
| **Mon–Tue** | Build the cutover PR set against placeholders (§3–§5); deployer `[pearl]` lane with a fail-closed `TBD` chain id (#137 pattern); `chain/pearl` validator/sentry infra | Claude (PRs) / zxxma (infra) |
| **Wed 08-26** | Pearl launches. **Do not cut over day-0** — alpha-side snapshot-recovery issues were flagged on 08-20; launch-day halts/restarts are likely. Verify: `/status` chain id + `build_version`, namespace + CLA gates via a `--preflight` run, faucet, sentry synced | zxxma |
| **Thu 08-27 earliest** (weekday window, 24 h freeze pinned in `#memba`) | **Combined ceremony** (§4) → record `realm-versions.json` `pearl` section → backend cutover (§5) → frontend cutover PR merge → fresh-wallet E2 login → de-gate | both (multisig = zxxma + zooma) |
| After | Sapphire keeps serving until the Pearl flip is verified; then references retire (like topaz). Close or merge deployer #139 per §2 | — |

## 2. The gno#6028 decision tree (only real fork in the plan)

`#6028` changes `grc20.NewToken`'s 4th param `seqid.ID → *grc20.IDGenerator` and makes `grc20reg.Register` reject tokens not issued by the registry's generator. `tokenfactory_v2` is the only Memba realm calling `NewToken`; the `memba_collections` test helper is the only other call site (test-only). Verified 2026-08-23: nothing in the backend/frontend parses a grc20 `Token.ID()` (all `tokenId`s are NFT indices; `payDenom` uses the unchanged `grc20reg` key `rlmPath.symbol`).

- **#6028 is in the launch ref** → deployer **#139** (draft, proven against #6028's head `0a9e403` in the canonical CI gate): replace `GNO_REF: pull/6028/head` with the launch ref, re-run, merge. Then the ceremony.
- **#6028 is not in the launch ref** → close #139 unmerged; the merged #138 lane is already correct. Bump `GNO_REF` to the launch ref in a plain PR.
- Either way the **Pearl drift sweep** (08-23, master `#6056` + #6028 tree) found no other custody-set drift — re-run the same sweep once the launch ref is known (cheap: vendor into a rig built from the ref, `gno test` each realm).

## 3. Deployer: `[pearl]` lane

`config/networks.toml` `[pearl]` mirroring `[sapphire]` (#137): `chain_id = "TBD-pearl-PLACEHOLDER"` until confirmed (resolve_network fail-closes on PLACEHOLDER), `enforce_fund_safety = true`, `deps_layout = "topaz-1"`, `deposit = "100000000ugnot"`, official RPC primary + sentry fallback. Rehearse: `./samcrew-deploy.sh pearl memba --dry-run` (and `--commerce-v2 --dry-run`), then `--preflight` against the live chain on Wed.

## 4. Combined ceremony (one window, same invocation pattern as 2026-08-15)

1. `deps` (avl → rotree → pager) → `gnodaokit` → `memba` default lane (9 core realms incl. `memba_feed_v1`; **the activation realm `r/samcrew/deps/demo/profile` is in `deps`** — login needs it) → `REALM=` the two funds-free commerce realms if preferred, or let the lane walk SKIP them when already live.
2. `memba --commerce-v2`: `grc721 → memba_collections → memba_market_core_v2 → memba_market_config → tokenfactory_v2 → memba_nft_market_v3_2` (lane recomposed by #138; dry-run verified).
3. **Separate, later invocation** `memba --p0-guards`: `escrow_v3 → memba_token_otc_v2` (manifest dependency inversion — a combined run AddPackage-fails). Drain gate is vacuous on a fresh chain (no `supersedes=` declared) — expected.
4. Post-deploy txs: `memba_market_config` fee lanes + treasury check (admin is the baked 2-of-2 `g10kw7e55…`); `memba_nft_market_v3_2`: `RealmAddress()` == `nftConfig.ts:54`, `FinalizeSaleSeed()`; **`RegisterMarket(v3_2)` only after the NFT indexer is confirmed tailing** (§5); pre-stage signed `Pause` + `UnregisterMarket` abort txs.
5. Record every artifact (seq/height/txHash, `vm/qfile` verified) in `realm-versions.json` → new `pearl` section. Sequences start where the multisig's Pearl account starts (0 on a fresh chain).

## 5. Backend cutover (Fly)

Secrets (owner): `GNO_CHAIN_ID`, `MEMBA_ACCEPTED_CHAIN_IDS` (a **lockout switch** — straight cut, as at sapphire), `GNO_RPC_URL`, `FEED_RPC_URL` (sentry), `FEED_START_BLOCK` = `memba_feed_v1` deploy height; `INDEXER_GRAPHQL_URL` if used. Then `fly ssh console -C "/app/memba feed-reset"` (mandatory — the DB cursor beats the env floor). NFT: `fly ssh console -C "/app/memba nft-reset"` (#1082), `NFT_START_BLOCK` = v3_2 deploy height (code default is a test13 height), `NFT_WATCHED_REALMS=…memba_nft_market_v3_2,…memba_collections`, `NFT_SALE_VOLUME_REALMS=…memba_nft_market_v3_2`, `NFT_SEED_REALM_CURSOR=<realm>@<height>` (**`@`**), `NFT_RPC_URL` = a dedicated node, arm `memba_indexer_*{indexer="nft"}` alerts **before** unsetting `NFT_INDEXER_DISABLED`. `fly.toml` [env] edited in the same PR so the file stays truthful. Deploy = push to `main` (rolling; GHCR mirror = rollback).

## 6. Frontend cutover PR (ship when the ceremony is verified)

- `config.ts`: `NETWORKS.pearl` is **pre-registered hidden** (PR #1091, 2026-08-23: `hidden: true`, `realmsDeployed: false`, expected endpoints with `VITE_PEARL_*` overrides, explicit empty allowlist) — the cutover PR re-asserts `chainId` against the launched node, flips `hidden`/`realmsDeployed`, fills `fallbackRpcUrls`, and sets `REALM_ALLOWLIST.pearl` = the 24-artifact core list **plus** the ceremony-verified commerce set (`escrow_v3`, `memba_token_otc_v2`, `tokenfactory_v2`, `memba_collections`, `memba_market_config`, `memba_nft_market_v3_2` — the NFT stack as one unit; the legacy v2 pair and v3_1 are **not** deployed, so not listed), every entry backed by a `realm-versions.json` `pearl` record (merge-blocking rule, `config.ts:590`).
- `sitemap.ts`, `chainHealth.ts`, `netlify.toml`, `.env.example` (VITE_GNO_CHAIN_ID + faucet URL), `safeFlags.ts` drop `VITE_ENABLE_NFT` (+ its test), `ci.yml:125` + `deploy-frontend.yml:55` flag lists, `e2e/token.spec.ts:78-91` back to the form assertion, `config.test.ts` pearl contract; update the tests pinned to the active chain: `config.test.ts` (pearl live/dark contract — the pre-registration tests pin `hidden`/`realmsDeployed`/empty allowlist and flip with the cutover), and the fixtures tied to `SNAPSHOT_NETWORK` / `FEED_INDEXED_NETWORK` (`useHomeSnapshot.test.ts`, `chainHealth.test.ts`). Triage 2026-08-23: the other `sapphire-1` literals in tests are fixture strings or auth unit-test inputs, not the `env-test-divergence` class — leave them. `nftConfig.ts` constants stay (same paths → same deterministic addresses; verify at §4.4).
- Netlify env: `VITE_GNO_CHAIN_ID`, then `VITE_ENABLE_NFT` / `VITE_ENABLE_SERVICES` / `VITE_ENABLE_TOKENS` flips **after** the 2-wallet live-money test; hard-reload (PWA) before judging.
- Preview first: `addNetwork` into Adena, **fresh** wallet E2 login (faucet → `AUTH-ACTIVATE-01` → `SetStringField("Bio","")` on `deps/demo/profile`), list→buy + offer path, token `New` with the spine fee, escrow + OTC round-trips.

## 7. Rollback levers (unchanged)

Frontend flag/allowlist off (no chain tx) → `v3_2.Pause()` (value-exits stay open) → `UnregisterMarket(v3_2)` → `collections.Pause()`. Backend: `flyctl releases rollback` / GHCR image. Chain-level: sapphire stays reachable until retired — a failed Pearl flip reverts `VITE_GNO_CHAIN_ID` + the four Fly secrets.
