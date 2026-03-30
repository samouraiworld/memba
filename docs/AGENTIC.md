# Memba Agentic Integration

> How to use Memba with AI agents, MCP servers, and CI/CD automation.

## Overview

Memba exposes its data through three layers that agents can consume:

1. **SKILL.md** — A self-contained markdown file at the repo root that any AI agent can read.
   Contains API endpoints, curl examples, DAO lifecycle, and project structure.

2. **Direct ABCI Queries** — All on-chain data (DAOs, proposals, members, tokens, validators)
   is queryable via JSON-RPC POST to any Gno RPC endpoint. No authentication needed.

3. **ConnectRPC Backend** — Multisig coordination and user profiles via the Go backend.
   Public endpoints (GetProfile) need no auth. Write endpoints need an auth token.

## Quick Start for Agents

### Read the SKILL.md
The fastest way to understand Memba's API surface:
```bash
cat SKILL.md
```

### Query a DAO's state
```bash
curl -s https://rpc.testnet12.samourai.live:443 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"abci_query","params":{"path":"vm/qrender","data":"gno.land/r/samcrew/memba_dao\n"}}'
```

### Get contributor leaderboard
```bash
curl -s 'https://backend.gnolove.world/stats?time_filter=all'
```

### Get validator metrics
```bash
curl -s 'https://monitoring.gnolove.world/validators'
```

## MCP Server

The Memba MCP server (`mcp-server/`) exposes 9 tools for agents:

| Tool | Description |
|------|-------------|
| `memba_query_render` | Query any realm's Render() output (raw ABCI) |
| `memba_query_eval` | Evaluate a realm function (vm/qeval) |
| `memba_get_balance` | Get GNOT balance of an address |
| `memba_get_dao` | Get DAO overview (name, members, proposals) |
| `memba_get_proposal` | Get proposal details by ID |
| `memba_get_contributors` | Gnolove contributor leaderboard |
| `memba_get_contributor` | Single contributor profile |
| `memba_get_repositories` | Tracked Gnolove repositories |
| `memba_get_network` | Current chain status (height, chain ID) |

### Setup (Claude Desktop)
```json
{
  "mcpServers": {
    "memba": {
      "command": "node",
      "args": ["/path/to/memba/mcp-server/build/index.js"]
    }
  }
}
```

See `mcp-server/README.md` for full configuration details.

## CI/CD Integration

### Verify DAO state in CI
```bash
# Check if a proposal passed
RESULT=$(curl -s RPC_URL -d '{"jsonrpc":"2.0","id":1,"method":"abci_query","params":{"path":"vm/qrender","data":"gno.land/r/samcrew/memba_dao\n1"}}')
echo "$RESULT" | jq -r '.result.response.ResponseBase.Data' | base64 -d
```

### Monitor validator uptime
```bash
curl -s 'https://monitoring.gnolove.world/validators' | jq '.[0]'
```

## Data Sources Reference

| Data | Source | Auth |
|------|--------|------|
| DAO config, members, proposals | Gno RPC (ABCI) | None |
| Token balances, info | Gno RPC (ABCI) | None |
| Validator set, block data | Gno RPC (Tendermint) | None |
| Contributor stats, PRs | Gnolove API | None |
| Validator metrics, uptime | Gnomonitoring API | None |
| User profiles | Memba Backend (ConnectRPC) | None (read) |
| Multisig operations | Memba Backend (ConnectRPC) | Auth token |
