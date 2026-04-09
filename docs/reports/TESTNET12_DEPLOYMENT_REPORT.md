# Memba On-Chain Deployment Report — test12

> **Date:** 2026-04-09
> **Author:** Samourai.world (samcrew)
> **For:** Gno Core Engineering Team
> **Chain:** test12 (gno testnet)

---

## 1. Chain Context

| Field | Value |
|-------|-------|
| Network | test12 |
| Node | samourai-crew-sentry (v1.0.0-rc.0) |
| Block at report | 239,734 |
| Deployer | samcrew-core-test1 (2-of-2 multisig) |
| Address | `g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0` |
| Account # | 237 |
| Sequence | 61 |
| Balance | 9,999,222,134,800 ugnot (~9,999 GNOT) |

---

## 2. Deployment Transaction History

All TXs used: `gas_fee=10,000,000 ugnot`, `gas_wanted=150,000,000`, `deposit=100,000,000 ugnot` (100 GNOT per realm).

| TX | Date | Artifact | Block | Gas Used | Storage Delta | TX Cost | TX Hash |
|----|------|----------|-------|----------|---------------|---------|---------|
| 1 | 2026-03-29 | `r/samcrew/memba_dao` | 150,069 | 45,276,891 | 113,089 B | 21.3 GNOT | `9TqViv0c...` |
| 2 | 2026-03-29 | `r/samcrew/memba_dao_candidature` | 150,813 | 24,851,988 | 13,452 B | 11.3 GNOT | `VRx52/7J...` |
| 3 | 2026-03-29 | `r/samcrew/memba_dao_channels` | 150,815 | 29,035,496 | 62,566 B | 16.3 GNOT | `0r3olENT...` |
| 4 | 2026-04-03 | `r/samcrew/agent_registry` | 231,189 | 25,220,429 | 23,026 B | 12.3 GNOT | `pfTol4PB...` |
| 5 | 2026-04-03 | `r/samcrew/escrow` | 232,733 | 25,369,443 | 21,412 B | 12.1 GNOT | `gAJ87Cbi...` |
| 6 | 2026-04-09 | `r/samcrew/nft_market` | ~237,929 | (timeout) | ~20,000 B | ~14 GNOT | (RPC timeout, TX landed) |
| 7 | 2026-04-09 | `r/samcrew/gnobuilders_badges` | 237,936 | 16,433,463 | 38,180 B | 13.8 GNOT | `9ViPkv5L...` |
| 8 | 2026-04-09 | `r/samcrew/memba_dao_candidature_v2` | 237,938 | 16,786,757 | 23,003 B | 12.3 GNOT | `UBuoMqUe...` |
| 9 | 2026-04-09 | `r/samcrew/memba_dao_channels_v2` | 237,939 | 21,154,040 | 76,640 B | 17.7 GNOT | `FVK+yC9z...` |

### Totals (8 measured TXs)

| Metric | Value |
|--------|-------|
| Gas used | 204,128,467 |
| Storage delta | 371,368 bytes |
| Total TX costs | ~131 GNOT (gas + storage fees, excluding deposits) |
| Gas efficiency | 13.6% avg (gas_used / gas_wanted) |
| Avg gas per realm | 25,516,058 |
| Avg cost per realm | ~14.6 GNOT |

---

## 3. Artifact Inventory

### Packages (4)

| Path | Source Size | Files | Key Imports |
|------|-----------|-------|-------------|
| `p/samcrew/realmid` | 2,065 B | 3 | stdlib only |
| `p/samcrew/basedao` | 72,040 B | 18 | `p/nt/avl`, `p/nt/ufmt`, `p/nt/mux` |
| `p/samcrew/daocond` | 39,278 B | 12 | `p/nt/avl`, `p/nt/ufmt` |
| `p/samcrew/daokit` | 18,400 B | 8 | `p/nt/avl`, `p/nt/ufmt` |

### Realms (10)

