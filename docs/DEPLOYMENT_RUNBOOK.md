# Memba — On-Chain Deployment Runbook

> **Status:** COMPLETE — Full procedures for all samcrew on-chain deployments.
> **Last updated:** 2026-04-01 (v2.27.0)
> **Deployer tool:** [`samcrew-deployer`](https://github.com/samouraiworld/samcrew-deployer)

---

## Table of Contents

1. [Realm Inventory](#realm-inventory)
2. [Dependency Graph](#dependency-graph)
3. [Pre-Deploy Checklist](#pre-deploy-checklist)
4. [Standard Deployment Procedure](#standard-deployment-procedure)
5. [Multi-Network Deployment Order](#multi-network-deployment-order)
6. [Post-Deploy Verification](#post-deploy-verification)
7. [New Network Checklist](#new-network-checklist)
8. [Failure Recovery](#failure-recovery)
9. [Frontend Config Sync](#frontend-config-sync)
10. [Operational Reference](#operational-reference)

---

## Realm Inventory

| # | Realm | Module Path | test12 | gnoland1 | Source |
|---|-------|-------------|--------|----------|--------|
| 1 | **gnodaokit** (4 pkg + 3 realm) | `gno.land/{p,r}/samcrew/...` | ✅ | ❓ Pending restart | `samcrew-deployer/projects/gnodaokit/` |
| 2 | **tokenfactory** | `gno.land/r/samcrew/tokenfactory` | ✅ | ❓ | `samcrew-deployer/projects/tokenfactory/` |
| 3 | **memba_dao** | `gno.land/r/samcrew/memba_dao` | ✅ | ❓ | `samcrew-deployer/projects/memba/realms/` |
| 4 | **memba_dao_candidature** | `gno.land/r/samcrew/memba_dao_candidature` | ✅ | ❓ | `samcrew-deployer/projects/memba/realms/` |
| 5 | **memba_dao_channels** | `gno.land/r/samcrew/memba_dao_channels` | ✅ | ❓ | `samcrew-deployer/projects/memba/realms/` |
| 6 | **escrow** | `gno.land/r/samcrew/escrow_stub` | ❌ | ❌ | `contracts/escrow_stub/` |
| 7 | **agent_registry** | TBD | ❌ Not built | ❌ | N/A |
| 8 | **IBC transfer** | `gno.land/r/aib/ibc/apps/transfer` | ❓ Upstream | ❌ | Upstream |

**Total tracked artifacts:** 34 (query with `samcrew-status.sh`)

---

## Dependency Graph

```
Vendored dependencies (_deps)
    └── gnodaokit (4 packages: basedao, daocond, daokit, realmid)
            ├── tokenfactory
            └── memba_dao
                    ├── memba_dao_candidature
                    └── memba_dao_channels
                            └── escrow (future — depends on channels for dispute)
```

**Rule:** Deploy strictly top-down. A realm that imports an undeployed package will fail with an `import` error. gnodaokit packages MUST be live before any downstream realm.

---

## Pre-Deploy Checklist

### 1. Run Memba CI (all must pass)

```bash
cd ~/Desktop/Code/Gno/Memba/frontend
npx tsc --noEmit           # 0 TS errors
npx eslint .               # 0 lint errors
npx vitest run             # 1,349+ tests pass
npx playwright test        # 16 E2E specs pass

cd ~/Desktop/Code/Gno/Memba/backend
go test -race ./...        # all packages pass
```

### 2. Run realm tests

```bash
cd ~/Desktop/Code/Gno/samcrew-deployer
./samcrew-test.sh all      # gno test + gno lint on all projects
```

### 3. Run pre-flight health checks

```bash
# Verifies: RPC reachable, deploy key in keychain, balance sufficient,
# gno/gnokey available, core dependencies on-chain
./samcrew-verify.sh <network>
```

### 4. Environment prerequisites

| Tool | Min version | Check |
|------|-------------|-------|
| `gnokey` | (latest) | `gnokey version` |
| `gno` | (latest) | `gno version` |
| `jq` | any | `jq --version` |
| `curl` | any | `curl --version` |
| Node.js | 22+ | `node -v` |
| Go | 1.25+ | `go version` |

### 5. Deploy key verification

```bash
# List available keys
gnokey list

# Expected key: samcrew-core-test1 (multisig 2-of-2)
# Signers: zooma, adena-zxxma
# Override with: DEPLOY_KEY=<name>
```

---

## Standard Deployment Procedure

### Single project

```bash
cd ~/Desktop/Code/Gno/samcrew-deployer

# 1. Dry run (prints what would deploy, no transactions)
./samcrew-deploy.sh <network> <project> --dry-run

# 2. Deploy
DEPLOY_KEY=samcrew-core-test1 MULTISIG_SIGNERS=zooma,adena-zxxma \
  ./samcrew-deploy.sh <network> <project>

# 3. Verify
./samcrew-status.sh <network>
```

**Projects:** `gnodaokit`, `tokenfactory`, `lz`, `btc`, `all`

### Memba realms specifically

```bash
# Deploy all 3 Memba realms (sequential: dao → candidature → channels)
DEPLOY_KEY=samcrew-core-test1 MULTISIG_SIGNERS=zooma,adena-zxxma \
  ./projects/memba/deploy.sh <network>
```

### Full stack (all projects)

```bash
# Deploys in priority order: gnodaokit → tokenfactory → lz-oapp → btc-gnodao
DEPLOY_KEY=samcrew-core-test1 MULTISIG_SIGNERS=zooma,adena-zxxma \
  ./samcrew-deploy.sh <network> all
```

### Multisig signing flow (automatic)

When `MULTISIG_SIGNERS` is set and the deploy key is a multisig, each artifact follows this 5-step flow automatically:

1. `gnokey maketx addpkg --broadcast=false` → create unsigned TX
2. `gnokey sign` → signature from signer 1 (zooma)
3. `gnokey sign` → signature from signer 2 (adena-zxxma)
4. `gnokey multisign` → combine signatures
5. `gnokey broadcast` → submit to chain

Passwords are prompted once per session, held in memory, cleared on exit. Account sequence auto-increments between TXs.

---

## Multi-Network Deployment Order

When deploying to a new or restarted network, follow this order:

### Priority 1 — test12 (development default)

test12 is the primary development network. All features are tested here first.

```bash
./samcrew-deploy.sh test12 all
```

### Priority 2 — gnoland1 (betanet / production)

gnoland1 is the production chain. Deploy after test12 is verified stable.

```bash
# Pre-flight is critical for production
./samcrew-verify.sh betanet

# Dry run first
./samcrew-deploy.sh betanet all --dry-run

# Deploy
DEPLOY_KEY=samcrew-core-test1 MULTISIG_SIGNERS=zooma,adena-zxxma \
  ./samcrew-deploy.sh betanet all
```

### Priority 3 — portal-loop (community)

Optional. Portal-loop resets periodically, so deployments are ephemeral.

```bash
./samcrew-deploy.sh portal-loop all
```

### After gnoland1 restart

When gnoland1 restarts (chain reset), all state is wiped. Full redeploy required:

1. Fund deploy key on new chain: request GNOT from faucet or multisig transfer
2. Run pre-flight: `./samcrew-verify.sh betanet`
3. Deploy all: `./samcrew-deploy.sh betanet all`
4. Verify all 34 artifacts: `./samcrew-status.sh betanet`
5. Update Memba frontend config if RPC or chain ID changed
6. Smoke test Memba app against gnoland1

---

## Post-Deploy Verification

### Automated status check

```bash
# Shows LIVE / NOT FOUND for all 34 artifacts
./samcrew-status.sh <network>
```

### Manual Render() verification

After deploying Memba realms, verify `Render()` works on each:

```bash
# Query realm Render function via gnokey
gnokey query vm/qrender \
  --data "gno.land/r/samcrew/memba_dao:" \
  --remote <rpc_url>

gnokey query vm/qrender \
  --data "gno.land/r/samcrew/memba_dao_candidature:" \
  --remote <rpc_url>

gnokey query vm/qrender \
  --data "gno.land/r/samcrew/memba_dao_channels:" \
  --remote <rpc_url>
```

### MsgCall smoke tests

```bash
# Test a read-only call (e.g., GetMembers on memba_dao)
gnokey query vm/qeval \
  --data "gno.land/r/samcrew/memba_dao.GetMembers()" \
  --remote <rpc_url>
```

### Frontend smoke test

1. Open `memba.samourai.app` (or local dev)
2. Switch to the deployed network in the network selector
3. Verify: DAO loads, proposals visible, candidature page renders, channels accessible

---

## New Network Checklist

When a new Gno network launches (e.g., test13, mainnet):

| Step | Action | Command / Location |
|------|--------|--------------------|
| 1 | **Add network config** | Edit `samcrew-deployer/config/networks.toml` |
| 2 | **Fund deploy key** | Faucet or multisig transfer |
| 3 | **Pre-flight** | `./samcrew-verify.sh <network>` |
| 4 | **Run realm tests** | `./samcrew-test.sh all` |
| 5 | **Dry-run deploy** | `./samcrew-deploy.sh <network> all --dry-run` |
| 6 | **Deploy all** | `./samcrew-deploy.sh <network> all` |
| 7 | **Verify artifacts** | `./samcrew-status.sh <network>` |
| 8 | **Render() checks** | Manual `vm/qrender` per realm |
| 9 | **Add to Memba frontend** | `frontend/src/lib/config.ts` — add to NETWORKS |
| 10 | **Update env vars** | Netlify: `VITE_GNO_CHAIN_ID`, `VITE_GNO_RPC_URL` |
| 11 | **Frontend smoke test** | Connect wallet, switch network, verify DAO |
| 12 | **Update docs** | DEPLOYMENT.md, README.md chain table |

### networks.toml template

```toml
[newchain]
chain_id = "newchain"
rpc = "https://rpc.newchain.example:443"
faucet = "https://faucet.example"
explorer = "https://newchain.example"
gas_fee = "10000000ugnot"
gas_wanted = "80000000"
deposit = "1ugnot"
```

---

## Failure Recovery

### Mid-sequence deploy failure

If a deploy fails partway through a sequence (e.g., realm 2/3 fails):

1. **Check the logs:** `samcrew-deployer/logs/deploy-<network>-<timestamp>.log`
2. **Check on-chain state:** `./samcrew-status.sh <network>` — see what actually deployed
3. **Re-run deploy:** The deployer is idempotent — already-deployed artifacts are skipped. Simply re-run the same command.
4. **If sequence error:** The deployer auto-re-queries account sequence after broadcast failure. If sequence is stale, wait 10s and retry.

### Broadcast timeout (TX may have landed)

```bash
# Check if the artifact actually deployed despite the timeout
./samcrew-status.sh <network>

# If LIVE: the TX landed, continue with next artifact
# If NOT FOUND: retry with --force to bypass the "already deployed" check
./samcrew-deploy.sh <network> <project> --force
```

### RPC failover

The deployer retries up to 3 times with exponential backoff (5s, 10s, 15s). On retry, it switches to `RPC_FALLBACK` if configured in `networks.toml`.

To manually switch RPC:

```bash
# Temporarily override RPC
RPC_URL=https://alt-rpc.example:443 ./samcrew-deploy.sh <network> <project>
```

### Balance too low

```bash
# Check balance
gnokey query bank/balances/<address> --remote <rpc_url>

# Fund from faucet (testnets only)
curl -X POST https://faucet.gno.land -d '{"address":"<address>"}'

# Or transfer from another key
gnokey maketx send -to <address> -send "10000000ugnot" -gas-fee "1000000ugnot" \
  -gas-wanted "2000000" -remote <rpc_url> -broadcast -chainid <chain_id> <funding_key>
```

### Lint errors block deploy

The deployer runs `gno lint` before each broadcast. If lint fails:

1. Fix the source code in the project's realm directory
2. Re-run `./samcrew-test.sh <project>` to confirm fix
3. Re-run deploy

---

## Frontend Config Sync

After deploying to a new network, update the Memba frontend:

### 1. Add network to config

File: `frontend/src/lib/config.ts`

Add a new entry to the `NETWORKS` object with:
- `chainId` — must match `chain_id` in `networks.toml`
- `rpcUrl` — RPC endpoint
- `explorerUrl` — gnoweb explorer
- `daoRealmPath` — `gno.land/r/samcrew/memba_dao` (same across networks)

### 2. Update environment variables

For production (Netlify):
- `VITE_GNO_CHAIN_ID` — default network chain ID
- `VITE_GNO_RPC_URL` — default network RPC

### 3. Deploy frontend

```bash
cd ~/Desktop/Code/Gno/Memba/frontend
npm run build              # verify build succeeds
# Push to main → Netlify auto-deploys
```

---

## Operational Reference

### Configured networks

| Network | Chain ID | RPC | Gas Fee | Gas Wanted | Deposit |
|---------|----------|-----|---------|------------|---------|
| test12 | `test12` | `rpc.testnet12.samourai.live` | 10M ugnot | 150M | 100M ugnot |
| betanet | `gnoland1` | `rpc.gnoland1.samourai.live` | 10M ugnot | 80M | 1M ugnot |
| portal-loop | `portal-loop` | `rpc.gno.land` | 10M ugnot | 80M | 1 ugnot |
| local | `dev` | `127.0.0.1:26657` | 1M ugnot | 10M | 1 ugnot |

### Deploy key

| Key | Type | Address | Signers |
|-----|------|---------|---------|
| `samcrew-core-test1` | 2-of-2 multisig | `g10kw7e55e9wc8j8v6904ck29dqwr9fm9u280juh` | zooma, adena-zxxma |

### Safety features

- **Idempotent** — skips already-deployed artifacts (unless `--force`)
- **TX spacing** — 3s delay between TXs to avoid mempool collisions (`TX_DELAY`)
- **RPC failover** — automatic retry on fallback RPC (3 attempts, exponential backoff)
- **Pre-broadcast lint** — catches type errors before wasting gas
- **Audit logs** — every deploy is logged to `logs/deploy-{network}-{timestamp}.log`
- **Source commit tracking** — git SHA logged per artifact for traceability
- **Sequence auto-recovery** — re-queries on-chain sequence after broadcast failure

### Flags

| Flag | Effect |
|------|--------|
| `--dry-run` | Print what would deploy, no transactions |
| `--force` | Skip "already deployed" check |
| `--preflight` | Run pre-flight checks only |
| `--list-networks` | Show all configured networks |

---

## Realm Deploy Rollback

> ⚠️ **On-chain realm deployment is NOT reversible.** If a realm deploys with a bug, you cannot update the code at the same path. The VM returns `"package already exists"`.

**Recovery strategy:**
1. **If deploy fails pre-broadcast** (lint, sequence, gas): Fix and re-run. No chain state affected.
2. **If deploy succeeds with buggy code**: Deploy a fixed version at a **versioned path suffix**:
   - `gno.land/r/samcrew/memba_dao_candidature` → `gno.land/r/samcrew/memba_dao_candidature/v2`
   - Update all frontend references to the new path
3. **If deploy partially lands** (timeout, ambiguous): Run `samcrew-status.sh` to check on-chain state before retrying.

---

## Feature Flags Reference

Frontend feature flags are configured as **Netlify environment variables** (NOT committed to `netlify.toml`).

| Flag | Default | Status | Notes |
|------|---------|--------|-------|
| `VITE_ENABLE_TEAMS` | `false` | ✅ Ready to enable | Backend + frontend shipped in v2.28. Set to `true` via Netlify UI. |
| `VITE_ENABLE_MARKETPLACE` | `false` | 🔒 Gated | Agent registry realm not deployed. Mock data only. |
| `VITE_ENABLE_NFT` | `false` | 🔒 Gated | GRC721 standard evolving upstream. No seed collections. |
| `VITE_ENABLE_SERVICES` | `false` | 🔒 Gated | Escrow realm not deployed. |

**Where to set:** Netlify Dashboard → Site → Build & Deploy → Environment Variables.
**NOT in:** `netlify.toml`, `.env`, or any committed file.

See `docs/features/` for detailed activation plans per feature.

---

*Expanded from placeholder during v2.27 docs session. Updated v2.29 with rollback and feature flags. Source of truth for all samcrew on-chain deployments.*
