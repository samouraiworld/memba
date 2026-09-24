import { beforeEach, expect, it, vi } from "vitest"
import native from "./testdata/weighted-recovery-native.json"
import { buildWeightedMessage, readWeightedSnapshot, validateWeightedRecovery, weightedAuthority, weightedConfigSchema, weightedMembersSchema, weightedProposalSchema } from "./weighted"
import { directRpcCall } from "../rpcFallback"
import { bech32Encode } from "./realmAddress"
import { qevalWire, weightedFixture, weightedRealm } from "./testdata/weighted"
vi.mock("../rpcFallback", async original => ({ ...await original<typeof import("../rpcFallback")>(), directRpcCall: vi.fn() }))
const ctx = { realmPath: weightedRealm, rpcUrl: "https://selected.invalid", chainId: "test" }
const replacement = bech32Encode("g", new Uint8Array(20).fill(9))
let fixture = weightedFixture(2)
beforeEach(() => {
    fixture = weightedFixture(2)
    vi.mocked(directRpcCall).mockImplementation(async (_url, method, params) => {
        if (method === "status") return { node_info: { network: "test" } }
        const expression = new TextDecoder().decode(Uint8Array.from(params!.data.slice(2).match(/../g)!, h => parseInt(h, 16)))
        const value = expression.includes("GetConfigJSON") ? fixture.config : expression.includes("GetMembersJSON") ? fixture.roster : fixture.page
        return { response: { ResponseBase: { Data: btoa(String.fromCharCode(...new TextEncoder().encode(qevalWire(value)))), Error: null } } }
    })
})
it("accepts v1/v2 only with their exact capabilities and rejects mixed responses", async () => {
    expect(weightedConfigSchema.safeParse(weightedFixture().config).success).toBe(true)
    expect(weightedConfigSchema.safeParse(fixture.config).success).toBe(true)
    expect(weightedConfigSchema.safeParse({ ...fixture.config, schema: "memba-weighted-host/v1" }).success).toBe(false)
    expect(weightedConfigSchema.safeParse({ ...fixture.config, schema: "memba-weighted-host/v3" }).success).toBe(false)
    fixture.roster.schema = "memba-weighted-host/v1"
    await expect(readWeightedSnapshot(ctx)).rejects.toThrow("Mixed")
})
it("checks the recovery checksum, exact current seat and unused replacement", async () => {
    const snapshot = await readWeightedSnapshot(ctx)
    const action = { type: "recover" as const, personId: fixture.members[0].personId, oldAddress: fixture.members[0].address, newAddress: replacement }
    expect(() => validateWeightedRecovery(snapshot, action)).not.toThrow()
    expect(buildWeightedMessage(fixture.members[1].address, weightedRealm, action, fixture.config.schema).value).toMatchObject({ func: "ProposeRecovery", args: [action.personId, action.oldAddress, replacement], send: "" })
    expect(() => validateWeightedRecovery(snapshot, { ...action, personId: "another human" })).toThrow("seat changed")
    expect(() => validateWeightedRecovery(snapshot, { ...action, newAddress: fixture.members[1].address })).toThrow("already belongs")
    expect(() => validateWeightedRecovery(snapshot, { ...action, newAddress: replacement.slice(0, -1) + (replacement.endsWith("q") ? "p" : "q") })).toThrow("checksum")
    snapshot.config = weightedConfigSchema.parse(weightedFixture().config)
    expect(() => validateWeightedRecovery(snapshot, action)).toThrow("does not support")
})
it("preserves former-member actors only in terminal v2 history", async () => {
    const oldAddress = fixture.members[0].address
    fixture.members[0].address = replacement
    fixture.proposal.action = { type: "recover-member", personId: fixture.members[0].personId, oldAddress, newAddress: replacement }
    fixture.proposal.status = "EXECUTED"; fixture.proposal.talliesAvailable = false
    fixture.proposal.weightYes = fixture.proposal.peopleYes = fixture.proposal.developersYes = null
    expect((await readWeightedSnapshot(ctx)).page.proposals[0].proposer).toBe(oldAddress)
    fixture.proposal.status = "VOTING"; fixture.proposal.talliesAvailable = true
    fixture.proposal.weightYes = fixture.proposal.peopleYes = fixture.proposal.developersYes = 0
    await expect(readWeightedSnapshot(ctx)).rejects.toThrow("current members")
})
it("binds authority to identities, keys, weights and roles, independent of roster display order", async () => {
    const snapshot = await readWeightedSnapshot(ctx)
    const same = structuredClone(snapshot); same.members.reverse()
    expect(weightedAuthority(snapshot)).toBe(weightedAuthority(same))
    for (const field of ["address", "personId", "admin", "finance", "weight", "founder"] as const) {
        const changed = structuredClone(snapshot)
        const m = changed.members[0]
        if (field === "address") m.address = replacement
        if (field === "personId") m.personId = "changed"
        if (field === "admin" || field === "finance" || field === "founder") m[field] = !m[field]
        if (field === "weight") m.weight = 1
        expect(weightedAuthority(changed)).not.toBe(weightedAuthority(snapshot))
    }
})
it("accepts exact native v2 recovery output and rejects it under v1", () => {
    expect(weightedConfigSchema.parse(native.records.config).schema).toBe("memba-weighted-host/v2")
    const before = weightedMembersSchema.parse(native.records.removed).members
    const after = weightedMembersSchema.parse(native.records.recovered).members
    const proposal = weightedProposalSchema.parse(native.records.recovery).proposal
    expect(proposal.action.type).toBe("recover-member")
    expect(weightedProposalSchema.safeParse({ ...native.records.recovery, schema: "memba-weighted-host/v1" }).success).toBe(false)
    expect(before[0].address).not.toBe(after[0].address)
    expect({ ...before[0], address: after[0].address }).toEqual(after[0])
    expect(weightedProposalSchema.parse(native.records.replacement_vote).proposal.weightYes).toBe(2)
})
