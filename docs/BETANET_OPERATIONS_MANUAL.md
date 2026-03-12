# Samouraï Crew — Betanet Operations Manual

> **Target:** Gno Betanet launch (~March 12–14, 2026)
> **Team:** zooma, mikael, gh0st, mikecito, david, lours, dadidou
> **Projects:** Memba, gnolove, gnomonitoring, gnodaokit, infra_gno-validator, multisigs

---

## Table of Contents

1. [Pre-Launch Checklist](#1-pre-launch-checklist)
2. [Workstream A: Validator Node](#2-workstream-a-validator-node)
3. [Workstream B: gnodaokit Realm Deployment](#3-workstream-b-gnodaokit-realm-deployment)
4. [Workstream C: Multisig Re-Setup](#4-workstream-c-multisig-re-setup)
5. [Workstream D: Application Configuration](#5-workstream-d-application-configuration)
6. [Workstream E: Monitoring Infrastructure](#6-workstream-e-monitoring-infrastructure)
7. [Day-of-Launch Runbook](#7-day-of-launch-runbook)
8. [Post-Launch Verification](#8-post-launch-verification)

---

## 1. Pre-Launch Checklist

> [!IMPORTANT]
> These items must be gathered from the gno core team **before** any deployment can start.

| # | Info Needed | Source | Status |
|---|------------|--------|--------|
| 1 | **Betanet chain ID** (exact string) | PR #5250 or core team | ⏳ Pending |
| 2 | **Genesis.json URL** | `github.com/gnolang/gno/misc/deployments/betanet/` | ⏳ Pending |
| 3 | **Seed nodes / persistent peers** | Core team Telegram/Discord | ⏳ Pending |
| 4 | **Docker image tag** | `ghcr.io/gnolang/gno/gnoland:chain-betanet` or similar | ⏳ Pending |
| 5 | **RPC endpoint URL** | Likely `rpc.betanet.gno.land:443` | ⏳ Pending |
| 6 | **GraphQL indexer URL** | Likely `indexer.betanet.gno.land/graphql/query` | ⏳ Pending |
| 7 | **Faucet URL** (if exists) | Core team | ⏳ Pending |
| 8 | **Deployed realms list** (genesis) | `chain/betanet` branch `.gno` patches | ⏳ Pending |
| 9 | **Initial validator set** | Core team | ⏳ Pending |
| 10 | **`r/gnops/valopers`** availability | PR #5250 (D4ryl00 asked, moul confirmed) | ⏳ Pending |
| 11 | **`config.toml` template** | Currently at `infra_gno-validator/betanet/config.toml` (8.9KB) | ✅ Exists |

---

## 2. Workstream A: Validator Node

> **Owner:** Infrastructure lead (lours / zooma)
> **Repo:** [infra_gno-validator](file:///Users/zxxma/Desktop/Code/Gno/infra_gno-validator)
> **Infra:** Scaleway private network (validator + sentry)

### A.1 — Update Inventory

**File:** `inventory.yaml`

```yaml
betanet:
  hosts:
    gno-sentry:
      ansible_host: <SENTRY_PUBLIC_IP>
      private_ip: <SENTRY_PRIVATE_IP>
      ufw_port_moni: [9100, 9200, 9464]
      ufw_ports_app: [26656]
      ufw_allow_ip: <MONITORING_SERVER_IP>
    gno-validator:
      public_ip: <VALIDATOR_PUBLIC_IP>
      private_ip: <VALIDATOR_PRIVATE_IP>
      ufw_port_moni: [9100, 26656, 9464]
      ufw_allow_ip: <SENTRY_PRIVATE_IP>
```

### A.2 — Update Betanet Config Files

**Files to update when genesis info is available:**

| File | What to Update |
|------|---------------|
| `betanet/genesis.json` (45MB) | Replace with official betanet genesis |
| `betanet/config.toml` | Update `seeds`, `persistent_peers_sentry`, chain-specific settings |
| `betanet/entrypoint.sh` | Verify startup flags match betanet requirements |
| `betanet/otel/otel-config.yaml` | Update OTEL endpoint if monitoring target changes |

### A.3 — Deployment Sequence

```bash
# Step 1: Base setup (only if new servers)
cd /Users/zxxma/Desktop/Code/Gno/infra_gno-validator/playbooks
ansible-playbook -i ../inventory.yaml base_setup_betanet.yml

# Step 2: Deploy chain
ansible-playbook -i ../inventory.yaml upload-betanet-deployment.yml
```

> [!CAUTION]
> The Docker image must match exactly: `ghcr.io/gnolang/gno/gnoland:chain-betanet` (verify tag with core team).

### A.4 — Validator Registration on `r/gnops/valopers`

Once the node is synced and the `r/gnops/valopers` realm is confirmed:

```bash
gnokey maketx call \
  --pkgpath "gno.land/r/gnops/valopers" \
  --func "Register" \
  --args "Samourai Crew" \
  --gas-fee 1000000ugnot --gas-wanted 2000000 \
  --broadcast \
  --chainid "<BETANET_CHAIN_ID>" \
  --remote "rpc.betanet.gno.land:443" \
  samourai-key
```

> Exact function signature TBD — check `r/gnops/valopers` Render() once deployed.

---

## 3. Workstream B: gnodaokit Realm Deployment

> **Owner:** zooma / lours
> **Repo:** [gnodaokit](file:///Users/zxxma/Desktop/Code/Gno/gnodaokit)
> **Gno version pinned:** `4e80c37e8d1870aa5d3b01966ed4c5dfa18a7566`

### B.1 — Packages to Deploy

gnodaokit uses `gno.land/p/samcrew/*` import paths. These packages must be deployed **in dependency order**:

| Order | Package | Path | Dependencies |
|-------|---------|------|-------------|
| 1 | realmid | `gno.land/p/samcrew/realmid` | None |
| 2 | daocond | `gno.land/p/samcrew/daocond` | None |
| 3 | daokit | `gno.land/p/samcrew/daokit` | daocond, realmid |
| 4 | basedao | `gno.land/p/samcrew/basedao` | daokit, daocond, realmid |

### B.2 — Package Deployment Commands

For each package, deploy via `gnokey maketx addpkg`:

```bash
# Common flags
CHAIN_ID="<BETANET_CHAIN_ID>"
REMOTE="rpc.betanet.gno.land:443"
KEY="samourai-key"  # deployer key with sufficient ugnot

# 1. Deploy realmid
gnokey maketx addpkg \
  --pkgpath "gno.land/p/samcrew/realmid" \
  --pkgdir "./gno/p/realmid" \
  --gas-fee 1000000ugnot --gas-wanted 5000000 \
  --broadcast \
  --chainid "$CHAIN_ID" --remote "$REMOTE" \
  "$KEY"

# 2. Deploy daocond
gnokey maketx addpkg \
  --pkgpath "gno.land/p/samcrew/daocond" \
  --pkgdir "./gno/p/daocond" \
  --gas-fee 1000000ugnot --gas-wanted 5000000 \
  --broadcast \
  --chainid "$CHAIN_ID" --remote "$REMOTE" \
  "$KEY"

# 3. Deploy daokit
gnokey maketx addpkg \
  --pkgpath "gno.land/p/samcrew/daokit" \
  --pkgdir "./gno/p/daokit" \
  --gas-fee 1000000ugnot --gas-wanted 10000000 \
  --broadcast \
  --chainid "$CHAIN_ID" --remote "$REMOTE" \
  "$KEY"

# 4. Deploy basedao
gnokey maketx addpkg \
  --pkgpath "gno.land/p/samcrew/basedao" \
  --pkgdir "./gno/p/basedao" \
  --gas-fee 1000000ugnot --gas-wanted 10000000 \
  --broadcast \
  --chainid "$CHAIN_ID" --remote "$REMOTE" \
  "$KEY"
```

### B.3 — Demo Realm Deployment (Optional)

After packages are deployed, optionally deploy the demo realms:

```bash
# Simple DAO demo
gnokey maketx addpkg \
  --pkgpath "gno.land/r/samcrew/daodemo/simple_dao" \
  --pkgdir "./gno/r/daodemo/simple_dao" \
  --gas-fee 1000000ugnot --gas-wanted 10000000 \
  --broadcast \
  --chainid "$CHAIN_ID" --remote "$REMOTE" \
  "$KEY"

# Repeat for custom_resource, custom_condition if desired
```

### B.4 — Pre-Deployment Verification

```bash
# Run tests locally first
cd /Users/zxxma/Desktop/Code/Gno/gnodaokit
make test

# Verify lint passes
make lint
```

> [!WARNING]
> gnodaokit is pinned to a specific gno version (`4e80c37`). If betanet runs a different GnoVM version, there may be incompatibilities. Test `make test` against the betanet-targeted gno version before deploying.

---

## 4. Workstream C: Multisig Re-Setup

> **Owner:** zooma
> **Repo:** [multisigs](file:///Users/zxxma/Desktop/Code/Gno/multisigs)
> **Config:** 3-of-7 (`zooma`, `mikael`, `gh0st`, `mikecito`, `david`, `lours`, `dadidou`)

### C.1 — Key Situation

All 7 public keys are already collected ✅ (see [SAMOURAI_CREW_SETUP.md](file:///Users/zxxma/Desktop/Code/Gno/multisigs/SAMOURAI_CREW_SETUP.md)).

**Betanet consideration:** The same keys (ed25519 keypairs) should work on betanet since gno uses the same key format. However:

| Question | Answer |
|----------|--------|
| Do existing keys work on betanet? | **Yes** — same key format, but addresses are derived from pubkeys and are chain-independent |
| Do members need new keys? | **No** — unless bech32 prefix changes (check with core team) |
| Does the multisig need to be re-registered? | **Yes on-chain** — the multisig exists as a local keybase construct. For on-chain use, the multisig address needs ugnot balance on betanet |

### C.2 — Betanet Multisig Steps

```bash
# 1. Verify multisig key still resolves
gnokey list | grep samourai-crew

# 2. Get the multisig address
gnokey list samourai-crew
# Address: g1<multisig_address>

# 3. Fund the multisig on betanet (from faucet or team transfer)
# Members EACH need their own betanet ugnot too for signing

# 4. Verify on betanet
gnokey query bank/balances \
  --remote "rpc.betanet.gno.land:443" \
  <multisig_address>
```

### C.3 — Multisigs Repo PR

If the `accounts.csv` already has `samourai-crew`, no PR is needed. Otherwise, follow the existing setup guide in `SAMOURAI_CREW_SETUP.md`.

---

## 5. Workstream D: Application Configuration

### D.1 — Memba (Primary)

> **Repo:** [Memba](file:///Users/zxxma/Desktop/Code/Gno/Memba)
> **Changes:** See [betanet_safe_execution.md](file:///Users/zxxma/.gemini/antigravity/brain/b79fcd59-a760-4636-bc8a-2ec6032f5b8d/betanet_safe_execution.md)

**Code changes (backward-compatible, ~10 lines across 5 files):**
1. `config.ts` — add `case "betanet"` to `getExplorerBaseUrl()`
2. `DAOHome.tsx` — use `getUserRegistryPath()` instead of hardcoded path
3. `DAOMembers.tsx` — same as above
4. `validators.ts` — use `getExplorerBaseUrl()` instead of hardcoded `test11` URL
5. `Dashboard.tsx` — remove duplicate function name from log string

**Deployment config (Netlify):**

```bash
# Option A: Single deploy with network selector (current architecture)
# Set env var in Netlify UI → Build & Deploy → Environment Variables:
VITE_GNO_CHAIN_ID=test11          # Keep test11 as default
# Users switch to betanet via UI network selector → localStorage("memba_network")

# Option B: Separate betanet deploy (new Netlify site)
VITE_GNO_CHAIN_ID=betanet
VITE_API_URL=https://memba-backend.fly.dev
VITE_GNO_MONITORING_API_URL=https://monitoring.gnolove.world
VITE_GNOLOVE_API_URL=https://gnolove.world/api
```

**When betanet config is confirmed, validate:**

```bash
cd /Users/zxxma/Desktop/Code/Gno/Memba/frontend
VITE_GNO_CHAIN_ID=betanet npm run build    # Must succeed
VITE_GNO_CHAIN_ID=test11 npm run build     # Must still succeed
npm test -- --run                           # All tests pass
```

### D.2 — gnolove

> **Repo:** [gnolove](file:///Users/zxxma/Desktop/Code/Gno/gnolove)
> **Decision:** Keep on test11 for now, prepare betanet config.

**Current config issues (stale):**

| File | Current | Action |
|------|---------|--------|
| `.env` | `NEXT_PUBLIC_GNO_CHAIN_ID=test11` | Keep for now |
| `server/.env.example` L4 | References `test5`/`test8` | Update to test11 immediately |
| `github-link-ghverify-dialog.tsx` L28 | May reference old RPC | Verify and fix |

**Betanet preparation (create but don't activate):**

```bash
# Create betanet env variant
cp .env .env.betanet
# Edit .env.betanet:
# NEXT_PUBLIC_GNO_CHAIN_ID=betanet
# NEXT_PUBLIC_GNO_RPC_ENDPOINT=https://rpc.betanet.gno.land:443
# NEXT_PUBLIC_PROFILE_REALM_PATH=gno.land/r/demo/profile  ← verify exists
# NEXT_PUBLIC_GHVERIFY_REALM_PATH=gno.land/r/teritori/ghverify  ← verify exists
```

> [!WARNING]
> **gnolove `.env` contains `GITHUB_API_TOKEN` in plaintext** (`ghp_lypE3x...`). If this is committed to a public repo, **rotate immediately** and move to `.env.example` with placeholder.

### D.3 — gnomonitoring

> **Repo:** [gnomonitoring](file:///Users/zxxma/Desktop/Code/Gno/gnomonitoring)

**Immediate:** Merge PR #65 (security fixes)

**Betanet config changes (when ready):**

| Config | Current | Betanet |
|--------|---------|---------|
| `rpc_endpoint` | `rpc.test11.testnets.gno.land` | `rpc.betanet.gno.land` |
| GraphQL endpoint | `indexer.test11.testnets.gno.land/graphql/query` | `indexer.betanet.gno.land/graphql/query` |
| `gnoweb` URL | `test11.testnets.gno.land` | `betanet.gno.land` |

**infra_gnolove betanet preparation:**

```yaml
# config_docker.yaml for betanet:
backend_port: "8989"
allow_origin: "https://gnolove.world"
rpc_endpoint: "https://rpc.betanet.gno.land"
metrics_port: 8888
gnoweb: "https://betanet.gno.land"
graphql: "indexer.betanet.gno.land/graphql/query"
dev_mode: false
```

---

## 6. Workstream E: Monitoring Infrastructure

> **Repo:** [infra_gnolove](file:///Users/zxxma/Desktop/Code/Gno/infra_gnolove)

### E.1 — Backend Env Template Updates

**File:** `backend.env.templates`

```bash
# Current (stale):
GNO_CHAIN_ID=test7.2
GNO_RPC_ENDPOINT=https://rpc.test9.testnets.gno.land/

# Fix immediately (regardless of betanet):
GNO_CHAIN_ID=test11
GNO_RPC_ENDPOINT=https://rpc.test11.testnets.gno.land/

# Betanet variant:
GNO_CHAIN_ID=betanet
GNO_RPC_ENDPOINT=https://rpc.betanet.gno.land/
GNO_GRAPHQL_ENDPOINT=https://indexer.betanet.gno.land/graphql/query
```

### E.2 — OTEL Collector

The `betanet/otel/otel-config.yaml` in infra_gno-validator handles telemetry. Verify the OTEL endpoint target matches your monitoring server.

---

## 7. Day-of-Launch Runbook

> [!IMPORTANT]
> Follow this sequence **in order** when the core team announces "betanet genesis is ready."

### Hour -2: Preparation

```
□ Get genesis.json URL from core team
□ Get seed nodes / persistent peers from core team  
□ Get Docker image tag from core team
□ Verify betanet chain ID (exact string)
□ Update infra_gno-validator/betanet/genesis.json
□ Update infra_gno-validator/betanet/config.toml (seeds, peers)
□ Update infra_gno-validator/inventory.yaml (if IPs changed)
```

### Hour -1: Validator Deployment

```
□ Run base setup playbook (if new servers)
□ Run deployment playbook
□ Verify node starts syncing: 
    docker logs gnoland-validator --tail 100
□ Wait for node to catch up (check block height)
□ Verify node appears in validator set
```

### Hour 0: Launch

```
□ Verify validator is producing blocks
□ Fund deployer wallet with ugnot (faucet or team transfer)
□ Fund multisig address with ugnot
□ Register on r/gnops/valopers (if available)
```

### Hour +1: Realm Deployment

```
□ Run gnodaokit tests against betanet gno version
□ Deploy packages in order: realmid → daocond → daokit → basedao
□ Verify each package: gnokey query vm/qrender ...
□ Deploy demo realms (optional)
□ Create first Samourai Crew DAO on betanet via daodemo
```

### Hour +2: Application Updates

```
□ Merge Memba betanet code changes (5 files, ~10 lines)
□ Build + test: VITE_GNO_CHAIN_ID=betanet npm run build
□ Build + test: VITE_GNO_CHAIN_ID=test11 npm run build (regression)
□ Deploy Memba to Netlify (keep test11 as default)
□ Verify betanet via localStorage override:
    localStorage.setItem("memba_network", "betanet"); location.reload()
□ Merge gnomonitoring PR #65
□ Update gnomonitoring RPC config for betanet
□ Restart gnomonitoring backend
```

### Hour +3: Verification

```
□ Run Post-Launch Verification (section 8 below)
□ Update docs/MAINNET_PREPARATION.md
□ Update CHANGELOG.md
□ Create PR with all betanet changes
□ Notify team: "Betanet ready ✅"
```

---

## 8. Post-Launch Verification

### Validator

```bash
# Check node status
gnokey query tm/status --remote "rpc.betanet.gno.land:443"

# Verify our validator is in the set
gnokey query tm/validators --remote "rpc.betanet.gno.land:443"

# Check block production
gnokey query tm/block --remote "rpc.betanet.gno.land:443"
```

### gnodaokit Realms

```bash
# Verify each package exists
for pkg in realmid daocond daokit basedao; do
  echo "=== Checking gno.land/p/samcrew/$pkg ==="
  gnokey query vm/qfile \
    --data "gno.land/p/samcrew/$pkg" \
    --remote "rpc.betanet.gno.land:443"
done
```

### Memba

| Check | How | Expected |
|-------|-----|----------|
| Build succeeds | `VITE_GNO_CHAIN_ID=betanet npm run build` | Exit 0 |
| Network selector shows Betanet | Open app → network dropdown | "Betanet" option visible |
| Dashboard loads | Connect Adena → Dashboard | No errors |
| GovDAO proposals load | Navigate to `/dao/gno.land~r~gov~dao` | Proposals list renders |
| Profile links correct | Click validator profile link | Opens `betanet.gno.land/r/demo/profile:u/g1...` |
| User registry links correct | DAOHome → "Register @username" | Opens `betanet.gno.land/r/sys/users` |
| FaucetCard hidden | Dashboard on betanet | Card not rendered |
| Explorer URLs correct | Any "View source" link | Points to `betanet.gno.land` |

### gnomonitoring

| Check | How | Expected |
|-------|-----|----------|
| Validator tracking | Open monitoring dashboard | Our validator visible with block signatures |
| GovDAO proposals | Check proposal tracking | Betanet proposals listed |
| WebSocket | Check real-time updates | Connected to betanet RPC |

---

## Appendix A: Key Contacts & Resources

| Resource | Link |
|----------|------|
| Gno Core Team | Discord / Telegram |
| PR #5250 (betanet config) | [github.com/gnolang/gno/pull/5250](https://github.com/gnolang/gno/pull/5250) |
| `chain/betanet` branch | [github.com/gnolang/gno/tree/chain/betanet](https://github.com/gnolang/gno/tree/chain/betanet) |
| Betanet milestone | [🚀 Mainnet beta launch](https://github.com/gnolang/gno/milestone/7) |
| Docker images | [ghcr.io/gnolang/gno/gnoland](https://github.com/gnolang/gno/pkgs/container/gno%2Fgnoland) |
| Gnokey docs | [docs.gno.land/users/interact-with-gnokey](https://docs.gno.land/users/interact-with-gnokey) |

## Appendix B: Repository Responsibility Matrix

| Repo | Owner | Betanet Action | Priority |
|------|-------|---------------|----------|
| **infra_gno-validator** | lours/zooma | Deploy validator + sentry | 🔴 CRITICAL |
| **gnodaokit** | zooma | Deploy packages to chain | 🟡 HIGH |
| **multisigs** | zooma | Fund multisig on betanet | 🟡 HIGH |
| **Memba** | zooma | Code changes + Netlify deploy | 🟡 HIGH |
| **gnomonitoring** | lours | Merge PR #65 + config update | 🟡 HIGH |
| **gnolove** | zooma | Keep test11, prepare config | 🟢 MEDIUM |
| **infra_gnolove** | lours | Update stale RPC refs | 🟢 MEDIUM |
| **adena-wallet** | Onbloc (external) | Verify betanet chain support | ⏳ EXTERNAL |

---

*Manual written 2026-03-12 by Antigravity CTO Agent. No code changes included.*
