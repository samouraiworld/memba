import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { directRpcCall } from "../rpcFallback"
import { parseWeightedQeval } from "./weighted"
import {
    hasVotedV2,
    membaV2ConfigSchema,
    membaV2ProposalSchema,
    membaV2ProposalsSchema,
    readV2Config,
    readV2Members,
    readV2Proposal,
    readV2Proposals,
    readV2Votes,
} from "./membaV2"

vi.mock("../rpcFallback", async (importOriginal) => ({ ...(await importOriginal<typeof import("../rpcFallback")>()), directRpcCall: vi.fn() }))

// Fixtures are real realm outputs captured by daoTemplate.v2.gno.test.ts.
const fixture = (name: string) => readFileSync(join(import.meta.dirname, "testdata", "memba-v2", `${name}.txt`), "utf8").trim()
const json = (name: string) => parseWeightedQeval(fixture(name)) as Record<string, unknown>
const wire = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`

const ctx = { rpcUrl: "https://selected.invalid", chainId: "test-chain", realmPath: "gno.land/r/memba/v2_reads" }
const BOB = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const CAROL = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"

let replies: Record<string, string> = {}
let network = ctx.chainId
const expressions: string[] = []

beforeEach(() => {
    vi.clearAllMocks()
    network = ctx.chainId
    expressions.length = 0
    replies = {
        "GetConfigJSON()": fixture("config"),
        "GetMembersJSON(0, 50)": fixture("members"),
        "GetMembersJSON(1, 1)": fixture("members-page2"),
        "GetProposalsJSON(0, 50)": fixture("proposals"),
        "GetProposalsJSON(0, 2)": fixture("proposals-page"),
        "GetProposalsJSON(2, 2)": fixture("proposals-last"),
        "GetProposalJSON(1)": fixture("proposal-text"),
        "GetProposalJSON(2)": fixture("proposal-add"),
        "GetVotesJSON(1, 0, 50)": fixture("votes"),
        [`HasVoted(2, address("${CAROL}"))`]: fixture("hasvoted-true"),
        [`HasVoted(2, address("${BOB}"))`]: fixture("hasvoted-false"),
    }
    vi.mocked(directRpcCall).mockImplementation(async (_url, method, params) => {
        if (method === "status") return { node_info: { network } }
        const full = new TextDecoder().decode(Uint8Array.from(params!.data.slice(2).match(/../g)!, (h) => parseInt(h, 16)))
        expect(full.startsWith(`${ctx.realmPath}.`)).toBe(true)
        const expression = full.slice(ctx.realmPath.length + 1)
        expressions.push(expression)
        const reply = replies[expression]
        if (reply === undefined) return { response: { ResponseBase: { Data: null, Error: { msg: "unknown" } } } }
        return { response: { ResponseBase: { Data: btoa(String.fromCharCode(...new TextEncoder().encode(reply))), Error: null } } }
    })
})

describe("memba v2 reader — real realm outputs", () => {
    it("reads the configuration, including escaped Unicode text", async () => {
        const config = await readV2Config(ctx)
        expect(config).toMatchObject({
            template_version: "memba-dao/2", api_version: "2.0", name: 'Reads "DAO" \\ é 🚀',
            description: "First line\nSecond <b>line</b>", threshold: 60, quorum: 0,
            voting_period: 7200, execution_delay: 1800, execution_window: 86400,
            member_count: 3, total_power: 100, proposal_count: 3, archived: false,
        })
    })

    it("reads member pages", async () => {
        const all = await readV2Members(ctx)
        expect(all.total).toBe(3)
        expect(all.members.map((m) => m.power)).toEqual([50, 30, 20])
        expect(all.members.find((m) => m.address === CAROL)?.roles).toEqual([])
        const page = await readV2Members(ctx, { offset: 1, limit: 1 })
        expect(page.members).toHaveLength(1)
        expect(page.members[0]).toEqual(all.members[1])
    })

    it("reads proposal pages newest first with a cursor", async () => {
        const first = await readV2Proposals(ctx, 0, 2)
        expect(first.proposals.map((p) => p.id)).toEqual([3, 2])
        expect(first.next_before).toBe(2)
        const last = await readV2Proposals(ctx, first.next_before, 2)
        expect(last.proposals.map((p) => p.id)).toEqual([1])
        expect(last.next_before).toBe(0)
        const all = await readV2Proposals(ctx, 0, 50)
        expect(all.proposals.map((p) => [p.id, p.action.kind, p.status])).toEqual([[3, "archive", "REJECTED"], [2, "add_member", "ACTIVE"], [1, "text", "EXECUTED"]])
    })

    it("reads one proposal with its action, timing and description", async () => {
        const text = await readV2Proposal(ctx, 1)
        expect(text).toMatchObject({ id: 1, title: 'say "hi" \\ 🚀', description: "line1\nline2 <b>", status: "EXECUTED", yes: 80, electorate_power: 100 })
        expect(text.executable_at - text.accepted_at).toBe(1800)
        expect(text.execute_by - text.executable_at).toBe(86400)
        const add = await readV2Proposal(ctx, 2)
        expect(add.action).toEqual({ kind: "add_member", target: expect.stringMatching(/^g1/), power: 5, roles: ["member"] })
        expect(add.accepted_at).toBe(0)
    })

    it("reads votes and HasVoted", async () => {
        const votes = await readV2Votes(ctx, 1)
        expect(votes.total).toBe(2)
        expect(votes.votes.every((v) => v.choice === "YES")).toBe(true)
        expect(await hasVotedV2(ctx, 2, CAROL)).toBe(true)
        expect(await hasVotedV2(ctx, 2, BOB)).toBe(false)
    })

    it("sends reads only to the selected endpoint", async () => {
        await readV2Config(ctx)
        expect(vi.mocked(directRpcCall).mock.calls.every((c) => c[0] === ctx.rpcUrl)).toBe(true)
        expect(expressions).toEqual(["GetConfigJSON()"])
    })
})

describe("memba v2 reader — refuses what it cannot trust", () => {
    it("refuses an endpoint serving another chain", async () => {
        network = "other-chain"
        await expect(readV2Config(ctx)).rejects.toThrow("network")
        expect(expressions).toEqual([])
    })

    it("refuses another template version, unknown fields and out-of-range settings", async () => {
        const config = json("config")
        expect(membaV2ConfigSchema.safeParse(config).success).toBe(true)
        for (const change of [{ template_version: "memba-dao/1" }, { api_version: "1.0" }, { threshold: 50 }, { extra: true }, { member_count: 101 }]) {
            replies["GetConfigJSON()"] = wire({ ...config, ...change })
            await expect(readV2Config(ctx)).rejects.toThrow()
        }
    })

    it("accepts ARCHIVED for proposals closed by archiving, accepted or not", () => {
        const text = json("proposal-text")
        const add = json("proposal-add")
        expect(membaV2ProposalSchema.safeParse({ ...text, status: "ARCHIVED" }).success).toBe(true)
        expect(membaV2ProposalSchema.safeParse({ ...add, status: "ARCHIVED" }).success).toBe(true)
    })

    it("refuses inconsistent proposals and forged pages", () => {
        const text = json("proposal-text")
        expect(membaV2ProposalSchema.safeParse(text).success).toBe(true)
        for (const change of [
            { status: "ACCEPTED", accepted_at: 0 },
            { status: "ACTIVE" },
            { yes: 101 },
            { action: { kind: "text", target: CAROL, power: 0, roles: [] } },
            { action: { kind: "add_member", target: CAROL, power: 0, roles: [] } },
            { action: { kind: "call_realm", target: "", power: 0, roles: [] } },
            { author: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59d" },
        ]) {
            expect(membaV2ProposalSchema.safeParse({ ...text, ...change }).success, JSON.stringify(change)).toBe(false)
        }
        const page = json("proposals") as { proposals: unknown[]; next_before: number }
        expect(membaV2ProposalsSchema.safeParse(page).success).toBe(true)
        expect(membaV2ProposalsSchema.safeParse({ ...page, proposals: [...page.proposals].reverse() }).success).toBe(false)
        expect(membaV2ProposalsSchema.safeParse({ ...page, next_before: 7 }).success).toBe(false)
    })

    it("refuses a page that does not match the cursor or the requested id", async () => {
        replies["GetProposalsJSON(2, 2)"] = fixture("proposals-page")
        await expect(readV2Proposals(ctx, 2, 2)).rejects.toThrow("cursor")
        replies["GetProposalJSON(1)"] = fixture("proposal-add")
        await expect(readV2Proposal(ctx, 1)).rejects.toThrow("id")
        replies["GetMembersJSON(1, 1)"] = fixture("members")
        await expect(readV2Members(ctx, { offset: 1, limit: 1 })).rejects.toThrow()
    })

    it("validates arguments before any request", async () => {
        await expect(readV2Proposal(ctx, 0)).rejects.toThrow("id")
        await expect(readV2Members(ctx, { offset: 0, limit: 51 })).rejects.toThrow("size")
        await expect(readV2Proposals(ctx, -1)).rejects.toThrow("cursor")
        await expect(hasVotedV2(ctx, 1, 'g1") + evil(')).rejects.toThrow()
        await expect(readV2Config({ ...ctx, realmPath: "gno.land/r/x/evil\")" })).rejects.toThrow("realm path")
        expect(directRpcCall).not.toHaveBeenCalled()
    })

    it("treats a failed or empty query as an error, never as empty data", async () => {
        delete replies["GetVotesJSON(1, 0, 50)"]
        await expect(readV2Votes(ctx, 1)).rejects.toThrow("failed")
        replies[`HasVoted(2, address("${BOB}"))`] = "(1 int)"
        await expect(hasVotedV2(ctx, 2, BOB)).rejects.toThrow("bool")
    })
})
