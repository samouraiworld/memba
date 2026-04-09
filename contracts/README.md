# Memba On-Chain Contracts (Reference Copies)

These directories contain **reference copies** of the Gno realm code deployed on-chain for MembaDAO.

## Source of Truth

The canonical source for all deployed realm code is the **samcrew-deployer** repository:

```
samcrew-deployer/projects/memba/realms/
├── memba_dao/                    → gno.land/r/samcrew/memba_dao
├── memba_dao_candidature/        → DEPRECATED (no ACL — issue #2)
├── memba_dao_candidature_v2/     → gno.land/r/samcrew/memba_dao_candidature_v2
├── memba_dao_channels/           → DEPRECATED (no ACL — issue #3)
├── memba_dao_channels_v2/        → gno.land/r/samcrew/memba_dao_channels_v2
├── nft_market/                   → gno.land/r/samcrew/nft_market
└── gnobuilders_badges/           → gno.land/r/samcrew/gnobuilders_badges
```

## Deployment Status (test12)

| Realm | Path | Status |
|-------|------|--------|
| MembaDAO | `gno.land/r/samcrew/memba_dao` | Deployed 2026-03-29 |
| Candidature v1 | `gno.land/r/samcrew/memba_dao_candidature` | DEPRECATED — no ACL |
| Candidature v2 | `gno.land/r/samcrew/memba_dao_candidature_v2` | Deployed 2026-04-09 (security fix) |
| Channels v1 | `gno.land/r/samcrew/memba_dao_channels` | DEPRECATED — no ACL |
| Channels v2 | `gno.land/r/samcrew/memba_dao_channels_v2` | Deployed 2026-04-09 (security fix) |
| Agent Registry | `gno.land/r/samcrew/agent_registry` | Deployed 2026-04-03 |
| Escrow | `gno.land/r/samcrew/escrow` | Deployed 2026-04-03 |
| NFT Market | `gno.land/r/samcrew/nft_market` | Deployed 2026-04-09 |
| GnoBuilders Badges | `gno.land/r/samcrew/gnobuilders_badges` | Deployed 2026-04-09 |

## Deployment Method

All realms are deployed via 2-of-2 multisig using `samcrew-deployer`:

```bash
DEPLOY_KEY=samcrew-core-test1 MULTISIG_SIGNERS=zooma,adena-zxxma \
  ./samcrew-deploy.sh test12 memba
```

## Agent Registry

The `agent_registry/` directory contains the AI Agent Marketplace realm.
Agents self-register with MCP metadata (endpoint, transport, pricing).
Reviews and a pay-per-use credit system are on-chain.
Part of the Marketplace feature (gated behind `VITE_ENABLE_MARKETPLACE`).

## Escrow

The `escrow/` directory contains the milestone-based escrow realm for freelance services.
Supports contract creation, milestone funding, completion, release, disputes,
auto-refund timeouts, and dispute timeout auto-resolution.
Part of the Freelance Services feature (gated behind `VITE_ENABLE_SERVICES`).

## Escrow Stub (deprecated)

The `escrow_stub/` directory contains the original minimal placeholder. Superseded by `escrow/`.
