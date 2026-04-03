/**
 * Agent Registry — data layer for the AI Agent Marketplace.
 *
 * Queries the on-chain agent registry realm via ABCI, with seed data fallback
 * when the realm is unreachable or not yet deployed.
 *
 * @module lib/agentRegistry
 */

import { queryRender } from "./dao/shared"
import { GNO_RPC_URL, API_BASE_URL } from "./config"
import { MEMBA_DAO } from "./config"
import { api } from "./api"
import type { Token } from "../gen/memba/v1/memba_pb"

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

export interface AgentReview {
    reviewer: string
    rating: number
    comment: string
    blockHeight: number
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

// ── Seed Agents (fallback) ──────────────────────────────────

export const SEED_AGENTS: AgentListing[] = [
    {
        id: "memba-mcp",
        name: "Memba MCP Server",
        description: "Official Memba MCP server — query DAOs, proposals, validators, and contributor data from the Gno blockchain.",
        longDescription: `The official Memba MCP server (@samouraiworld/memba-mcp) provides 9 tools for interacting with the Gno ecosystem:

- **memba_query_render** — Query any realm's Render() output
- **memba_query_eval** — Evaluate realm functions via vm/qeval
- **memba_get_balance** — Check GNOT balance for any address
- **memba_get_dao** — Get DAO overview (members, proposals, config)
- **memba_get_proposal** — Get proposal details with vote data
- **memba_get_contributors** — Gnolove contributor leaderboard
- **memba_get_contributor** — Single contributor profile
- **memba_get_repositories** — Tracked Gnolove repositories
- **memba_get_network** — Current chain status (height, validators)

Works with Claude Desktop, Cursor, and any MCP-compatible client.

Install: npx @samouraiworld/memba-mcp
Configure GNO_RPC_URL to point to your preferred network.`,
        category: "analytics",
        capabilities: [
            "Query realm Render()",
            "Evaluate realm functions",
            "Check GNOT balances",
            "DAO overview & members",
            "Proposal details & votes",
            "Contributor leaderboard",
            "Repository tracking",
            "Network status",
        ],
        creator: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0",
        creatorName: "Samourai.world",
        mcpEndpoint: "npx @samouraiworld/memba-mcp",
        mcpTransport: "stdio",
        pricing: "free",
        pricePerCall: 0,
        rating: 0,
        ratingCount: 0,
        totalCalls: 0,
        tags: ["official", "gno", "dao", "proposals", "validators", "gnolove", "mcp"],
        version: "0.1.0",
        verified: true,
    },
]

// ── Cache ───────────────────────────────────────────────────

const CACHE_TTL = 60_000 // 1 minute
let agentCache: { agents: AgentListing[]; ts: number } | null = null

function getCachedAgents(): AgentListing[] | null {
    if (!agentCache) return null
    if (Date.now() - agentCache.ts > CACHE_TTL) {
        agentCache = null
        return null
    }
    return agentCache.agents
}

// ── On-Chain Queries ────────────────────────────────────────

/**
 * Parse agent registry Render("") table output into AgentListing[].
 *
 * Expected format:
 *   | ID | Name | Category | Rating | Pricing |
 *   | --- | --- | --- | --- | --- |
 *   | memba-mcp | [Memba MCP Server](:agent/memba-mcp) | development | 5.0 (1) | free |
 */
export function parseAgentTable(raw: string): AgentListing[] {
    const agents: AgentListing[] = []
    const lines = raw.split("\n")

    for (const line of lines) {
        // Skip non-table lines, headers, and separator rows
        if (!line.startsWith("|") || line.startsWith("| ID") || line.startsWith("| ---")) continue

        const cols = line.split("|").map(c => c.trim()).filter(Boolean)
        if (cols.length < 5) continue

        const id = cols[0]
        // Extract name from markdown link: [Name](:agent/id)
        const nameMatch = cols[1].match(/\[(.+?)\]/)
        const name = nameMatch ? nameMatch[1] : cols[1]
        const category = cols[2] as AgentCategory
        // Parse rating: "4.5 (3)" or "unrated"
        const ratingMatch = cols[3].match(/^([\d.]+)\s*\((\d+)\)/)
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0
        const ratingCount = ratingMatch ? parseInt(ratingMatch[2]) : 0
        // Parse pricing: "free", "pay-per-use (100000 ugnot)", "subscription"
        const pricingRaw = cols[4]
        let pricing: "free" | "pay-per-use" | "subscription" = "free"
        let pricePerCall = 0
        if (pricingRaw.startsWith("pay-per-use")) {
            pricing = "pay-per-use"
            const priceMatch = pricingRaw.match(/\((\d+)\s*ugnot\)/)
            pricePerCall = priceMatch ? parseInt(priceMatch[1]) : 0
        } else if (pricingRaw === "subscription") {
            pricing = "subscription"
        }

        agents.push({
            id, name, description: "", category, capabilities: [],
            creator: "", mcpEndpoint: "", mcpTransport: "stdio",
            pricing, pricePerCall, rating, ratingCount, totalCalls: 0,
            tags: [], version: "", verified: false,
        })
    }

    return agents
}

/**
 * Parse agent detail from Render("agent/{id}") output.
 *
 * Expected format:
 *   # AgentName
 *   description text
 *
 *   **ID:** agent-id
 *   **Category:** development
 *   **Creator:** g1addr...
 *   **Endpoint:** https://...
 *   **Transport:** stdio
 *   **Pricing:** free
 *   **Price:** 100000 ugnot/call
 *   **Version:** 1.0.0
 *   **Total Calls:** 42
 *   **Registered:** block 12345
 *   **Rating:** 4.5 (3 reviews)
 *
 *   ## Capabilities
 *   - cap1
 *   - cap2
 *
 *   ## Reviews
 *   **g1addr...** [*****] (block 123)
 *   comment text
 */
export function parseAgentDetail(raw: string): { agent: Partial<AgentListing>; reviews: AgentReview[] } | null {
    if (!raw || raw.includes("# 404")) return null

    const lines = raw.split("\n")
    const agent: Partial<AgentListing> = {}
    const reviews: AgentReview[] = []
    let section = "header" // header | description | capabilities | reviews

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        if (line.startsWith("# ") && !line.startsWith("## ")) {
            agent.name = line.slice(2).trim()
            section = "description"
            continue
        }

        if (line === "## Capabilities") {
            section = "capabilities"
            agent.capabilities = []
            continue
        }

        if (line === "## Reviews") {
            section = "reviews"
            continue
        }

        // Parse metadata fields
        if (line.startsWith("**ID:**")) { agent.id = extractField(line); continue }
        if (line.startsWith("**Category:**")) { agent.category = extractField(line) as AgentCategory; continue }
        if (line.startsWith("**Creator:**")) { agent.creator = extractField(line); continue }
        if (line.startsWith("**Endpoint:**")) { agent.mcpEndpoint = extractField(line); continue }
        if (line.startsWith("**Transport:**")) {
            agent.mcpTransport = extractField(line) as "stdio" | "sse" | "streamable-http"
            continue
        }
        if (line.startsWith("**Pricing:**")) {
            const p = extractField(line)
            if (p === "pay-per-use") agent.pricing = "pay-per-use"
            else if (p === "subscription") agent.pricing = "subscription"
            else agent.pricing = "free"
            continue
        }
        if (line.startsWith("**Price:**")) {
            const m = line.match(/(\d+)\s*ugnot/)
            agent.pricePerCall = m ? parseInt(m[1]) : 0
            continue
        }
        if (line.startsWith("**Version:**")) { agent.version = extractField(line); continue }
        if (line.startsWith("**Total Calls:**")) { agent.totalCalls = parseInt(extractField(line)) || 0; continue }
        if (line.startsWith("**Rating:**")) {
            const ratingMatch = line.match(/([\d.]+)\s*\((\d+)\s*reviews?\)/)
            if (ratingMatch) {
                agent.rating = parseFloat(ratingMatch[1])
                agent.ratingCount = parseInt(ratingMatch[2])
            }
            continue
        }

        // Capabilities section
        if (section === "capabilities" && line.startsWith("- ")) {
            agent.capabilities!.push(line.slice(2).trim())
            continue
        }

        // Description (lines between title and first ** field)
        if (section === "description" && !line.startsWith("**") && line.trim()) {
            agent.description = (agent.description || "") + (agent.description ? "\n" : "") + line
            continue
        }

        // Reviews section: **g1addr...** [*****] (block 123)
        if (section === "reviews" && line.startsWith("**")) {
            const reviewMatch = line.match(/\*\*(.+?)\*\*\s*\[([*.]+)\]\s*\(block (\d+)\)/)
            if (reviewMatch) {
                const stars = reviewMatch[2].split("").filter(c => c === "*").length
                // Find the comment: skip empty lines, take first non-separator content line
                let comment = ""
                for (let j = i + 1; j < lines.length; j++) {
                    const nextLine = lines[j].trim()
                    if (nextLine === "---") break
                    if (nextLine === "") continue
                    comment = nextLine
                    break
                }
                reviews.push({
                    reviewer: reviewMatch[1],
                    rating: stars,
                    comment,
                    blockHeight: parseInt(reviewMatch[3]),
                })
            }
        }
    }