| Path | Source | Files | Lines | Render() | Status |
|------|--------|-------|-------|----------|--------|
| `r/samcrew/memba_dao` | 6,233 B | 3 | 191 | 384 B | ACTIVE — DAO governance |
| `r/samcrew/tokenfactory` | 22,176 B | 4 | 750 | 173 B | ACTIVE — GRC20 token factory |
| `r/samcrew/memba_dao_candidature` | 9,751 B | 3 | 358 | 108 B | DEPRECATED — no ACL |
| `r/samcrew/memba_dao_channels` | 18,594 B | 3 | 694 | 402 B | DEPRECATED — no ACL |
| `r/samcrew/agent_registry` | 16,779 B | 3 | 671 | 362 B | ACTIVE — AI agent marketplace |
| `r/samcrew/escrow` | 26,478 B | 3 | 971 | 95 B | ACTIVE — milestone escrow |
| `r/samcrew/nft_market` | 19,776 B | 3 | 737 | 65 B | ACTIVE — NFT marketplace |
| `r/samcrew/gnobuilders_badges` | 20,835 B | 3 | 808 | 249 B | ACTIVE — GRC721 badge NFTs |
| `r/samcrew/memba_dao_candidature_v2` | 20,419 B | 3 | 734 | 176 B | ACTIVE — ACL-fixed candidature |
| `r/samcrew/memba_dao_channels_v2` | 31,517 B | 3 | 1,162 | 472 B | ACTIVE — ACL-fixed channels |

### Dependencies (1 deployed)

| Path | Size | Notes |
|------|------|-------|
| `r/samcrew/_deps/demo/profile` | 5,996 B | Mirrored stdlib (required by basedao) |

### Totals

| Metric | Value |
|--------|-------|
| Total source code | 330,337 bytes (330 KB) |
| Total files on-chain | 73 |
| Total source lines | ~7,076 |
| Active realms | 8 |
| Deprecated realms | 2 |

---

## 4. Dependency Graph

```
chain/runtime, chain/banker, strconv, strings  (stdlib — always available)
│
├── p/nt/avl/v0          ← ALL realms + packages
├── p/nt/ufmt/v0         ← ALL realms + packages
├── p/nt/mux/v0          ← tokenfactory only
├── p/nt/ownable/v0      ← tokenfactory only
├── p/nt/testutils/v0    ← v2 realm tests only
│
├── p/samcrew/realmid    ← basedao internal
├── p/samcrew/basedao    ← memba_dao only
├── p/samcrew/daocond    ← memba_dao only
├── p/samcrew/daokit     ← memba_dao only
│
├── r/samcrew/memba_dao  ← uses basedao + daocond + daokit + profile
│
├── r/samcrew/candidature_v2  ← standalone (avl + ufmt only)
├── r/samcrew/channels_v2     ← standalone (avl + ufmt only)
├── r/samcrew/agent_registry  ← standalone (avl + ufmt only)
├── r/samcrew/escrow          ← standalone (avl + ufmt only)
├── r/samcrew/nft_market      ← standalone (avl + ufmt only)
├── r/samcrew/gnobuilders_badges ← standalone (avl + ufmt + testutils)
└── r/samcrew/tokenfactory    ← uses grc20, avl, ownable, mux
```

**Key observation:** 8 of 10 realms are standalone — they depend only on `p/nt/avl` and `p/nt/ufmt`. Only `memba_dao` uses the gnodaokit stack. This is intentional: standalone realms are simpler to deploy, test, and reason about.

---

## 5. GnoVM Patterns Used

### Runtime APIs

| Pattern | Usage | Notes |
|---------|-------|-------|
| `cur realm` (crossing) | ALL realm functions | New GnoVM crossing model |
| `runtime.OriginCaller()` | Owner init (pkg-level var) | v2 realms use this for deployer address |
| `runtime.PreviousRealm()` | ACL checks | Address-based caller verification |
| `runtime.ChainHeight()` | Timestamps | Block height as timestamp source |
| `runtime.CurrentRealm()` | Realm self-address | Used in banker operations |
| `banker.BankerTypeRealmSend` | Send coins | Deposit refunds, payment flows |
| `banker.OriginSend()` | Receive coins | Deposit verification |
| `avl.Tree` | ALL state storage | Primary key-value storage primitive |
| `Render(path string) string` | ALL realms | gnoweb-compatible markdown output |

### Security Patterns

