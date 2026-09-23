# Memba MCP Server

Model Context Protocol (MCP) server for querying DAOs, proposals, validators, and contributors on the Gno blockchain.

## Tools

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

## Setup

### MCP client configuration

Add the server to your MCP client's configuration file:

```json
{
  "mcpServers": {
    "memba": {
      "command": "node",
      "args": ["/path/to/memba/mcp-server/build/index.js"],
      "env": {
        "GNO_RPC_URL": "https://rpc.gno.land:443"
      }
    }
  }
}
```

### Minimal configuration

Without `env`, the server uses the default `GNO_RPC_URL` listed under [Configuration](#configuration):

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

### Cursor

Add to Cursor MCP settings:

```json
{
  "memba": {
    "command": "node",
    "args": ["/path/to/memba/mcp-server/build/index.js"]
  }
}
```

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `GNO_RPC_URL` | `https://rpc.gno.land:443` (gno.land mainnet, chain-id `gnoland-1`) | Gno RPC endpoint |
| `GNOLOVE_API_URL` | `https://backend.gnolove.world` | Gnolove API endpoint |

## Development

```bash
cd mcp-server
npm install
npm run build
npm start
```

## Example Usage

Once configured, agents can:

- "What proposals are active on GovDAO?" → `memba_get_dao` + `memba_get_proposal`
- "Who are the top contributors?" → `memba_get_contributors`
- "What's the balance of g1abc...?" → `memba_get_balance`
- "Show me the latest block height" → `memba_get_network`
- "Read the memba_dao realm" → `memba_query_render`