    return { agent, reviews }
}

function extractField(line: string): string {
    const idx = line.indexOf(":**")
    if (idx === -1) return ""
    return line.slice(idx + 3).trim()
}

/**
 * Fetch all agents. Tries backend cache first, then direct ABCI, then seed data.
 */
export async function fetchAgents(): Promise<AgentListing[]> {
    const cached = getCachedAgents()
    if (cached) return cached

    // Try backend cached proxy first (60s server-side TTL)
    const raw = await fetchAgentsRaw()
    if (!raw || raw.includes("No agents registered")) {
        return [...SEED_AGENTS]
    }

    const onChainAgents = parseAgentTable(raw)
    if (onChainAgents.length === 0) {
        return [...SEED_AGENTS]
    }

    // Enrich each agent with detail data (endpoint, capabilities, etc.)
    const enriched = await Promise.all(
        onChainAgents.map(async (stub) => {
            try {
                const detail = await fetchAgentDetail(stub.id)
                return detail || stub
            } catch {
                return stub
            }
        }),
    )

    agentCache = { agents: enriched, ts: Date.now() }
    return enriched
}

/** Fetch raw agent listing — backend proxy with ABCI fallback. */
async function fetchAgentsRaw(): Promise<string | null> {
    // Try backend proxy first
    try {
        const backendUrl = API_BASE_URL || ""
        const resp = await fetch(`${backendUrl}/api/marketplace/agents`)
        if (resp.ok) return resp.text()
    } catch { /* fallback to direct ABCI */ }

    // Direct ABCI fallback
    try {
        return await queryRender(GNO_RPC_URL, MEMBA_DAO.agentRegistryPath, "")
    } catch {
        return null
    }
}

