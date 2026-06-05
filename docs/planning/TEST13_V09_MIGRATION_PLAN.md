# Memba — test13 / gno v0.9 Migration Plan (Proposal)

> **Status:** PROPOSAL — for review before any work starts.
> **Date:** 2026-06-03 (rev. 2026-06-04 after skeptical re-audit — see §10)
> **Owner:** Memba core (zxxma) · coordinated with Gno core (aeddi/Manfred) and Sam crew (David/LOurs/mikecito).
> **Target chain:** test-13 (gno `0.9`+, heading to interrealm v2). **Canonical identifiers below.**
> **Mainnet (gnoland1) target:** Aug 1, 2026 (Jae Kwon) — this plan gets Memba green-and-deployed on test-13, the staging ground for mainnet.

> 🛑 **CANONICAL NETWORK IDENTIFIERS (CORRECTED 2026-06-04 — was wrong, signature-breaking).**
> - **On-wire chain-id = `test-13`** (with hyphen). Verified live: `GET https://rpc.test-13-aeddi-1.gnoland.network/status` → `node_info.network == "test-13"` (height ~136k, moniker `aeddi-1`).
> - **RPC host (current) = `https://rpc.test-13-aeddi-1.gnoland.network`** — this is **aeddi's personal node `aeddi-1`, NON-canonical and likely to change** (aeddi flagged AWS prod infra incoming). **Make the RPC env-overridable** (`VITE_GNO_RPC_URL`) with a `fallbackRpcUrls` slot; do NOT hardcode it as the sole path. The earlier plan value `https://test-13.gnoland.network` was **invented and 404s** — purge it.
> - **KEY vs VALUE:** the frontend network *map key* may stay `test13` (identifier-safe), but the on-wire **`chainId` value MUST be `test-13`** everywhere it is signed/compared: backend `GNO_CHAIN_ID`, Adena `GetNetwork().chainId`, `networks.toml` `chain_id`, `NETWORKS[*].chainId`, explorer `case`, `smoke.sh` compare, e2e fixtures. Why load-bearing: `crypto.go` `MakeADR36SignDoc` embeds `chain_id` into the signed doc; a `test13` signature against a `test-13` chain fails `ValidateToken` → **"invalid user signature" on every fresh login**.
> - Trusted-domain/CSP must allow `gnoland.network` (suffix) — `*.gno.land` does **not** cover it.
> *(Where this doc still writes "test13" as a network key/branch/prose label it is fine; only the on-wire chain-id value and the RPC host were corrected.)*

This single document is both **(A) the realm/contract update inventory** and **(B) the phased implementation plan**. A first CTO review changelog is at §9; a **2026-06-04 skeptical re-audit correction report is at §10** and the body is updated against it.

---

## 1. Context & external constraints

