import { describe, it, expect } from "vitest"
import { parseAgentTable, parseAgentDetail } from "./agentRegistry"

describe("parseAgentTable", () => {
    it("parses a single agent table", () => {
        const raw = `# Memba Agent Registry

On-chain AI Agent Marketplace for the Gno ecosystem.

## Agents

| ID | Name | Category | Rating | Pricing |
| --- | --- | --- | --- | --- |
| memba-mcp | [Memba MCP Server](:agent/memba-mcp) | analytics | unrated | free |`

        const agents = parseAgentTable(raw)
        expect(agents).toHaveLength(1)

        expect(agents[0].id).toBe("memba-mcp")
        expect(agents[0].name).toBe("Memba MCP Server")
        expect(agents[0].category).toBe("analytics")
        expect(agents[0].pricing).toBe("free")
    })

    it("parses multiple agents with varied pricing", () => {
        const raw = `| ID | Name | Category | Rating | Pricing |
| --- | --- | --- | --- | --- |
| memba-mcp | [Memba MCP Server](:agent/memba-mcp) | analytics | 4.5 (2) | free |
| paid-agent | [Paid Agent](:agent/paid-agent) | security | unrated | pay-per-use (100000 ugnot) |`

        const agents = parseAgentTable(raw)
        expect(agents).toHaveLength(2)

        expect(agents[0].rating).toBe(4.5)
        expect(agents[0].ratingCount).toBe(2)

        expect(agents[1].pricing).toBe("pay-per-use")
        expect(agents[1].pricePerCall).toBe(100000)
    })

    it("returns empty array for empty registry", () => {
        const raw = `# Memba Agent Registry

*No agents registered yet.*`
        expect(parseAgentTable(raw)).toHaveLength(0)
    })

    it("returns empty array for empty input", () => {
        expect(parseAgentTable("")).toHaveLength(0)
    })

    it("skips header and separator rows", () => {
        const raw = `| ID | Name | Category | Rating | Pricing |
| --- | --- | --- | --- | --- |`
        expect(parseAgentTable(raw)).toHaveLength(0)
    })

    it("parses subscription pricing", () => {
        const raw = `| sub-agent | [Sub Agent](:agent/sub-agent) | analytics | 3.5 (2) | subscription |`
        const agents = parseAgentTable(raw)
        expect(agents[0].pricing).toBe("subscription")
    })
})

describe("parseAgentDetail", () => {
    it("parses a full agent detail with reviews", () => {
        const raw = `# Memba MCP Server

Official Memba MCP server — query DAOs, proposals, validators, and contributor data from the Gno blockchain.

**ID:** memba-mcp
**Category:** analytics
**Creator:** g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0
**Endpoint:** npx @samouraiworld/memba-mcp
**Transport:** stdio
**Pricing:** free
**Version:** 0.1.0
**Total Calls:** 12
**Registered:** block 500
**Rating:** 5.0 (2 reviews)

## Capabilities

- Query realm Render()
- Evaluate realm functions
- Check GNOT balances
- DAO overview & members

## Reviews

**g1abc12...** [*****] (block 600)

Works great for DAO analysis

---

**g1def34...** [****.] (block 700)

Solid toolset

---`

        const result = parseAgentDetail(raw)
        expect(result).not.toBeNull()

        const { agent, reviews } = result!
        expect(agent.name).toBe("Memba MCP Server")
        expect(agent.id).toBe("memba-mcp")
        expect(agent.category).toBe("analytics")
        expect(agent.creator).toBe("g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0")
        expect(agent.mcpEndpoint).toBe("npx @samouraiworld/memba-mcp")
        expect(agent.mcpTransport).toBe("stdio")
        expect(agent.pricing).toBe("free")
        expect(agent.version).toBe("0.1.0")
        expect(agent.totalCalls).toBe(12)
        expect(agent.rating).toBe(5.0)
        expect(agent.ratingCount).toBe(2)
        expect(agent.capabilities).toEqual([
            "Query realm Render()",
            "Evaluate realm functions",
            "Check GNOT balances",
            "DAO overview & members",
        ])

        expect(reviews).toHaveLength(2)
        expect(reviews[0].rating).toBe(5)
        expect(reviews[0].comment).toBe("Works great for DAO analysis")
        expect(reviews[0].blockHeight).toBe(600)
        expect(reviews[1].rating).toBe(4)
        expect(reviews[1].comment).toBe("Solid toolset")
    })

    it("returns null for 404", () => {
        expect(parseAgentDetail("# 404\nAgent not found")).toBeNull()
    })

    it("returns null for empty input", () => {
        expect(parseAgentDetail("")).toBeNull()
    })

    it("parses pay-per-use agent", () => {
        const raw = `# Paid Agent

A paid agent

**ID:** paid
**Category:** security
**Pricing:** pay-per-use
**Price:** 100000 ugnot/call
**Transport:** streamable-http
**Endpoint:** https://example.com/mcp

## Capabilities

- Scan code`

        const result = parseAgentDetail(raw)
        expect(result).not.toBeNull()
        expect(result!.agent.pricing).toBe("pay-per-use")
        expect(result!.agent.pricePerCall).toBe(100000)
        expect(result!.agent.mcpTransport).toBe("streamable-http")
    })
})