| Pattern | Realm(s) | Description |
|---------|----------|-------------|
| `assertCallerIsAdmin()` | candidature_v2 | `PreviousRealm().Address()` vs admin avl.Tree |
| `assertCallerIsOwner()` | candidature_v2, channels_v2, badges | `PreviousRealm().Address()` == owner |
| `assertCallerHasWriteAccess()` | channels_v2 | Membership + role vs channel WriteRoles |
| `assertCallerIsMember()` | channels_v2 | Checks membership avl.Tree |
| `assertCallerIsAdminRole()` | channels_v2 | Checks `hasRole(caller, "admin")` |
| CEI ordering | candidature, escrow, nft_market | State mutation before `banker.SendCoins` |
| Anti-spam deposits | candidature_v2 | 10x escalating deposit per re-application |
| Soulbound tokens | gnobuilders_badges | `TransferFrom` panics if `badge.Soulbound == true` |

---

## 6. Storage Analysis

| Realm | Source Size | Storage Delta | Expansion Ratio | Notes |
|-------|-----------|---------------|-----------------|-------|
| memba_dao | 6.2 KB | 113.1 KB | **18.2x** | gnodaokit expansion (basedao+daocond+daokit+profile) |
| candidature (v1) | 9.8 KB | 13.5 KB | 1.4x | Small, standalone |
| channels (v1) | 18.6 KB | 62.6 KB | 3.4x | 6 default channels init'd in `init()` |
| agent_registry | 16.8 KB | 23.0 KB | 1.4x | Standalone |
| escrow | 26.5 KB | 21.4 KB | 0.8x | Standalone, minimal init state |
| nft_market | 19.8 KB | ~20.0 KB | ~1.0x | Standalone (estimate) |
| gnobuilders_badges | 20.8 KB | 38.2 KB | 1.8x | Standalone |
| candidature_v2 | 20.4 KB | 23.0 KB | 1.1x | v2 with ACL + admin management |
| channels_v2 | 31.5 KB | 76.6 KB | 2.4x | v2 with membership system + 6 channels |

### Observations

- **Standalone realms** (avl + ufmt only): 0.8x-3.4x storage expansion
- **gnodaokit-dependent realms**: 18.2x expansion due to deep import chain
- **Channels realms** have higher expansion (~2.4-3.4x) because `init()` creates 6 default channels with role arrays — each channel creates multiple avl.Tree entries
- **Escrow** has the lowest expansion (0.8x) — source includes tests that aren't stored, and init() creates only empty avl.Trees

---

## 7. Versioning & Immutability

### v1 to v2 Migration

| Aspect | v1 (March 2026) | v2 (April 2026) |
|--------|-----------------|-----------------|
| **Candidature ACL** | ZERO — anyone can MarkApproved/MarkRejected | Admin allowlist with `assertCallerIsAdmin()` |
| **Channels ACL** | ZERO — anyone can post/moderate | Full membership + role system |
| **Owner init** | `runtime.PreviousRealm().Address()` in init() | `runtime.OriginCaller()` at pkg-level var |
| **Path** | `r/samcrew/memba_dao_candidature` | `r/samcrew/memba_dao_candidature_v2` |
| **Cost of bug** | 2 permanent realm paths occupied | +30 GNOT for redeployment |

### Lesson Learned

On Gno, deployed code is permanent and immutable. ACL should be the **first** thing implemented, not bolted on after deployment. The v1 to v2 migration cost:
- 2 additional realm deployments (~30 GNOT in gas + storage)
- 2 permanently occupied paths that can never be reused
- Frontend migration to update all path references
- Test suite updates for the new crossing model

---

## 8. Gas Correlation Analysis

| Realm | Source (bytes) | Gas Used | Gas per KB Source | Storage Delta | Gas per KB Storage |
|-------|---------------|----------|-------------------|---------------|--------------------|
| memba_dao | 6,233 | 45,276,891 | 7,265,000 | 113,089 | 400,000 |
| candidature v1 | 9,751 | 24,851,988 | 2,549,000 | 13,452 | 1,847,000 |
| channels v1 | 18,594 | 29,035,496 | 1,562,000 | 62,566 | 464,000 |
| agent_registry | 16,779 | 25,220,429 | 1,503,000 | 23,026 | 1,095,000 |
| escrow | 26,478 | 25,369,443 | 958,000 | 21,412 | 1,185,000 |
| badges | 20,835 | 16,433,463 | 789,000 | 38,180 | 430,000 |
| candidature v2 | 20,419 | 16,786,757 | 822,000 | 23,003 | 730,000 |
| channels v2 | 31,517 | 21,154,040 | 671,000 | 76,640 | 276,000 |

