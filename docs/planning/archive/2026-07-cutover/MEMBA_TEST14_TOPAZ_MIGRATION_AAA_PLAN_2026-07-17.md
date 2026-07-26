# Memba × Test14 "Topaz" — AAA Migration & Integration Plan

**Date:** 2026-07-17 · **Status:** PROPOSAL — owner review pending. **Nothing coded, nothing merged, nothing deployed by this document.**
**Scope:** Memba (app + realms) migration to the Test14/Topaz testnet, katana daemon adoption, gnomonitoring Test14 onboarding, validator ops integration.
**Inputs:** live-chain probes (§1), 4 deep-read briefings (Memba, samcrew-deployer, katana, gnomonitoring, gno master), and the governing docs: `UNIFIED_IMPLEMENTATION_PLAN_AND_PROD_RISK_2026-07-16.md`, `AVL_OPTION_A_VENDORING_SPEC_2026-07-17.md`, `CUSTODY_ORACLE_TEST_MATRIX_2026-07-17.md`, `IMMUTABLE_API_SURFACE_FREEZE_2026-07-17.md`, `samcrew-deployer/projects/memba/MAINNET_READINESS.md`.
**CTO review:** DONE — 3 fresh independent reviewers (protocol-correctness, delivery/risk, security/ops), all **APPROVE-WITH-CHANGES**; every correction is folded into the body below and logged in §10.

---

## 0. Executive summary

Topaz is live (launched 2026-07-16 15:48 UTC) and runs **gno v1.0.0-rc.0 (`chain/topaz.3248+67a0bb333` = master merge-base `f306ab6e7` + 3 genesis-tooling commits)**. That single fact re-prices the whole roadmap:

> **Every "mainnet-gated" realm-compatibility item is now a Test14 item.** The avl cut, the immutable API freeze, NF-2 solvency getters, emit-cap bounding, and the deploy-tooling `GNO_REF` flag-day were all sequenced against a far-off mainnet. Topaz runs the post-#5314 VM **today** — our realms are deterministically rejected at `AddPackage` on it until the cut is done.

**Core thesis: run the Test14 cut as the mainnet version-cut rehearsal.** Do the realm work ONCE — vendored avl + API-freeze ADDs + NF-2 getters + §6 auth-hardening — so the artifacts deployed to Topaz are the intended mainnet artifacts. Test14 then becomes a months-long live rehearsal instead of a throwaway port. *Caveat (CTO C-1): "byte-identical, deploy twice" holds only if the eventual mainnet genesis ref ≈ the Topaz ref; that assumption is now explicit (§6 R-9, §7 Q12) and re-verified before any mainnet ceremony.*

**Two hard external gates prevent immediate ceremony (and cost us nothing, because the local rehearsal path is fully unblocked):**
1. **Chain identity is not final.** Genesis `chain_id` is literally `"dev"`; the official `rpc.topaz.testnets.gno.land` DNS exists but is dark; the valset has **one** validator (power 10). A genesis reset with the real chain-id is almost certainly coming. Chain-id is signature-load-bearing (ADR-036 + tx sign bytes) — nothing user-facing can be pointed at Topaz until it's final.
2. **The `samcrew` namespace + funding on Topaz are unresolved — and self-service registration is impossible.** `p/samcrew/*` ships in genesis (upstream examples), but Topaz's registration realm (`r/sys/namereg/v1`) only accepts **`nym-[a-z]{5,13}\d{3}`-format names** — `samcrew` cannot be self-registered at all. The namespace must arrive via **genesis preregistration** (ask **Aeddi / gno core** — §7 Q3) or a GovDAO proposal. Note the enforcement gates (`r/sys/names.IsEnabled()`, `r/sys/cla` hash) are currently **DARK** on the live chain — deploys succeed today under weaker rules than the final chain may enforce (§3 WS-B4 asserts the expected state, fail-closed).

**A third finding changes economics: storage deposits are LIVE on Topaz** (`storage_price: 100ugnot/byte`, default cap 600 GNOT when `max_deposit` is empty — which all our canonical builders emit). Every realm deploy and every byte of user state **locks funds**. Deploy funding, faucet sizing, and fee UX must all budget for it (§2 B9 — new).

**What we can and should start now (zero prod risk):** the realm version-cut in samcrew-deployer validated against a **local Topaz-ref devnet**, custody-oracle authoring, katana e2e rehearsal, gnomonitoring config prep, and *authoring* (not merging — Jul-20 window, §4) of the flag-dark app config. Prod (test13) is untouched throughout; the cutover is a discrete, owner-executed ceremony at the end.

---

## 1. Verified ground truth (probed 2026-07-17; re-verified independently by CTO reviewer #1)

### 1.1 Chain facts (`https://rpc.topaz.samourai.live`)

| Fact | Value | Consequence |
|---|---|---|
| `genesis.chain_id` | **`"dev"`** | NOT final. Do not bake into any config; every signing path breaks on rename. Also collides with our `[local]` devnet chain-id → replay hazard (§3 WS-B5). |
| `genesis_time` | 2026-07-16T15:48:57Z | Chain is ~1 day old; reset cost is near zero → expect one. |
| `build_version` | `chain/topaz.3248+67a0bb333` | Topaz ref = **`67a0bb333`** (master merge-base `f306ab6e7` + 3 genesis-glue commits). Upstream tag `v1.0.0` exists. |
| Validator set | 1 validator (`g19a8gk7…`, power 10, Ed25519) | Pre-launch skeleton. Samourai validator (Lours: 51.159.105.229, sentry+validator+TMKMS) not yet in valset. |
| Sentry `tx_index` | `off` | No tx queries on this sentry; activity surfaces need a tx-indexer deployment (§7 Q6). |
| VM params | `storage_price=100ugnot/B`, `default_deposit=600000000ugnot`, `preprocessGasPerByte=1250`, `MaxEventAttrLen=4096` (panic), `tx_sig_limit=7`, `restricted_denoms` empty | §2 B2/B3/B9. `tx_sig_limit=7` fine for the 2-of-2. Transfers open. |
| AddPackage gates | `r/sys/names.IsEnabled() == false`; CLA enforcement **disabled** (empty hash) | Machinery exists but is dark today — preflight must assert expected state at ceremony time (WS-B4). |
| `rpc.topaz.testnets.gno.land` | DNS exists (AWS), connection times out | Official infra provisioned but dark — pre-release. |
| `indexer/gnoweb/faucet .topaz.samourai.live` | NXDOMAIN | Not provisioned — §7 Q6 (Aeddi for official, Lours for samourai-hosted). |

### 1.2 On-chain genesis survey (via `vm/qpaths` / `vm/qfile`)

