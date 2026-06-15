# Memba `contracts/` — template stubs for CI only

> ⚠️ **These `.gno` files are STUBS for template/local CI only. They are NEVER deployed.**
> The canonical, deployed realm source is the **samcrew-deployer** repository. The deployed
> on-chain state (paths, blocks, txHashes, ACL status) is tracked in
> [`/realm-versions.json`](../realm-versions.json), which is **verified against the live chain**
> (not from prose — see `docs/planning/MEMBA_AAA_IMPLEMENTATION_PLAN.md` §3.1 / G5).

These directories exist so the template/test tooling (`gno-test.yml`, `scripts/extract-contracts.ts`)
has something to run against. Do **not** treat them as the source of what is live on-chain.

## Stub directories present here

```
contracts/
├── memba_dao_stub/          → stub for gno.land/r/samcrew/memba_dao
├── memba_candidature_stub/  → stub for gno.land/r/samcrew/memba_dao_candidature_v2
├── memba_channels_stub/     → stub for gno.land/r/samcrew/memba_dao_channels_v2
└── escrow_stub/             → stub for gno.land/r/samcrew/escrow
```

(Other deployed realms — `agent_registry`, `nft_market`, `gnobuilders_badges`, `tokenfactory` —
have no stub here; their canonical source lives in samcrew-deployer.)

## Source of truth

The canonical, deployed realm code lives in the **samcrew-deployer** repo:

```
samcrew-deployer/projects/memba/realms/
```

All realms are deployed via 2-of-2 multisig using `samcrew-deployer`:

```bash
DEPLOY_KEY=samcrew-core-test1 MULTISIG_SIGNERS=zooma,adena-zxxma \
  ./samcrew-deploy.sh test12 memba
```

## Deployed state

See [`/realm-versions.json`](../realm-versions.json) — the chain-verified ledger of what is actually
deployed per network (paths, blocks, full txHashes, and ACL notes derived from live `vm/qfile`).
