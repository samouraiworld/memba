/**
 * agentTemplate.test.ts — Comprehensive tests for the AI agent registry template.
 *
 * Covers:
 * 1. Chain API compliance (runtime.*, banker.*, chain.*, no std.*)
 * 2. Input validation (realm path, address format)
 * 3. Security patterns (access control, state management)
 * 4. Config embedding & string escaping
 * 5. MsgCall builders (register, review, deposit, refund, deploy)
 * 6. Query helpers (getAgents, searchAgents, getAgent)
 * 7. MCP config generation (stdio, HTTP)
 */

import { describe, it, expect } from "vitest"
import {
    generateAgentRegistryCode,
    buildRegisterAgentMsg,
    buildReviewAgentMsg,
    buildDepositCreditsMsg,
    buildRefundCreditsMsg,
    buildDeployAgentRegistryMsg,
    type AgentRegistryConfig,
} from "./agentTemplate"
import {
    getAgents,
    getAgent,
    searchAgents,
    generateMcpConfig,
    SEED_AGENTS,
    AGENT_CATEGORIES,
} from "./agentRegistry"

// ── Fixtures ──────────────────────────────────────────────────

const DEFAULT_CONFIG: AgentRegistryConfig = {
    realmPath: "gno.land/r/test/agent_registry",
    name: "Test Agent Registry",
    description: "A test agent registry for unit testing",
    adminAddress: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
}

function getCode(): string {
    return generateAgentRegistryCode(DEFAULT_CONFIG)
}

function getImportBlock(code: string): string {
    return code.match(/import \([\s\S]*?\)/)?.[0] || ""
}

function getFuncBody(code: string, funcName: string, nextFuncName?: string): string {
    const start = code.indexOf(`func ${funcName}`)
    if (start === -1) return ""
    const end = nextFuncName ? code.indexOf(`func ${nextFuncName}`) : code.length
    return code.slice(start, end === -1 ? code.length : end)
}

// ── 1. Chain API Compliance ───────────────────────────────────

describe("generateAgentRegistryCode — chain API compliance", () => {
    it("generates valid package declaration from realm path", () => {
        expect(getCode()).toContain("package agent_registry")
    })

    it("imports chain, chain/banker, and chain/runtime, NOT std", () => {
        const importBlock = getImportBlock(getCode())
        expect(importBlock).toContain('"chain"')
        expect(importBlock).toContain('"chain/banker"')
        expect(importBlock).toContain('"chain/runtime"')
        expect(importBlock).not.toContain('"std"')
    })

    it("uses runtime.PreviousRealm().Address() for caller identity", () => {
        const code = getCode()
        expect(code).toContain("runtime.PreviousRealm().Address()")
        expect(code).not.toContain("std.PreviousRealm()")
        expect(code).not.toContain("chain.PreviousRealm()")
        expect(code).not.toContain(".Addr()")
    })

    it("uses runtime.ChainHeight() for block height", () => {
        const code = getCode()
        expect(code).toContain("runtime.ChainHeight()")
        expect(code).not.toContain("std.GetHeight()")
        expect(code).not.toContain("chain.GetHeight()")
    })

    it("uses runtime.CurrentRealm().Address() for realm address", () => {
        const code = getCode()
        expect(code).toContain("runtime.CurrentRealm().Address()")
        expect(code).not.toContain("std.CurrentRealm()")
        expect(code).not.toContain("chain.CurrentRealm()")
    })

    it("uses banker.OriginSend() for payment checks", () => {
        const code = getCode()
        expect(code).toContain("banker.OriginSend()")
        expect(code).not.toContain("std.GetOrigSend")
    })

    it("uses banker.NewBanker(banker.BankerTypeRealmSend)", () => {
        const code = getCode()
        expect(code).toContain("banker.NewBanker(banker.BankerTypeRealmSend)")
        expect(code).not.toContain("std.GetBanker")
        expect(code).not.toContain("chain.GetBanker")
    })

    it("uses chain.Coins{chain.NewCoin(...)}", () => {
        const code = getCode()
        expect(code).toContain("chain.Coins{chain.NewCoin(")
        expect(code).not.toContain("std.Coins")
    })

    it("uses address type (not std.Address)", () => {
        const code = getCode()
        expect(code).toContain("Creator      address")
        expect(code).not.toContain("std.Address")
    })

    it("does NOT contain any deprecated std.* API anywhere", () => {
        expect(getCode()).not.toMatch(/\bstd\.\w/)
    })

    it("banker variable does not shadow banker import", () => {
        const code = getCode()
        expect(code).toContain("bnk := banker.NewBanker")
        expect(code).toContain("bnk.SendCoins")
        expect(code).not.toMatch(/\bbanker\s*:=/)
    })

    it("uses custom package name derived from realm path", () => {
        const config = { ...DEFAULT_CONFIG, realmPath: "gno.land/r/org/my_agents" }
        expect(generateAgentRegistryCode(config)).toContain("package my_agents")
    })
})