- **`p/nt/*` are all versioned `/v0`**; our realm sources already import `/v0` paths (52 files import `p/nt/avl/v0`, 0 unversioned).
- **`avl/v0.Get(key string) any` is single-return** (chain-source-verified; existence via `Has()`). Our ~409 two-value call sites across **37 realm dirs** do not compile on Topaz.
- **`p/samcrew/*` in genesis**: `basedao`, `daocond`, `daokit`, `gauge`, `keccak256`, `piechart`, `tablesort`, `urlfilter` (+ `r/samcrew/daodemo`). **`p/samcrew/realmid` is NOT in genesis** — and our fork's basedao + `memba_dao` import it (§3 WS-A1).
- **Genesis daokit/basedao ABI ≠ our fork** (verified by reviewer #1): genesis `daokit.NewActionHandler(kind, func(interface{}))` vs fork `func(interface{}, realm)`; genesis `basedao.New(conf, rlm) *DAOWrapper` (single return) vs `memba_dao.gno`'s two-value `basedao.New(…)`; genesis `Config` lacks `PrivateVarName` and `SetImplemFn` (both used at `memba_dao.gno:66-68`); fork-only `InstantExecute`/`Extension` absent. **Genesis daokit is NOT adoptable by `memba_dao` as a repoint** — see WS-A1.
- **System realms**: `r/sys/users`(+`/init`), `r/sys/names`, `r/sys/namereg/v1` (Register: IsUserCall-gated, exact-payment, **price currently 0**, name format locked to `nym-[a-z]{5,13}\d{3}`, **no public price getter**), **`r/sys/cla`**, `r/sys/txfees`, `r/sys/rewards`, `r/sys/params`, `r/sys/validators/v2+v3`; `r/gov/dao` v3 stack; **`r/gnops/valopers` + `/proposal`** (katana's defaults exist ✅ and its `DefaultEjectScript` ABI matches on-chain `validators/v3/proposal.gno` exactly ✅).
- `p/demo/tokens/{grc20,grc721,grc1155,grc777}` present; `grc20reg maxSlugLen=128` (#5911). `r/demo/profile` present (memba_dao dep ✅).

### 1.3 What is already absorbed (verified — do NOT re-plan these)

- **Interrealm-v2**: realms already use `cur realm`/`cross(cur)`/`chain/banker`/`chain/runtime/unsafe`; 0 files import `"std"`.
- **Manifests**: 41/41 realm dirs use `gnomod.toml`.
- **`max_deposit` sign bytes**: canonical builders already emit it (`frontend/src/lib/multisigTx.ts:52`, `loginChallenge.ts:104`, golden tests). Residual: Adena's own release (§7 Q7), non-canonical builder paths, and **deposit semantics** (empty string = 600 GNOT default cap — §2 B9).
- `userRegistryPath` already `gno.land/r/sys/users` (`config.ts:130`) — reads OK; the registration write-flow changes (§2 B5).

---

## 2. Breaking-change delta (test13-pinned sources/clients → Topaz VM)

| # | Break | Evidence | Blast | Fix owner |
|---|---|---|---|---|
| **B1** | `avl.Get` 2→1 (409 sites, 37 realm dirs; immutable `memba_collections` + forked grc721 in closure) | chain source §1.2; AVL spec | Deterministic `AddPackage` rejection of nearly every realm | WS-A1 |
| **B2** | `chain.emit` attr >4096 B **panics** the tx (was truncate) | `emit_event.go:37`; **353 `chain.Emit` sites** in the realm set | Any user-controlled emitted string | WS-A5 |
| **B3** | Preprocess gas 1250/source-byte up-front at `AddPackage` **and `MsgRun`** — charged for ALL `.gno` incl. `_test` | `vm/params.go:52` | Ceremony gas budgets (strip `_test.gno`); katana eject-script gas; any `maketx run` flow | WS-B3, WS-D3 |
| **B4** | Type-check strictenings (#5739 embedded identity, #5920 blank `_`, #5932 cross-pkg method qual) consensus-deterministic (#5891/#5893); #5732 is runtime-error *typing* (not compile-time) | audit register A5/A6 (corrected) | Empirical compile gate at the Topaz ref | WS-B5 gate |
| **B5** | Registration reshaped: `r/gnoland/users` gone → `r/sys/namereg/v1.Register` — **free today (price 0, changeable), nym-format-locked (`nym-…`), arbitrary @usernames GONE**; `samcrew` namespace not self-registrable; CLA machinery present (dark today) | §1.2 | Onboarding flow + copy (#960 guidance must be **rewritten**, not re-verified); deploy preflight; §7 Q3 genesis-prereg ask | WS-C4 + WS-B4 |
| **B6** | Wire residuals: Adena release must emit `max_deposit`; non-canonical builder paths must match | §1.3 | All Adena-signed txs fail if stale | WS-C4 |
| **B7** | Valoper surfaces: `r/gnops/valopers` (+ GovDAO v3 facade); **secp256k1 valsets REMOVED (#5949) — Ed25519 only** | §1.2 | katana; Memba validator pages; TMKMS consensus key must be Ed25519 (verify — WS-D4) | WS-D2/D4 |
| **B8** | grc20reg `maxSlugLen=128` (#5911) | chain source | $MEMBA / tokenfactory_v2 registration | WS-A cut |
| **B9** | **Storage deposits (NEW — missed by all prior audits):** every DeliverTx locks `100ugnot × net-storage-growth-bytes` at a per-realm derived deposit address; empty `max_deposit` (our builders' default) = 600 GNOT cap | genesis VM params; `keeper.go:1795` | Deploy-key funding must budget deposits (full realm set = source+state × 100ugnot); user UX (a ~2 KB post locks ~0.2 GNOT); faucet sizing; fee display; consider emitting explicit `max_deposit`. Neutral for NF-2 (deposits sit at a derived addr, not the realm addr). | WS-B3, WS-C4, §7 Q4 |

**Confirmed non-deltas:** interrealm-v2, gnomod.toml, `/v0` import paths, `NewBanker` 2-arg, `realm.Sub` (additive), session/vesting accounts (additive; sessions blocked from AddPackage).

---

## 3. Workstreams

### WS-0 — Decisions & external gates (owner + Aeddi/gno core + Lours)

**Escalation routing (corrected per owner, Jul-17):** **Aeddi** leads the gno core team — Topaz/Test14 chain-official matters (final chain-id, genesis resets & preregistration, `r/sys/*` enforcement states, official RPC/indexer/gnoweb/faucet, valset admission, Onbloc/Adena contact) go to him. **Lours** is Samourai-crew (dev & validator tooling; leads validators infra at the samourai coop) — our validator entry, TMKMS key type, second samourai sentry, gnomonitoring/katana hosting go to him. He does not control the chain.

Nothing in WS-E starts until: final chain-id confirmed (Aeddi); `samcrew` namespace preregistration + CLA path proven on the final chain (Aeddi); funding (incl. storage deposits) in place; indexer/gnoweb story known; **owner ratifications Q10–Q13**. Everything in WS-A–WS-D proceeds regardless. **The asks go out THIS WEEK — they, not engineering, are the critical path (CTO reviewer #2). Ready-to-send drafts: §7.1.**

**WS-0.k — Key & secret inventory (WS-0 exit criterion).** Draft below (owner fills custodian/storage where marked ◻; P4 arming blocks on zero ◻ in katana rows). Katana's signer is a **GovDAO member that can file and vote ANY proposal** — dedicated key, mnemonic in env/secret file only (0600, never in the compose-mounted config.yaml), membership-removal path documented before arming.

| Key / secret | Purpose on Test14 | Custodian | Storage | Rotation / revocation | Blast radius if lost/compromised |
|---|---|---|---|---|---|
| Deploy 2-of-2 `samcrew-core-test1` = **`g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0`** (keystore-verified `(multi)`, zooma + adena-zxxma) | AddPackage ceremony; **this address is the `samcrew` genesis-prereg grantee** (multisig addrs derive from composite pubkey → chain-independent, valid on topaz-1) | owner (adena-zxxma) + zooma | local keystores ◻ (confirm zooma's) | New multisig + re-auth of `samcrew` namespace with Aeddi | Can publish under `samcrew`; immutable-path squatting |
| Fee-spine multisig `samourai-crew` = `g10kw7e55e9wc8j8v6904ck29dqwr9fm9u280juh` (keystore-verified `(multi)`, 7 pubkeys) | Treasury / fee recipient (market_config) | owner + crew ◻ threshold? | ◻ | `SetTreasury` 2-step (A2 adds it) | Fee flow diversion |
| ~~Marketplace admin "single key"~~ **RESOLVED (Jul-17 keystore evidence): `g1x7k4628…` IS the deploy 2-of-2's address** — the audits' "single-key mislabeled multisig" concern (P0-3/X4) was a false alarm at the key level; realm admin fields pointing at it point at the true 2-of-2 | Realm admin ops until 2-step handover | (same as deploy 2-of-2) | — | A2's 2-step `TransferAdmin/AcceptAdmin` at the cut | Admin actions on markets |
| katana signer (Q8, ◻ NEW) | GovDAO member; files ejection proposals | ◻ (recommend: ops, not owner) | env/secret 0600 only | GovDAO member-removal proposal — document BEFORE arming | Can file/vote ANY GovDAO proposal |
| Validator + TMKMS consensus key (Ed25519 — verify, B7) | Consensus signing, 51.159.105.229 | Lours | TMKMS on the validator host | Valset update via GovDAO | Double-sign/jail; valset seat |
| Memba backend token-signing key | Login-token signing (Fly secret) | owner | Fly secrets | New keypair at chain flip (staging app gets its OWN — §10 security) | Session forgery |
| gnomonitoring Clerk admin accounts | Panel `/admin/*` | owner (+ Lours?) ◻ | Clerk | Clerk role removal | Chain config + alert purge on the panel |
| gnomonitoring static token / `critical_counts` (Phase-2, if built) | katana alert reads | n/a until built | env, constant-time compare | Rotate on schedule; scoped read-only | Alert-history reads only (by design) |
| `METRICS_BEARER` / `QUEST_ADMIN_ADDRESSES` (prod, still unset) | Backend metrics/admin | owner | Fly secrets | — | Pre-existing gap, unrelated to Test14 but same sweep |
| Throwaway P2 staging keys | `[topaz-dev]` deploys (replay-collision with `[local]` — distinct from everything above) | session-generated | scratchpad only, discard | discard at reset | none (throwaway by design) |

### WS-A — Realm version-cut (repo: `samcrew-deployer`) — *the mainnet rehearsal*

The existing Phase 5–8 program retargeted to the Topaz ref `67a0bb333`. One version-cut, deployed to test14 now; **re-validated (oracles + compile) at the actual mainnet ref before any mainnet ceremony** (§6 R-9).

- **A1 · Vendor avl (Option A, existing spec)** — publish `gno.land/p/samcrew/avl` with the two-value `Get` frozen; mechanical repoint in the 52 importing files; zero call-site changes. **Daokit reality check (corrected by CTO review):** genesis daokit is **not** ABI-compatible with `memba_dao` (§1.2), and the fork **cannot** be republished at its own paths (genesis occupies them; AddPackage can't overwrite) — a fork path means renaming (e.g. `p/samcrew/daokit_v2`… or `/v2`, the test11 pattern) **and publishing `p/samcrew/realmid` first** (absent from genesis; `gnodaokit/deploy.sh:83` deploys it first for a reason). Scope correction: only **`memba_dao`** imports the daokit closure in non-test code (not "43 realms"). The decision — **rewrite memba_dao onto the genesis basedao API vs. fork-rename** — is an owner-visible design choice: **§7 Q13**. **Spike DONE (§11.3): recommendation = fork-rename (Path B), decisively** — genesis daokit self-labels "EXPERIMENTAL / INSECURE… fork and harden", ships a permanent `RemoveMember` role-bookkeeping bug our fork fixed (immutable `/p`, unfixable), and lacks the members/proposals render routes Memba's backend quest verifier (`quest_verify_phase3.go:86-93`) and frontend member parser consume today. Path B = ~28 mechanical import-line edits (`/v2` suffix pattern already scripted for test11 in `projects/gnodaokit/deploy.sh:52-59`), memba_dao itself changes **3 import lines**. **New spec requirement: vendor `p/samcrew/avl/pager` too** (fork's `utils.gno:127/162` call `pager.NewPager(*avl.Tree,…)` — on-chain pager takes the new tree type). Amend `AVL_OPTION_A_VENDORING_SPEC` §2/§4 (+pager) and `MAINNET_READINESS` §4 accordingly (assigned: the A1 PR).
- **A2 · Immutable API-surface freeze ADDs** (`SaleSeedSealed()`, `GetProceeds`, `MaxPrice` cap, batch getters, escrow_v4 solvency getters + 2-step admin + `assertNotPaused()` coverage, market_config 2-step, purchase-gated `PostReview`). **Gated on the freeze steward sign-off — see P1b.**
- **A3 · NF-2 solvency getters** on every pooled-fund realm (this IS the version-cut the Jul-15 deferral named).
- **A4 · §6 auth-hardening** for every realm in the Test14 deploy set (new immutable path ⇒ MUST, per MAINNET_READINESS §6); ratchet baseline lines deleted per realm; `GATE_NEW=1` on the test14 lane.
- **A5 · Emit-cap bounding**: sweep all 353 `chain.Emit` sites; bound user-controlled attrs ≤4096 B at the realm boundary.
- **A6 · Custody-oracle matrix** (existing doc): authored BEFORE any avl diff; gate = green at **both** `f3d5a5d13` and `67a0bb333`; `revive()`-based, no `p/nt/uassert`.
- **A7 · Deploy-set hygiene + sweep refresh**: MAINNET_READINESS §1 is pinned to `c81c913` and predates points_v1, feed_v2, appstore_v3, arcade/barricade realms, escrow_v4 — **re-run the OriginSend sweep at HEAD and extend the §1 tables (SSOT rows) before the deploy set is defined**; the WS-B6 gate keys off the refreshed table. The 7 ⛔ legacy realms never enter the Test14 sequence.
- **A8 · SSOT extension (named deliverable)**: add the Test14 section to `MAINNET_READINESS.md` (publish-order rows, gate rows, refreshed sweep, A1/Q13 outcome). Extend, never fork.

### WS-B — Deploy tooling (repo: `samcrew-deployer`)

- **B1 · `config/networks.toml`**: add `[test14]` (`chain_id = "<FINAL — §7 Q1>"`, `rpc = https://rpc.topaz.samourai.live:443`, fallback = official RPC when live). Fail-closed while the placeholder is unresolved (`lib/network.sh check_rpc` already hard-fails on chain-id mismatch ✅). **Plus a separate `[topaz-dev]` entry** (`chain_id = "dev"`, never referenced by any app config) so P2 throwaway deploys don't loosen the `[test14]` rule (CTO C-4).
- **B2 · `GNO_REF` flag-day**: `f3d5a5d13 → 67a0bb333` in deployer `test.yml:155` — atomic with the avl repoint. **CORRECTION (pre-flag-day analysis, Jul-17 PM): Memba's `gno-test.yml` `GNO_PIN` does NOT join this flag-day** — that gate validates the frontend deploy *templates* against the chain users deploy to TODAY (test13, where `p/samcrew/avl` doesn't exist); bumping it would force a template repoint that breaks live test13 deploys. The GNO_PIN + template avl-migration flip together at the WS-E chain flip (new C4 item). The security reviewer's stale-VM concern is served by the deployer CI (which does validate the realm set at the Topaz ref post-flag-day). Re-vet the vendored `ci/vendor/uassert` guard at the new ref (upstream still carries `f(cross(rlm))` at master — guard won't spuriously trip ✅). Flag-day preconditions restate UNIFIED Cert #9 explicitly: the feed session's realms compile at the new ref, the 8 uassert suites green on the non-gating leg, and **direct coordination with the live Lane-B session immediately before the flip**. **Directive to Lane-B now: author remaining feed_v2 slices against `p/samcrew/avl` + the Topaz ref**, or they land two-value stdlib-avl code that reds at the flip.
- **B3 · Gas + deposit budgeting**: recompute per-package `gas_wanted` (1250/byte incl. tests → strip `_test.gno` first); **budget storage deposits per realm** (B9) into the ceremony funding sheet. **Corrected by the §11.4 pilot: deposits are charged on state-store growth (STORAGE DELTA), NOT source bytes** — observed 0.27×–2.23× source. Budget from `gnokey -broadcast -simulate only` dry-runs per package (prints `STORAGE DELTA`/`TOTAL TX COST`, accurate to ~0.001%; suggests 5%-margin gas) — ceremony tooling consumes that output directly. Keep the default `-simulate test` gate on (refuses to broadcast under-gassed txs at zero cost; an out-of-gas broadcast burns the fee).
- **B4 · Ceremony preflight additions** (fail-closed, each recording actual vs expected): (i) CLA status — query `r/sys/cla`, assert expected enforcement state, sign if required; (ii) namespace — `r/sys/names.IsEnabled()` + `IsAuthorizedAddressForNamespace(deployKey,"samcrew")`, assert both against the expected final-chain state (the gates are dark today; **a P2-green run does NOT prove the P3 authorization path** — reviewer #1); (iii) namereg price via qrender parse (no getter exists; optional upstream getter PR); (iv) deposit-balance check: deploy key balance ≥ gas + computed deposits.
- **B5 · Local Topaz devnet rehearsal pipeline**: docker gnoland at `67a0bb333` (reuse katana's `gnoland-test/` harness; `bootstrap.sh` must **assert** `git rev-parse HEAD == 67a0bb333`), full deploy sequence green + custody oracles green = **WS-A definition of done**. **Replay hygiene (security reviewer): the local devnet's chain-id equals live Topaz's (`dev`) — use distinct keys for local rehearsal vs any live-Topaz staging**, or artifacts are cross-replayable.
- **B6 · Fund-safety gate for test14 (mechanism specified — it doesn't exist yet):** add a `enforce_fund_safety = true` key to networks.toml, parsed in `lib/network.sh`, honored at `deploy.sh:501` alongside `IS_PRODUCTION`; ship with a regression test proving a ⛔ realm is refused on the test14 lane. Recommended posture: all production behaviors **except** the typed confirmation prompt (Topaz paths are just as immutable as mainnet's). Blocking the 7 ⛔ realms on Topaz is intended. Owner ratifies: §7 Q10.

### WS-C — Memba app (frontend + backend) — *additive & flag-gated; prod untouched; merges respect the Jul-20 window (§4)*

- **C1 · `config.ts`**: add `NETWORKS["test14"]` (key `test14`; on-wire `chainId` placeholder until final; `VITE_TEST14_*` envs); `REALM_ALLOWLIST.test14` **must exist and be fail-closed** (verified: absent key ⇒ fail-open at `config.ts:272-273`); prune era-specific third-party trust entries (`p2p.team`, `aeddi.org`) while touching `TRUSTED_RPC_DOMAINS` (already covers `samourai.live`/`testnets.gno.land`, port-agnostic). Default network stays `test13` until WS-E. Note `config.ts:287` falls back to `"test-13"` on resolution failure — re-verify at flip.
- **C2 · CSP**: existing wildcards already cover Topaz hosts — the real check is **`wss://`** (only gno.land/gnoland.network/onbloc.xyz have wss entries): if any subscription path targets the samourai sentry, add `wss://*.samourai.live` to BOTH `netlify.toml` and `frontend/index.html` (sync rule). New hosts only if outside existing wildcards. **One-time `samourai.live` DNS audit** (stale-testnet subdomain takeover = trusted-RPC spoof path).
- **C3 · Backend chain hygiene** (fixes audit P0-6): per-chain `RPC_FALLBACK_URLS` (same-chain nodes ONLY — never inherit test13 defaults); chain-id verification with corrected polarity (security reviewer): **boot = hard-fail on confirmed mismatch (`/status` reachable AND network ≠ configured), warn-only when unreachable (no crash-loop on RPC blips); failover = hard-reject a mismatched fallback.** Staged `fly.toml` diff prepared-not-applied. Transition = **hard cutover**; `MEMBA_ACCEPTED_CHAIN_IDS` = exactly ONE chain-id at all times (dual-accept forbidden); **close the AUTH-CHAINID-01 empty-ChainId legacy-token grace (`crypto.go:513-518`) at or before the flip**; Fly staging app rehearses first with **its own token-signing keypair**, never prod's. **DB chain-scoping (new, reviewer #2):** the Fly volume holds test13-derived projections (feed, leaderboards, quests, barricade ~516K) — decide wipe-and-reindex vs chain-id column, migrations numbered ≥026, indexer replay budget estimated, BEFORE the flip.
- **C4 · Signing & onboarding lane**: golden-test canonical sign bytes against `gnokey` @ `67a0bb333` (extend fixtures — and cover **deposit semantics**, not just byte-shape; consider explicit `max_deposit` values); sweep non-canonical builders (`agentTemplate`, `grc20`, `escrowTemplate`, `channelTemplate`, `boardTemplate`, `parseMsgs`); **Adena on Topaz is an external gate** (§7 Q7) — including the user-side flow of adding/selecting the network in Adena, not just signing; **rewrite** the username flow + #960 guidance for namereg reality (nym-format, price surfaced via qrender, arbitrary usernames gone); re-verify #973 CLA mapping against live errors; surface storage-deposit cost in fee UX (B9).
- **C5 · Indexer**: test14 entry ships `indexerUrl: ""` until §7 Q6 resolves; verify the existing no-indexer degradation paths in e2e (they exist for gnoland1).
- **C6 · e2e + baselines + docs**: test14 fixtures in `stubNetwork` (chain-id parametrized); plan the **Playwright visual-baseline regen** post-flip (warm vite cache, rm baselines first — known procedure); sweep docs/`.env.example`/README for hardcoded test13 endpoints.

### WS-D — Monitoring & validator ops (repos: `gnomonitoring`, `katana`)

- **D1 · gnomonitoring += Topaz**: panel `POST /admin/chains` (hot-start) or `config_docker.yaml` + restart; `graphqls`/`gnowebs` when they exist; enable `validator_report_enabled.test14` + daily report only once the valset is real. Server-side Prometheus/Grafana/Loki already done (Lours #1).
- **D2 · katana Phase 1 — metrics-scope-only, NOT observe-grade (label corrected by security review: katana has NO observe mode; any enabled chain is broadcast-armed).** Phase 1 = `missed_blocks` condition only (public `/missing_block` endpoint — no auth gap). **Hard rule: katana is never pointed at live Topaz with a broadcast-capable, funded, GovDAO-member signer until P4.** The **`dry_run` upstream PR is a prerequisite** for ANY pre-P4 run against Topaz (an unfunded signer is not an acceptable substitute — it trains operators to ignore broadcast errors). Phase 2 (critical-alerts): preferred fix is a **public aggregated endpoint upstream** (`GET /critical_counts?chain=&from=` → per-addr counts; same sensitivity class as the already-public `/missing_block`, zero new secrets). Static-token fallback if the owner prefers: read-only, `GET /admin/alerts`-scoped, constant-time compare, rotation documented. mTLS / proxy header injection don't work (Clerk middleware rejects regardless); dev-mode sidecar rejected (unauthenticates destructive admin routes incl. `DELETE /admin/chains`).
- **D3 · katana safety rails before arming**: `storage.driver: sqlite` **enforced** (propose upstream: fail-start if a broadcast-enabled chain runs `driver: none` — the Noop store re-proposes every cycle); exceptions seeded (Samourai + core validators); `GNO_REF=67a0bb333` in the image (and **fail the build if `GNO_REF=master`** for any real-chain image); pin the gnomonitoring image in the e2e compose to the VPS's actual digest; rehearse scenarios 1–5 on `gnoland-test/` at the Topaz ref; add to the upstream PR: assert configured `chain_id == /status.network` before broadcast (clean stop on genesis reset); re-check the default 20M `gas_wanted` at the Topaz ref (MsgRun now pays 1250/byte preprocess gas); note v3 ejection requires the target operator to be registered in `r/gnops/valopers` (unregistered validators are un-ejectable via the script — fine post-final-genesis if all register).
- **D4 · Signer & placement (owner: §7 Q8–Q9)**: dedicated GovDAO-member key per WS-0.k. Placement: 51.159.105.229 or monitoring VPS; katana/gnomonitoring should prefer a LAN-local sentry (D6). **Verify the Samourai validator's consensus key is Ed25519** (secp256k1 valsets removed, B7).
- **D5 · Memba `/reports` linkage** (public `GET /api/reports/validators?chain=test14`): post-cutover enhancement, not critical path.
- **D6 · RPC availability (new, security review)**: app, backend failover, gnomonitoring, katana, and the ceremony currently all share **one sentry co-located with the validator + TMKMS**. Before the user-facing flip: (a) a second same-chain RPC (official when live, or second samourai sentry on separate hardware); (b) public app RPC decoupled from the validator host or proxy rate-limits confirmed; (c) monitoring/katana pointed at the LAN-local sentry.

### WS-E — Cutover ceremony & verification (owner-executed, gated on WS-0)

1. Final-genesis gate: chain-id ≠ `dev` confirmed by Aeddi/core team; enforcement states (names/CLA/price/storage) recorded and matched by B4 preflight; second RPC live (D6).
2. Preflight: B4 checks + funding incl. deposits + `samcrew-realm-solvency.sh test14` baseline.
3. Deploy in the amended publish order (per the Q13 spike, pending owner ratification): `p/samcrew/avl` (+`/pager`) → `p/samcrew/realmid` → `p/samcrew/daocond/v2` → `daokit/v2` → `basedao/v2` → grc721 → collections → market_config/core → nft_market_v3_2 → tokenfactory_v2 → memba_dao + dao realms → consumers. One realm at a time via `REALM=…`; never bare `make deploy`.
4. Smoke: `vm/qrender` per realm; scripted tx smoke (nym registration, mint, list, buy); post-deploy solvency; treasury repoint per MAINNET_READINESS §4 (F-1 lesson); verify `GetTreasury()` parity.
5. App flip (**corrected — CTO C-3**): the chain flip is a **git PR editing `netlify.toml` `[build.environment]` (`VITE_GNO_CHAIN_ID` → final id)** — committed file config wins over the team env store; `VITE_TEST14_*` overrides go in the store via `netlify api`. Owner-gated merge (= prod deploy). Fly: staged `fly.toml` diff, rolling deploy, `MEMBA_ACCEPTED_CHAIN_IDS` flip + AUTH grace closure in the same window.
   **5b. Rollback runbook (new):** pre-staged revert PR for `netlify.toml`; `fly.toml`/`MEMBA_ACCEPTED_CHAIN_IDS` revert procedure; bounded verification window with named trigger criteria (login success rate, tx success, RPC health). test13 staying live makes rollback cheap — it's written down BEFORE the flip.
6. test13 sunset: prod stays on test13 until owner verifies Topaz end-to-end; then a wind-down window with read-only banner (WS-F comms).

### WS-F — User data continuity & comms (new workstream — CTO reviewer #2's biggest gap)

Nothing carries over chain-to-chain. Deliverables: **(F1)** per-surface decision table — points/XP (LIVE in prod), NFTs/collections, DAO memberships, badges, quest progress, barricade attestations, feed history, usernames (nym-format re-registration — flow AND identity display change) — each marked wipe / re-seed / disclose, owner-signed; **(F2)** comms plan: in-app banner, FAQ, dates, what-happens-to-my-assets copy; **(F3)** the test13 read-only window definition; **(F4)** backend DB story = C3's chain-scoping decision, executed.

---

## 4. Phasing (updated gates — CTO corrections C-2, C-5 folded)

**Jul-20 constraint (explicit):** per the UNIFIED plan, no gated-flag / frontend prod-deploying merges within 48 h of Jul-20; one in-flight prod deploy per surface; Track-0 leftovers (#964 owner merge, METRICS_BEARER) share the window. **P0 authoring is unaffected; WS-C merges are deferred past the window or follow the hardened procedure (green prod-context deploy-preview + owner ack).**

| Phase | Contents | Gate to start |
|---|---|---|
| **P0 — now** | Owner asks (§7, THIS WEEK); WS-0.k inventory draft; WS-B5 local devnet; A1 spike (genesis-vs-fork ABI matrix for memba_dao → feeds Q13) + A6 oracle authoring + A7 sweep refresh; katana harness rehearsal @ Topaz ref; D2 config prep + upstream PR drafts (dry-run, sqlite-enforce, chain-id assert); C4 golden-test lane; C1/C2 **authoring** (merge post-window) | none |
| **P1a — mechanical cut** | A1 avl repoint + A5 emit caps + B1–B5 + C3 | P0 oracle + devnet lanes green |
| **P1b — freeze-gated cut** | A2 + A3 + A4 (+ A8 SSOT) | ✅ **GATE SATISFIED 2026-07-17** — owner ratified Q10–Q13 ("Go ratify"); freeze enumeration accepted as the working set per Q11 (new discoveries still get owner eyes) |
| **P2 — live staging (throwaway)** | Deploy full set to current Topaz via `[topaz-dev]` (distinct keys — replay hazard); gnomonitoring += topaz; katana **dry-run** pointed at it | Aeddi ack on resets/throwaway deploys (Q2); dry-run PR merged; namespace/CLA state recorded (NB: proves mechanics, NOT the P3 authorization path — gates are dark today) |
| **P3 — ceremony** | WS-E on final genesis | WS-0 fully resolved; refreshed sweep (A7) done; B6 gate live with regression test; C3 merged+deployed; second RPC (D6); owner GO |
| **P4 — post-cutover** | katana armed (missed-blocks conditions) after: ≥2-week dry-run soak with zero unreviewed false positives, owner-approved exceptions, valset ≥ 4 with Samourai validator in-set, gnomonitoring `dev_mode=false` asserted, WS-0.k inventory complete; daily reports enabled; D5; Option-B avl cleanup | P3 verified |
| **Fallback trigger** | If final genesis is confirmed before the full cut is green: deploy the **P1a (avl-only) set** via an interim lane for app smoke only; immutable realms' final deploys remain single-shot in the full cut | — |

**Effort (corrected per CTO review #2):** P0 ≈ 4–6 sessions (oracle matrix alone 2–3); P1a ≈ 4–6; P1b ≈ 4–6 (A2 contains a NEW realm — escrow_v4 — plus the reviews wrapper; A4 touches ~30 realms); P2–P3 ≈ 2 + ceremony. **Program ≈ 15–22 engineering sessions**; calendar dominated by §7 answers, not engineering.

## 5. PR breakdown & merge policy

Small single-concern PRs, each CI-green before merge. Gates per this session's authorization AND repo reality: deep review + fresh-CTO review + tests + up-to-date + zero conflicts + **verify zero failing checks (mergeable ≠ green; exact required check names incl. `Changelog entry`, `Frontend (React · Node 20/22)`)** + peer review + parallel-session check via git movement before every merge. Memba PRs trip the **changelog gate** (entry or `no-changelog`). `--admin` merges of own PRs need explicit per-PR authorization — not assumed. samcrew-deployer is a **shared checkout: worktrees only, never `git add -A`**. Register every lane in `docs/planning/SESSION_SYNC.md` before first edit (single-writer files in play: CI yaml (B2), `CHANGELOG.md`, `frontend/.env.example` (C1)); Lane-B feed + Lane-C auth remain off-limits per SESSION_SYNC.

Seams: PR-1 networks.toml (`[test14]`+`[topaz-dev]`) + B4 preflights · PR-2 `p/samcrew/avl` + module tests · PR-3 Q13 spike result (ABI matrix) · PR-4..n per-realm-cluster P1b diffs (oracle-gated) · PR-x GNO_REF+GNO_PIN flag-day (atomic) · PR-y C1/C2 (post-Jul-20) · PR-z C3 backend · upstream: katana dry-run + sqlite-enforce + chain-id assert; gnomonitoring `/critical_counts` (or token); optional namereg price getter.

## 6. Risk register

| # | Risk | L×I | Mitigation |
|---|---|---|---|
| R-1 | Chain-id churn / genesis resets invalidate work | H×M | Placeholder discipline (B1); `[topaz-dev]` carve-out; nothing user-facing until final |
| R-2 | memba_dao daokit decision stalls the cut (genesis-ABI rewrite vs fork-rename) | M×H | Q13 spike in P0; both paths pre-scoped (A1); realmid publish requirement known |
| R-3 | avl repoint misses a call-path | M×H | Both-refs oracle gate; local-devnet full-sequence AddPackage backstop |
| R-4 | Adena can't sign/select-network on Topaz | M×H | §7 Q7 early; golden tests our side; fallback = builtin multisig/gnokey flows |
| R-5 | katana files a real ejection prematurely | L×H | No observe mode exists — dry-run PR prerequisite; P4 arming checklist (valset ≥4, soak, exceptions, custody) |
| R-6 | Namespace/CLA/price flip between P2 and P3 (gates dark today) | M×M | B4 asserts expected enforcement state fail-closed; §7 Q3 genesis-prereg ask now |
| R-7 | Emit-cap panic in a live money path | L×H | A5 sweep (353 sites) + oracle case per emitting entrypoint |
| R-8 | Backend serves stale test13 state post-cutover (RPC failover OR DB projections) | H×M | C3: chain-id recheck (corrected polarity) + same-chain-only fallbacks + DB chain-scoping decision pre-flip |
| R-9 | Mainnet ref ≠ Topaz ref drift breaks "deploy twice" | M×M | Assumption now explicit; re-run oracles+compile at the actual mainnet ref before mainnet ceremony (Q12) |
| R-10 | Scope-coupling: one-cut not green when final genesis lands | M×H | P1a/P1b split + fallback trigger (§4) |
| R-11 | Jul-20 wave contention (capacity + frontend merges in-window) | M×M | §4 constraint: author now, merge post-window/hardened |
| R-12 | Single-sentry shared fate (app+monitoring+katana+ceremony on one host with the validator) | M×H | D6: second RPC pre-flip; decouple/rate-limit; LAN-local for monitoring |
| R-13 | Storage-deposit underfunding aborts ceremony mid-sequence | M×M | B3 deposit budget + B4 balance preflight (gas + deposits) |

## 7. Open questions (asked THIS WEEK; they are the critical path). Addressees: **[A]** = Aeddi/gno core · **[L]** = Lours/samourai infra · **[O]** = owner

1. **[A] Final `chain_id`** for Test14/Topaz (exact on-wire string). Current genesis: `dev`.
2. **[A] Genesis reset schedule** — will the current chain reset? Throwaway deploys welcome meanwhile?
3. **[A] `samcrew` namespace**: `namereg/v1` is nym-format-locked — `samcrew` cannot self-register. Ask: **preregister `samcrew` → deploy-key in the final genesis** (or GovDAO route). Also: will `r/sys/names.Enable()` + CLA enforcement + nonzero register price be live at final genesis? (All dark today.)
4. **[A]** genesis premine / official faucet · **[L]** samourai-side faucet ops if we host — funding for deploy key (**gas + storage deposits**: 100ugnot/byte locked per realm), 2-of-2, fee-spine, katana signer, test users; faucet sizing for user deposits (a 2 KB post locks ~0.2 GNOT).
5. **[A]** valset admission plan (who validates, when we're added) · **[L]** our validator entry ops + **confirm TMKMS consensus key is Ed25519** (secp256k1 valsets removed).
6. **[A]** official tx-indexer + GraphQL, gnoweb, faucet URLs (rpc.topaz.testnets.gno.land is dark) · **[L]** samourai-hosted equivalents + a second same-chain RPC / decoupling public app RPC from the validator host (D6).
7. **[A→Onbloc] Adena** — signs correctly against v1.0.0 (`max_deposit`, chain-id)? Users can add/select Test14? Test contact?
8. **[O] katana signer** — which key becomes the GovDAO member; custodian per WS-0.k?
9. **[L] katana placement + thresholds** — host (validator box vs monitoring VPS); missed-blocks max/window; exceptions roster; `require_all`?
10. **[O] Gate scope** — ✅ **RATIFIED by owner 2026-07-17** ("Go ratify"): `enforce_fund_safety` for test14, all prod behaviors except typed prompt.
11. **[O] Mainnet-rehearsal scope** — ✅ **RATIFIED 2026-07-17**: A2/A3/A4 fold into the Test14 cut (one-cut strategy, §4). Interpretation recorded: the `IMMUTABLE_API_SURFACE_FREEZE` doc's enumerated ADD/CHANGE list is accepted as the working freeze set; any NEW entrypoint discovered later still gets explicit owner eyes before the cut freezes.
12. **[O] VM pin** — ✅ **RATIFIED 2026-07-17**: `67a0bb333` is the working pin; mainnet-candidate ref remains open and will be re-verified before any mainnet ceremony (R-9).
13. **[O] memba_dao** — ✅ **RATIFIED 2026-07-17**: **fork-rename** (`daocond/daokit/basedao` → `/v2` + `realmid` publish), per the §11.3 spike matrix.

### 7.1 Ready-to-send ask drafts

**To Aeddi (gno core):**
> Hey Aeddi — we're prepping Memba + the samcrew realms for Test14/Topaz (our validator + tooling are already pointed at it). A few things from the official side:
> 1. Final `chain_id` for Topaz? Genesis currently says `dev` — will there be a reset with the real id, and rough timing?
> 2. OK for us to make throwaway deploys on the current chain meanwhile?
> 3. `r/sys/namereg/v1` is nym-format-locked, so the `samcrew` namespace can't self-register. Could you preregister `samcrew` → our deploy address in the final genesis (or what's the intended route — GovDAO)? And will `r/sys/names.Enable()` + CLA enforcement + a nonzero register price be live at final genesis? (All three are off today.)
> 4. Funding: genesis premine or faucet for our deploy key + multisigs? Note storage deposits (100ugnot/B) lock funds on every deploy, so amounts matter.
> 5. Will there be an official tx-indexer/GraphQL, gnoweb and faucet for Topaz? `rpc.topaz.testnets.gno.land` looks provisioned but dark — planned URLs?
> 6. Valset: what's the admission plan? Our Samourai-crew validator is ready.
> 7. Adena on Topaz — is the current release expected to sign fine against v1.0.0 (`max_deposit` field, new chain-id)? Who's the right Onbloc contact for a quick test?

**To Lours (samourai infra):**
> Salut Lours — Topaz infra looks great. From our side:
> 1. When do we enter the valset, and can you confirm the validator/TMKMS consensus key is Ed25519? (v1.0 removed secp256k1 valsets.)
> 2. Could we get a second same-chain RPC, or split the public app RPC from the validator host? App, monitoring, katana and deploys currently all share `rpc.topaz.samourai.live`, co-located with the validator.
> 3. gnomonitoring: we'll add the topaz chain via the panel once graphql/gnoweb URLs exist; daily reports stay off until the valset is real. OK?
> 4. katana: where do you want it running (validator box vs monitoring VPS)? We'll propose thresholds + an exceptions roster for review, we're adding a `dry_run` mode upstream before it ever points at Topaz, and it will need a GovDAO-member signer (separate ask with the owner).

## 8. Explicitly out of scope

Mainnet/gnoland1 deploy (this plan only makes its artifacts real); Barricade 3D (separate track); Feed v2 realm ceremony (Lane-B owns it; **but see B2's directive** — its slices must target the vendored avl + Topaz ref from now on); $MEMBA tokenomics/ICO; unrelated feature work.

## 9. Source references

Probes §1; `AVL_OPTION_A_VENDORING_SPEC_2026-07-17.md`; `CUSTODY_ORACLE_TEST_MATRIX_2026-07-17.md`; `IMMUTABLE_API_SURFACE_FREEZE_2026-07-17.md`; `UNIFIED_IMPLEMENTATION_PLAN_AND_PROD_RISK_2026-07-16.md`; `MAINNET_READINESS.md`; katana `README/prd/config.yaml.example` + `internal/`; gnomonitoring `README#validator-health-report` + `api-admin.go`; gno `master`/`origin/chain/topaz@67a0bb333`.

## 10. CTO review outcomes (3 fresh reviewers, 2026-07-17)

| Lens | Verdict | Headline findings (all folded above) |
|---|---|---|
| **Protocol correctness** | APPROVE-WITH-CHANGES | Ground truth reproduced (counts: 409 sites/37 dirs/52 files; katana↔v3 ABI match). **Corrections:** A1-a inverted — genesis daokit NOT adoptable by memba_dao (ABI drift verified; fork must rename, `realmid` missing from genesis and from the publish order); "43 DAO realms" → 1 (`memba_dao`); namereg is free-but-nym-locked (samcrew not self-registrable; #960 copy must be rewritten); AddPackage gates DARK today (P2 ≠ P3 authorization proof); #5732 recategorized; Ed25519-only valsets. **Additions:** storage deposits LIVE (B9 — the biggest miss); MsgRun preprocess gas; no namereg price getter; katana can't eject unregistered valopers. |
| **Delivery / risk** | APPROVE-WITH-CHANGES | Thesis + decomposition endorsed; one-cut recommended WITH P1a/P1b split + fallback trigger + owner asks front-loaded. **Corrections:** VM pin is an owner decision (Q12); P1 must gate on freeze sign-off (P1b); WS-E5 flip mechanism was factually wrong (netlify.toml git PR, not env store); `[topaz-dev]` carve-out (C-4); Jul-20 window absent (now §4); feed_v2 Lane-B directive; OriginSend sweep stale (A7). **Missing (added):** WS-F data-continuity/comms; DB chain-scoping; rollback runbook (E-5b); changelog/SESSION_SYNC/worktree mechanics (§5); SSOT extension (A8); baselines/docs sweep (C6). **Estimates corrected:** ~15–22 sessions total. |
| **Security / ops** | APPROVE-WITH-CHANGES | Every verified claim held (spam footgun, no dry-run by design, Clerk-vs-bearer gap, gate mechanics). **Corrections:** "observe-grade" label deleted — Phase 1 is broadcast-armed; dry-run PR is a **prerequisite**; B6 requires a new `enforce_fund_safety` key + regression test; C3 boot polarity inverted (now: hard-fail on confirmed mismatch, warn on unreachable); CSP diff ≈ no-op, real gap = wss; Phase-2 preferred fix = public aggregated endpoint (no new secrets). **Additions:** WS-0.k key inventory; `dev` chain-id replay collision; Memba GNO_PIN in the flag-day; rehearsal pinning; AUTH-CHAINID-01 grace closure at flip; single-sentry risk (R-12); P4 arming checklist (valset ≥4, soak, dev_mode=false). |

**Consolidated hard blockers imposed:** before P2 — dry-run PR merged; distinct throwaway keys. Before P3 — `enforce_fund_safety` live with ⛔-refusal test ✅ *(#120)*; C3 merged+deployed; AUTH grace closed, accepted set = exactly one chain-id; second same-chain RPC. Before P4 — full katana arming checklist + WS-0.k inventory complete.

### 11.7 P1a merges (owner "Go ratify" received; Q10–Q13 recorded in §7)

- **#120 MERGED (`1f964a7`)** — `[test14]` (fail-closed `TBD-…-PLACEHOLDER` chain-id) + `[topaz-dev]` lanes; `enforce_fund_safety` honored at the fund-safety chokepoint, unknown-deploy-state refusal, balance hard-fail, `--force` refusal (typed prompt stays production-only per Q10); 25-assertion hermetic regression suite (reviewer's M2 mutation escape closed pre-merge by pinning the OR-condition strings); `--list-networks` comment-line bug fixed. Gate review: MERGE — bypass hunt clean across all ~30 entrypoints, env-squash verified, `exit`-in-`||true` verified empirically.
- **#121 MERGED (`52e378c`)** — vendored `p/samcrew/avl` + `/rotree` + `/pager` at `deps/avl` from `f3d5a5d13`, byte-identity independently re-diffed (only module/import lines differ); mutation-tested equivalence/fuzz oracle (4000-op deterministic model check); gating CI leg at the pinned ref; ceremony deploy order avl → rotree → pager at the very head (`projects/deps`); MAINNET_READINESS §4 publish-order row. Both-refs green independently reproduced. Reviewer note for B3: vendored test files ship in the mempackage (~2.9k lines × 1250 gas/byte) until the B3 strip lands.
- **#122 MERGED (`030db69`) — THE ATOMIC FLAG-DAY.** 52 realm files repointed to `p/samcrew/avl` (import-lines-only, hunk-audited) + deployer CI flipped to `GNO_REF 67a0bb333` in one PR. **Both-refs gate CLOSED: all 4 custody-oracle suites + the equivalence oracle green at the Topaz ref with ZERO modifications** — no behavioral drift through the avl cut. All CI legs made hermetic (empirically proven: gno resolves out-of-workspace `gno.land/*` imports by live-chain download only — legs previously depended silently on a live chain). Legacy v1 suites keep their own pre-existing v1.1.0 toolchain (untouched). Lint census at the new ref: **35/41 realms CLEAN — the entire deploy set compiles at the Topaz VM except `memba_dao`** (known Q13 daokit scope; byte-identical error log to the census). Memba `GNO_PIN` intentionally NOT moved (WS-B2 correction — flips at WS-E with the template migration). Gate review: MERGE, zero blocking findings, oracle re-runs independently reproduced.
- **gnodaokit#65 OPEN (fork-rename, Q13 Path B)** — `feat/topaz-v2-rename` = pr-64 + one path-mechanics commit (44 internal import lines incl. daodemo, 8 avl lines, 3 module renames; zero call-site/ABI changes; one forced 2-line deviation: `ntavl` alias at the `p/demo/svg` boundary — genesis svg types `Canvas.Style` as the NEW avl's `*Tree`). 7/7 packages green at the Topaz ref; genesis piechart ABI confirmed compatible. **Repo CI is pre-existing-red** (Makefile pins stale gno `2c7f1abe`) → merge is gated on either a minimal CI retool or owner say-so; gate review in flight at session close. Supersedes parked #64.
- **P1a remaining:** #65 disposition + deployer follow-up (memba_dao 3-line `/v2` repoint + CI vendoring of the fork — closes the last compile gap), A5 emit-cap sweep (349 sites), B4 ceremony preflights, B3 strip+budget sheet, C3 backend (Memba repo, post-Jul-20 merge). P1b (A2/A3/A4) unlocked.

### 11.8 · Cross-reference: parallel pressure-test (`TOPAZ_PLAN_PRESSURE_TEST_2026-07-17.md`, separate session, 3-reviewer red-team)

Ran concurrently with P1a execution; reconciliation against the merged state: **absorbed already** — avl equivalence suite (its "missing" finding predates #121, which shipped it mutation-tested); Option-A and Path-B independently re-confirmed. **Still open, folds into the next PRs**: (i) `projects/memba/deploy.sh` gnodaokit dependency preflight **false-passes against genesis daokit** (presence-check matches the ABI-wrong genesis packages — the memba_dao follow-up PR must check the `/v2` paths specifically); (ii) fork `daokit.Core.Execute` lacks a re-entrancy guard (P1b hardening item, fold into the version-cut wave); (iii) namereg **prereg-before-Enable** footgun refines the Q3 ask to Aeddi (prereg must land in genesis, not post-Enable). **Corrections accepted**: the #5892 1250/byte preprocess-gas citation is NOT active at the Topaz ref (B3's budget-from-`-simulate` rule stands — the pilot's measured numbers are ref-accurate — but the per-byte citation is withdrawn); the "RemoveMember breaks member surfaces" phrasing overstated (the genesis bug is real; blast radius = role-quorum math, per the pressure-test).

## 12. BREAKING (2026-07-17 evening) — Aeddi's gnolang/gno#5945: final genesis TONIGHT

Aeddi (gno core lead): required PRs merged, Topaz PR updated, **chain kicks off tonight**, weekend monitoring, Monday announce. Verified from the PR + `gen-genesis.sh` + README:

| Fact | Value | Impact on this plan |
|---|---|---|
| **`CHAIN_ID = topaz-1`** | final on-wire id | **Q1 ANSWERED.** Replace every `TBD-test14-PLACEHOLDER` at P3-prep: networks.toml, config.ts chainId, fly staging. |
| **Base ref `959cefd91`** (master) + deployment folder = new chain/topaz tip | pin moves | **Q12 re-verify (R-9 fired early):** one-line `GNO_REF` bump PR + full CI re-run + census re-lint at the new ref (all #122 machinery reusable). |
| **Genesis = curated 90 pkgs; `p/samcrew` = piechart/tablesort/urlfilter ONLY** — no daokit/basedao/daocond | collision gone | **Q13 FLIPS: the `/v2` rename is unnecessary.** Fork republishes at ORIGINAL paths + `realmid`; memba_dao needs ZERO import changes; gnodaokit#65 → HOLD, strip renames after genesis inspection, keep avl repoint + svg `ntavl` alias (svg IS in genesis, new-avl-typed). §11.8-pre's dep-check false-pass concern also dissolves (no genesis daokit) — dep-check must verify OUR fork instead. Comment posted on #65. |
| **`names.Enable` at block 1** | namespace gate ON from genesis | **`samcrew` prereg must be IN the genesis artifacts → ask Aeddi TONIGHT** (genesis generated from repo `transactions/` dirs; `r/sys/users/init` is in the set). Post-genesis fallback: names-admin authorization or GovDAO (aeddi = sole T1). |
| Valset = `gno-core-val-01/02` (power 60 each), operator-keyed valoper profiles | Samourai not initial | Join post-genesis: `VALIDATOR.md` flow + valoper Register + GovDAO proposal (aeddi approves). Lours executes. |
| 10 faucets × 1e18 ugnot; fee payers exact-burn; **unrestricted transfers** | funding path exists | Q4 partially answered — ask which faucet + operator. |
| GovDAO: aeddi sole T1, `AllowedDAOs` locked to `r/gov/dao/v3/impl` | | katana signer membership goes through Aeddi (Q8 routing). |
| Fresh chain, no replay; genesis 2.7 MB, sha256-locked, reproducible | | Current `"dev"` chain dies tonight — P2 throwaway window CLOSED; P3 prep starts Monday against the real chain. |

**Revised next-session order:** inspect launched genesis (verify #5945 manifest held) → `GNO_REF`/pin bump PR + census re-run at the new tip → strip #65 to avl-repoint-only → deployer: replace placeholder with `topaz-1` + point `[test14]` at the real RPC → memba_dao CI fork-vendoring → A5/B4/B3 → P3 prep.

### 12.1 New-tip delta analysis (`67a0bb333 → fc4052651`, 23 commits — fetched Jul-17 late evening)

Tip = `fc4052651` (master merge `d4de2f46f` @ baseline `959cefd91` + VALIDATOR.md seeds). **The re-verification is NOT a formality** — flagged commits:
- **`24088cf2c fix(grc20)!: decouple token id from symbol (#5908)` — BREAKING.** tokenfactory_v2 + $MEMBA registration use `p/demo/tokens/grc20` + `r/demo/defi/grc20reg`; the id/symbol key semantics change must be diffed against our call sites BEFORE the pin bump (new verification item; the tokenfactory oracle suite is the behavioral net).
- **`412ab1962 (#5892) preprocess-gas metering at AddPackage/Run — RE-ADDED.** It was absent at `67a0bb333` (pressure-test was right for the old ref) but IS in the new tip → **the §11.4 pilot's gas numbers are stale-LOW for the launched chain**; B3 budgeting via `-simulate only` at the NEW ref is mandatory; katana's 20M `gas_wanted` re-check re-opens.
- Semantics fixes to re-census: `68111d9e6` interface-bound method dispatch, `d623488ac` embedded-field BFS lookup, `27b5b8e24` map-delete key reclaim, `c9ad5149f` apd→`big.Rat` (decimal), `9bfc0a4bb` deterministic type-check verdict, `42c8946c7` lazy file blocks (perf), `a876beb06` vesting POC (additive).
**Executed same evening — new-tip verification RESULTS (toolchain built @ `fc4052651`):**
- **Census:** identical to the old ref EXCEPT **`tokenfactory_v2` now BREAKS** — `tokenfactory.gno:100` `grc20.NewToken` call vs the new signature (#5908 adds a dedicated `seqid.ID` id param; "stateful token creators allocate non-reusable IDs"). Every otc_v1/v2 failure is a cascade of importing it (their own code is clean). memba_dao unchanged (Q13); 5 dead v1s unchanged; everything else clean.
- **Oracles:** escrow_v3 ✅ agent_registry_v2 ✅ feed_v2 ✅ avl equivalence ✅ · tokenfactory_v2 ❌ + otc_v2 ❌ — same single root cause (compile, not behavior).
- **Fix shape = "flag-day 2" atomic PR**: `GNO_REF → fc4052651` + tokenfactory_v2 NewToken adaptation (realm-local seqid allocator; preserve OUR duplicate-symbol reject so the oracle pin holds) — the fix can't compile at the old ref, so bump+fix ship together, #122 pattern.

### 12.2 Late-evening execution results

- **#123 OPEN, review-verdict READY** (`feat/topaz-tip-grc20`): tokenfactory adaptation independently proven exact vs upstream canonical pattern (grc20factory); grc20reg `rlmPath.symbol` keying + our realm-layer duplicate-symbol reject verified intact (oracle pin holds regardless of upstream policy); the only test edit (collections grc20 fixture) strictly #5908-format-scoped; ALL oracle suites re-run green at `fc4052651` by the reviewer; CI 4/4. **MERGE GATE: launched topaz-1 `build_version` must confirm `fc4052651` (Monday) — re-pin + re-verify if moved.**
- **#124 MERGED (`dd2b70a`) — WS-B4 ceremony preflights.** Fail-closed AddPackage gates on enforce/production lanes: chain-id echo, names gate (with paused-vs-unauthorized diagnosis), CLA gate (hash anchored to its table row), namereg price probe (warn-only by design), simulate-based funding gate (gas+deposits, ×1.10 headroom, **refuses on missing `TOTAL TX COST`** — review's MEDIUM fixed pre-merge + new 7d test). 57-assertion hermetic suite green under bash 3.2 + 5; non-enforce lanes byte-identical (test13 untouched); r/sys APIs re-verified at the launch tip; MAINNET_READINESS §4 rows annotated. Full gate treatment (FIX-FIRST → fixed → CI green → merged).
- Live RPC went **502 during review — the topaz-1 reset appears to be in progress** (as Aeddi announced).

### 12.4 Jul-18 session-close verification round

- **katana#9 MERGED upstream** (verified via the midday status-audit session + gh) — the P2/P4 dry-run hard blocker is **CLOSED**; katana can rehearse against topaz-1 in dry-run once pointed at it.
- `chain/topaz` tip re-checked: **still `fc4052651`** — #123's pin remains correct; the only outstanding gate is the live `build_version` confirmation (both RPCs still down/maintenance at close: samourai sentry = maintenance page, official = dark).
- **#123 rebased onto post-#124 main** (CHANGELOG adjacency resolved, both entries kept) — merge-ready pending the tip gate.
- Memba repo (other sessions): 0 open PRs, `METRICS_BEARER` now SET in prod.
- Housekeeping: plan §11.8/§12.3 renumbered; scratch worktrees removed post-verification; memory + index refreshed.

### 12.5 🚀 topaz-1 IS LIVE — verified + #123 MERGED (Jul-18 morning)

- **`rpc.topaz.testnets.gno.land` UP**: `network topaz-1`, fresh blocks (launched ~08:50 UTC), moniker `gno-core-rpc-…`. Samourai sentry still on its maintenance page (Lours redeploys with the new genesis — expected).
- **Tip gate satisfied by on-chain fingerprint** (build_version string carries no commit suffix): deployed grc20 has the exact #5908 `NewToken(name, symbol, decimals, id seqid.ID, rlm)` signature; `p/samcrew` = exactly {piechart, tablesort, urlfilter} per the #5945 manifest; `origin/chain/topaz` unchanged at `fc4052651`. → **#123 MERGED (`9b2b22e`)** after rebase onto post-#124 main (CHANGELOG adjacency resolved), CI 4/4, CLEAN, zero comments. **Deployer main is now fully topaz-1-ready**: pin = launched VM, all realms adapted (avl + grc20), oracles green, fail-closed lanes + ceremony preflights live.
- `names.IsEnabled() == true` from block 1 (as documented). **⚠️ BLOCKER CONFIRMED: `IsAuthorizedAddressForNamespace(g1x7k4628…, "samcrew") == false` — the genesis preregistration did NOT land.** No samcrew AddPackage is possible until Aeddi authorizes post-genesis (names-admin path or GovDAO — he's sole T1). The B4 preflight refuses exactly this, as designed. **→ Owner escalation to Aeddi is THE next action; everything engineering-side is done and waiting.**
- Remaining next-session queue (unblocked-by-code, blocked-by-humans): `topaz-1` into the `[test14]` placeholder + real RPC endpoints (once samourai sentry returns), strip gnodaokit#65 to avl-repoint-only, memba_dao CI fork-vendoring, A5 emit sweep, B3 budget sheet vs live params, katana dry-run pointed at topaz-1 (katana#9 is MERGED), gnomonitoring += topaz-1, C1/C2 Memba config (Jul-20 window rules).

### 12.6 Official release confirmation (github.com/gnolang/gno/releases/tag/chain/topaz, published Jul-17 15:42Z)

- **Target commit `fc4052651` — official.** #123's pin is release-confirmed (belt to the fingerprint braces). Baseline `959cefd91` = 133 commits ahead of test13's `f45cc5c88`. Assets: `genesis.json` (sha-verifiable) + binaries.
- Release-notes double-checks vs our register: grc20 #5908 ✓ (adapted, #123), secp256k1-removal #5949 ✓ (D4 Ed25519 check), gas metering #5892 ✓ (B3/B4 simulate), apd→big.Rat #5867 ✓ (census clean), VM-correctness batch ✓ (oracles zero-drift). **NEW line item: #5048 — package name must match the last pkgpath element, enforced AT ADDPKG (not lint)** — the census can't see it; covered per-package by the B4 simulate gate (a simulate IS an addpkg). **Empirically CONFIRMED during the #65 strip: #5048 BLOCKED a `/v2`-suffixed scratch publish** (package `daokit` ≠ path element `v2`) — the original Q13 rename path would have failed at ceremony time unless package clauses were renamed too; the genesis dropping daokit dodged a real landmine. (Upstream's own `/v0` packages must use a carve-out or matching names — either way, versioned-suffix publishes need the simulate gate's proof before any ceremony.)
- "No state carries over — re-register" is the official confirmation of WS-F's data-continuity premise.

### 12.7 Continuation round — #125 MERGED + #65 finalized (Jul-18)

- **#125 MERGED (`f47f31d`)**: `[test14]` is LIVE — `chain_id topaz-1`, official RPC primary, samourai sentry as fallback (maintenance page until Lours redeploys; fail-closes correctly meanwhile), `enforce_fund_safety` retained; `[topaz-dev]` retired to a hermetic test fixture; the PLACEHOLDER guard stays mutation-killable via a synthetic fixture lane. Live acceptance evidence in the PR: dry-run resolves on topaz-1, the ⛔ chokepoint fires on the live lane (`BLOCKED on topaz-1`), and the ceremony preflight refuses at the namespace gate with the Aeddi remediation — the exact state Aeddi's authorization will flip.
- **gnodaokit#65 final form pushed** (`60c4bf0`): /v2 renames fully stripped (7 files, +10/−9 — avl repoint + svg `ntavl` alias only; alias necessity re-proven by live qfile + negative compile). Merge remains owner/David-gated on the CI-retool question. Bonus: #5048 empirically blocked a `/v2`-suffixed scratch publish — the abandoned rename path was a hidden ceremony landmine.
- **Deployer state: 7 PRs merged this program (#119-#125). The repo is ceremony-ready for topaz-1** — the ONLY blockers are human: (1) Aeddi authorizes `samcrew` for `g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0` (names-admin or GovDAO), (2) funding from a genesis faucet, (3) Lours's sentry + valset entry. After (1)+(2): run the ceremony per WS-E with the B4 preflight green as the go signal.

### 12.8 SESSION CLOSE (Jul-20) — **ALL THREE BLOCKERS CLOSED, live-verified. CEREMONY IS GO.**

Aeddi (Jul-19 night): Topaz running with full endpoints; **namespaces created for aib/akkadia/gnoswap/samcrew + funds sent**. Verified live this morning against `rpc.topaz.testnets.gno.land`:
- `IsAuthorizedAddressForNamespace(g1x7k4628…, "samcrew")` → **`true`** ✅ (blocker 1 CLOSED)
- Deploy 2-of-2 balance → **10,000 GNOT** ✅ (blocker 2 CLOSED; ceremony sims estimated low-hundreds incl. deposits)
- Official endpoints all 200: gnoweb `topaz.testnets.gno.land` · RPC · gnockpit · status · **tx-indexer `indexer.topaz.testnets.gno.land/graphql`** (→ WS-C5's indexer URL exists now) — record them in config.ts `VITE_TEST14_*` and gnomonitoring `graphqls`/`gnowebs`.
- **Samourai sentry BACK on topaz-1** (`rpc.topaz.samourai.live`, height ~53.9k, synced) ✅ (blocker 3's RPC leg closed; valset entry still pending Lours). Optional deployer follow-up: swap `[test14]` primary/fallback if the sentry is preferred.
- **katana#9 MERGED by Lours** (dry-run rails upstream) — P2/P4 katana prerequisite in place.
- Remaining outside our control: faucet-hub PR gnolang/faucet-hub#81 (public faucet for end-users; NOT a ceremony blocker).

**NEXT SESSION OPENS WITH (in order):** (1) `REALM=<first-package> ./samcrew-deploy.sh test14 …` B4 preflight — expect ALL GATES GREEN now (names ✓ CLA-dark ✓ funding ✓); (2) owner-attended WS-E ceremony per §WS-E order (avl+pager+rotree → realmid → daocond/daokit/basedao [original paths, per stripped #65 — merge it first or deploy from its branch, owner decides with David] → grc721 → collections → … per §11.3 order); (3) post-deploy smoke + solvency + treasury repoint; (4) Memba app config C1/C2 with the now-known endpoint URLs; (5) gnomonitoring += topaz-1; (6) katana config vs the live chain (dry-run first, D2/D3 rails). Jul-20 is ICO-flag day on Memba prod — keep frontend merges hardened per §4.

### 12.3 Mid-day session snapshot (written before the §12 events; kept for the record — §12/§12.2 supersede its "next steps")

**Merged today (all 6-gate):** deployer #119 (oracles) → #120 (networks+gate) → #121 (vendored avl) → #122 (**atomic flag-day** — deployer CI now gates at `67a0bb333`; both-refs oracle gate closed, zero drift; 35/41 realms compile at the Topaz VM, only memba_dao left = Q13 scope). **Open:** gnodaokit#65 (review in flight; CI-red question), katana#9 draft (Lours). **Human critical path unchanged:** §7.1 asks → Aeddi (chain-id/resets/`samcrew` prereg/official infra/Adena) + Lours (valset entry/Ed25519/second RPC/katana). **Next session starts with:** #65 disposition → memba_dao follow-up PR → A5 → B4 → B3 → P1b. Toolchain worktrees (`gno-topaz`, `gno-preavl`) live in the session scratchpad — rebuild from refs if GC'd; `git -C gno worktree prune` afterwards. Ops note: the enforce-git-rules hook checks the *session cwd's* branch, which false-positives for commits made in worktrees of OTHER repos — worked around legitimately (isolated-cwd subagent); consider teaching the hook to resolve the worktree of the `git -C` target instead.

---

## 11. P0 execution log (started 2026-07-17, same day — "go" received)

**Owner role correction folded:** Aeddi = gno core lead (official chain asks); Lours = samourai validators infra. §7 routed, §7.1 drafts ready.

### 11.1 Empirical compile census — DONE (gno lint @ `67a0bb333`, all 41 realms vendored into the Topaz worktree's examples tree, production files only)

**Result: the Option-A avl vendoring alone makes the entire non-DAO deploy set compile-clean under the Topaz VM.** Every active deploy-set realm shows **avl `Get`-arity errors ONLY** (`other=0`): collections 1 · nft_market_v3_2 1 · market_config 1 · nft_v2 1 · grc721 9 · tokenfactory_v2 3 · escrow_v3 2 · agent_registry_v2 22 · otc_v2 1 · candidature_v3 10 · channels_v2 33 · feed_v1 16 · feed_v2 16 · points_v1 4 · appstore_v3 9 · reviews_core_v1 7 · arcade_leaderboard_v1 13 · quest_attestation_v1 4 · blog_v1 8 · feedback_v2 33.

**`memba_dao` is the sole non-avl breaker (14 errors, avl=0)** — all genesis-daokit ABI drift, matching the CTO protocol review exactly, plus a 4th drift class: `basedao.RoleInfo` has no `Color` field in genesis. (Errors observed: `Config.SetImplemFn`/`PrivateVarName` unknown, `basedao.New` single-return, `Execute(pid, cur)` signature, `DAO.Render` missing, `RoleInfo.Color` ×4.)

**Interrealm-era classes exist ONLY in the 5 dead v1 realms** (`escrow`, `nft_market`, `memba_dao_candidature`, `memba_dao_channels`, `gnobuilders_badges`: 49× `runtime.PreviousRealm/CurrentRealm/OriginCaller` undefined, 11× 1-arg `NewBanker`, 4× `banker.OriginSend` undefined) — none ship, so §1.3's non-delta claims hold **for the deploy set**. Artifacts: scratchpad `lint_inventory_run1/` + toolchain (`gnoland`/`gnokey`/`gnoweb`/`gno`) built at the ref.

### 11.2 A7 OriginSend sweep refresh — DONE (verified at deployer `67bfa33`)

41 realms fully partitioned: **11 guarded** (the 9 + NEW `memba_appstore_v3` [`appstore.gno:173`/guard `:160`] + NEW `memba_nft_market_v3_2` [`market.gno:294`/`:281`, `offers.gno:50`/`:46` — pooled offer escrow]) · **7 unguarded** (unchanged, zero `IsUserCall` anywhere in them) · **23 non-fund** (incl. NEW feed_v2, blog_v1, arcade_leaderboard_v1, points_v1 + migrations; plus pre-existing doc omission `memba_dao_channels` v1). Delta since `c81c913` is purely additive (61 files, +9411/−0) — the SSOT's existing line numbers remain exact. Weak-pattern checks all clean (no `IsUser()`, no guard-after-read, all 52 `NewBanker` sites are `RealmSend`). **feed_v2 = NON-FUND** (no banker import; passes the gate trivially).
SSOT updates queued for the A8 PR: ✅ 9→11; ⛔ `nft_market` supersession → v3_2; non-fund list → 23; evidence line → `67bfa33`.

### 11.3 Q13 daokit ABI matrix spike — DONE (genesis fetched in full off-chain; fork pr-64; memba_dao.gno)

**Recommendation: fork-rename (Path B), decisively.** Key evidence: (i) genesis daokit/basedao is a frozen Authority-pattern refactor that self-labels **"EXPERIMENTAL / INSECURE / INCOMPLETE — fork and harden"**; (ii) genesis `MembersStore.RemoveMember` has a live bug (`Remove(role.Name)` instead of `Remove(member)`) → role-quorum corruption, permanently unfixable in immutable `/p`; our fork has the fix; (iii) genesis deletes what Memba actually uses: `SetImplemFn` self-upgrade, `members`/`proposals`/`role/{name}` render routes (consumed by backend `verifyJoinDAO` and the frontend members parser), extensions, `RoleInfo.Color`; (iv) `daocond` is API-identical both sides. Path A honest cost: ~90 LOC of new safety-critical upgrade-handler code + full test rewrite + cross-repo member-surface re-verification + standing role-quorum landmine. Path B cost: ~28 mechanical import/gnomod line edits in the fork (`/v2` suffix — pattern already scripted, `deploy.sh:52-59`), `realmid` publish (free on Topaz, RPC-verified absent), and **3 import lines in memba_dao.gno:22-24** — test13-proven behavior carries over bit-identical. Fork's own avl exposure: 19 two-value call sites + **2 `pager.NewPager` sites → vendored avl must include `/pager`** (spec amendment queued). Publish order: `avl(+pager) → realmid → daocond/v2 → daokit/v2 → basedao/v2 → memba_dao`. Full symbol-by-symbol matrix preserved in the session log; attach to the Q13 ask.

### 11.4 Local-devnet Option-A pilot — DONE, **mechanics validated end-to-end**

gnoland @ `67a0bb333` (needs `-skip-genesis-sig-verification` — one of the 3 topaz-branch commits), local VM storage params **identical to live Topaz** (100ugnot/B, 600 GNOT default cap) so all numbers transfer 1:1.
- **Vendored avl** (root module from `f3d5a5d13`, zero edits) lints clean under the Topaz VM incl. its own tests — the old source survives the A6 strictenings unmodified. Subpackages at that ref: `pager`, `rotree` (no `list`); tokenfactory_v2 will need pager+rotree, memba_dao fork needs pager (§11.3).
- **Pilot repoints lint clean with zero non-avl residue**: `p/samcrew/grc721` (note: the fork is a **`p/` package**, not `r/`) + `r/samcrew/memba_collections`; 4 plain un-aliased import lines changed.
- **AddPackage rehearsal** (publish order held; empty `max_deposit` = our builders' default, worked under the 600 GNOT cap): avl 6.09M gas / 0.46 GNOT locked · grc721 12.9M gas / 3.55 GNOT · collections 27.8M gas / **8.85 GNOT locked** (88,450 B state delta on a 39,626 B source — 2.23×). Pilot total locked: **12.85 GNOT for 3 packages** → the full ~30-realm ceremony plausibly locks a low-hundreds-of-GNOT order; fund per §B3's simulate-based sheet.
- **User-tx deposit datum (B9 fee-UX):** one `CreateCollection` locked **1.16 GNOT** of the caller's balance (11,598 B delta) + the realm's own 1 GNOT createFee. Deposit UX disclosure is mandatory, not cosmetic.
- Smoke green: qrender + qeval on the live realm; two-value `avl.Get` proven at runtime on hit and miss paths.
- Re-confirmations: names/CLA gates dark on dev genesis too (P2 ≠ P3 authorization proof); failed under-gassed AddPackage burns fee but locks no deposit; `-lazy` dev genesis lacks genesis-*builder* packages (basedao/daokit…) — a memba_dao devnet rehearsal must vendor them into examples first.
Artifacts in scratchpad: `vendored-avl/`, `pilot/`, `devnet/` logs, `gnokey-home/`.

### 11.5 katana safety rails — DONE, DRAFT PR open for Lours

**https://github.com/samouraiworld/katana/pull/9** (`feat/operational-safety-rails`, 3 TDD'd commits, full suite + `-race` green, re-verified independently; CI pending at submission). Delivers the three P2/P4 prerequisites: (1) per-chain `dry_run` — full pipeline, logs `[DRY-RUN]` + labeled notification, records a `dry-run` status row invisible to the real lifecycle gate (can never block a later real proposal), deduped via the existing cooldown gate; (2) fail-start when any broadcast-capable chain runs `storage.driver: none` (dry-run-only downgrades to a warning); (3) chain-id assert (`/status.network` vs configured id) at every eval cycle + before broadcast — fail-closed, clean skip on genesis reset. README + config.yaml.example updated; prd.md D9 amended in place.
**Review caveats for Lours (in the PR):** dry-run re-fire interval reuses `proposal.cooldown` (default 30d — lower it on the rehearsal chain or ask for a dedicated knob); `/status` now on the cycle hot path (fail-closed ⇒ liveness depends on the sentry, consistent with D6); dry-run rows are audit-visible in `ListProposals`. Note: katana's default branch is `master`.

### 11.6 A6 custody oracles (pre-avl leg) — DONE & **MERGED: samcrew-deployer #119** (`c5d7fef`)

4 oracle suites, 1,339 lines, 32 tests, all green at `f3d5a5d13` and wired into gating CI legs: **escrow_v3** (all 9 fund-mover rows: release 2%-fee split, cancel 5%-to-freelancer, dispute both ways, timeout claims, double-pay blocks; the v3 pause-gap pinned GREEN as `*_V3PauseGapPinned` — must FLIP for escrow_v4, matrix gate #3) · **agent_registry_v2** (ledger + 50-depositor refund loop + GNO1-2 nil-vs-zero controls) · **tokenfactory_v2** (first tests ever: applyFee mint split, faucet stored-height-0 boundary 700/721, supply deltas) · **memba_token_otc_v2** (`Fill` settlement first-ever exercise: partial/full, 50 bps token-lane fee with drift tripwire, OTC-002 fund-safe revert). Merge ran the full 6-gate treatment: fresh reviewer traced every pinned value to source AND mutation-tested the harness (wrong values genuinely fail; simulated v4 pause fix flips the gap tests RED); review nits (stale comments) fixed pre-merge; CI 4/4 on final commit; base unmoved; zero owner comments. Out of scope, tracked: vendored-avl equivalence/fuzz suite (needs A1's package), structural presence auto-enroll (spec §6 row 5), all escrow_v4 rows (realm not yet authored). **P1a's "oracle lane green" precondition is now satisfied for the pre-avl leg.**
