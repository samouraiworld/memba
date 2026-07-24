# Memba `contracts/` — non-deployed realm sources only

> ⚠️ **Nothing in this directory is deployed.** The canonical, deployed realm source is
> the **samcrew-deployer** repository. The deployed on-chain state (paths, blocks,
> txHashes, ACL status) is tracked in [`/realm-versions.json`](../realm-versions.json),
> which is **verified against the live chain** (not from prose — see
> `docs/planning/MEMBA_AAA_IMPLEMENTATION_PLAN.md` §3.1 / G5).

## Template validation moved (W1.2)

The hand-written `*_stub` realms and `scripts/extract-contracts.ts` are **gone**: they
never exercised the real generators, so the "Gno Test & Lint" CI check was validating
fakes. The authoritative gate is now `frontend/src/lib/templates.compile.test.ts`
(run by `.github/workflows/gno-test.yml` with a pinned interrealm-v2 gno and
`REQUIRE_GNO=1`): it lints **real generator output** for every template as **one gno
workspace** (cross-realm imports resolved), with a toolchain probe and a negative
control so it can never silently pass while checking nothing.

## What remains here

```
contracts/
└── memba_nft_offers_v1/   → GATED offers stub (pre-interrealm-v2, not in the realm
                             allowlist, not deployable as-is — kept for reference only)
```

## Source of truth

The canonical, deployed realm code lives in the **samcrew-deployer** repo:

```
samcrew-deployer/projects/memba/realms/
```

All realms are deployed via 2-of-2 multisig using `samcrew-deployer`.

## Deployed state

See [`/realm-versions.json`](../realm-versions.json) — the chain-verified ledger of what is actually
deployed per network (paths, blocks, full txHashes, and ACL notes derived from live `vm/qfile`).

## EVM Contracts (Solidity)

The `evm/` subdirectory contains Solidity contracts for the EVM migration
(Robinhood Chain / Arbitrum Nitro). This is a separate Foundry project with
its own toolchain, dependencies, and test suite.

```
contracts/
├── README.md                    ← this file
├── evm/                         ← Solidity contracts (Foundry project)
│   ├── foundry.toml
│   ├── src/                     ← Contract source
│   ├── test/                    ← Forge tests
│   ├── script/                  ← Deployment scripts
│   └── lib/                     ← Dependencies (OZ v5, forge-std)
└── memba_nft_offers_v1/         ← Legacy Gno stub (reference only)
```

See [`docs/evm-migration/`](../docs/evm-migration/) for architecture, contract specs, and progress tracking.