// ── 2. Input Validation ──────────────────────────────────────

describe("generateAgentRegistryCode — input validation", () => {
    it("rejects invalid realm path (missing gno.land/r/ prefix)", () => {
        const config = { ...DEFAULT_CONFIG, realmPath: "invalid/path" }
        expect(() => generateAgentRegistryCode(config)).toThrow("Invalid realm path")
    })

    it("rejects realm path with uppercase", () => {
        const config = { ...DEFAULT_CONFIG, realmPath: "gno.land/r/Test/registry" }
        expect(() => generateAgentRegistryCode(config)).toThrow("Invalid realm path")
    })

    it("accepts valid realm path", () => {
        const config = { ...DEFAULT_CONFIG, realmPath: "gno.land/r/samcrew/agents_v2" }
        expect(() => generateAgentRegistryCode(config)).not.toThrow()
    })

    it("rejects invalid address (wrong prefix)", () => {
        const config = { ...DEFAULT_CONFIG, adminAddress: "0x1234567890" }
        expect(() => generateAgentRegistryCode(config)).toThrow("Invalid Gno address")
    })

    it("rejects address with wrong length", () => {
        const config = { ...DEFAULT_CONFIG, adminAddress: "g1short" }
        expect(() => generateAgentRegistryCode(config)).toThrow("Invalid Gno address")
    })

    it("accepts valid g1 address (40 chars)", () => {
        expect(() => getCode()).not.toThrow()
    })
})

// ── 3. Config Embedding ──────────────────────────────────────

describe("generateAgentRegistryCode — config embedding", () => {
    it("embeds admin address", () => {
        expect(getCode()).toContain(`AdminAddress   = "${DEFAULT_CONFIG.adminAddress}"`)
    })

    it("embeds registry name", () => {
        expect(getCode()).toContain(`RegistryName   = "${DEFAULT_CONFIG.name}"`)
    })

    it("embeds registry description", () => {
        expect(getCode()).toContain(`RegistryDesc   = "${DEFAULT_CONFIG.description}"`)
    })

    it("escapes quotes in name", () => {
        const config = { ...DEFAULT_CONFIG, name: 'My "Agent" Hub' }
        const code = generateAgentRegistryCode(config)
        expect(code).toContain('My \\"Agent\\" Hub')
    })

    it("escapes newlines in description", () => {
        const config = { ...DEFAULT_CONFIG, description: "Line1\nLine2" }
        const code = generateAgentRegistryCode(config)
        expect(code).toContain("Line1\\nLine2")
    })
})

// ── 4. Security Patterns ─────────────────────────────────────

describe("agentTemplate security", () => {
    it("RegisterAgent stores caller as Creator", () => {
        const body = getFuncBody(getCode(), "RegisterAgent", "UpdateAgent")
        expect(body).toContain("runtime.PreviousRealm().Address()")
        expect(body).toContain("Creator:")
    })

    it("UpdateAgent restricts to creator", () => {
        const body = getFuncBody(getCode(), "UpdateAgent", "ReviewAgent")
        expect(body).toContain('panic("only the creator can update")')
    })

    it("RemoveAgent restricts to creator or admin", () => {
        const body = getFuncBody(getCode(), "RemoveAgent", "DepositCredits")
        expect(body).toContain("AdminAddress")
    })

    it("ReviewAgent validates rating 1-5", () => {
        const body = getFuncBody(getCode(), "ReviewAgent", "RemoveAgent")
        expect(body).toContain("rating < 1 || rating > 5")
    })

    it("DepositCredits checks sent coins", () => {
        const body = getFuncBody(getCode(), "DepositCredits", "UseCredit")
        expect(body).toContain("banker.OriginSend()")
    })

    it("RefundCredits sends coins and zeroes balance", () => {
        const body = getFuncBody(getCode(), "RefundCredits", "Render")
        expect(body).toContain("bnk.SendCoins")
        expect(body).toContain("credits.Set(key, int64(0))")
    })

    it("RefundCredits checks zero balance", () => {
        const body = getFuncBody(getCode(), "RefundCredits", "Render")
        expect(body).toContain('panic("zero balance")')
    })
})