### Observations

- **memba_dao** has 7.3M gas/KB source — 5-10x higher than standalone realms. The deep gnodaokit import chain (basedao: 72KB, daocond: 39KB, daokit: 18KB) causes significant type-checking and compilation overhead
- **Standalone realms** average ~1.0M gas/KB source — much more predictable
- **v2 realms** (badges, candidature_v2, channels_v2) use notably less gas per KB than v1 equivalents, suggesting GnoVM optimizations between March and April 2026 chain builds
- **Gas per KB storage** varies widely (276K-1.8M) — `init()` state initialization is the primary driver

---

## 9. Open Questions for Gno Core

### Q1: `runtime.OriginCaller()` in test context

`runtime.OriginCaller()` returns empty (`""`) during both package-level variable initialization and `init()` in the GnoVM test runner. This forced us to:
- Use `testing.SetOriginCaller()` + `testutils.TestAddress()` in a test-file `init()`
- Manually patch the `owner` variable and admin/member trees after the realm's `init()` runs

Is this behavior intentional? If so, is there a recommended pattern for testing realms that set ownership during initialization?

### Q2: Panics from crossed function calls

Panics from `cross`-ed function calls (functions with `cur realm` parameter called via `cross`) cannot be caught by `defer/recover` in the calling test function. This makes it impossible to write unit tests that verify panic behavior (e.g., ACL rejections, not-found errors) through the public API.

We restructured tests to verify data structures directly instead of testing the full call path. Is there a recommended pattern for testing panicked realm functions in unit tests?

### Q3: Gas estimation

Gas efficiency is ~13.6% (`gas_used / gas_wanted`). We allocate 150M gas_wanted as a safe ceiling, but actual usage is 16-45M. Is there a way to simulate or estimate gas before broadcast? A pre-flight `simulate_tx` RPC would allow tighter gas allocation.

### Q4: Storage expansion with deep imports

`memba_dao` has 18.2x storage expansion (6KB source → 113KB storage delta) because it imports the gnodaokit package stack (basedao: 72KB, daocond: 39KB, daokit: 18KB, profile: 6KB = ~135KB compiled dependencies). All standalone realms have 0.8-3.4x expansion.

Is the dependency storage allocated per-realm (each importing realm pays for the full dependency tree)? Or is it shared across realms that import the same packages?

### Q5: `broadcast_tx_commit` timeout

The `nft_market` deployment (TX 6) timed out on `broadcast_tx_commit` but the transaction was successfully included in the next block. The default timeout appears to be ~10 seconds, which is tight for `MsgAddPkg` transactions on a ~5-6 second block time chain.

Is there a recommended timeout configuration? Would `broadcast_tx_async` + polling be more reliable for deployment scripts?

---

## 10. Deployment Infrastructure

### samcrew-deployer

The deployment pipeline (`samcrew-deployer`) provides:
- **Multisig support**: 2-of-2 signing with local key caching
- **Idempotent deploys**: `is_deployed` check skips already-deployed realms
- **Retry with fallback RPC**: 3 attempts with configurable fallback endpoint
- **Sequence management**: Auto-re-query on broadcast failure
- **Dry-run mode**: Full TX plan preview without broadcasting
- **Post-deploy verification**: ABCI `qrender` check for each deployed realm

### Key Configuration (test12)

```toml
[test12]
chain_id = "test12"
rpc = "https://rpc.testnet12.samourai.live:443"
gas_fee = "10000000ugnot"
gas_wanted = "150000000"
deposit = "100000000ugnot"
```

---

*Report generated from live on-chain ABCI queries and deployment logs.*
*Source: samcrew-deployer commit fe4b193, Memba v4.2 (PR #288-#291)*
