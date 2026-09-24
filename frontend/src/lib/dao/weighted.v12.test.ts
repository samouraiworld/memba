import { beforeEach, describe, expect, it, vi } from "vitest"
import native from "./testdata/weighted-v12/native.json"
import policySource from "./testdata/weighted-v12/memba_weighted_policy.gno.txt?raw"
import { readWeightedProposal, readWeightedSnapshot, validateWeightedRecovery, weightedApplicationPolicies, weightedConfigSchema, weightedMembersSchema, weightedPageSchema, weightedProposalSchema, WEIGHTED_APPLICATIONS_SCHEMA } from "./weighted"
import { APPLICATION_POLICY_KEYS, IMMEDIATE_THRESHOLDS, applicationDetails, expectedCategory, flattenBefore, type WeightedApplicationAction } from "./weightedApplications"
import { directRpcCall } from "../rpcFallback"
import { qevalWire, weightedFixture } from "./testdata/weighted"
vi.mock("../rpcFallback", async importOriginal => ({ ...await importOriginal<typeof import("../rpcFallback")>(), directRpcCall: vi.fn() }))

type Json = Record<string, unknown>
const records = native.records as unknown as Record<string, Json>
const realmPath = "gno.land/r/samcrew/memba_dao"
const ctx = { realmPath, rpcUrl: "https://selected.invalid", chainId: "gnoland-1" }
const proposalRecord = (id: number) => structuredClone(records[`proposal_${id}`]) as Json & { proposal: Json & { action: Json } }
const parseProposal = (value: unknown) => weightedProposalSchema.safeParse(value).success
let replies: { config: unknown; members: unknown; pages: Record<string, unknown>; proposals: Record<string, unknown> }

beforeEach(() => {
    vi.clearAllMocks()
    replies = {
        config: structuredClone(records.config), members: structuredClone(records.members),
        pages: { "0": structuredClone(records.proposals_page_1), "7": structuredClone(records.proposals_page_2) },
        proposals: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [String(i + 1), structuredClone(records[`proposal_${i + 1}`])])),
    }
    vi.mocked(directRpcCall).mockImplementation(async (_url, method, params) => {
        if (method === "status") return { node_info: { network: ctx.chainId } }
        const expr = new TextDecoder().decode(Uint8Array.from(params!.data.slice(2).match(/../g)!, h => parseInt(h, 16)))
        const call = expr.slice(realmPath.length + 1)
        const value = call === "GetConfigJSON()" ? replies.config : call === "GetMembersJSON()" ? replies.members
            : call.startsWith("GetProposalsJSON(") ? replies.pages[call.slice(17).split(",")[0]] : replies.proposals[call.slice(16, -1)]
        return { response: { ResponseBase: { Data: btoa(String.fromCharCode(...new TextEncoder().encode(qevalWire(value)))), Error: null } } }
    })
})

