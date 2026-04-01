# Memba — On-Chain Deployment Runbook

> **Status:** BRIEF — Detailed procedure to be built in next session.
> **Last updated:** 2026-04-01 (v2.27.0 audit)

## Purpose

This document tracks all Memba on-chain realm deployments and provides a reproducible,
ordered procedure for deploying the full Memba stack to any Gno network.

## Realm Inventory

| # | Realm | Module Path | test12 | gnoland1 | Source |
|---|-------|-------------|--------|----------|--------|
| 1 | **gnodaokit** (4 pkg + 3 realm) | `gno.land/r/samcrew/...` | ✅ Deployed | ❓ Pending restart | `samcrew-deployer/projects/gnodaokit/` |
| 2 | **tokenfactory** | `gno.land/r/samcrew/tokenfactory` | ✅ Deployed | ❓ | `tokenfactory/` repo |
| 3 | **memba_dao** | `gno.land/r/samcrew/memba_dao` | ✅ Deployed | ❓ | `contracts/memba_dao_stub/` |
| 4 | **memba_dao_candidature** | `gno.land/r/samcrew/memba_dao_candidature` | ✅ Deployed | ❓ | `contracts/memba_candidature_stub/` |
| 5 | **memba_dao_channels** | `gno.land/r/samcrew/memba_dao_channels` | ✅ Deployed | ❓ | `contracts/memba_channels_stub/` |
| 6 | **escrow** | `gno.land/r/samcrew/escrow_stub` | ❌ Not deployed | ❌ | `contracts/escrow_stub/` |
| 7 | **agent_registry** | TBD | ❌ Not built | ❌ | N/A |
| 8 | **IBC transfer** | `gno.land/r/aib/ibc/apps/transfer` | ❓ On gno master | ❌ | Upstream |

## Deployment Order (Dependency Graph)

```
gnodaokit (foundation)
    └── tokenfactory
    └── memba_dao
            ├── memba_dao_candidature
            └── memba_dao_channels
                    └── escrow (depends on channels for dispute)
```

**Critical:** gnodaokit MUST be deployed before any samcrew realm.

## Deployer Tool

All deployments use `samcrew-deployer` (see `Desktop/Code/Gno/samcrew-deployer/README.md`):

```bash
# Pre-flight
./samcrew-verify.sh <network>

# Deploy all
DEPLOY_KEY=samcrew-core-test1 MULTISIG_SIGNERS=zooma,adena-zxxma \
  ./samcrew-deploy.sh <network> all
```

## Next Session Scope

The dedicated deployment runbook session should cover:

1. **Pre-deploy E2E tests** — `gno test` on each realm
2. **Post-deploy verification** — `Render()` checks, `MsgCall` smoke tests
3. **samcrew-deployer enhancements** — add escrow, agent registry
4. **Multi-network procedure** — gnoland1 restart, mainnet launch
5. **Rollback procedures** — handling mid-sequence deploy failures
6. **New network checklist** — step-by-step for adding a new chain
7. **Frontend config sync** — auto-update `config.ts` after deployment

---

*Created during v2.27 Sprint 1 — security & hygiene hardening.*
