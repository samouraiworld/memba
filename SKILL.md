# Memba — Agent Skill File

> Machine-readable instructions for AI agents (Claude Code, Cursor, Windsurf, etc.)
> interacting with Memba, the Gno-native multisig & DAO governance application.

## What is Memba?

Memba is a web application for managing multisig wallets, DAOs, tokens, and validator
monitoring on the [Gno](https://gno.land) blockchain. Built by [Samourai.world](https://www.samourai.world).

- **Live:** https://memba.samourai.app
- **Repo:** https://github.com/samouraiworld/memba
- **Chain:** Gno testnet12 (default), gnoland1 (betanet)

## Architecture

- **Frontend:** React + Vite SPA deployed on Netlify
- **Backend:** Go + ConnectRPC on Fly.io (multisig coordination only)
- **On-chain:** Direct ABCI queries to Gno RPC (no backend needed for DAO/token features)
- **Wallet:** Adena browser extension (all signing is client-side)

## Key API Endpoints

### Gno RPC (Direct — no auth needed)

All on-chain data is queried via JSON-RPC POST to the Gno RPC endpoint.

**Default RPC:** `https://rpc.testnet12.samourai.live:443`

#### Query a realm's Render() output
```bash
curl -s https://rpc.testnet12.samourai.live:443 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"abci_query","params":{"path":"vm/qrender","data":"gno.land/r/gov/dao\n"}}'
```

#### Query with a path argument (e.g., proposal #42)
```bash
curl -s https://rpc.testnet12.samourai.live:443 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"abci_query","params":{"path":"vm/qrender","data":"gno.land/r/gov/dao\n42"}}'
```

#### Evaluate a function (e.g., check if DAO is archived)
```bash
curl -s https://rpc.testnet12.samourai.live:443 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"abci_query","params":{"path":"vm/qeval","data":"gno.land/r/samcrew/memba_dao\nIsArchived()"}}'
```

#### Get GNOT balance
```bash
curl -s https://rpc.testnet12.samourai.live:443 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"abci_query","params":{"path":"bank/balances/g1ADDRESS"}}'
```

### Memba Backend (ConnectRPC)

**Base URL:** `https://memba-backend.fly.dev`

The backend uses [ConnectRPC](https://connectrpc.com/) (HTTP/1.1 compatible).
Service: `memba.v1.MultisigService`

#### Get user profile (public, no auth)
```bash
curl -s https://memba-backend.fly.dev/memba.v1.MultisigService/GetProfile \
  -H 'Content-Type: application/json' \
  -d '{"address":"g1ADDRESS"}'
```

#### List multisigs for a user (requires auth token)
```bash
curl -s https://memba-backend.fly.dev/memba.v1.MultisigService/Multisigs \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{"userAddress":"g1ADDRESS","chainId":"test12"}'
```

### Gnolove API (Contributor Data)

**Base URL:** `https://backend.gnolove.world`

#### Get contributor leaderboard
```bash
curl -s 'https://backend.gnolove.world/stats?time_filter=all'
```

#### Get contributor profile
```bash
curl -s 'https://backend.gnolove.world/users/USERNAME'
```

#### Get tracked repositories
```bash
curl -s 'https://backend.gnolove.world/repositories'
```

#### Get PR report for a date range
```bash
curl -s 'https://backend.gnolove.world/pull-requests/report?startdate=2026-01-01&enddate=2026-03-30'
```

#### Get on-chain proposals
```bash
curl -s 'https://backend.gnolove.world/onchain/proposals'
```

#### Get GovDAO members
```bash
curl -s 'https://backend.gnolove.world/onchain/govdao-members'
```

### Gnomonitoring API (Validator Metrics)

**Base URL:** `https://monitoring.gnolove.world`

```bash
curl -s 'https://monitoring.gnolove.world/validators'
```

## DAO Lifecycle

### 1. Create a DAO
The frontend generates Gno realm code and deploys via `MsgAddPackage`.
- Config: name, description, roles, member addresses, voting threshold
- Generates: DAO realm + optional channels realm + optional candidature realm
- Deploy fee: 10 GNOT

### 2. View DAO
Query `Render("")` on the DAO realm path to get config, members, proposals.

### 3. Create Proposal
Call `Propose(title, description, category)` via `MsgCall` on the DAO realm.

### 4. Vote on Proposal
- Memba DAOs: `VoteOnProposal(proposalId, "YES"|"NO"|"ABSTAIN")`
- GovDAO: `MustVoteOnProposalSimple(proposalId, "YES"|"NO"|"ABSTAIN")`

### 5. Execute Proposal
Call `ExecuteProposal(proposalId)` when quorum is reached.

## Token Operations

### Create GRC20 Token
Deploy via GRC20 factory at `gno.land/r/demo/defi/grc20factory`.
Platform fee: 2.5%.

### Query Token Balance
```bash
# via vm/qeval
curl -s RPC_URL -d '{"jsonrpc":"2.0","id":1,"method":"abci_query","params":{"path":"vm/qeval","data":"gno.land/r/demo/defi/grc20factory\nBalanceOf(\"SYMBOL\",\"g1ADDRESS\")"}}'
```

## Key Realm Paths

| Realm | Path |
|-------|------|
| GovDAO | `gno.land/r/gov/dao` |
| GovDAO Memberstore | `gno.land/r/gov/dao/v3/memberstore` |
| User Registry | `gno.land/r/sys/users` |
| GRC20 Factory | `gno.land/r/demo/defi/grc20factory` |
| MembaDAO | `gno.land/r/samcrew/memba_dao` |
| MembaDAO Channels | `gno.land/r/samcrew/memba_dao_channels` |

## Project Structure

```
frontend/           React + Vite SPA
  src/lib/          Core libraries (DAO, tokens, validators, config)
  src/pages/        Page components
  src/hooks/        React hooks
  src/plugins/      Board/leaderboard plugins
backend/            Go + ConnectRPC server
  cmd/memba/        Server entry point
  internal/         Auth, service, DB
api/                Proto definitions
docs/               Architecture, deployment, planning docs
```

## Development

```bash
# Frontend
cd frontend && npm install && npm run dev

# Backend
cd backend && go run ./cmd/memba

# Tests
cd frontend && npx vitest run        # 959+ unit tests
cd backend && go test -race ./...    # Backend tests
```

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| Testnet 12 | test12 | https://rpc.testnet12.samourai.live:443 |
| Betanet | gnoland1 | https://rpc.gnoland1.samourai.live:443 |
| Testnet 11 | test11 | https://rpc.test11.testnets.gno.land:443 |