describe("weighted host v12 native reads", () => {
    it("records the pinned runtime and generated candidate", () => {
        expect(native.gnoRef).toBe("e75fef82c02876a4df92ad6e325c5479b9532168")
        expect(native.realm).toBe(realmPath)
        expect(Object.keys(native.realmSha256)).toHaveLength(12)
        expect(native.realmSha256["memba_dao.gno"]).toBe("06b0d79e6c07dc4da9346b7dc57b117bb35ea4c5ddbf9259869f427f619bcdc7")
    })

    it("accepts the config with application actions and all ten adapter policies", () => {
        const config = weightedConfigSchema.parse(records.config)
        expect(config.schema).toBe(WEIGHTED_APPLICATIONS_SCHEMA)
        expect(config.capabilities).toEqual({ roleProposals: true, memberReplacement: true, migration: false, treasuryExecution: false, applicationActions: true })
        expect(weightedApplicationPolicies(config).map(p => p.key)).toEqual(APPLICATION_POLICY_KEYS)
        expect(APPLICATION_POLICY_KEYS).toHaveLength(10)
        expect(weightedApplicationPolicies(config).every(({ policy }) => policy.invalidatesOtherProposals && policy.returnStagesOnly)).toBe(true)
    })

    it("rejects unknown versions, missing or extra policies and altered categories", () => {
        const config = records.config
        for (const schema of ["memba-weighted-host/v3", "memba-weighted-host/v11", "memba-weighted-host/v13", "memba-weighted-host/v12 ", undefined]) {
            expect(weightedConfigSchema.safeParse({ ...config, schema }).success).toBe(false)
        }
        const { feedbackPolicy: _dropped, ...missing } = config
        void _dropped
        expect(weightedConfigSchema.safeParse(missing).success).toBe(false)
        expect(weightedConfigSchema.safeParse({ ...config, migrationPolicy: {} }).success).toBe(false)
        expect(weightedConfigSchema.safeParse({ ...config, capabilities: { ...(config.capabilities as Json), applicationActions: false } }).success).toBe(false)
        expect(weightedConfigSchema.safeParse({ ...config, arcadePolicy: { ...(config.arcadePolicy as Json), unpauseCategory: "routine" } }).success).toBe(false)
        expect(weightedConfigSchema.safeParse({ ...config, questPolicy: { ...(config.questPolicy as Json), extra: true } }).success).toBe(false)
        expect(weightedConfigSchema.safeParse({ ...config, marketPolicy: { ...(config.marketPolicy as Json), invalidatesOtherProposals: false } }).success).toBe(false)
        // A v2 config cannot carry adapters, and v12 policies cannot relabel an older version.
        expect(weightedConfigSchema.safeParse({ ...config, schema: "memba-weighted-host/v2" }).success).toBe(false)
        expect(weightedConfigSchema.safeParse({ ...weightedFixture(2).config, schema: WEIGHTED_APPLICATIONS_SCHEMA }).success).toBe(false)
    })

    it("accepts every native proposal and covers every action type, category and status", () => {
        const types = new Set<string>(), categories = new Set<string>(), statuses = new Set<string>()
        for (let id = 1; id <= 26; id++) {
            const parsed = weightedProposalSchema.parse(records[`proposal_${id}`])
            types.add(parsed.proposal.action.type); categories.add(parsed.proposal.category); statuses.add(parsed.proposal.status)
        }
        for (const key of ["recovery_later", "badges_later"]) expect(parseProposal(records[key])).toBe(true)
        expect([...types].sort()).toEqual(["appstore", "arcade", "badges", "channels", "escrow", "feed", "feedback", "market-config", "quest", "recover-member", "reviews", "set-role"])
        expect([...categories].sort()).toEqual(["critical", "financial", "routine"])
        expect([...statuses].sort()).toEqual(["EXECUTED", "EXPIRED", "INVALIDATED", "READY", "TIMELOCKED", "VOTING"])
        for (const page of ["proposals_page_1", "proposals_page_2", "proposals_page_small", "proposals_empty"]) expect(weightedPageSchema.safeParse(records[page]).success).toBe(true)
        expect(weightedMembersSchema.parse(records.members).members.reduce((n, m) => n + m.weight, 0)).toBe(8)
    })

    it("treats routine and financial proposals as ready once qualified, with no delay clocks", () => {
        const routine = proposalRecord(18).proposal, financial = proposalRecord(17).proposal
        expect([routine.category, routine.status, routine.weightedAfter, routine.developerAfter]).toEqual(["routine", "READY", null, null])
        expect([financial.category, financial.status, financial.weightYes, financial.peopleYes]).toEqual(["financial", "READY", 5, 4])
        const wrap = (p: Json) => ({ schema: WEIGHTED_APPLICATIONS_SCHEMA, kind: "proposal", proposal: p })
        expect(parseProposal(wrap({ ...routine, weightedAfter: routine.createdAt }))).toBe(false)
        expect(parseProposal(wrap({ ...routine, status: "TIMELOCKED", ready: false }))).toBe(false)
        expect(parseProposal(wrap({ ...routine, status: "VOTING", ready: false, qualified: false }))).toBe(false)
        // Four points never qualify a financial action, even with three people.
        const arcade = proposalRecord(20).proposal
        expect([arcade.category, arcade.status, arcade.weightYes, arcade.peopleYes]).toEqual(["financial", "VOTING", 4, 3])
        expect(parseProposal(wrap({ ...arcade, status: "READY", ready: true, qualified: true }))).toBe(false)
        // Critical timing keeps both independent routes.
        expect(proposalRecord(26).proposal.weightedAfter).not.toBeNull()
        expect(proposalRecord(26).proposal.developerAfter).not.toBeNull()
        expect((records.recovery_later as { proposal: Json }).proposal.status).toBe("READY")
        expect((records.badges_later as { proposal: Json }).proposal.status).toBe("TIMELOCKED")
    })

    it("refuses a category the host would not assign", () => {
        for (const [id, category] of [[20, "critical"], [18, "financial"], [21, "routine"], [1, "financial"]] as const) {
            const record = proposalRecord(id)
            record.proposal.category = category
            expect(parseProposal(record)).toBe(false)
        }
        expect(expectedCategory({ type: "appstore", operation: "approve" })).toBe("routine")
        expect(expectedCategory({ type: "escrow", operation: "pay-freelancer" })).toBe("financial")
        expect(expectedCategory({ type: "quest", operation: "set-signer" })).toBe("critical")
    })

    it("validates operation fields and the frozen before-state strictly", () => {
        const mutate = (id: number, change: (a: Json) => void) => { const r = proposalRecord(id); change(r.proposal.action); return parseProposal(r) }
        expect(mutate(17, a => { a.recipient = (records.config.marketPolicy as Json).treasury })).toBe(false)
        expect(mutate(17, a => { a.bps = 501 })).toBe(false)
        expect(mutate(22, a => { a.contractId = "1" })).toBe(false)
        expect(mutate(22, a => { a.operation = "withdraw" })).toBe(false)
        expect(mutate(22, a => { a.type = "treasury" })).toBe(false)
        expect(mutate(18, a => { a.id = "0" })).toBe(false)
        expect(mutate(19, a => { a.signer = (a.signer as string).toUpperCase() })).toBe(false)
        expect(mutate(21, a => { a.recipient = "" })).toBe(false)
        expect(mutate(24, a => { a.subject = "" })).toBe(false)
        expect(mutate(26, a => { a.name = "" })).toBe(false)
        expect(mutate(26, a => { (a.before as Json).unexpected = true })).toBe(false)
        expect(mutate(9, a => { ((a.before as Json).contract as Json).count = "1" })).toBe(false)
        expect(mutate(8, a => { delete (a.before as Json).listing })).toBe(false)
        expect(mutate(25, a => { a.extra = "" })).toBe(false)
    })

    it("keeps the v1/v2 action unions closed to application actions", () => {
        for (const schema of ["memba-weighted-host/v1", "memba-weighted-host/v2", "memba-weighted-host/v99"]) expect(parseProposal({ ...proposalRecord(17), schema })).toBe(false)
        expect(parseProposal({ ...proposalRecord(16), schema: "memba-weighted-host/v2" })).toBe(true)
        expect(parseProposal({ ...proposalRecord(16), schema: "memba-weighted-host/v1" })).toBe(false)
        expect(weightedPageSchema.safeParse({ ...records.proposals_page_1, schema: "memba-weighted-host/v2" }).success).toBe(false)
    })

    it("reads a snapshot and follows the native cursor to the last page", async () => {
        const first = await readWeightedSnapshot(ctx)
        expect(first.page.proposals.map(p => p.id)).toEqual(Array.from({ length: 20 }, (_, i) => String(26 - i)))
        expect(first.page.nextBefore).toBe("7")
        const second = await readWeightedSnapshot(ctx, "7")
        expect(second.page.proposals.map(p => p.id)).toEqual(["6", "5", "4", "3", "2", "1"])
        expect(second.page.nextBefore).toBeNull()
        expect((await readWeightedProposal(ctx, "18", WEIGHTED_APPLICATIONS_SCHEMA)).category).toBe("routine")
        expect(() => validateWeightedRecovery(first, { type: "recover", personId: "dadidou", oldAddress: first.members[6].address, newAddress: "g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqquyl3wcje" })).not.toThrow()
    })

    it("checks proposers for application actions but names no member target", async () => {
        const page = replies.pages["0"] as { proposals: Json[] }
        const outsider = "g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqucmwq2kd"
        page.proposals[4] = { ...page.proposals[4], proposer: outsider } // #22 escrow unpause, VOTING
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow("current members")
        page.proposals[4] = structuredClone(records.proposal_22.proposal as Json)
        // Role actions still require a current member target.
        const role = page.proposals[11] as { action: Json } // #15 set-role, VOTING
        role.action = { ...role.action, target: outsider }
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow("current members")
    })

    it("binds returns, treasury changes and the reviews target to the configured adapters", async () => {
        const config = replies.config as Json
        config.reviewsPolicy = { ...(config.reviewsPolicy as Json), target: "gno.land/r/samcrew/memba_reviews_v1" }
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow("configured adapters")
        replies.config = structuredClone(records.config)
        const page = replies.pages["0"] as { proposals: Json[] }
        const fee = page.proposals[9] as { action: Json } // #17 market set-fee
        fee.action = { ...fee.action, operation: "return-admin", lane: "", bps: 0, recipient: (records.config.marketPolicy as Json).treasury }
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow()
        fee.action = { ...fee.action, operation: "set-treasury", recipient: (records.config.marketPolicy as Json).successor }
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow("configured adapters")
    })

    it("rejects mixed versions and malformed replies without a prose fallback", async () => {
        replies.members = { ...(replies.members as Json), schema: "memba-weighted-host/v2" }
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow("Mixed")
        replies.members = structuredClone(records.members)
        replies.config = "# Memba DAO\n\nRendered markdown is never parsed"
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow()
        replies.config = { ...(records.config as Json), schema: "memba-weighted-host/v13" }
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow()
    })
})

