import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { directRpcCall, resilientAbciQuery } from "../rpcFallback"
import { encodeBech32 } from "../templates/dao/v2/bech32"
import { resolveDaoKind } from "./kind"
import { getDAOConfig } from "./config"
import { getDAOMembers, getMemberRole } from "./members"
import { getDAOProposals, getProposalDetail, getProposalVotes, invalidateProposalCache } from "./proposals"
import { V2_MAX_PROPOSAL_PAGES } from "./membaV2Shell"

vi.mock("../rpcFallback", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../rpcFallback")>()),
    directRpcCall: vi.fn(),
    resilientAbciQuery: vi.fn(),
}))
vi.mock("./kind", async (importOriginal) => ({ ...(await importOriginal<typeof import("./kind")>()), resolveDaoKind: vi.fn() }))

const REALM = "gno.land/r/memba/v2_reads"
const RPC = "https://rpc.invalid"
const fixture = (name: string) => readFileSync(join(import.meta.dirname, "testdata", "memba-v2", `${name}.txt`), "utf8").trim()
const wire = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`
const addr = (n: number) => encodeBech32("g", [0x4d, ...new Array(17).fill(0), (n >> 8) & 255, n & 255])

let replies: Record<string, string> = {}
const expressions: string[] = []

function reply(text: string) {
    return { response: { ResponseBase: { Data: btoa(String.fromCharCode(...new TextEncoder().encode(text))), Error: null } } }
}

beforeEach(() => {
    vi.clearAllMocks()
    invalidateProposalCache(REALM)
    expressions.length = 0
    replies = {
        "GetConfigJSON()": fixture("config"),
        "GetMembersJSON(0, 50)": fixture("members"),
        "GetProposalsJSON(0, 50)": fixture("proposals"),
        "GetProposalJSON(1)": fixture("proposal-text"),
        "GetVotesJSON(1, 0, 50)": fixture("votes"),
    }
    vi.mocked(resolveDaoKind).mockResolvedValue("memba-v2")
    // Render reads and the legacy JSON probes go through this layer; a version-2 realm must never reach it
    // except for username lookups on the user registry.
    vi.mocked(resilientAbciQuery).mockResolvedValue(null)
    vi.mocked(directRpcCall).mockImplementation(async (_url, method, params) => {
        if (method === "status") return { node_info: { network: "pearl-1" } }
        const full = new TextDecoder().decode(Uint8Array.from(params!.data.slice(2).match(/../g)!, (h) => parseInt(h, 16)))
        const expression = full.slice(REALM.length + 1)
        expressions.push(expression)
        const text = replies[expression]
        if (text === undefined) return { response: { ResponseBase: { Data: null, Error: { msg: "unknown" } } } }
        return reply(text)
    })
})

function realmQueriesThroughLegacyLayer(): string[] {
    return vi.mocked(resilientAbciQuery).mock.calls.map(([path, data]) => `${path} ${data}`).filter((c) => c.includes(REALM))
}

describe("version-2 DAOs in the generic readers", () => {
    it("reads the configuration from JSON", async () => {
        const config = await getDAOConfig(RPC, REALM, true)
        expect(config).toMatchObject({ name: 'Reads "DAO" \\ é 🚀', threshold: "60%", memberCount: 3, isArchived: false, memberstorePath: "" })
        expect(config?.v2?.execution_delay).toBe(3600)
        expect(expressions).toEqual(["GetConfigJSON()"])
        expect(realmQueriesThroughLegacyLayer()).toEqual([])
    })

    it("reads members from JSON with their voting power", async () => {
        const members = await getDAOMembers(RPC, REALM, undefined, true)
        expect(members.map((m) => [m.address, m.votingPower, m.roles])).toEqual([
            ["g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", 50, ["lead"]],
            ["g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", 30, ["member"]],
            ["g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq", 20, []],
        ])
        expect(expressions).toEqual(["GetMembersJSON(0, 50)"])
        expect(realmQueriesThroughLegacyLayer()).toEqual([])
    })

    it("pages through a roster larger than one page", async () => {
        const all = Array.from({ length: 60 }, (_, i) => ({ address: addr(i + 1), power: 1, roles: [] }))
        replies["GetMembersJSON(0, 50)"] = wire({ total: 60, offset: 0, members: all.slice(0, 50) })
        replies["GetMembersJSON(50, 50)"] = wire({ total: 60, offset: 50, members: all.slice(50) })
        const members = await getDAOMembers(RPC, REALM, undefined, true)
        expect(members).toHaveLength(60)
        expect(expressions).toEqual(["GetMembersJSON(0, 50)", "GetMembersJSON(50, 50)"])
    })

    it("finds one member's role without resolving usernames", async () => {
        const member = await getMemberRole(RPC, REALM, "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c")
        expect(member).toMatchObject({ roles: ["lead"], votingPower: 50 })
        expect(await getMemberRole(RPC, REALM, addr(9))).toBeNull()
    })

    it("lists proposals newest first with the realm's own status and power tallies", async () => {
        const proposals = await getDAOProposals(RPC, REALM, true)
        expect(proposals.map((p) => [p.id, p.status, p.v2?.status])).toEqual([[3, "rejected", "REJECTED"], [2, "open", "ACTIVE"], [1, "executed", "EXECUTED"]])
        const active = proposals[1]
        expect(active).toMatchObject({ yesVotes: 50, noVotes: 20, yesPercent: 50, noPercent: 20, actionType: "add_member", author: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" })
        expect(expressions).toEqual(["GetProposalsJSON(0, 50)"])
        expect(realmQueriesThroughLegacyLayer()).toEqual([])
    })

    it("follows the cursor and stops at the page limit", async () => {
        const page = (first: number) => ({
            proposals: Array.from({ length: 50 }, (_, i) => {
                const id = first - i
                return {
                    id, title: `p${id}`, category: "governance", author: addr(1), action: { kind: "text", target: "", power: 0, roles: [] },
                    electorate_power: 10, electorate_version: 0, created_at: 100, voting_ends_at: 200, status: "EXPIRED",
                    yes: 0, no: 0, abstain: 0, accepted_at: 0, executable_at: 0, execute_by: 0,
                }
            }),
            next_before: first - 49,
        })
        let first = 1000
        replies["GetProposalsJSON(0, 50)"] = wire(page(first))
        for (let i = 1; i <= V2_MAX_PROPOSAL_PAGES + 2; i++) {
            const before = first - 49
            first -= 50
            replies[`GetProposalsJSON(${before}, 50)`] = wire(page(first))
        }
        const proposals = await getDAOProposals(RPC, REALM, true)
        expect(proposals).toHaveLength(50 * V2_MAX_PROPOSAL_PAGES)
        expect(expressions).toHaveLength(V2_MAX_PROPOSAL_PAGES)
        expect(expressions[1]).toBe("GetProposalsJSON(951, 50)")
    })

    it("reads one proposal with its description, and its votes by address", async () => {
        const detail = await getProposalDetail(RPC, REALM, 1)
        expect(detail).toMatchObject({ id: 1, description: "line1\nline2 <b>", status: "executed" })
        expect(detail?.v2).toMatchObject({ accepted_at: 1234567890, executable_at: 1234571490, execute_by: 1234657890 })
        const votes = await getProposalVotes(RPC, REALM, 1)
        expect(votes).toEqual([{ tier: "Members", vppm: 0, noVoters: [], abstainVoters: [], yesVoters: [
            { username: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", profileUrl: "" },
            { username: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", profileUrl: "" },
        ] }])
        expect(expressions).toEqual(["GetProposalJSON(1)", "GetVotesJSON(1, 0, 50)"])
        expect(realmQueriesThroughLegacyLayer()).toEqual([])
    })

    it("surfaces a failed JSON read to strict callers instead of parsing Render", async () => {
        delete replies["GetProposalsJSON(0, 50)"]
        await expect(getDAOProposals(RPC, REALM, true)).rejects.toThrow()
        expect(await getDAOProposals(RPC, REALM, false)).toEqual([])
        expect(realmQueriesThroughLegacyLayer()).toEqual([])
    })

    it("does not read the realm another way when its kind cannot be resolved", async () => {
        vi.mocked(resolveDaoKind).mockRejectedValue(new Error("RPC down"))
        await expect(getDAOConfig(RPC, REALM, true)).rejects.toThrow("RPC down")
        expect(await getDAOConfig(RPC, REALM)).toBeNull()
        expect(await getDAOMembers(RPC, REALM)).toEqual([])
        expect(await getDAOProposals(RPC, REALM)).toEqual([])
        expect(realmQueriesThroughLegacyLayer()).toEqual([])
        expect(expressions).toEqual([])
    })

    it("leaves other contracts on their existing readers", async () => {
        vi.mocked(resolveDaoKind).mockResolvedValue("memba-v1")
        await getDAOConfig(RPC, REALM)
        expect(expressions).toEqual([])
        expect(realmQueriesThroughLegacyLayer().some((c) => c.startsWith("vm/qrender"))).toBe(true)
    })
})