/**
 * Fetch a single agent's full detail.
 * Backend proxy with ABCI fallback.
 */
export async function fetchAgentDetail(id: string): Promise<AgentListing | null> {
    const raw = await fetchAgentDetailRaw(id)
    if (!raw) return null
    const result = parseAgentDetail(raw)
    if (!result) return null

    const a = result.agent
    return {
        id: a.id || id,
        name: a.name || "",
        description: a.description || "",
        category: a.category || "custom",
        capabilities: a.capabilities || [],
        creator: a.creator || "",
        mcpEndpoint: a.mcpEndpoint || "",
        mcpTransport: a.mcpTransport || "stdio",
        pricing: a.pricing || "free",
        pricePerCall: a.pricePerCall || 0,
        rating: a.rating || 0,
        ratingCount: a.ratingCount || 0,
        totalCalls: a.totalCalls || 0,
        tags: [],
        version: a.version || "",
        verified: false,
    }
}

/** Fetch raw agent detail — backend proxy with ABCI fallback. */
async function fetchAgentDetailRaw(id: string): Promise<string | null> {
    try {
        const backendUrl = API_BASE_URL || ""
        const resp = await fetch(`${backendUrl}/api/marketplace/agents?id=${encodeURIComponent(id)}`)
        if (resp.ok) return resp.text()
    } catch { /* fallback */ }

    try {
        return await queryRender(GNO_RPC_URL, MEMBA_DAO.agentRegistryPath, `agent/${id}`)
    } catch {
        return null
    }
}

/** Invalidate the agent cache (call after registration or review). */
export function invalidateAgentCache(): void {
    agentCache = null
}

// ── Sync Queries (for initial render / search) ──────────────

/** Get all agents synchronously (seed data only — use fetchAgents for chain). */
export function getAgents(): AgentListing[] {
    return getCachedAgents() || [...SEED_AGENTS]
}

/** Get agent by ID (sync, from cache or seed). */
export function getAgent(id: string): AgentListing | undefined {
    const cached = getCachedAgents()
    if (cached) return cached.find(a => a.id === id)
    return SEED_AGENTS.find(a => a.id === id)
}

/** Search agents by query string (sync). */
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

// ── Favorites & Stats (via ConnectRPC backend) ──────────────

export interface AgentStats {
    viewCount: number
    favoriteCount: number
}

/** Toggle favorite for an agent. Returns true if now favorited, false if removed. */
export async function toggleFavorite(authToken: Token, agentId: string): Promise<boolean> {
    const res = await api.favoriteAgent({ authToken, agentId })
    return res.favorited
}

/** Get the current user's favorited agent IDs. */
export async function getFavorites(authToken: Token): Promise<string[]> {
    const res = await api.getFavorites({ authToken })
    return res.agentIds || []
}

/** Get public stats (views + favorites) for an agent. */
export async function getAgentStats(agentId: string): Promise<AgentStats> {
    const res = await api.getAgentStats({ agentId })
    return {
        viewCount: res.stats?.viewCount || 0,
        favoriteCount: res.stats?.favoriteCount || 0,
    }
}