describe("immediate thresholds", () => {
    it("match the vendored policy source recorded in the fixture provenance", async () => {
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(policySource))), b => b.toString(16).padStart(2, "0")).join("")
        expect(digest).toBe(native.packageSha256["gno.land/p/samcrew/memba_weighted_policy/policy.gno"])
        const rule = (category: string) => {
            const match = policySource.match(new RegExp(`case ${category}:\\n\\t\\ts\\.Qualified = s\\.WeightYes >= (\\d+) && s\\.PeopleYes >= (\\d+)\\n\\t\\ts\\.Ready = s\\.Qualified\\n`))
            return match && { points: Number(match[1]), people: Number(match[2]) }
        }
        expect(rule("Routine")).toEqual(IMMEDIATE_THRESHOLDS.routine)
        expect(rule("Financial")).toEqual(IMMEDIATE_THRESHOLDS.financial)
        expect(IMMEDIATE_THRESHOLDS).toEqual({ routine: { points: 3, people: 2 }, financial: { points: 5, people: 3 } })
    })
})

describe("display helpers", () => {
    it("lists only operation parameters that are set and flattens the frozen state", () => {
        const action = (id: number) => weightedProposalSchema.parse(records[`proposal_${id}`]).proposal.action as WeightedApplicationAction
        expect(applicationDetails(action(17))).toEqual([["lane", "service"], ["bps", "150"]])
        expect(applicationDetails(action(22))).toEqual([])
        expect(applicationDetails(action(18))).toEqual([["id", "1"]])
        expect(flattenBefore(action(9).before)).toContainEqual(["contract.milestones", "(none)"])
        expect(flattenBefore(action(8).before)).toContainEqual(["listing.status", "(unset)"])
    })
})
