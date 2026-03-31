/**
 * Agent Registry — data layer for the AI Agent Marketplace.
 *
 * Phase 4a: Provides types, seed agents, and on-chain registry queries
 * for discovering and connecting AI agents in the Gno ecosystem.
 *
 * Architecture:
 * - Agents are registered on-chain via a registry realm
 * - Frontend queries Render() for agent listings
 * - MCP config is generated client-side from agent metadata
 *
 * @module lib/agentRegistry
 */

// ── Types ────────────────────────────────────────────────────

export type AgentCategory =
    | "governance"
    | "development"
    | "analytics"
    | "portfolio"
    | "content"
    | "security"
    | "custom"

export interface AgentListing {
    /** Unique agent ID (slug) */
    id: string
    /** Display name */
    name: string
    /** Short description */
    description: string
    /** Detailed markdown description */
    longDescription?: string
    /** Agent category */
    category: AgentCategory
    /** Capabilities list (human-readable) */
    capabilities: string[]
    /** Creator's on-chain address */
    creator: string
    /** Creator display name */
    creatorName?: string
    /** MCP server endpoint or command */
    mcpEndpoint: string
    /** MCP transport type */
    mcpTransport: "stdio" | "sse" | "streamable-http"
    /** Pricing model */
    pricing: "free" | "pay-per-use" | "subscription"
    /** Price per invocation in ugnot (0 if free) */
    pricePerCall: number
    /** Average rating (1-5, 0 if unrated) */
    rating: number
    /** Number of ratings */
    ratingCount: number
    /** Total invocations */
    totalCalls: number
    /** Tags for search */
    tags: string[]
    /** Version string */
    version: string
    /** Whether agent is verified by the Memba team */
    verified: boolean
}

// ── Categories ───────────────────────────────────────────────

export const AGENT_CATEGORIES: { key: AgentCategory; label: string; icon: string; description: string }[] = [
    { key: "governance", label: "Governance", icon: "🏛️", description: "Proposal analysis, vote recommendations, DAO health monitoring" },
    { key: "development", label: "Development", icon: "💻", description: "Code review, smart contract analysis, deployment automation" },
    { key: "analytics", label: "Analytics", icon: "📊", description: "On-chain data analysis, metrics dashboards, trend detection" },
    { key: "portfolio", label: "Portfolio", icon: "💰", description: "Asset tracking, balance monitoring, DeFi position management" },
    { key: "content", label: "Content", icon: "✍️", description: "Proposal writing, documentation, community communications" },
    { key: "security", label: "Security", icon: "🛡️", description: "Audit assistance, vulnerability scanning, security monitoring" },
    { key: "custom", label: "Custom", icon: "🔧", description: "Custom agents and integrations" },
]

// ── Seed Agents ──────────────────────────────────────────────

export const SEED_AGENTS: AgentListing[] = [
    {
        id: "memba-mcp",
        name: "Memba MCP Server",
        description: "Official Memba MCP server — query DAOs, proposals, validators, and contributor data from the Gno blockchain.",
        longDescription: `The official Memba MCP server provides 9 tools for interacting with the Gno ecosystem:

- **memba_query_render** — Query any realm's Render() output
- **memba_query_eval** — Evaluate realm functions via vm/qeval
- **memba_get_balance** — Check GNOT balance for any address
- **memba_get_dao** — Get DAO overview (members, proposals, config)
- **memba_get_proposal** — Get proposal details with vote data
- **memba_get_contributors** — Gnolove contributor leaderboard
- **memba_get_contributor** — Single contributor profile
- **memba_get_repositories** — Tracked Gnolove repositories
- **memba_get_network** — Current chain status (height, validators)

Works with Claude Desktop, Cursor, and any MCP-compatible client.`,
        category: "analytics",
        capabilities: ["Query realm Render()", "Evaluate realm functions", "Check balances", "DAO overview", "Proposal details", "Contributor data", "Network status"],
        creator: "g1samouraiworld",
        creatorName: "Samourai.world",
        mcpEndpoint: "node /path/to/memba/mcp-server/build/index.js",
        mcpTransport: "stdio",
        pricing: "free",
        pricePerCall: 0,
        rating: 5,
        ratingCount: 1,
        totalCalls: 0,
        tags: ["official", "gno", "dao", "proposals", "validators", "gnolove"],
        version: "0.1.0",
        verified: true,
    },
    {
        id: "gov-analyst",
        name: "GovDAO Analyst",
        description: "Analyzes GovDAO proposals, summarizes voting patterns, and recommends vote positions based on historical data.",
        category: "governance",
        capabilities: ["Proposal summarization", "Vote pattern analysis", "Risk assessment", "Historical comparison"],
        creator: "g1example1",
        creatorName: "GnoBuilder",
        mcpEndpoint: "https://agents.example.com/gov-analyst",
        mcpTransport: "streamable-http",
        pricing: "free",
        pricePerCall: 0,
        rating: 4.2,
        ratingCount: 8,
        totalCalls: 156,
        tags: ["governance", "proposals", "voting", "analysis"],
        version: "1.0.0",
        verified: false,
    },
    {
        id: "realm-auditor",
        name: "Realm Security Auditor",
        description: "Scans Gno realm source code for common vulnerabilities, unsafe patterns, and gas optimization opportunities.",
        category: "security",
        capabilities: ["Source code analysis", "Vulnerability detection", "Gas optimization", "Best practice checks"],
        creator: "g1example2",
        creatorName: "SecureGno",
        mcpEndpoint: "https://agents.example.com/realm-auditor",
        mcpTransport: "streamable-http",
        pricing: "pay-per-use",
        pricePerCall: 100000,
        rating: 4.8,
        ratingCount: 3,
        totalCalls: 42,
        tags: ["security", "audit", "smart-contract", "vulnerabilities"],
        version: "0.2.0",
        verified: false,
    },
]

// ── Queries ──────────────────────────────────────────────────

/** Get all agents (seed + on-chain registry when available). */
export function getAgents(): AgentListing[] {
    return [...SEED_AGENTS]
}

/** Get agent by ID. */
export function getAgent(id: string): AgentListing | undefined {
    return SEED_AGENTS.find(a => a.id === id)
}

/** Search agents by query string. */
export function searchAgents(query: string, category?: AgentCategory): AgentListing[] {
    let results = getAgents()
    if (category) {
        results = results.filter(a => a.category === category)
    }
    if (query) {
        const q = query.toLowerCase()
        results = results.filter(a =>
            a.name.toLowerCase().includes(q) ||
            a.description.toLowerCase().includes(q) ||
            a.tags.some(t => t.includes(q)) ||
            a.capabilities.some(c => c.toLowerCase().includes(q)),
        )
    }
    return results
}

// ── MCP Config Generation ────────────────────────────────────

export interface McpConfig {
    mcpServers: Record<string, {
        command?: string
        args?: string[]
        url?: string
        transport?: string
    }>
}

/** Generate MCP client config for an agent. */
export function generateMcpConfig(agent: AgentListing): McpConfig {
    if (agent.mcpTransport === "stdio") {
        const parts = agent.mcpEndpoint.split(" ")
        return {
            mcpServers: {
                [agent.id]: {
                    command: parts[0],
                    args: parts.slice(1),
                },
            },
        }
    }

    return {
        mcpServers: {
            [agent.id]: {
                url: agent.mcpEndpoint,
                transport: agent.mcpTransport,
            },
        },
    }
}