// ── 5. MsgCall Builders ──────────────────────────────────────

describe("MsgCall builders", () => {
    const caller = "g1testcaller"
    const registryPath = "gno.land/r/test/agents"

    it("buildRegisterAgentMsg has correct type and func", () => {
        const msg = buildRegisterAgentMsg(caller, registryPath, "ai-1", "Agent", "Desc", "governance", "caps", "http://ep", "sse", "free", "1.0", 0)
        expect(msg.type).toBe("/vm.m_call")
        expect(msg.value.func).toBe("RegisterAgent")
        expect(msg.value.caller).toBe(caller)
        expect(msg.value.pkg_path).toBe(registryPath)
    })

    it("buildRegisterAgentMsg passes all args in order", () => {
        const msg = buildRegisterAgentMsg(caller, registryPath, "id1", "Name", "Desc", "dev", "cap1,cap2", "endpoint", "stdio", "free", "2.0", 500)
        expect(msg.value.args).toEqual(["id1", "Name", "Desc", "dev", "cap1,cap2", "endpoint", "stdio", "free", "2.0", "500"])
    })

    it("buildRegisterAgentMsg converts pricePerCall to string", () => {
        const msg = buildRegisterAgentMsg(caller, registryPath, "id", "N", "D", "c", "cap", "ep", "t", "p", "v", 42)
        expect(msg.value.args[9]).toBe("42")
    })

    it("buildReviewAgentMsg has correct structure", () => {
        const msg = buildReviewAgentMsg(caller, registryPath, "agent-1", 5, "Great agent!")
        expect(msg.type).toBe("/vm.m_call")
        expect(msg.value.func).toBe("ReviewAgent")
        expect(msg.value.args).toEqual(["agent-1", "5", "Great agent!"])
        expect(msg.value.send).toBe("")
    })

    it("buildDepositCreditsMsg includes send amount", () => {
        const msg = buildDepositCreditsMsg(caller, registryPath, "agent-1", 5000000)
        expect(msg.type).toBe("/vm.m_call")
        expect(msg.value.func).toBe("DepositCredits")
        expect(msg.value.send).toBe("5000000ugnot")
        expect(msg.value.args).toEqual(["agent-1"])
    })

    it("buildRefundCreditsMsg has no send", () => {
        const msg = buildRefundCreditsMsg(caller, registryPath, "agent-1")
        expect(msg.type).toBe("/vm.m_call")
        expect(msg.value.func).toBe("RefundCredits")
        expect(msg.value.send).toBe("")
    })

    it("buildDeployAgentRegistryMsg uses /vm.m_addpkg", () => {
        const code = getCode()
        const msg = buildDeployAgentRegistryMsg(caller, registryPath, code)
        expect(msg.type).toBe("/vm.m_addpkg")
        expect(msg.value.creator).toBe(caller)
        expect(msg.value.package.name).toBe("agents")
        expect(msg.value.package.path).toBe(registryPath)
        expect(msg.value.package.files[0].name).toBe("agents.gno")
        expect(msg.value.package.files[0].body).toBe(code)
    })
})

// ── 6. Query Helpers (agentRegistry.ts) ──────────────────────

