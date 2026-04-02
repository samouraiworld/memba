# Memba On-Chain Contracts (Reference Copies)

These directories contain **reference copies** of the Gno realm code deployed on-chain for MembaDAO.

## Source of Truth

The canonical source for all deployed realm code is the **samcrew-deployer** repository:

```
samcrew-deployer/projects/memba/realms/
├── memba_dao/                    → gno.land/r/samcrew/memba_dao
├── memba_dao_candidature/        → gno.land/r/samcrew/memba_dao_candidature
└── memba_dao_channels/           → gno.land/r/samcrew/memba_dao_channels
```

## Deployment Status (test12)

| Realm | Path | Status |
|-------|------|--------|
| MembaDAO | `gno.land/r/samcrew/memba_dao` | Deployed 2026-03-29 |
| Candidature | `gno.land/r/samcrew/memba_dao_candidature` | Deployed 2026-03-29 |
| Channels | `gno.land/r/samcrew/memba_dao_channels` | Deployed 2026-03-29 |
| Escrow | `gno.land/r/samcrew/escrow_stub` | Not deployed |

## Deployment Method

All realms are deployed via 2-of-2 multisig using `samcrew-deployer`:

```bash
DEPLOY_KEY=samcrew-core-test1 MULTISIG_SIGNERS=zooma,adena-zxxma \
  ./samcrew-deploy.sh test12 memba
```

## Escrow Stub

The `escrow_stub/` directory contains a minimal placeholder that has NOT been deployed.
It is part of the Freelance Services feature (gated behind `VITE_ENABLE_SERVICES`).