The Gno core team shipped **test13 / gno v0.9** (PR [gnolang/gno#5653](https://github.com/gnolang/gno/pull/5653), now reflected on `origin/master`). The relevant landed changes:

- **#5726** — non-test13 example packages moved to `examples/quarantined/` (not deployed by default; `examples/` → `deploypkgs` rename is *planned, not landed*).
- **#5758** — closes the nil-realm cross-realm write hole for `/p/` and stdlib.

**Directives we must design around:**

- **Jae Kwon:** shorten the deploy list to the absolute minimum; quarantine everything else; **stop using `commondao` (structurally broken)**; membergroups to be broken out of commondao; **security-audit all deployed code with Claude and make surgical exploit fixes**; mainnet by Aug 1.
- **Manfred Touron:** network looks stable — *now* is the moment to run test suites and publish contracts.
- **Sam crew priority (David / LOurs / zôÖma):** *"priority is on the tests themselves, to consolidate and accelerate to test13, not to deploy contracts if it's not a priority."* LOurs has run the `community-scripts` Samourai-crew suite; David will port daokit + PR + test against test13 and sweep `p/samcrew` on the monorepo; mikecito will run adversarial transaction tests on core contracts.

**Coordination note:** Memba's `gnodaokit` is **already v0.9-ported on `main`** (see §3). David's "port daokit tonight" is likely redundant or refers to the toolchain bump (gnodaokit#63) — **coordinate before duplicating effort.**

---

## 2. The good news — v0.9 porting is mostly done (but a v2 wave is pending)

> **Reconciled 2026-06-04:** "heavy lifting complete" is true **for v0.9 only**. gno master has since moved to **interrealm v2** (§3.1), which requires a **second port pass** (mechanical for most realms; a real re-port for `memba_dao`). That v2 work is gated on the live chain rebasing onto v2 (`chain/test-13` is still pre-v2). So: v0.9 done; **v2 pending**.

The four-stream audit (on-chain spec, Memba realms, dependencies/tooling, off-chain) found that **the v0.9 heavy lifting is already complete**:

- **All 9 Memba realms** in `samcrew-deployer/projects/memba/realms/` are **already ported to v0.9**: new `chain*` stdlib, `gno.land/p/nt/*/v0` packages, `gnomod.toml` with `gno = "0.9"`, and `func F(cur realm, …)` crossing signatures.
- **All four known production security gaps are already fixed in source** (but **not yet deployed** — test12 still runs the vulnerable binaries). See §4.
- **`gnodaokit` is already v0.9-ported on `main`** and — critically — **has zero dependency on `commondao` or `membergroups`**, so Jae's "stop working on commondao" directive **forces no Memba DAO rework**.
- **Off-chain code requires no client-library bump** — the frontend signs via injected `window.adena`; the backend uses cosmos-sdk primitives; MCP servers are read-only ABCI. The Gno v0.9 transaction wire format (bech32 `g` prefix, `MsgCall`/`MsgRun` shape, account/sequence) is **unchanged**.

The remaining work is therefore **plumbing, verification, test-hardening, redeploy, and docs** — plus the v2 port pass. The genuinely new risk is the off-chain network-config/CSP changes for the new RPC host + chain-id. *(Correction B-5: the "`MsgCall` rejects non-crossing functions" semantic is **NOT new to test13** — the rejection panic exists on both `chain/test12` and `chain/test-13`, and Memba's realms are already crossing-only, so it is **pre-existing and already satisfied**; keep it only as a call-site audit item, not a "new" risk.)*

---

## 3. Breaking-change cheat-sheet (condensed reference)

| Area | Old (test12) | New (test13 / v0.9) | Automated by `gno fix`? |
|---|---|---|---|
| Stdlib pkg | `std` | `chain`, `chain/runtime`, `chain/banker`, `chain/params` | ✅ (`stdsplit` fixer) |
| Realm caller | `std.PrevRealm()` / `std.PreviousRealm()` | `runtime.PreviousRealm()` | ✅ |
| Current realm | `std.CurrentRealm()` | `runtime.CurrentRealm()` | ✅ |
| Origin caller | `std.GetOrigCaller()` | `runtime.OriginCaller()` | ✅ |
| Address type | `std.Address` | builtin `address` (lowercase) | ✅ |
| Emit / coins | `std.Emit` / `std.Coin` | `chain.Emit` / `chain.Coin` | ✅ |
| Banker | `std.NewBanker` | `banker.NewBanker` | ✅ |
| Params | `std.SetParamBool` | `params.SetBool` | ✅ |
| Bech32 | `std.EncodeBech32`/`DecodeBech32` | **removed — manual rewrite** | ❌ |
| Inter-realm | plain exported func | **`func F(cur realm, …)` crossing fn**; call with `cross(...)` | partial (same-pkg call threading is manual) |
| Packages | `p/demo/*` | `p/nt/*/v0` (**versioned; `/v0` is mandatory — bare path does not exist**) | ❌ (path edits) |
| Module file | `gno.mod` | `gnomod.toml` (`module`, `gno = "0.9"`) | ✅ |
| `commondao` | usable | **structurally broken — do not use** (Memba doesn't, anyway) | n/a |

**Myth-busting:** there is **no** `@cross` decorator (it's the `cur realm` first-param form) and **no** `realmid` *stdlib* (`realmid` is a samcrew package inside gnodaokit). `MsgCall` arg encoding is unchanged — the chain synthesizes the leading `cur` argument; **clients must not add it.** *(Correction per CTO review M1: a `chain/markdown` stdlib **does** exist on master — but Memba imports no markdown package, so it's irrelevant here.)*

> ⚠️ **Ground-truth caveat (CTO review H4):** the cheat-sheet and surviving-package claims below were verified against `origin/master`, but the **deployed test13 testnet is built from branch `chain/test-13` (`5dd6950`, ~3 wks older than master) which does NOT carry the `examples/quarantined/` split (#5726).** The authoritative source for what is actually deployable is the **live test13 genesis manifest / RPC**, not master. Confirming it is a Phase-0 blocker (§5.1).

### 3.1 ⚠️ Interrealm v2 — the NEXT wave of breaking changes (NEW, added 2026-06-04)

**gno master advanced again** (`2c7f1abe3` → `ecc5c9fe2`, 2026-06-03) and now carries the **Gno Interrealm Specification v2** (`gnovm/adr/interrealm_v2.md`, `docs/resources/gno-interrealm-v2.md`; gno PRs #5747/#5773). This is a **second, distinct breaking wave** on top of the v0.9 stdlib split documented above — and it invalidates the "realms are already ported" comfort: the realms are ported to **v0.9 / pre-v2**, NOT to interrealm v2.

**Status / timing:** Interrealm v2 is on gno **master** (and David's gnodaokit **PR #64** targets it), but it is **NOT yet on the live `chain/test-13`** (which predates it). It is therefore an **upcoming** break that lands when test13 (or test14 / mainnet) rebases onto current master. Plan for it now; don't deploy against it until the chain carries it (PR #64's own CI notes the live chain "still lags master").

| v2 change | v1 (what Memba realms use today) | v2 (gno master) | Memba blast radius |
|---|---|---|---|
| **Caller introspection quarantined** | `runtime.PreviousRealm()` / `CurrentRealm()` / `OriginCaller()` / `OriginSend()` from `chain/runtime` | **moved to `chain/runtime/unsafe`** (hard move — `chain/runtime` keeps only the `Realm` *type* + `ChainHeight`) | **9 realm files** use `runtime.PreviousRealm`, **5** use `runtime.CurrentRealm`, **8** import `chain/runtime` — plus `_deps/profile` + `tokenfactory`. All must switch to `import "chain/runtime/unsafe"` + `unsafe.PreviousRealm()`. |
| **`cross` is now an authority token** | `cross` is a builtin `realm` value; call `fn(cross, args)` | `cross` is `func(realm) realm`; call **`fn(cross(cur), args)`** — prevents a real cross-realm token-theft exploit (attacker-supplied interface method calling a banker in the victim's context) | every cross-call site in the realms + deployer-vendored deps |
| **basedao constructor** | `basedao.New(&Config{…})` | **`basedao.New(&Config{…}, rlm realm)`** + profile writes use `cross(rlm)` | `memba_dao` init |
| **DAO.Execute / handlers** | `dao.Execute(id)`; `Handler.Execute(action)` | **`dao.Execute(id, rlm)`**; `Handler.Execute(action, rlm)`; `InstantExecute(d, req, rlm)` | `memba_dao` |
| **Crossing-DAO wrapper removed** | `daokit.NewCrossing`, `Config.CrossFn`, per-realm `crossFn`, two-arg `setImplem` | **deleted** — use `localDAO` directly + **one-arg `setImplem`** | `memba_dao` (uses all of these) |
| **basedao.MigrateFn** | `func(prev, params)` | **`func(prev, params, rlm realm)`** | `memba_dao` migrations (if any) |
| **`banker.NewBanker` (C-4)** | `banker.NewBanker(bt)` | **`banker.NewBanker(bt, rlm realm)`** (master 2-arg; test-13 still 1-arg) | audit **escrow / nft_market** banker deposit/refund call sites in the v2 pass |
| **`p/nt/mux` → `p/nt/mux/v0` (C-5)** | `p/nt/mux` | versioned `p/nt/mux/v0` (PR #64 bumps basedao's render dep) | basedao import edit |

> **Scope notes (C-5):** only the **4 introspection fns** move to `unsafe` — `runtime.ChainID()` / `ChainHeight()` and the `Realm` *type* stay in `chain/runtime`. The `runtime.PreviousRealm` count is **10** files (incl. one `*_test.gno`), not 9.

**Bottom line:** every Memba realm needs a **second port pass to interrealm v2** (mostly the mechanical `runtime.*` → `unsafe.*` + `cross(cur)` rewrite, largely automatable by `gno fix` once it ships the v2 fixer), and **`memba_dao` needs a real re-port** to the post-#64 daokit API (drop `NewCrossing`/`CrossFn`; thread `rlm` through `Execute`; `basedao.New(conf, rlm)`). See §4.1 (PR #64) and §4.2.

---

## 4. Component & realm/contract update inventory

Legend — **Port:** v0.9 source status · **Sec:** security status · **Action:** what this migration must do.

> **Global v2 note (§3.1):** every realm below is ported to **v0.9/pre-v2** but NOT interrealm v2. When test13 rebases onto v2, all realms need the `runtime.PreviousRealm/CurrentRealm` → `chain/runtime/unsafe` rewrite (9+5 files) and `cross`→`cross(cur)`. Mostly `gno fix`-automatable; `memba_dao` additionally needs a real daokit re-port (above).

### 4.1 On-chain dependencies (deploy these FIRST)

| Component | Repo / path | Port | Action for test13 |
|---|---|---|---|
| **gno toolchain** | system `gno`/`gnokey` | — | Install the **test13-compatible binary** in CI + the multisig deploy env. Pin the version (no pin exists today). |
| **gnodaokit** — `realmid`, `daocond`, `daokit`, `basedao` | `samouraiworld/gnodaokit` `main` (v0.9) + **PR #64** (interrealm v2) | ✅ v0.9-ported on `main`; **PR #64 ports to interrealm v2** | **NEW — PR #64 (David, draft, `feat/port-latest-gno-interrealm-v2`, +191/−288, 45 files):** clean port of all gnodaokit to gno master `2c7f1abe` + interrealm v2 — deletes `crossing.gno`/`NewCrossing`/`CrossFn`, threads `rlm` down `Execute`, `runtime.*`→`unsafe.*`, `basedao.New(conf, rlm)`, `MigrateFn(+rlm)`, GNOVERSION→`2c7f1abe…`, `gno fix` no-op, lint clean. **This is the right v2 target.** Sequencing: (a) decide merge order vs #62 (v5 security) / #63 (toolchain) — #64 supersedes #63's bump and should absorb/rebase #62; (b) **#64 removes the public `daokit.NewCrossing`/`CrossFn` API → `memba_dao` breaks** and must re-port in lockstep (§4.2); (c) it targets master, which **lags the live test13 deps** — don't deploy v2 until the chain carries it. (d) Note: PR body carries a "🤖 Generated with Claude Code" footer (David's PR) — flag re: the samouraiworld no-Claude-branding policy. Still also: pin GNOVERSION (now `2c7f1abe` via #64, not `4e80c37e`/`5111dbc2`); deploy from the `/v0`-versioned + `_deps`-vendored form (`main`'s bare `p/nt/avl` won't resolve); **no commondao migration needed.** |
| **piechart + svg** (hidden basedao deps) | `p/samcrew/piechart`, `p/demo/svg` | ⚠️ **not in original inventory** | **CTO review H5:** `basedao` imports `gno.land/p/samcrew/piechart` (`view_members_page.gno:5`) and `gno.land/p/demo/svg` (`utils.gno:7`, `view_role_detail_page.gno:4`) in its **render** path — both must be deployable before basedao. Add `piechart` to the deploy set (vendor or deploy under samcrew); confirm `p/demo/svg` survives in test13 genesis or vendor it; check `piechart`'s own transitive deps (review flagged a possible `p/sunspirit/md`). |
| **_deps** — `demo/profile`, `onbloc/json`, `onbloc/uint256` | `samcrew-deployer/_deps/` | ✅ already v0.9 (vendored under `samcrew` namespace) | `r/demo/profile` **survives in test13 examples on master** (not quarantined) — but confirm against the live `chain/test-13` genesis (H4). Deployer keeps the vendored `r/samcrew/_deps/demo/profile`; `memba_dao` **hard-requires** it (`basedao.New()` panics without `GetProfileString`). ⚠️ **SECURITY — LOurs H7+M8 (C-2):** the vendored `profile.gno:73-116` `Set{String,Int,Bool}Field` use `runtime.PreviousRealm().Address()` with **no `IsUserCall()` guard (H7)** and **no field-name allowlist (M8)** — Memba ships a known-vulnerable dep. **Before redeploy:** patch the setters with an `IsUserCall()` guard + field allowlist, OR document that memba_dao writes profile via basedao `cross(rlm)` (so `Previous` is the DAO realm) and accept realm-keyed profiles. (Also: this file's `runtime.PreviousRealm` is itself a v2 break → `unsafe.PreviousRealm`.) |

### 4.2 Memba realms (`samcrew-deployer/projects/memba/realms/`)

| Realm | Deployed (test12) | Port | Sec (in source) | Action |
|---|---|---|---|---|
| **memba_dao** | v1 (v0.9) — **needs v2 re-port** | ⚠️ **OPEN — LOurs H3 (C-1)** | **Exposed to live, un-snapshotted voting power.** `memba_dao.gno:55` wires `daocond.MembersThreshold(0.66, store.IsMember, store.MembersCount)`; `daocond.cond_members_threshold.gno:66-78` computes the ratio against the **live** roster and `daokit.Core.Execute` evaluates at **execution** time (no snapshot — only `CreatedHeight` is stored). A `RemoveMember` proposal executing between another proposal's vote and execution shrinks the denominator → a sub-66% ballot can retroactively pass. Low risk at 1 member; **grows as the DAO onboards toward mainnet.** Fix: snapshot total power + member set at `Propose()` (Compound GovernorBravo) or timelock member-removal + document; add an executed adversarial test. | **Blocked on gnodaokit redeploy** + `_deps/profile`. **v2 re-port (§3.1):** drop `NewCrossing`/`CrossFn`, use `localDAO` + one-arg `setImplem`, `basedao.New(conf, rlm)`, thread `rlm` through `Execute`. Only 4 tests — expand. |
| **memba_dao_candidature_v2** | v2 (ACL unverified) | ✅ | ✅ fixed (admin/owner guards; state-before-send) | Redeploy under test13. |
| **memba_dao_candidature** (v1) | — | ✅ | deprecated (no ACL) | **Retire** — do not deploy. |
| **memba_dao_channels_v2** | v2 — **CRITICAL zero-ACL in prod** | ✅ | ✅ fixed (all writes guarded; moderation gated) | **Deploy the hardened build** (effectively v3 over the vulnerable deployed v2). Highest-priority security redeploy. ⚠️ **BLOCKER (H1, sharpened B-2):** the realm exports `PostThread/PostReply/EditThread/DeleteThread/CreateChannel`; the frontend `channelTemplate.ts` calls `CreateThread/ReplyToThread/SetChannelACL/ArchiveChannel/ReorderChannels/EditMessage/DeleteMessage`. **ZERO clean matches** — even `CreateChannel` differs (realm `CreateChannel(cur, name, description, ctype)` vs frontend `(cur, name, chanType, readRoles, writeRoles)`); the realm **dropped per-channel read/write-role ACL params** (ACL now baked at creation) and has **no `SetChannelACL`/`ArchiveChannel`/`ReorderChannels` at all**. This is a **feature/ACL-model reconciliation**, not a rename sweep: decide whether the hardened realm supports per-channel roles / edit-ACL / reorder / archive, then re-spec or remove those UX features. Phase-2 work, Phase-3 exit gate. |
| **memba_dao_channels** (v1) | — | ✅ | deprecated (zero ACL) | **Retire.** |
| **agent_registry** | v1 — `UseCredit` no ACL | ✅ | ✅ fixed (`UseCredit` requires creator/admin) | **Deploy v2.** |
| **escrow** | v1 | ✅ | OK (CEI correct) | Redeploy. |
| **nft_market** | v1 — `BuyNFT` missing `TransferFrom` | ✅ | ✅ 2-phase escrow (Buy→Confirm→ClaimTimeout) | **Deploy v2.** Residual *design* limit: market can't atomically guarantee NFT delivery — documented, feature-gated, flag for cross-realm `Approve`/`TransferFrom` composability work. |
| **gnobuilders_badges** | v1 | ✅ | OK (admin/owner-gated, pausable) | Redeploy. |

> **Unmerged work:** the realm hardening lives on `samcrew-deployer` branch `fix/mainnet-security-audit-v3` (5 commits, **no PR**). PR + merge before redeploy.

### 4.3 tokenfactory

| Component | Repo | Port | Action |
|---|---|---|---|
| **tokenfactory** (`r/samcrew/tokenfactory`) | `samouraiworld/gno-tokenfactory` `main` | ✅ ported (`p/nt/*/v0`, `cur realm`, `cross`) | Two legacy deps — `p/demo/tokens/grc20` + `r/demo/defi/grc20reg` — **confirmed surviving in test13 examples** (not quarantined). Redeploy. **Re-verify exported signatures** (`New/Mint/Transfer/Burn/Faucet/Approve`) against frontend `grc20.ts` arg order (realm code is external to the Memba repo). No open PRs. |

### 4.4 Deployment tooling — `samcrew-deployer` (branch `fix/mainnet-security-audit-v3`)

The deployer is **multi-network by design**; test13 is a config + mapping task, not a rewrite.

1. **Add a `test-13` network to `config/networks.toml`.** The commented template's **`chain_id`, `rpc`, AND `explorer` are all wrong** (not just the RPC). Use **chain_id `test-13`**, RPC `https://rpc.test-13-aeddi-1.gnoland.network` (env-overridable; non-canonical aeddi-1 node), and resolve faucet/explorer/gas from the **live `/status` + community-scripts `funders/`** in Phase 0 — do not invent hosts.
2. **Add test13 import mapping to `lib/imports.sh`.** test13 uses the `/v0` form (same as test12 canonical) → likely **pass-through**, no `/v0` stripping. Confirm against the test13 genesis manifest.
3. **Register the `samcrew` namespace on test13** before `addpkg` (no tooling step exists; aeddi created `aib`/`onbloc` namespaces — **request `samcrew` namespace + funded multisig**). This is a hard external dependency.
4. **Install the test13 `gno`/`gnokey` binary** in the deploy env.
5. **Broaden `lib/smoke.sh:194`** (test11-specific badges guard) to include test13 — don't add a parallel branch (L7).
6. **Point the gnodaokit `source_dir` at the `/v0` deploy form** (checkout `test12-deploy` or land `/v0` on the deploy branch) so the **bare `p/nt/avl`** form from `main` is never vendored; confirm test13 carries **no stale samcrew `basedao/daocond/daokit`** and that the deploy default is **`PKG_SUFFIX=""`** (not test11's `/v2`) — H10.
7. **Pin the toolchain in CI:** replace `gno@latest`/`gnokey@latest` in `.github/workflows/test.yml` with the test13 commit; decide whether the gno-test job blocks the migration PR (H9).
8. **PR + merge** the 5 `fix/mainnet-security-audit-v3` realm-hardening commits (after the Claude exploit diff-audit, §6 Ph1).
9. *(Optional)* integrate `gno fix` instead of the hand-maintained `sed` table in `lib/imports.sh`.

### 4.5 Memba off-chain (frontend / backend / MCP / config)

| Item | File(s) | Action |
|---|---|---|
| **Network registry** | `frontend/src/lib/config.ts:45-52,92,119,125,165-171,236-247` | Add `test13` to `NETWORKS`, defaults, explorer/gnoswap maps. |
| **TRUSTED_RPC_DOMAINS** ⚠️ | `frontend/src/lib/config.ts:265-281` | **Add `gnoland.network`** — else the new RPC is rejected as untrusted (silent breakage). |
| **CSP `connect-src` (DUAL FILE)** ⚠️ | `netlify.toml:26` **AND** `frontend/index.html:27` | **CTO review H2 (4 lenses):** add `https://*.gnoland.network` + `wss://*.gnoland.network` to connect-src in **BOTH** files (they carry an explicit "KEEP BOTH IN SYNC" warning). Editing only one silently blocks test13 RPC in dev/preview. Phase-2 exit: diff the two connect-src lists. |
| Frontend defaults (true swaps) | `directory.ts:133`, `traction.ts:89`, `chainHealth.ts:110` | Literal hardcoded `"test12"` fallbacks → test13. *(`gnoweb.ts:25`, `NETWORKS`, `GNOSWAP_PATHS` are ADD-a-test13-key, not swaps — L2.)* |
| **Explorer URL (switch, not map)** | `frontend/src/lib/config.ts:164-172` | `getExplorerBaseUrl` is a **switch** whose default yields a wrong host — add an explicit `case "test13"` returning the correct explorer host (M3). |
| Cosmetic | `ChainHaltedBanner.tsx:58`, `TeamHubHeader.tsx:53` | Update test12 references. |
| Backend RPC + chain-id | `backend/internal/service/render_proxy.go:22-26`, `service.go:54` | Update RPC fallback; set **`GNO_CHAIN_ID=test-13`** (hyphen — see canonical-identifiers callout). |
| **Auth chain-id binding** | `backend/internal/auth/crypto.go` (ADR-036 sign doc embeds chain_id) | Cut over `GNO_CHAIN_ID` in lockstep with frontend. **Correction (L1):** there is no "24h grace window" — legacy empty-`chain_id` signatures are accepted **indefinitely** via an unconditional fallback (`crypto.go:323-340`); the 24h figure is the token TTL (`DefaultTokenDuration`), unrelated. Cutover is non-breaking. PRs #336/#370 already merged. |
| MCP / shared client | `packages/gno-rpc/src/client.ts:11`; **`mcp-server-dao-analyst/src/index.ts:498-511`** (`KNOWN_NETWORKS` + help string); **`scripts/register-agent.sh:8-9`** (`REMOTE`/`CHAIN` hardcoded test12) | Update `DEFAULT_RPC`/env **and** the dao-analyst `KNOWN_NETWORKS` registry + the register-agent script (M4 — env alone misses both). |
| Env / infra | `.env`, `.env.example`, `frontend/.env.example`, `docker-compose.yml:34-35` | test13 values (note Memba's `envDir:'..'` — root `.env*` only). |
| **Realm call-site signatures** ⚠️ | `frontend/src/lib/*Template.ts`, `dao/builders.ts`, `grc20.ts`, … | After realms recompile, **diff each exported func arg list** vs the `args:[…]` arrays. MsgCall encoding is unchanged; only signature/name drift breaks call sites. **#1 risk: `channelTemplate.ts` ↔ channels_v2 (confirmed broken — see §4.2 / H1).** #2 risk: **tokenfactory** (external realm; verify `New/NewWithAdmin/Mint/Transfer/Burn/Faucet/Approve/TransferFrom/DropInstanceOwnership`). |
| E2E / unit tests | `frontend/e2e/*.spec.ts`, `*.test.ts(x)` mocking `useNetworkKey:"test12"` | Update `/test12/` fixtures + network mocks. |
| `realm-versions.json` | root | Add a `test13` block **after** redeploy. |

### 4.6 Tests, security hardening & docs

| Item | Action |
|---|---|
| **ACL tests — guards never execute (gap, CTO review H6)** | The security-critical crossing fns (`UseCredit, RegisterAgent, MarkApproved/Rejected, PostThread, BuyNFT, ConfirmPurchase`) are **never invoked at all** — tests patch state directly (e.g. set `app.Status='approved'`), so the "fixed in source" ACLs have **zero executed-test evidence** and deposit/refund banker paths are unexercised. Add **both positive and negative** tests via `testing.SetRealm/SetOriginCaller` for each crossing fn (authorized succeeds + deposit refunded; unauthorized panics). **Gate Phase 3 on these passing.** This operationalizes Jae's "audit with Claude" directive. |
| **Community-scripts suite — WIRED (B-6)** | LOurs' suite is cloned at `community-scripts/tests/samourai-crew` (gnoverse, branch `feat/audit-security-app-bugs`, HEAD `c2c559f`). Run it as a **Phase-1 gate**: `make tests-one-shot REMOTE=https://rpc.test-13-aeddi-1.gnoland.network CHAINID=test-13` (Docker + gnokey vs live RPC). It has 22 GnoVM-fix regressions (incl. `audit_nil_realm_hole` = #5758), 6 e2e, 5 markdown-injection, sybil stress. **Map its `AUDIT_SECURITY_2026-06-02.md` (7 HIGH / 11 MED) to Memba deps:** H7/M8 → vendored profile (C-2), H3 → memba_dao (C-1), H1 → verified clean (Memba uses `.Remove()`, not `Set(false)`). Plus mikecito's adversarial tx tests. |
| **Stub / divergent-copy cleanup (M5)** | `contracts/*_stub` dirs are **generated** from frontend templates by `scripts/extract-contracts.ts` — regenerate, don't "re-sync from deployer." Separately, `contracts/agent_registry` and `contracts/escrow` are **stale hand-copies, not stubs** (the agent_registry copy still has the **vulnerable** no-ACL `UseCredit` at line 278) — **delete or mark never-deploy.** Never audit/deploy from any `Memba/contracts/` copy. |
| **Docs** | Update `ROADMAP.md`, `README.md`, `SKILL.md`, `CHANGELOG.md`, `realm-versions.json`, and `docs/{DEPLOYMENT_RUNBOOK,GNO_CORE_COMPAT,MAINNET_PREPARATION}.md`. `DEPLOYMENT_RUNBOOK.md` already has a "New Network (test13)" checklist; `GNO_CORE_COMPAT.md` is the migration playbook. |
| **Tracking** | **No issue/PR tracks this migration in any of the 4 repos.** Create tracking issues + a milestone first. |

---

## 5. Open verification items (resolve in Phase 0 — these gate scope)

1. **test13 genesis manifest — BLOCKER (CTO review H4).** Query the **live test13 RPC genesis / `chain/test-13` branch** (NOT `origin/master` — they differ; master has the quarantine split, the chain branch may not). Confirm the deployed package set: `p/nt/*/v0` paths, `r/demo/profile`, `p/demo/tokens/grc20`, `r/demo/defi/grc20reg`, `p/onbloc/{json,uint256}`, **and `p/samcrew/piechart` + `p/demo/svg` (basedao render deps, H5)**. Pin the exact verification commit. The entire "surviving packages / minimum deploy" design depends on this.
2. **samcrew namespace on test13** — request creation + funded 2-of-2 multisig from aeddi (as done for `aib`/`onbloc`). **Long-lead external ask — kick off immediately (Phase 0a).**
3. **Admin-key reconciliation (CTO review H7).** `agent_registry/nft_market/escrow` hardcode `AdminAddress = g1x7k…` (test12 multisig); `channels_v2/candidature_v2` derive `owner = OriginCaller()` at init. **Confirm the test13 deploy multisig == `g1x7k…`.** If a NEW multisig is granted, **patch `AdminAddress` before build** and verify `GetOwner() == multisig` post-deploy for the OriginCaller-init realms — else split-brain admin.
4. **test13 chain-id, gas params, faucet URL** — from the launch spec (not the stale template).
5. **GNOVERSION / toolchain pin** — gnodaokit Makefile pins `4e80c37e`; set it (and the CI/deploy binary) to the exact commit the deployed test13 chain was built from (derive from `chain/test-13` / test13 `/status`). **CI gap (H9):** `.github/workflows/test.yml` installs `gno@latest`/`gnokey@latest` with `continue-on-error` — replace with the pinned commit and decide if the gno-test job blocks the migration PR.
6. **Adena ↔ test13** — confirm the wallet exposes test13 (`GetNetwork().chainId == "test13"`); if not, the network-switch UX needs a custom-network add.

---

## 6. Phased implementation plan

Sequenced to the Sam-crew priority: **build + test green on test13 first, deploy only what's needed.** Phases 1 and 2 run in parallel.

### Phase 0 — Foundation, scope-freeze & verification (gate)
**Pre-0 (now):** create tracking issues + milestone across `memba`, `samcrew-deployer`, `gnodaokit`, `gno-tokenfactory` (none exist today).

**Phase 0a — long-lead asks, kicked off immediately (run in parallel with Ph1/2):**
- Request the **samcrew namespace + funded multisig** from aeddi (external latency — can blow the estimate; start day 1).
- Query the **live test13 genesis manifest** (§5.1, H4) and **Adena test13 support** (§5.6).

**Phase 0b — the gate that must close before Phase 3:**
- Install + **pin** the test13 `gno`/`gnokey` binary (CI `.github/workflows/test.yml` + deploy env) to the chain's build commit (§5.5).
- Resolve all remaining §5 items (namespace granted, chain-id/gas, AdminAddress reconciliation H7).
- **FREEZE THE DEPLOY SCOPE HERE (CTO review H3 — Jae's "minimum list").** Decide the must-ship set now, not in Phase 4. **Proposed minimum: `{memba_dao, candidature_v2, channels_v2, agent_registry}` + hard deps (gnodaokit, piechart/svg, profile/_deps).** Defer `nft_market / escrow / gnobuilders_badges / tokenfactory` unless a test13 round-trip requires them.
- **Exit criteria:** test13 endpoints + namespace + pinned binary + admin-key + frozen scope all confirmed.

### Phase 1 — On-chain: build, harden, test green (Sam-crew #1) — ~3–5 days
- **gnodaokit:** pin `GNOVERSION` (#63), land #62 (governance hardening), build the `/v0` deploy form; `gno test ./...` green on test13 toolchain. Confirm `piechart`+`svg` build (H5).
- **Per realm + tokenfactory + _deps:** `gno fix .` dry-run (near-noop — already ported), `gno build`, `gno test`. Hand-fix any residual (e.g. bech32 — none expected).
- **If a new test13 multisig:** patch hardcoded `AdminAddress` before build (H7).
- **Add executed ACL tests** (§4.6, H6) — positive **and** negative, via `SetRealm/SetOriginCaller`, actually invoking each crossing fn. **These gate Phase 3.**
- **Run the Claude exploit audit on the PR diff** of the 5 unmerged `fix/mainnet-security-audit-v3` commits (diff exported-fn surface vs frontend call sites — this is how H1 surfaced); then **PR + merge** them.
- Run **community-scripts + adversarial tx** suites against test13; consolidate failures.
- **Exit criteria:** every in-scope package builds + tests green on test13; positive+negative ACL tests pass; no `commondao`/quarantined imports remain.

### Phase 2 — Off-chain test13 readiness (parallel) — ~2–3 days
- Frontend: `NETWORKS`, **`TRUSTED_RPC_DOMAINS` (+gnoland.network)**, explorer-switch `case "test13"`, defaults.
- **CSP `connect-src` in BOTH `netlify.toml:26` AND `frontend/index.html:27`** (+`*.gnoland.network`/`wss:`) — the dual silent blocker (H2).
- **Reconcile `channelTemplate.ts` to the hardened channels_v2 API** (H1) — `CreateThread→PostThread`, `ReplyToThread→PostReply`, drop/replace `SetChannelACL/ArchiveChannel/ReorderChannels/EditMessage/DeleteMessage`.
- Backend: RPC fallback + `GNO_CHAIN_ID=test13`; verify auth ADR-036 cutover (non-breaking, L1).
- MCP: `packages/gno-rpc` `DEFAULT_RPC`, `mcp-server-dao-analyst` `KNOWN_NETWORKS`, `register-agent.sh`; `.env*` + `docker-compose`.
- Regenerate `*_stub`; delete divergent `contracts/{agent_registry,escrow}` copies (M5).
- Update E2E/unit fixtures.
- **Exit criteria:** frontend connects + signs against test13; **both CSP connect-src lists diffed-equal**; channel call sites reconciled; CI green.

### Phase 3 — Deploy the FROZEN MINIMUM set to test13 — ~1–2 days
Deploy ONLY the Phase-0-frozen scope (default `{memba_dao, candidature_v2, channels_v2, agent_registry}` + hard deps), **dependency-first**, via the 2-of-2 multisig:
1. `_deps` (profile / onbloc json / uint256) + **`piechart` (+`svg`/`sunspirit/md` if not in genesis, H5)** — if not mapped to native.
2. gnodaokit (from the `/v0` deploy form; confirm `PKG_SUFFIX=""` for test13, not test11's `/v2`): `realmid` → `daocond` → `daokit` → `basedao`.
3. In-scope realms: `memba_dao` → `memba_dao_candidature_v2` → `memba_dao_channels_v2` (hardened).
4. `agent_registry` v2.
5. *(Deferred unless required:* `tokenfactory`, `escrow`, `nft_market` v2, `gnobuilders_badges`.*)*
- **Retire** candidature/channels v1 (do not deploy).
- Run `samcrew-smoke.sh`; **re-verify each exported signature vs frontend call sites** (channels_v2 #1, tokenfactory #2).
- **Append-only / fix-forward:** redeploys go to the same path via `--force` (no revert); batches resume via the deployer's already-deployed skip.
- Update `realm-versions.json` **only after** smoke/verify confirms each deployed path (capture block/txHash), **and not until test13 is declared non-volatile** (§7).
- **Exit criteria:** in-scope realms live on test13; smoke + frontend round-trip pass.

### Phase 4 — Validate & pre-mainnet hardening — ~2–3 days
- Full E2E against test13 (frontend + backend + MCP).
- **Claude exploit re-audit** of the *deployed* set (Jae's directive) → surgical fixes. Explicitly model `nft_market` abuse paths (buyer-takes-NFT-then-times-out via permissionless `ClaimPurchaseTimeout`; seller-never-approves) before any decision to deploy it.
- **Confirm the mainnet realm scope** (already frozen in Phase 0): validate the deferred set (`nft_market`/`escrow`/`gnobuilders_badges`/`tokenfactory`) is genuinely not needed for gnoland1 launch, or schedule it.
- Docs sweep (§4.6).
- **Exit criteria:** deployed test13 set clean; mainnet scope validated; docs reconciled.

### Phase 5 — Mainnet (gnoland1) prep — tracked separately
- Per `docs/MAINNET_PREPARATION.md`; gated on the tightened scope, vesting/token-account work, and Gno core's Aug 1 readiness. **Out of this plan's immediate execution scope** — listed for continuity.

---

## 7. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| test13 re-genesis / instability (aeddi still testing) | High | Treat test13 as volatile; script idempotent redeploys; don't update `realm-versions.json` until stable. |
| samcrew namespace not granted in time | High (blocks deploy) | Request from aeddi in Phase 0; deploy logic is otherwise ready. |
| **`channelTemplate.ts` ↔ channels_v2 API mismatch** (confirmed) | **High** | Reconcile in Phase 2 (H1); Phase-3 exit re-verifies. **#1 signature-drift risk.** |
| Exported-signature drift breaks other call sites | Med | Phase 3 signature-diff gate; tokenfactory verified explicitly (#2). |
| Verifying against `origin/master` ≠ deployed test13 | High | Phase-0 genesis query against the live chain / `chain/test-13` (H4). |
| Hidden basedao→piechart/svg dep blocks memba_dao | High | Added to inventory + deploy ordering (H5). |
| Split-brain admin (hardcoded key vs new multisig) | High | Phase-0 admin-key reconciliation (H7). |
| Untested ACL paths regress under v0.9 semantics | Med | Phase 1 negative tests + adversarial tx suite. |
| `MsgCall` to a non-crossing/getter func now panics | Med | Audit call sites; route getters through `vm/qeval`. |
| Silent off-chain blockers (CSP, TRUSTED_RPC_DOMAINS) | Med | Explicitly itemized (§4.5); verify in a real browser, not just unit tests. |
| Duplicated daokit-port effort with David | Low | Coordinate: gnodaokit is already ported. |
| `gno fix` mangles same-package crossing calls | Low | Already ported, so `gno fix` is a near-noop; manual review of any diff. |

## 8. Effort summary

| Phase | Est. | Can parallelize |
|---|---|---|
| 0 — Foundation/verify | 1–2 d | — (gating) |
| 1 — On-chain build/test | 3–5 d | with Phase 2 |
| 2 — Off-chain config | 2–3 d | with Phase 1 |
| 3 — Deploy | 1–2 d | after 1 |
| 4 — Validate/harden | 2–3 d | after 3 |
| **Subtotal — clean v0.9 deploy on test-13** | **~9–15 working days** | (≈2 calendar weeks) |
| + interrealm-v2 port pass (realms mechanical + `memba_dao` re-port) | +2–4 d | gated on chain rebasing to v2 |
| + executed ACL tests (H6) + community-scripts wiring (B-6) | +1–2 d | with Phase 1 |
| + memba_dao H3 snapshot (C-1) + profile H7/M8 patch (C-2) + channels feature reconcile (B-2) | +2–3 d | Phase 1–2 |
| **Revised total** | **~14–24 working days** | still inside Aug 1 |

The v0.9 deploy fits comfortably in the Aug 1 window; the v2 pass rides on top once the live chain carries interrealm v2.

---

## 9. CTO cross-perspective review changelog

Six independent expert lenses (Gno protocol correctness, Security/red-team, Release/DevOps, Frontend/backend integration, Program management, Adversarial completeness) reviewed and **verified against the real repos**. The plan's factual backbone held up across all lenses (the 9 ported realms, §3 std→chain mappings, MsgCall non-crossing rejection, gnodaokit being commondao-free, the 5-commit unmerged branch, the deployer wrong-RPC template, nearly all off-chain file:line refs). The findings below are corrections and gap-closures — **no structural rewrite required**. Every CRITICAL/HIGH finding was independently re-verified by me against the source before applying (see commit-grep evidence in the disposition column).

### CRITICAL / HIGH — applied to the plan body

| # | Finding | Verified? | Disposition |
|---|---------|-----------|-------------|
| **H1** | `channelTemplate.ts` calls `CreateThread/ReplyToThread/SetChannelACL/ArchiveChannel/ReorderChannels/EditMessage/DeleteMessage`; realm exports `PostThread/PostReply/EditThread/DeleteThread/CreateChannel` — only `CreateChannel` matches → channel writes panic on deploy | ✅ confirmed by grep | **Applied** — §4.2 blocker, §4.5 #1 signature risk, §6 Ph2 reconcile step, §7 High risk |
| **H2** | Dual CSP — `frontend/index.html:27` missed alongside `netlify.toml:26` (4 lenses) | ✅ | **Applied** — §4.5 dual-file row, §6 Ph2 diff-check exit |
| **H3** | Deploy maximal-set-first inverts Jae's "minimum list" | n/a (judgment) | **Applied** — scope-freeze moved to Phase 0b; Phase 3 deploys frozen minimum |
| **H4** | `origin/master` ≠ deployed test13 (`chain/test-13` `5dd6950`, older, no quarantine split) | ✅ branch confirmed | **Applied** — §3 caveat, §5.1 BLOCKER vs live genesis |
| **H5** | `basedao` imports `p/samcrew/piechart` + `p/demo/svg` (hidden deploy deps) | ✅ confirmed `view_members_page.gno:5`, `utils.gno:7` | **Applied** — §4.1 dep row, §5.1, §6 Ph3 ordering |
| **H6** | ACL guards have ZERO executed-test coverage (crossing fns never invoked) | ✅ | **Applied** — §4.6 reworded (positive+negative, actually invoke), gates Phase 3 |
| **H7** | Split admin: hardcoded `AdminAddress (g1x7k…)` vs OriginCaller-init owner | ✅ pattern present | **Applied** — §5.3 reconciliation gate, §6 Ph0/Ph1 |
| **H8** | GNOVERSION is `4e80c37e`, not `5111dbc2` | ✅ Makefile line 1 | **Applied** — §4.1, §5.5 corrected |
| **H9** | "pin in CI" had no target — CI is `@latest`, `continue-on-error` | ✅ | **Applied** — §4.4 step 7, §5.5 |
| **H10** | gnodaokit vendored from `main` (bare `p/nt/avl`, non-resolving); test11 `/v2` suffix coupling | ✅ | **Applied** — §4.4 step 6 (source_dir `/v0`, `PKG_SUFFIX=""`) |

### MEDIUM — applied

- **M1** — `chain/markdown` stdlib **does** exist (my §3 myth-bust was wrong) → **corrected** §3. ✅ verified `gnovm/stdlibs/chain/markdown/markdown.gno`.
- **M3** — `getExplorerBaseUrl` is a switch with a wrong default host → §4.5 explicit `case "test13"`.
- **M4** — missing test12 hardcodes in `mcp-server-dao-analyst/src/index.ts:498-511` + `register-agent.sh:8-9` → added to §4.5.
- **M5** — `*_stub` are generated by `scripts/extract-contracts.ts`; `contracts/{agent_registry,escrow}` are stale hand-copies (vulnerable `UseCredit`) → §4.6 reworded (regenerate stubs; delete divergent copies).
- **M6** — Phase 0 long-lead asks → split into **0a** (parallel, kicked off now) / **0b** (the gate).
- **M7** — `realm-versions.json` written only after on-chain verify + non-volatile → §6 Ph3.

### LOW / corrections — applied

- **L1** — "24h grace window" was wrong; legacy empty-`chain_id` is accepted **indefinitely** (`crypto.go:323-340`); 24h is the token TTL → §4.5 corrected.
- **L2** — clarified ADD-a-key vs literal swap in §4.5.
- **L3** — added `NewWithAdmin/TransferFrom/DropInstanceOwnership` to the tokenfactory verify set (§4.5).
- **L6** — append-only / fix-forward rollback note → §6 Ph3.
- **L7** — broaden smoke.sh badges guard, don't branch → §4.4 step 5.

### Downgraded / flagged (do NOT gate work on these)

- **"PR #62 `crossingDAO.Render()` infinite-recursion fix"** — corrected/clarified (B-7): the **recursion bug is REAL** (`gnodaokit gno/p/daokit/crossing.gno:59-60`, `func (c *crossingDAO) Render(path) { return c.Render(path) }` — self-recursive), but **PR #62 does not fix it** (its diff is governance hardening: proposal expiry, spam limit, member guard). It's harmless in practice (memba_dao Render uses `localDAO`) and **PR #64 deletes the whole file**, so it self-resolves. §4.1 correctly reframes #62 as governance hardening; the §9-addendum note that the recursion is genuine is the accurate one.
- **Reviewer disagreement on H4 severity** (PgM=High, Gno=Low): resolved as **High** — confirming the live genesis is cheap and de-risks the whole scope; both lenses agree master ≠ deployed test13.
- **H10 framing** (DevOps `/v2`-suffix vs Adversarial bare→`/v0`): two distinct deployer dimensions, both addressed in §4.4 step 6.

### VERDICT

The plan is **sound and ready to execute after the must-fixes**, which are all surgical and now folded in. The single most dangerous item caught was **H1** (channels_v2 would have broken every channel write on deploy) — exactly the kind of exported-surface drift Jae's "audit with Claude" directive targets, and now a Phase-2 reconcile + Phase-3 gate. The methodological correction **H4** (verify against the live test13 genesis, not master) and the hidden **H5** piechart dep are the other two that materially change execution. Two false claims (chain/markdown, the #62 recursion fix) were corrected so they don't mislead reviewers.

### TOP 5 EDITS (all applied)

1. **[H1]** Reconcile `channelTemplate.ts` → channels_v2 API; Phase-3 blocking exit; #1 signature risk.
2. **[H3+H4]** Scope-freeze to `{memba_dao, candidature_v2, channels_v2, agent_registry}`+deps in Phase 0; verify the **deployed** test13 genesis, not master.
3. **[H2]** Both CSP files + `TRUSTED_RPC_DOMAINS`; Phase-2 diff gate.
4. **[H5+H10]** Add `piechart`/`svg` to deps + ordering; vendor gnodaokit `/v0` form, `PKG_SUFFIX=""`.
5. **[H6+H7+H8/H9]** Executed positive+negative ACL tests gating Phase 3; reconcile admin key; GNOVERSION `4e80c37e` + pin CI.

---

### §9 Addendum — 2026-06-04 re-pull & PR #64 review

**Re-pull:** all repos refreshed. Memba/gnodaokit/tokenfactory `main` and samcrew-deployer `fix/mainnet-security-audit-v3` **unchanged since 2026-06-03**. **gno master advanced** `2c7f1abe3`→`ecc5c9fe2` and now carries **Interrealm Specification v2** (#5747/#5773) — a **new upcoming breaking wave** (see §3.1). `chain/test-13` is still `5dd6950` (pre-v2), so v2 is not live yet but is the direction of travel.

**PR #64 review (gnodaokit, David, draft):** ✅ a clean, correct interrealm-v2 port (45 files, +191/−288) — drops the buggy crossing wrapper (its `Render` was infinite-recursive), threads `rlm` only down the `Execute` path (Propose/Vote correctly don't cross), moves caller-introspection to `chain/runtime/unsafe`, bumps GNOVERSION to the exact master commit, `gno fix` no-op, lint clean. **Verdict: the right v2 target for gnodaokit.** Action items: (1) it **removes `daokit.NewCrossing`/`CrossFn` → `memba_dao` must re-port in lockstep**; (2) sequence it vs #62/#63 (it supersedes #63's bump); (3) don't deploy until the live chain carries v2; (4) the PR body has a "🤖 Generated with Claude Code" footer on a samouraiworld repo — flag vs the no-Claude-branding policy.

**Net effect on this plan:** the "porting is mostly done" framing (§2) holds for **v0.9**, but a **second v2 port pass** is now required (§3.1) — mostly mechanical for the realms, a real re-port for `memba_dao`. Effort estimate rises modestly; the v2 work can ride alongside Phase 1.

---

## 10. Skeptical re-audit correction report (2026-06-04)

After cloning **LOurs' `gnoverse/community-scripts` (`feat/audit-security-app-bugs`, `tests/samourai-crew`, HEAD `c2c559f`)**, a 5-lens skeptical Gno-expert panel (VM/interrealm, Memba-realm-security, DAO-dependency, network/deployment, whole-plan) re-verified this plan against the live repos + LOurs' suite with a falsify-by-default posture. **The technical backbone survived intact** — interrealm-v2 mechanics, PR #64 facts, the 4 source-fixed gaps, H1's existence, and gnodaokit being commondao-free were all independently confirmed. The corrections below were applied to the body; minor/uncertain items are logged here.

### Survived skeptical review (confirmed accurate)
§3.1 interrealm-v2 mechanics (4 lenses) · PR #64 facts line-for-line (3) · memba_dao breaks under #64 (3) · the 4 gaps fixed-in-source (2) · H1 drift real (2) · gnodaokit commondao-free (1, grep) · ADR-036 indefinite empty-`chain_id` fallback (1) · LOurs **H2/H5/M1 govdao bugs do NOT apply** to Memba's basedao (1, evidenced — see C-3).

### Applied corrections

| ID | Sev | Finding | Where applied |
|---|---|---|---|
| **B-1** | **CRITICAL** (5/5 lenses) | chain-id is **`test-13`** (live `/status` confirmed), RPC `rpc.test-13-aeddi-1.gnoland.network`; `test-13.gnoland.network` was invented & 404s. Signature-breaking (ADR-036). KEY≠chain-id VALUE. | Header callout, §2, §4.4(1), §4.5 backend row |
| **C-1 / B-3** | HIGH (2) | **memba_dao exposed to LOurs H3** — live, un-snapshotted voting power (`daocond.MembersThreshold` live roster; `Execute` no snapshot). `Sec` → **OPEN**. | §4.2 memba_dao row |
| **C-2** | HIGH (2) | **Vendored profile carries LOurs H7+M8** — `Set*Field` no `IsUserCall()` guard, no field allowlist (`profile.gno:73-116`). | §4.1 _deps row |
| **B-2** | HIGH (2) | H1 **under-stated** — **zero** channel funcs match (CreateChannel arity also differs; per-channel ACL params dropped). Feature/ACL-model reconcile, not renames. | §4.2 channels_v2 row |
| **B-4** | MED | §8 effort stale; §2 vs §3.1 contradiction. | §2 reconcile, §8 revised (~14–24 d) |
| **B-5** | MED | "MsgCall rejects non-crossing" is **pre-existing & already satisfied**, not new. | §2 |
| **B-6** | MED | community-scripts was a name-drop → wired with concrete `make` target + chain-id + finding map. | §4.6 row |
| **B-7** | LOW | §9 Render-recursion contradiction resolved (bug real; #62 doesn't fix; #64 deletes). | §9 |
| **C-4** | MED | `banker.NewBanker(bt, rlm)` v2 signature → audit escrow/nft_market banker sites. | §3.1 table |
| **C-5** | LOW | `p/nt/mux`→`/v0`; only 4 introspection fns move (ChainID/ChainHeight stay); `PreviousRealm` count 10 not 9. | §3.1 table + scope note |

### Verified CLEAN (skeptical check passed)
- **LOurs H1 (revocation `Set(false)`) does NOT apply** — Memba realms use `.Remove()` consistently (`agent_registry`, `candidature_v2`, `nft_market`, channels). ✅
- **LOurs H2/H5/M1 (govdao bootstrap/invitation/treasury) do NOT apply (C-3)** — those live in gno-core `r/gov/dao`; gnodaokit greps empty for `allowedDAOs|InvitationPoint|treasury`; basedao gates impl-change via the 66% member condition + `assertCallerIsMember` and boots with **1** founding member (not an empty allowlist).

### Open / needs runtime or human check (D)
- **Canonical test-13 endpoints** — `rpc.test-13-aeddi-1` is aeddi's personal node (non-canonical, AWS prod infra incoming). Make RPC env-overridable + `fallbackRpcUrls`; resolve canonical RPC/explorer/faucet from the live chain in Phase 0.
- **§4.4(6) gnodaokit source form** — gnodaokit's `test12-deploy` branch is the `/v0`-vendored form, but **where the deployer fetches gnodaokit source is not yet pinned in config** — locate the actual fetch/`source_dir` before writing the deploy step. (The `/v0` requirement itself is confirmed: `p/nt/avl` resolves only at `/v0`.)
- **ADR-036 cutover "non-breaking"** — true **iff** the frontend `chainId` moves to exactly `test-13` in lockstep (ties to B-1).
- **PR #64 Claude-Code footer** — it's a GitHub PR-body string, not in the local commit object; verify via `gh pr view 64` before asserting a policy violation.
- **`chain/markdown` (M1)** — exists on master, **not** on deployed `chain/test-13`; irrelevant to Memba either way.

### Verdict
After **B-1** (the one signature-breaking, unanimous error) and the three under-counted exposures (memba_dao H3, profile H7/M8, H1-as-feature-change), the plan is **accurate, internally consistent, and execution-ready**. No structural rewrite was needed — the VM/DAO analysis held up; the gaps were a wrong network identifier and three security items the plan's own "audit with Claude" mandate should have caught. All now folded in.
