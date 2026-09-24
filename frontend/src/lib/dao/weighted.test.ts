import native from "./testdata/weighted-native.json"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { assertWeightedWrites, buildWeightedMessage, parseWeightedQeval, readWeightedProposal, readWeightedSnapshot, weightedConfigSchema, weightedMembersSchema, weightedProposalSchema } from "./weighted"
import { directRpcCall } from "../rpcFallback"
import { qevalWire, weightedFixture, weightedRealm } from "./testdata/weighted"
vi.mock("../rpcFallback", async importOriginal => ({ ...await importOriginal<typeof import("../rpcFallback")>(), directRpcCall: vi.fn() }))
const ctx = { realmPath: weightedRealm, rpcUrl: "https://selected.invalid", chainId: "test-chain" }
let fixture = weightedFixture()
beforeEach(() => {
    vi.clearAllMocks(); fixture = weightedFixture()
    vi.mocked(directRpcCall).mockImplementation(async (_url, method, params) => {
        if (method === "status") return { node_info: { network: ctx.chainId } }
        const expr = new TextDecoder().decode(Uint8Array.from(params!.data.slice(2).match(/../g)!, h => parseInt(h, 16)))
        const value = expr.includes("GetConfigJSON") ? fixture.config : expr.includes("GetMembersJSON") ? fixture.roster : expr.includes("GetProposalJSON(") ? { schema: fixture.config.schema, kind: "proposal", proposal: fixture.proposal } : fixture.page
        const Data = btoa(String.fromCharCode(...new TextEncoder().encode(qevalWire(value))))
        return { response: { ResponseBase: { Data, Error: null } } }
    })
})
describe("weighted contract", () => {
    it("round-trips Unicode, escapes and duplicate-field rejection", () => {
        expect(parseWeightedQeval(qevalWire(fixture.roster))).toEqual(fixture.roster)
        expect(parseWeightedQeval(qevalWire("\x7f").replace("\x7f", String.raw`\x7f`))).toBe("\x7f")
        expect(parseWeightedQeval(qevalWire("🚀").replace("🚀", String.raw`\U0001f680`))).toBe("🚀")
        const duplicate = '("' + JSON.stringify('{"role":"admin","role":"finance"}').slice(1, -1) + '" string)'
        expect(() => parseWeightedQeval(duplicate)).toThrow("Duplicate")
        expect(() => parseWeightedQeval(String.raw`("\q" string)`)).toThrow()
        expect(() => parseWeightedQeval('{"kind":"config"}')).toThrow()
    })
    it("rejects unsupported capabilities, altered policy, unknown fields and duplicate seats", () => {
        expect(weightedConfigSchema.safeParse(fixture.config).success).toBe(true)
        expect(weightedConfigSchema.safeParse({ ...fixture.config, totalPoints: 9 }).success).toBe(false)
        expect(weightedConfigSchema.safeParse({ ...fixture.config, capabilities: { ...fixture.config.capabilities, treasuryExecution: true } }).success).toBe(false)
        expect(weightedConfigSchema.safeParse({ ...fixture.config, bypass: true }).success).toBe(false)
        fixture.roster.members[1] = fixture.roster.members[0]
        expect(weightedMembersSchema.safeParse(fixture.roster).success).toBe(false)
    })
    it("keeps unavailable historical tallies distinct and rejects inconsistent readiness", () => {
        const parse = (p: unknown) => weightedProposalSchema.safeParse({ schema: fixture.config.schema, kind: "proposal", proposal: p }).success
        expect(parse(fixture.proposal)).toBe(true)
        expect(parse({ ...fixture.proposal, ready: true })).toBe(false)
        expect(parse({ ...fixture.proposal, peopleYes: 2 })).toBe(false)
        expect(parse({ ...fixture.proposal, status: "EXPIRED" })).toBe(false)
        const executed = { ...fixture.proposal, status: "EXECUTED", talliesAvailable: false, weightYes: null, peopleYes: null, developersYes: null }
        expect(parse(executed)).toBe(true)
        expect(parse({ ...executed, weightYes: 0 })).toBe(false)
        expect(parse({ ...fixture.proposal, votingDeadline: "2026-09-23T10:00:00Z" })).toBe(false)
    })
    it("reads only the selected endpoint and validates the returned realm and chain", async () => {
        const result = await readWeightedSnapshot(ctx)
        expect(result.members).toEqual(fixture.members)
        expect(vi.mocked(directRpcCall).mock.calls.every(c => c[0] === ctx.rpcUrl)).toBe(true)
        fixture.config.realmPath = "gno.land/r/samcrew/foreign"
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow("realm")
        vi.mocked(directRpcCall).mockResolvedValueOnce({ node_info: { network: "another-chain" } })
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow("network")
    })
    it("refuses forged pages, malformed replies and proposal substitution", async () => {
        fixture.page.total = "2"
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow()
        fixture.page.total = "1"
        await expect(readWeightedProposal(ctx, "2")).rejects.toThrow("ID")
        vi.mocked(directRpcCall).mockResolvedValueOnce({ node_info: { network: ctx.chainId } }).mockResolvedValueOnce({ response: { ResponseBase: { Error: { message: "panic" }, Data: "" } } })
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow()
    })
    it("preserves uint64 IDs and exact governed entrypoints without sent coins", () => {
        const caller = fixture.members[0].address, max = "18446744073709551615"
        expect(buildWeightedMessage(caller, weightedRealm, { type: "vote", id: max, vote: "yes" }, fixture.config.schema).value).toEqual({ caller, send: "", pkg_path: weightedRealm, func: "Vote", args: [max, "yes"] })
        expect(buildWeightedMessage(caller, weightedRealm, { type: "execute", id: max }, fixture.config.schema).value.func).toBe("Execute")
        expect(buildWeightedMessage(caller, weightedRealm, { type: "propose", target: fixture.members[1].address, role: "finance", grant: false }, fixture.config.schema).value.args).toEqual([fixture.members[1].address, "finance", "false"])
        for (const id of ["0", "01", "-1", "1e3", "18446744073709551616", '1);panic("x")']) expect(() => buildWeightedMessage(caller, weightedRealm, { type: "execute", id }, fixture.config.schema)).toThrow()
    })
    it("blocks mainnet and stale wallet/network contexts unconditionally", () => {
        expect(() => assertWeightedWrites("gnoland-1", "gnoland-1", "gnoland-1", fixture.config.schema)).toThrow("hold")
        expect(() => assertWeightedWrites("pearl", "pearl", "other", fixture.config.schema)).toThrow()
        expect(() => assertWeightedWrites("pearl", "other", "pearl", fixture.config.schema)).toThrow()
        expect(() => assertWeightedWrites("pearl", "pearl", "pearl", fixture.config.schema)).not.toThrow()
    })
})


it("accepts exact structured output from the pinned generated realm", () => {
    expect(native.gnoRef).toBe("31b6650a100d9baf14e7669f8f0df924f1f841e0")
    expect(weightedConfigSchema.parse(native.records.config).realmPath).toBe(weightedRealm)
    for (const state of ["initial", "granted", "removed"]) {
        const members = weightedMembersSchema.parse(parseWeightedQeval(qevalWire(native.records[state]))).members
        expect(members.reduce((n, m) => n + m.weight, 0)).toBe(8)
    }
    const executed = weightedProposalSchema.parse(native.records.executed).proposal
    expect(executed.status).toBe("EXECUTED")
    expect(executed.weightYes).toBeNull()
})