describe("getAgents / getAgent / searchAgents", () => {
    it("getAgents returns all seed agents", () => {
        const agents = getAgents()
        expect(agents.length).toBeGreaterThanOrEqual(1)
    })

    it("getAgents returns a copy (not the original array)", () => {
        const a = getAgents()
        const b = getAgents()
        expect(a).not.toBe(b)
        expect(a).toEqual(b)
    })

    it("getAgent returns agent by known ID", () => {
        const agent = getAgent("memba-mcp")
        expect(agent).toBeDefined()
        expect(agent?.name).toBe("Memba MCP Server")
    })

    it("getAgent returns undefined for unknown ID", () => {
        expect(getAgent("nonexistent")).toBeUndefined()
    })

    it("searchAgents matches by name (case-insensitive)", () => {
        const results = searchAgents("memba")
        expect(results.length).toBeGreaterThan(0)
        expect(results.some(a => a.id === "memba-mcp")).toBe(true)
    })

    it("searchAgents matches by description", () => {
        const results = searchAgents("proposals")
        expect(results.length).toBeGreaterThan(0)
    })

    it("searchAgents matches by tag", () => {
        const results = searchAgents("gno")
        expect(results.length).toBeGreaterThan(0)
    })

    it("searchAgents matches by capability", () => {
        const results = searchAgents("balances")
        expect(results.length).toBeGreaterThan(0)
    })

    it("searchAgents filters by category", () => {
        const results = searchAgents("", "security")
        for (const r of results) {
            expect(r.category).toBe("security")
        }
    })

    it("searchAgents returns all with empty query and no category", () => {
        expect(searchAgents("").length).toBe(SEED_AGENTS.length)
    })

    it("searchAgents returns empty for no matches", () => {
        expect(searchAgents("zzz_nonexistent_zzz")).toHaveLength(0)
    })

    it("AGENT_CATEGORIES has all 7 categories", () => {
        expect(AGENT_CATEGORIES).toHaveLength(7)
        const keys = AGENT_CATEGORIES.map(c => c.key)
        expect(keys).toContain("governance")
        expect(keys).toContain("development")
        expect(keys).toContain("security")
        expect(keys).toContain("custom")
    })

    it("all seed agents have valid required fields", () => {
        for (const agent of SEED_AGENTS) {
            expect(agent.id).toBeTruthy()
            expect(agent.name).toBeTruthy()
            expect(agent.description).toBeTruthy()
            expect(agent.capabilities.length).toBeGreaterThan(0)
            expect(agent.mcpEndpoint).toBeTruthy()
            expect(agent.tags.length).toBeGreaterThan(0)
            expect(agent.rating).toBeGreaterThanOrEqual(0)
            expect(agent.rating).toBeLessThanOrEqual(5)
        }
    })

    it("seed agents have unique IDs", () => {
        const ids = SEED_AGENTS.map(a => a.id)
        expect(new Set(ids).size).toBe(ids.length)
    })
})

// ── 7. MCP Config Generation ─────────────────────────────────

describe("generateMcpConfig", () => {
    it("generates stdio config from command endpoint", () => {
        const agent = SEED_AGENTS.find(a => a.mcpTransport === "stdio")!
        const config = generateMcpConfig(agent)
        const server = config.mcpServers[agent.id]
        expect(server.command).toBeTruthy()
        expect(server.args).toBeDefined()
        expect(Array.isArray(server.args)).toBe(true)
    })

    it("splits stdio endpoint into command and args", () => {
        const agent = { ...SEED_AGENTS[0], mcpEndpoint: "node /path/to/index.js --flag", mcpTransport: "stdio" as const }
        const config = generateMcpConfig(agent)
        const server = config.mcpServers[agent.id]
        expect(server.command).toBe("node")
        expect(server.args).toEqual(["/path/to/index.js", "--flag"])
    })

    it("generates HTTP config for non-stdio transport", () => {
        const agent = { ...SEED_AGENTS[0], id: "http-agent", mcpEndpoint: "https://example.com/mcp", mcpTransport: "streamable-http" as const }
        const config = generateMcpConfig(agent)
        const server = config.mcpServers["http-agent"]
        expect(server.url).toBe("https://example.com/mcp")
        expect(server.transport).toBe("streamable-http")
    })

    it("uses agent ID as server key", () => {
        for (const agent of SEED_AGENTS) {
            const config = generateMcpConfig(agent)
            expect(config.mcpServers).toHaveProperty(agent.id)
        }
    })
})
