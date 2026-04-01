# AI Agent Marketplace — Activation Plan

> **Status:** Gated behind `VITE_ENABLE_MARKETPLACE=true`
> **Current code:** `frontend/src/pages/Marketplace.tsx` (fully implemented UI)
> **On-chain realm:** `agentTemplate.ts` generates the realm, not yet deployed

## Overview

Marketplace for discovering and connecting AI agents to DAOs via MCP
(Model Context Protocol). Agents provide governance analysis, treasury
optimization, proposal drafting, and other DAO automation capabilities.

## Prerequisites

1. **Agent registry realm deployed** — `agentTemplate.ts` can generate the realm
   code, but it needs to be deployed via samcrew-deployer.
2. **MCP server implementation** — Agents need a real MCP endpoint to connect to.
   Current UI uses mock data from `agentRegistry.ts`.
3. **Payment infrastructure** — GRC20 pay-per-use or subscription model requires
   on-chain escrow or streaming payment realm.

## Implementation Steps

### Phase 1 — Live Agent Registry (enable the flag)
1. Deploy `agent_registry` realm to testnet via samcrew-deployer
2. Replace mock data in `agentRegistry.ts` with on-chain ABCI queries
3. Set `VITE_ENABLE_MARKETPLACE=true` in production
4. Agent listing page with real on-chain data

### Phase 2 — MCP Integration
1. Implement MCP client SDK in `frontend/src/lib/mcp.ts`
2. Agent connection flow (one-click MCP config generation already exists)
3. Agent capability verification (test agent endpoints before connecting)
4. Connection status monitoring

### Phase 3 — Payments & Reviews
1. Deploy escrow-based payment realm for agent usage fees
2. On-chain review/rating system (verified purchase only)
3. Agent analytics dashboard (usage stats, revenue)
4. DAO-curated agent lists

## Test Plan

- [ ] E2E test: agent listing page renders with on-chain data
- [ ] E2E test: MCP config download generates valid JSON
- [ ] Unit tests for ABCI query parsing of agent registry
- [ ] Integration test with mock MCP server
- [ ] Verify agent registration flow end-to-end

## Rollout Criteria

- [ ] Agent registry realm deployed and queryable
- [ ] At least 3 seed agents registered (can be Memba-operated)
- [ ] MCP config generation produces valid, working configs
- [ ] All existing E2E tests still pass with flag enabled
- [ ] No performance regression on Directory page (shared components)
