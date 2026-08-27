# Pearl Cutover & Combined Ceremony Plan — week of 2026-08-24

> **Status:** plan of record, drafted 2026-08-23 (Sunday) from the 2026-08-20 contributors sync.
> **Trigger:** the next gno testnet **Pearl** (released as an **RC**) launches **Wed 2026-08-26**, superseding `sapphire-1` ten days after Memba cut over to it. Memba's 4th chain migration in five weeks (test13 → topaz → sapphire → pearl).
> **Decision already taken (2026-08-23):** the commerce ceremony does **NOT** run on sapphire. Prep is merged and chain-agnostic (Memba #1082, deployer #138); Pearl gets **one combined ceremony** — the phase-1 core set + the commerce set — once the chain is stable.
> **Mechanics reference:** `docs/SAPPHIRE_COMMERCE_CEREMONY.md` (rulings + sequence; every step applies to Pearl verbatim, only the chain name and heights change) · `docs/OPS_RUNBOOK.md` §2 chain-cutover invariants · `MILESTONES.md` (memba-internal): chain resets re-open status, never definitions — M1 and M2 both re-flip on `pearl`.

---

## 0. What we know / what we need

> **Resolved 2026-08-25** against `gnolang/gno` branch `chain/pearl` (@ `84e8edf9`, 08-24 22:04),
> whose `misc/deployments/pearl.gno.land/` directory is the genesis builder that MAKES the chain.
> That source outranks an announce but is not the running node — every row marked ✅ below still
> gets re-asserted against the launched node before anything merges.

| Item | Value | Source / owner |
|---|---|---|
| Chain id | ✅ **`pearl-1`** — `gen-genesis.sh:52` `CHAIN_ID=pearl-1`, corroborated by `VALIDATOR.md:92,123` and `govdao-exec.sh:6` | re-assert from the launched node's `/status` `.result.node_info.network` before merging the deployer lane |
| Official RPC | ⛔ `rpc.pearl.testnets.gno.land` **now resolves BUT LIES** — 200 OK reporting `sapphire-1` / `chain/sapphire`, frozen at height 395317 since 08-24T20:00:14Z (real sapphire ~20k ahead); reproduced across 3 pool instances | pre-provisioned infra awaiting the genesis. **DNS + HTTP 200 are false positives**; the only liveness test is `node_info.network == "pearl-1"` |
| Samouraï sentry | ❌ `rpc.pearl.samourai.live` **NXDOMAIN** (as is `pearl.rpc.onbloc.xyz`) — no second node exists on any provider | zxxma · `infra_gno-validator` still has only `chain/{sapphire,test-13,test11}`; the two-node rule needs this before `FEED_RPC_URL` can differ from `GNO_RPC_URL` |
| Launch ref (→ deployer `GNO_REF`) | 🟡 `chain/pearl` @ `84e8edf9` (08-24 22:04) — the branch moved as recently as launch-eve, so treat as provisional | confirm from the launched chain's `build_version`, not the announce (flag-day 2 precedent: re-pin if it launched from a different commit) |
| gno#6028 in the launch ref? | ✅ **NO.** `chain/pearl` carries `NewToken(…, id seqid.ID, …)`; PR6028's head `0a9e403` carries `NewToken(…, gen *IDGenerator, …)` + `idgenerator.gno` (positive control passed). #6028 is still OPEN with CHANGES_REQUESTED since 08-19 | ⇒ §2's second branch: **close deployer #139 unmerged**, bump `GNO_REF` in a plain PR. Re-run this one-line check against the final ref on Wed before closing |
| `samcrew` namespace authorized for `g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0` in genesis | ✅ **Absent from Pearl's genesis — and that is NOT a blocker.** Sapphire's genesis lacked it too and it was provisioned post-launch. `r/sys/names.Enable` *does* run at genesis (enforcement from block 1), but `r/sys/namereg/v1` ships in Pearl's package set and `r/sys/names/verifier.gno` documents the registered-name bridge (`r/sys/users` name→addr) | zxxma — confirm the controller/authority path, then register post-launch as on sapphire. Genesis prereg is a nice-to-have accelerator, not a precondition |
| Deploy multisig funding (storage deposits ~100 ugnot/B, ~10k GNOT did sapphire) | 🔴 **No genesis allocation.** Pearl has *no airdrop and no inherited balances* — only 3 faucet accounts, exact-burn fee payers, and `VESTED_ACCOUNTS`, which is **still empty** behind an `XXX: PLACEHOLDER` marker (`gen-genesis.sh:155`; the README calls it the one pending launch value) | 🔴 zxxma — **the genesis window shuts when the genesis is generated, before Wed 14:00 UTC.** Decide now: fund the multisig at genesis, or accept faucet funding post-launch. Transfers are unrestricted, so the faucet route works |
| CLA (`r/sys/cla`) enforcing? | ✅ **Not set at genesis** — Pearl's README lists CLA (and minimum fee) under "not set at genesis; defaults apply, adjustable post-genesis via GovDAO" | expect the gate DARK at launch; preflight gate 2 still re-checks, so sign once if it turns out to enforce |
| Faucet | hub `faucet.gno.land` (the per-chain subdomain is API-only — 405 to browsers) | verify Pearl is listed **before** the flag flip: activation needs gas |
| Adena | ✅ confirmed **no Pearl**: `chains.json` at v1.20.3 carries `gnoland1, sapphire-1, staging, dev, dev.gnoswap` only. Memba's `useAdena.addNetwork` (AddNetworkParams) can push Pearl into wallets from the app — **never exercised on a chain Adena didn't already ship** | zxxma / E2 — test it on the preview first; a Pearl-shipping Adena release is the durable fix |

## 1. Timeline

| When | What | Owner |
|---|---|---|
| **Mon 08-24** (contributors follow-up sync) | Pearl-side: vesting accounts in genesis (Antoine/Manfred) · `samcrew` namespace prereg · multisig funding · date/readiness coordination (Guilhem/Thomas) · review gno#6028 | zxxma |
| **Mon–Tue** | Build the cutover PR set (§3–§5); deployer `[pearl]` lane; `chain/pearl` validator/sentry infra. **Done 08-25** — §0's placeholders are resolved from `chain/pearl`'s genesis builder, so the PR set is staged against real values rather than `TBD`s. Everything stays **staged, not merged**: the live chain gates every merge | Claude (PRs) / zxxma (infra) |
| **Wed 08-26, 14:00 UTC** (genesis time `1787752800`) | Pearl launches. **Do not cut over day-0** — alpha-side snapshot-recovery issues were flagged on 08-20; launch-day halts/restarts are likely. **First check is `node_info.network == "pearl-1"`, not DNS or HTTP 200** (§0: the hostname already answers as sapphire-1). Then `build_version`, namespace + CLA gates via a `--preflight` run, faucet, sentry synced | zxxma |
| **Thu 08-27 earliest** (weekday window, 24 h freeze pinned in `#memba`) | **Combined ceremony** (§4) → record `realm-versions.json` `pearl` section → backend cutover (§5) → frontend cutover PR merge → fresh-wallet E2 login → de-gate | both (multisig = zxxma + zooma) |
| After | Sapphire keeps serving until the Pearl flip is verified; then references retire (like topaz). Close or merge deployer #139 per §2 | — |

## 2. The gno#6028 decision tree (only real fork in the plan)

`#6028` changes `grc20.NewToken`'s 4th param `seqid.ID → *grc20.IDGenerator` and makes `grc20reg.Register` reject tokens not issued by the registry's generator. `tokenfactory_v2` is the only Memba realm calling `NewToken`; the `memba_collections` test helper is the only other call site (test-only). Verified 2026-08-23: nothing in the backend/frontend parses a grc20 `Token.ID()` (all `tokenId`s are NFT indices; `payDenom` uses the unchanged `grc20reg` key `rlmPath.symbol`).

- **#6028 is in the launch ref** → deployer **#139** (draft, proven against #6028's head `0a9e403` in the canonical CI gate): replace `GNO_REF: pull/6028/head` with the launch ref, re-run, merge. Then the ceremony.
- **#6028 is not in the launch ref** → close #139 unmerged; the merged #138 lane is already correct. Bump `GNO_REF` to the launch ref in a plain PR.
- **Resolved 2026-08-25: it is NOT in `chain/pearl`** — the branch carries `NewToken(…, id seqid.ID, …)` while PR6028's head `0a9e403` carries `NewToken(…, gen *IDGenerator, …)` plus a new `idgenerator.gno` (positive control passed, so the absence is real and not a bad path). #6028 remains OPEN with CHANGES_REQUESTED since 08-19. ⇒ the second branch applies. `chain/pearl` moved at 08-24 22:04, so re-run this one-line check against the final launch ref on Wed **before** closing #139.
- Either way the **Pearl drift sweep** (08-23, master `#6056` + #6028 tree) found no other custody-set drift — re-run the same sweep once the launch ref is known (cheap: vendor into a rig built from the ref, `gno test` each realm).

### 2b. gno#6062 — the drift a source sweep cannot see 🔴

The 08-23 sweep compared **realm and library source trees**. `#6062` ("three ways coins were lost or over-authorized around the send-envelope", merged 08-12) changes **the chain**, not the examples: `gno.land/pkg/sdk/vm/keeper.go` (+93), new `vm` errors, and the rules for how attached coins are observed and authorized. A realm-source diff shows nothing; only *running* the realms against a rig built at the launch ref exercises it.

It ships on Pearl and was **never on topaz or sapphire** (verified: `#6062` is in `chain/pearl` and absent from `chain/sapphire`). Thursday's ceremony puts Memba's entire fund-custody set — `escrow_v3`, `memba_token_otc_v2`, `tokenfactory_v2`, `memba_market_core_v2`, `memba_nft_market_v3_2` — onto those new semantics for the first time, while the deployer's **A6 custody-oracle suites are frozen behavior pins still gated at `GNO_REF: fc4052651` (topaz)**. Those oracles have never executed against #6062.

The PR's own description also flags an unfixed case: attribution of "which realm is running" follows object *ownership*, so a realm reading its coins through a helper owned by another realm can be misjudged **in both directions — the worse one rejects a good payment**. Nothing in-tree triggers it today, but our vendored `p/samcrew/*` helpers are exactly the shape described.

⇒ **Pre-ceremony gate:** bump the deployer's `GNO_REF` to the launch ref and let the A6 oracles plus each commerce realm's tests run against it. Any oracle drift is a ceremony blocker, not a nit.

**Run 2026-08-25 against `84e8edf9e` — GREEN, no drift found.** Deployer #140's CI at the Pearl ref: `P0 Fund-Guard Gate (v2 toolchain)` SUCCESS — the job checked out `84e8edf9`, rebuilt the toolchain from it, and ran the vendored-avl gate plus the IsUserCall fund-guard/custody-oracle suites (`memba_token_otc_v2` and the rest) to `ok`. Not vacuous: the gate self-aborts on `no test files`, and that guard did not fire. Independently, Memba's own compile gate — the six generator specs behind `GNO_PIN` — is **30/30 at the Pearl ref, identical to the sapphire baseline**, so the wizard/template generators carry no drift either.

Both results are pinned to `84e8edf9e`. `chain/pearl` moved on launch-eve, so **re-run both once the launched chain's `build_version` is known**; a green today is evidence about this ref, not a standing guarantee.

## 3. Deployer: `[pearl]` lane

`config/networks.toml` `[pearl]` mirroring `[sapphire]` (#137): `enforce_fund_safety = true`, `deposit = "100000000ugnot"`, official RPC primary + sentry fallback. Rehearse: `./samcrew-deploy.sh pearl memba --dry-run` (and `--commerce-v2 --dry-run`), then `--preflight` against the live chain on Wed.

**Resolved 2026-08-25 (deployer #140, staged — merge held for the live check):**

- `chain_id` → **`pearl-1`**, replacing the fail-closed `TBD-pearl-PLACEHOLDER`. `resolve_network` refuses every command while the placeholder stands, so the lane was unusable even for a dry-run.
- `deps_layout` was deliberately unset pending a tree comparison. **Now settled with evidence.** The literal claim that licensed `deps_layout = "topaz-1"` on `[sapphire]` — "`r/sys` and `p/nt` byte-identical to topaz-1" — is **false for Pearl**: both trees differ. But the drift is inert (2 `r/sys/namereg/v1` filetests, `p/nt/avl/v0/README.md`, and `p/nt/treasury/v0/render.gno` — none of which Memba imports). What actually matters is the single question `deps_layout` gates, `_chain_avl_fork_policy` (`lib/preflight.sh:294`): **is stdlib `avl.Get` single-value, so gnodaokit's two-value calls need the `p/samcrew/avl` fork?** Pearl's `p/nt/avl` `.gno` files are **byte-identical to sapphire's** and `Get(key string) any` is still single-value ⇒ **fork required**, the same class as topaz-1/sapphire-1. Classified explicitly rather than inherited, so the reasoning is legible at the next chain.
- `rpc_fallback` names `rpc.pearl.samourai.live`, which is **NXDOMAIN** — flagged in-file so the lane does not imply a working two-node setup.
- `GNO_REF` bumped off the topaz pin `fc4052651` in the same PR, which is what puts the A6 custody oracles in front of gno#6062 (§2b).

## 4. Combined ceremony (one window, same invocation pattern as 2026-08-15)

1. `deps` (avl → rotree → pager) → `gnodaokit` → `memba` default lane (9 core realms incl. `memba_feed_v1`; **the activation realm `r/samcrew/deps/demo/profile` is in `deps`** — login needs it) → `REALM=` the two funds-free commerce realms if preferred, or let the lane walk SKIP them when already live.
2. `memba --commerce-v2`: `grc721 → memba_collections → memba_market_core_v2 → memba_market_config → tokenfactory_v2 → memba_nft_market_v3_2` (lane recomposed by #138; dry-run verified).
3. **Separate, later invocation** `memba --p0-guards`: `escrow_v3 → memba_token_otc_v2` (manifest dependency inversion — a combined run AddPackage-fails). Drain gate is vacuous on a fresh chain (no `supersedes=` declared) — expected.
4. Post-deploy txs: `memba_market_config` fee lanes + treasury check (admin is the baked 2-of-2 `g10kw7e55…`); `memba_nft_market_v3_2`: `RealmAddress()` == `nftConfig.ts:54`, `FinalizeSaleSeed()`; **`RegisterMarket(v3_2)` only after the NFT indexer is confirmed tailing** (§5); pre-stage signed `Pause` + `UnregisterMarket` abort txs.
5. Record every artifact (seq/height/txHash, `vm/qfile` verified) in `realm-versions.json` → new `pearl` section. Sequences start where the multisig's Pearl account starts (0 on a fresh chain).

## 5. Backend cutover (Fly)

Secrets (owner): `GNO_CHAIN_ID`, `MEMBA_ACCEPTED_CHAIN_IDS` (a **lockout switch** — straight cut, as at sapphire), `GNO_RPC_URL`, `FEED_RPC_URL` (sentry), `FEED_START_BLOCK` = `memba_feed_v1` deploy height; `INDEXER_GRAPHQL_URL` if used. Then `fly ssh console -C "/app/memba feed-reset"` (mandatory — the DB cursor beats the env floor). NFT: `fly ssh console -C "/app/memba nft-reset"` (#1082), `NFT_START_BLOCK` = v3_2 deploy height (code default is a test13 height), `NFT_WATCHED_REALMS=…memba_nft_market_v3_2,…memba_collections`, `NFT_SALE_VOLUME_REALMS=…memba_nft_market_v3_2`, `NFT_SEED_REALM_CURSOR=<realm>@<height>` (**`@`**), `NFT_RPC_URL` = a dedicated node, arm `memba_indexer_*{indexer="nft"}` alerts **before** unsetting `NFT_INDEXER_DISABLED`. `fly.toml` [env] edited in the same PR so the file stays truthful. Deploy = push to `main` (rolling; GHCR mirror = rollback).

## 6. Frontend cutover PR (ship when the ceremony is verified)

- `config.ts`: `NETWORKS.pearl` is **pre-registered hidden** (PR #1091, 2026-08-23: `hidden: true`, `realmsDeployed: false`, expected endpoints with `VITE_PEARL_*` overrides, explicit empty allowlist) — the cutover PR re-asserts `chainId` against the launched node, **and identity-verifies the `indexerUrl` the same way**: observed 2026-08-27 (~30 min AFTER the pearl-1 genesis) that `indexer.pearl.testnets.gno.land` answers GraphQL 200 with `latestBlockHeight: 395317` — the FROZEN sapphire height, pre-provisioned infra still serving the old chain's data. An answering indexer is not the chain's indexer; require its reported height to be plausible for pearl (≈ the RPC's `latest_block_height`) before the flip. Then flips `hidden`/`realmsDeployed`, fills `fallbackRpcUrls`, and sets `REALM_ALLOWLIST.pearl` = the 24-artifact core list **plus** the ceremony-verified commerce set (`escrow_v3`, `memba_token_otc_v2`, `tokenfactory_v2`, `memba_collections`, `memba_market_config`, `memba_nft_market_v3_2` — the NFT stack as one unit; the legacy v2 pair and v3_1 are **not** deployed, so not listed), every entry backed by a `realm-versions.json` `pearl` record (merge-blocking rule, `config.ts:590`).
- `sitemap.ts`, `chainHealth.ts`, `netlify.toml`, `.env.example` (VITE_GNO_CHAIN_ID + faucet URL), `safeFlags.ts` drop `VITE_ENABLE_NFT` (+ its test), `ci.yml:125` + `deploy-frontend.yml:55` flag lists, `e2e/token.spec.ts:78-91` back to the form assertion, `config.test.ts` pearl contract; update the tests pinned to the active chain: `config.test.ts` (pearl live/dark contract — the pre-registration tests pin `hidden`/`realmsDeployed`/empty allowlist and flip with the cutover), and the fixtures tied to `SNAPSHOT_NETWORK` / `FEED_INDEXED_NETWORK` (`useHomeSnapshot.test.ts`, `chainHealth.test.ts`). Triage 2026-08-23: the other `sapphire-1` literals in tests are fixture strings or auth unit-test inputs, not the `env-test-divergence` class — leave them. `nftConfig.ts` constants stay (same paths → same deterministic addresses; verify at §4.4).
- `GNO_PIN` (`.github/workflows/gno-test.yml`) moves off `1c6ac026` (the sapphire RC) to the launch ref, keeping the rule that the toolchain matches the chain the frontend targets. Pre-verified 2026-08-25: the six gated generator specs are 30/30 at `84e8edf9e`, byte-for-byte the baseline result, so the bump is behaviourally a no-op — re-run at the final ref before merging.
- Netlify env: `VITE_GNO_CHAIN_ID`, then `VITE_ENABLE_NFT` / `VITE_ENABLE_SERVICES` / `VITE_ENABLE_TOKENS` flips **after** the 2-wallet live-money test; hard-reload (PWA) before judging.
- Preview first: `addNetwork` into Adena, **fresh** wallet E2 login (faucet → `AUTH-ACTIVATE-01` → `SetStringField("Bio","")` on `deps/demo/profile`), list→buy + offer path, token `New` with the spine fee, escrow + OTC round-trips.

## 7. Rollback levers (unchanged)

Frontend flag/allowlist off (no chain tx) → `v3_2.Pause()` (value-exits stay open) → `UnregisterMarket(v3_2)` → `collections.Pause()`. Backend: `flyctl releases rollback` / GHCR image. Chain-level: sapphire stays reachable until retired — a failed Pearl flip reverts `VITE_GNO_CHAIN_ID` + the four Fly secrets.
