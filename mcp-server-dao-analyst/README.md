# DAO Governance Analyst — MCP Server

Multi-model AI governance analyst for Gno DAOs. Analyzes proposals from legal, technical, and financial perspectives using free-tier LLM consensus.

Registered on-chain: [`gno.land/r/samcrew/agent_registry`](https://testnet12.gno.land/r/samcrew/agent_registry:agent/dao-analyst) (testnet12)

## Tools

| Tool | Description |
|------|-------------|
| `dao_analyze_proposal` | Multi-perspective proposal analysis with consensus verdict |
| `dao_audit_treasury` | Treasury health assessment |
| `dao_governance_health` | Governance health score and recommendations |
| `dao_compare_proposals` | Side-by-side proposal comparison (free: 2, PRO: 5) |
| `dao_risk_assessment` | Focused risk analysis — what could go wrong |
| `dao_set_network` | Switch Gno network mid-conversation |

## Setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dao-analyst": {
      "command": "npx",
      "args": ["-y", "@samouraiworld/dao-analyst-mcp@latest"],
      "env": {
        "GNO_RPC_URL": "https://rpc.gno.land",
        "MEMBA_BACKEND_URL": "https://backend.memba.samourai.app"
      }
    }
  }
}
```

### Cursor / VS Code

Add to `.cursor/mcp.json` or `.vscode/mcp.json`:

```json
{
  "servers": {
    "dao-analyst": {
      "command": "npx",
      "args": ["-y", "@samouraiworld/dao-analyst-mcp@latest"],
      "env": {
        "GNO_RPC_URL": "https://rpc.gno.land",
        "MEMBA_BACKEND_URL": "https://backend.memba.samourai.app"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GNO_RPC_URL` | No | testnet12 | Gno RPC endpoint |
| `MEMBA_BACKEND_URL` | No | `http://localhost:8080` | Memba backend for LLM routing |
| `DAO_ANALYST_TOKEN` | No | — | Auth token for PRO tier |
| `DAO_ANALYST_USER_ADDRESS` | No | — | Gno address for on-chain credit lookup |

## Free vs PRO

| | Free | PRO |
|---|---|---|
| Perspectives | 2 (technical, financial) | 3 (+ legal) |
| Models | Round-robin across available | Multi-model consensus |
| Compare proposals | Max 2 | Up to 5 |
| Rate limit | 10/min | 100/min |
| Pricing | Free | 100,000 ugnot per analysis |

PRO requires credits deposited on-chain via `DepositCredits("dao-analyst")` on the agent registry realm.

## Networks

Built-in network aliases:

| Name | RPC |
|------|-----|
| `mainnet` | `https://rpc.gno.land` |
| `test5` | `https://rpc.test5.gno.land` |
| `test12` | `https://rpc.testnet12.samourai.live:443` |

Switch mid-conversation: use the `dao_set_network` tool.

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm --filter @samouraiworld/gno-rpc build
pnpm --filter @samouraiworld/dao-analyst-mcp build

# Run tests
pnpm --filter @samouraiworld/dao-analyst-mcp test

# Start locally
node build/index.js
```

## Architecture

```
MCP Client (Claude, Cursor)
  ↕ stdio (JSON-RPC)
dao-analyst-mcp (local)
  ├─ Fetches on-chain data via ABCI (gno-rpc)
  ├─ Constructs perspective prompts
  └─ Sends to Memba backend
       ↕ POST /api/analyst/analyze
     Memba Backend (Fly.io)
       ├─ Tier enforcement (on-chain credit check)
       ├─ LLM routing (Groq, Google AI, Together, Ollama)
       ├─ Circuit breaker + fallback chain
       └─ Rate limiting per IP
```

## License

MIT
