import { beforeEach, describe, expect, it, vi } from "vitest"
import native from "./testdata/weighted-v12/native.json"
import { assertWeightedWrites, buildWeightedMessage, isUnreadableProposal, readWeightedBallot, readWeightedPendingVotes, readWeightedProposal, readWeightedSnapshot, validateWeightedRecovery, weightedBallotSchema, weightedApplicationPolicies, weightedConfigSchema, weightedMembersSchema, weightedPageSchema, weightedProposalSchema, WEIGHTED_APPLICATIONS_SCHEMA } from "./weighted"
import { APPLICATION_POLICY_KEYS, IMMEDIATE_THRESHOLDS, packageAddress, applicationDetails, expectedCategory, flattenBefore, type WeightedApplicationAction } from "./weightedApplications"
import { directRpcCall } from "../rpcFallback"
import { qevalWire, weightedFixture } from "./testdata/weighted"
vi.mock("../rpcFallback", async importOriginal => ({ ...await importOriginal<typeof import("../rpcFallback")>(), directRpcCall: vi.fn() }))

type Json = Record<string, unknown>
// Verbatim host sources: the action encoders and the policy, pinned by SHA-256.
const hostSources = Object.fromEntries(Object.entries(import.meta.glob("./testdata/weighted-v12/host/*.gno.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>)
    .map(([path, text]) => [path.split("/").pop()!.replace(/\.txt$/, ""), text]))
const policySource = hostSources["policy.gno"]
const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), b => b.toString(16).padStart(2, "0")).join("")
const records = native.records as unknown as Record<string, Json>
const opRecords = Object.entries(records).filter(([key]) => key.startsWith("op:")) as [string, Json & { proposal: Json & { action: Json } }][]
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
        expect(native.realmSha256["memba_dao.gno"]).toBe("66d3957cfbcafa4347d81e62a71aa4b524e3bd9e667cf138e7e75fc481327c33")
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
        expect(mutate(17, a => { a.bps = "501" })).toBe(false)
        expect(mutate(17, a => { a.bps = 150 })).toBe(false)
        expect(mutate(17, a => { (a.before as Json).bps = 200 })).toBe(false)
        expect(mutate(18, a => { ((a.before as Json).item as Json).rating = 5 })).toBe(false)
        expect(mutate(18, a => { const item = (a.before as Json).item as Json; item.createdAt = item.createdAtHeight; delete item.createdAtHeight })).toBe(false)
        expect(mutate(22, a => { a.milestoneIndex = "0" })).toBe(false)
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

    it("lists a proposal that does not match the configured adapters as unreadable, keeping the rest", async () => {
        const config = replies.config as Json
        config.reviewsPolicy = { ...(config.reviewsPolicy as Json), target: "gno.land/r/samcrew/memba_reviews_v1" }
        const snapshot = await readWeightedSnapshot(ctx)
        const unreadable = snapshot.page.proposals.filter(isUnreadableProposal).map(p => p.id)
        expect(unreadable).toEqual(["18"]) // the only reviews proposal on the page
        expect(snapshot.page.proposals).toHaveLength(20)
        replies.config = structuredClone(records.config)
        const page = replies.pages["0"] as { proposals: Json[] }
        const fee = page.proposals[9] as { action: Json } // #17 market set-fee
        fee.action = { ...fee.action, operation: "set-treasury", lane: "", bps: 0, recipient: (records.config.marketPolicy as Json).successor }
        expect((await readWeightedSnapshot(ctx)).page.proposals.filter(isUnreadableProposal).map(p => p.id)).toEqual(["17"])
    })

    it("keeps the workspace readable when one item is mis-encoded, but not when the page itself is", async () => {
        const page = replies.pages["0"] as { proposals: Json[] }
        const item = page.proposals[3] as { action: Json } // #23 badges add-admin
        item.action = { ...item.action, operation: "grant-everything" }
        const snapshot = await readWeightedSnapshot(ctx)
        expect(snapshot.page.proposals.filter(isUnreadableProposal)).toEqual([{ id: "23", unreadable: true }])
        expect(snapshot.page.proposals.filter(p => !isUnreadableProposal(p))).toHaveLength(19)
        // Without a decimal ID the page order and cursor cannot be checked.
        page.proposals[3] = { id: "twenty-three" }
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow()
        page.proposals[3] = { ...item, id: "22" }
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow("Invalid proposal page")
        replies.pages["0"] = { ...(records.proposals_page_1 as Json), unexpected: true }
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow()
        replies.pages["0"] = structuredClone(records.proposals_page_1)
        replies.config = { ...(records.config as Json), feedbackPolicy: { ...(records.config.feedbackPolicy as Json), memberCategory: "routine" } }
        await expect(readWeightedSnapshot(ctx)).rejects.toThrow()
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

describe("every operation the host can encode", () => {
    const TYPE_FOR: Record<string, string> = { appstore: "appstore", arcade: "arcade", badges: "badges", channels: "channels", escrow: "escrow", feed: "feed", feedback: "feedback", market: "market-config", quest: "quest", reviews: "reviews" }
    const encodable = () => Object.entries(hostSources).filter(([name]) => name.endsWith("_actions.gno"))
        .flatMap(([name, text]) => [...text.matchAll(/Kind\s*=\s*"([a-z-]+)"/g)].map(m => `${TYPE_FOR[name.split("_")[0]]}:${m[1]}`))

    it("vendors the exact host encoders and policy recorded with the fixtures", async () => {
        const names = Object.keys(hostSources).sort()
        expect(names).toEqual(["appstore_actions.gno", "arcade_actions.gno", "badges_actions.gno", "channels_actions.gno", "escrow_actions.gno", "feed_actions.gno", "feedback_actions.gno", "market_actions.gno", "policy.gno", "quest_actions.gno", "reviews_actions.gno"])
        for (const name of names) {
            const module = name === "policy.gno" ? "memba_weighted_policy" : "memba_weighted_host"
            expect(await sha256(hostSources[name]), name).toBe((native.packageSha256 as Record<string, string>)[`gno.land/p/samcrew/${module}/${name}`])
        }
    })

    it("has a native proposal for each encodable operation, and every one parses", () => {
        const ops = encodable()
        expect(ops).toHaveLength(70)
        const covered = new Set<string>()
        const all = [...opRecords.map(([, r]) => r), ...Array.from({ length: 26 }, (_, i) => records[`proposal_${i + 1}`])]
        for (const record of all) {
            const parsed = weightedProposalSchema.safeParse(record)
            expect(parsed.success, JSON.stringify((record as { proposal: Json }).proposal.action)).toBe(true)
            const action = (record as { proposal: { action: Json } }).proposal.action
            if (typeof action.operation === "string") covered.add(`${action.type}:${action.operation}`)
            else covered.add(action.type === "set-role" ? `set-role:${action.grant ? "grant" : "remove"}` : String(action.type))
        }
        expect(ops.filter(op => !covered.has(op))).toEqual([])
        for (const extra of ["set-role:grant", "set-role:remove", "recover-member"]) expect(covered.has(extra)).toBe(true)
    })

    it("accepts every operation the encoders define and nothing else", () => {
        for (const op of encodable()) {
            const [type, operation] = op.split(":")
            expect(expectedCategory({ type, operation }), op).toMatch(/^(routine|financial|critical)$/)
        }
        const [, sample] = opRecords.find(([key]) => key === "op:badges:unpause")!
        const bogus = structuredClone(sample); bogus.proposal.action.operation = "pause"
        expect(parseProposal(bogus)).toBe(false)
    })

    it("binds escrow dispute actions to the frozen contract and milestone", () => {
        const [, refund] = opRecords.find(([key]) => key === "op:escrow:refund-client")!
        const action = refund.proposal.action as Json & { before: { contract: Json } }
        expect([action.contractId, action.before.contract.id, action.before.contract.exists]).toEqual(["0", "0", true])
        expect(parseProposal(refund)).toBe(true)
        const mutate = (change: (a: Json & { before: { contract: Json } }) => void) => { const r = structuredClone(refund); change(r.proposal.action as Json & { before: { contract: Json } }); return parseProposal(r) }
        expect(mutate(a => { a.milestoneIndex = "1" })).toBe(false)
        expect(mutate(a => { a.milestoneIndex = null })).toBe(false)
        expect(mutate(a => { a.contractId = "1" })).toBe(false)
        expect(mutate(a => { a.before.contract.exists = false })).toBe(false)
        expect(mutate(a => { a.contractId = "" })).toBe(false)
    })

    it("builds no transaction for v12 on any network", async () => {
        const snapshot = await readWeightedSnapshot(ctx)
        const caller = snapshot.members[1].address, schema = snapshot.config.schema
        const actions = [
            { type: "vote", id: "17", vote: "yes" }, { type: "execute", id: "17" },
            { type: "propose", target: snapshot.members[2].address, role: "admin", grant: true },
            { type: "recover", personId: "dadidou", oldAddress: snapshot.members[6].address, newAddress: "g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqquyl3wcje" },
        ] as const
        for (const action of actions) expect(() => buildWeightedMessage(caller, realmPath, action, schema)).toThrow("read-only")
        for (const chain of ["gnoland-1", "pearl", "test13", "dev"]) expect(() => assertWeightedWrites(chain, chain, chain, schema)).toThrow()
        expect(() => assertWeightedWrites("pearl", "pearl", "pearl", "memba-weighted-host/v2")).not.toThrow()
        expect(() => validateWeightedRecovery(snapshot, actions[3])).toThrow("does not support")
    })

    it("reads the escrow_v4 re-point: fee recipient rotation, pause fields and index-numbered milestones", () => {
        const escrowPolicy = records.config.escrowPolicy as Json
        expect(escrowPolicy).toMatchObject({ target: "gno.land/r/samcrew/escrow_v4", feeRecipientCategory: "financial" })
        expect(weightedConfigSchema.safeParse({ ...records.config, escrowPolicy: { ...escrowPolicy, feeRecipientCategory: "critical" } }).success).toBe(false)
        expect(weightedConfigSchema.safeParse({ ...records.config, escrowPolicy: { ...escrowPolicy, target: "gno.land/r/samcrew/escrow_v3" } }).success).toBe(false)
        const [, rotate] = opRecords.find(([key]) => key === "op:escrow:set-fee-recipient")!
        const a = rotate.proposal.action as Json & { before: Json }
        expect([rotate.proposal.category, a.milestoneIndex, a.contractId]).toEqual(["financial", null, ""])
        expect(Object.keys(a.before)).toEqual(["owner", "pendingOwner", "feeRecipient", "pendingFeeRecipient", "paused", "pausedAt", "exitsReopenAt", "cooldownUntil", "contract", "fees"])
        const mutate = (change: (x: Json & { before: Json }) => void) => { const r = structuredClone(rotate); change(r.proposal.action as Json & { before: Json }); return parseProposal(r) }
        expect(mutate(() => undefined)).toBe(true)
        expect(mutate(x => { x.recipient = "" })).toBe(false)
        expect(mutate(x => { x.milestoneIndex = "0" })).toBe(false)
        expect(mutate(x => { x.recipient = packageAddress("gno.land/r/samcrew/escrow_v4") })).toBe(false)
        expect(mutate(x => { x.recipient = x.before.feeRecipient })).toBe(false)
        expect(mutate(x => { x.before.pendingFeeRecipient = x.recipient })).toBe(false)
        expect(mutate(x => { x.before.pendingFeeRecipient = (records.members as { members: Json[] }).members[3].address })).toBe(true)
        expect(mutate(x => { x.before.pendingFeeRecipient = null })).toBe(false)
        expect(mutate(x => { x.before.feeRecipient = "" })).toBe(false)
        expect(mutate(x => { x.before.exitsOpen = true })).toBe(false)
        expect(mutate(x => { x.before.pausedBlocks = "0" })).toBe(false)
        expect(mutate(x => { x.before.cooldownUntil = 183525 })).toBe(false)
        expect(mutate(x => { x.before.pausedAt = "5" })).toBe(false)
        // A paused pre-state must name when the pause began and when exits reopen.
        const [, unpause] = opRecords.find(([key]) => key === "op:escrow:unpause")!
        const paused = (unpause.proposal.action as { before: Json }).before
        expect(paused.paused).toBe(true)
        expect(BigInt(paused.exitsReopenAt as string)).toBeGreaterThan(BigInt(paused.pausedAt as string))
        const badPause = structuredClone(unpause); ((badPause.proposal.action as { before: Json }).before).exitsReopenAt = paused.pausedAt
        expect(parseProposal(badPause)).toBe(false)
        const [, refund] = opRecords.find(([key]) => key === "op:escrow:refund-client")!
        const milestones = ((refund.proposal.action as { before: { contract: { milestones: Json[] } } }).before.contract.milestones)
        expect(milestones.map(m => m.id)).toEqual(["0"])
        const renumbered = structuredClone(refund); ((renumbered.proposal.action as { before: { contract: { milestones: Json[] } } }).before.contract.milestones[0]).id = "1"
        expect(parseProposal(renumbered)).toBe(false)
        expect(expectedCategory({ type: "escrow", operation: "set-fee-recipient" })).toBe("financial")
    })

    it("refuses a fee recipient that is the DAO itself", async () => {
        const [, rotate] = opRecords.find(([key]) => key === "op:escrow:set-fee-recipient")!
        const page = replies.pages["0"] as { proposals: Json[] }
        const dao = packageAddress(realmPath)
        const item = structuredClone(rotate.proposal) as Json & { action: Json }
        item.id = (page.proposals[0] as Json).id
        item.proposer = (page.proposals[0] as Json).proposer
        page.proposals[0] = item
        expect((await readWeightedSnapshot(ctx)).page.proposals.filter(isUnreadableProposal)).toEqual([])
        item.action = { ...item.action, recipient: dao }
        expect((await readWeightedSnapshot(ctx)).page.proposals.filter(isUnreadableProposal).map(p => p.id)).toEqual([item.id])
        expect(dao).toBe(((records.proposal_9 as { proposal: { action: { before: Json } } }).proposal.action.before.pendingOwner))
    })

    it("keeps feedback room fields distinct from channels fields", () => {
        const [, feedback] = opRecords.find(([key]) => key === "op:feedback:set-roles")!
        const before = feedback.proposal.action.before as Json
        expect(Object.keys(before).filter(k => k.startsWith("feedbackChannel"))).toHaveLength(6)
        const renamed = structuredClone(feedback)
        const state = renamed.proposal.action.before as Json
        state.channelCount = state.feedbackChannelCount; delete state.feedbackChannelCount
        expect(parseProposal(renamed)).toBe(false)
        const [, channels] = opRecords.find(([key]) => key === "op:channels:set-roles")!
        expect(Object.keys(channels.proposal.action.before as Json)).toContain("channelCount")
    })

    it("records the generated realm's own Render, which carries no DAO sub-page links", () => {
        expect(typeof records.render).toBe("string")
        expect(records.render as unknown as string).toMatch(/^# Memba DAO\n/)
        expect(records.render as unknown as string).not.toMatch(/:proposals|\]\(/)
    })
})

describe("invalidation records and sticky expiry", () => {
    it("explains every INVALIDATED proposal and nothing else", () => {
        const all = [...opRecords.map(([, r]) => r), ...Object.entries(records).filter(([k]) => /^proposal_/.test(k)).map(([, r]) => r)]
        let invalidated = 0
        for (const record of all) {
            const p = weightedProposalSchema.parse(record).proposal
            expect(p.invalidation === null, p.id).toBe(p.status !== "INVALIDATED")
            if (p.invalidation) invalidated++
        }
        expect(invalidated).toBeGreaterThan(2)
        expect((records.proposal_2 as { proposal: Json }).proposal.invalidation).toEqual({ cause: "superseded-execution", height: expect.stringMatching(/^\d+$/), proposalId: "4", target: "gno.land/r/samcrew/memba_market_config" })
        expect((records.proposal_invalidated_by_pause as { proposal: Json }).proposal.invalidation).toMatchObject({ cause: "pause", proposalId: null, target: "gno.land/r/samcrew/gnobuilders_badges_v2" })
        expect((records.proposal_superseded as { proposal: Json }).proposal.invalidation).toMatchObject({ cause: "superseded-execution", target: null })
    })

    it("rejects missing, contradictory or self-referencing invalidation records", () => {
        const wrap = (id: string, change: (p: Json) => void) => { const r = structuredClone(records[id]) as { proposal: Json }; change(r.proposal); return parseProposal(r) }
        expect(wrap("proposal_2", p => { delete p.invalidation })).toBe(false)
        expect(wrap("proposal_2", p => { p.invalidation = null })).toBe(false)
        expect(wrap("proposal_17", p => { p.invalidation = (records.proposal_2 as { proposal: Json }).proposal.invalidation })).toBe(false)
        expect(wrap("proposal_2", p => { (p.invalidation as Json).proposalId = "2" })).toBe(false)
        expect(wrap("proposal_2", p => { (p.invalidation as Json).cause = "pause" })).toBe(false)
        expect(wrap("proposal_2", p => { (p.invalidation as Json).height = 127 })).toBe(false)
        expect(wrap("proposal_2", p => { (p.invalidation as Json).target = "gno.land/r/samcrew/elsewhere" })).toBe(false)
        expect(wrap("proposal_invalidated_by_pause", p => { (p.invalidation as Json).target = null })).toBe(false)
    })

    it("keeps an expired proposal EXPIRED after a later reconfiguration, with its tallies cleared", () => {
        const sticky = weightedProposalSchema.parse(records.proposal_expired_sticky).proposal
        expect([sticky.status, sticky.talliesAvailable, sticky.weightYes, sticky.invalidation]).toEqual(["EXPIRED", false, null, null])
        const before = weightedProposalSchema.parse(records.proposal_14).proposal
        expect([before.status, before.talliesAvailable, before.weightYes]).toEqual(["EXPIRED", true, 1])
        // Older hosts without invalidation records never clear an EXPIRED tally.
        const legacy = { schema: "memba-weighted-host/v2", kind: "proposal", proposal: { ...(records.proposal_expired_sticky as { proposal: Json }).proposal, action: { type: "set-role", target: (records.members as { members: Json[] }).members[2].address, role: "admin", grant: true } } }
        expect(parseProposal(legacy)).toBe(true)
        delete (legacy.proposal as Json).invalidation
        expect(parseProposal(legacy)).toBe(false)
    })

    it("accepts invalidation on v1/v2 proposals only when it is well-formed, and older fixtures without it", () => {
        const v2 = { ...(records.proposal_superseded as Json), schema: "memba-weighted-host/v2" }
        const action = ((v2 as { proposal: Json }).proposal.action as Json)
        expect(action.type).toBe("set-role")
        expect(parseProposal(v2)).toBe(true)
        expect(parseProposal({ ...v2, schema: "memba-weighted-host/v1" })).toBe(true)
        const broken = structuredClone(v2) as { proposal: Json }; (broken.proposal.invalidation as Json).extra = 1
        expect(parseProposal(broken)).toBe(false)
        // v1/v2 have no adapters: no pause and no application target can invalidate them.
        for (const schema of ["memba-weighted-host/v1", "memba-weighted-host/v2"]) {
            const pause = structuredClone(v2) as { schema: string; proposal: Json }; pause.schema = schema
            pause.proposal.invalidation = (records.proposal_invalidated_by_pause as { proposal: Json }).proposal.invalidation
            expect(parseProposal(pause), `${schema} pause`).toBe(false)
            const targeted = structuredClone(v2) as { schema: string; proposal: Json }; targeted.schema = schema
            targeted.proposal.invalidation = { ...(targeted.proposal.invalidation as Json), target: "gno.land/r/samcrew/memba_market_config" }
            expect(parseProposal(targeted), `${schema} target`).toBe(false)
            const pauseNoTarget = structuredClone(v2) as { schema: string; proposal: Json }; pauseNoTarget.schema = schema
            pauseNoTarget.proposal.invalidation = { ...(pauseNoTarget.proposal.invalidation as Json), cause: "pause", proposalId: null }
            expect(parseProposal(pauseNoTarget), `${schema} pause without target`).toBe(false)
        }
    })
})

describe("config category fields", () => {
    it("checks every published category against the host's own classification", () => {
        const config = records.config
        expect(config.marketPolicy).toMatchObject({ feeCategory: "financial", treasuryCategory: "financial" })
        expect(config.reviewsPolicy).toMatchObject({ moderationCategory: "routine" })
        for (const [key, field, wrong] of [["marketPolicy", "feeCategory", "critical"], ["marketPolicy", "treasuryCategory", "routine"], ["reviewsPolicy", "moderationCategory", "critical"], ["escrowPolicy", "resolutionCategory", "critical"], ["appstorePolicy", "sealCategory", "financial"], ["questPolicy", "signerCategory", "routine"]] as const) {
            expect(weightedConfigSchema.safeParse({ ...config, [key]: { ...(config[key] as Json), [field]: wrong } }).success, `${key}.${field}`).toBe(false)
        }
        const { feeCategory: _fee, ...withoutFee } = config.marketPolicy as Json
        void _fee
        expect(weightedConfigSchema.safeParse({ ...config, marketPolicy: withoutFee }).success).toBe(false)
    })
})

describe("ballots and pending votes", () => {
    const ballotKeys = Object.keys(records).filter(k => k.startsWith("ballot_"))
    it("accepts every native ballot, and each case reads as recorded", () => {
        expect(ballotKeys.length).toBeGreaterThanOrEqual(12)
        for (const key of ballotKeys) expect(weightedBallotSchema.safeParse(records[key]).success, key).toBe(true)
        const b = (key: string) => weightedBallotSchema.parse(records[key])
        expect([b("ballot_yes").choice, b("ballot_abstain").choice, b("ballot_not_voted").choice]).toEqual(["yes", "abstain", null])
        expect(BigInt(b("ballot_changed").votedAtHeight!)).toBeGreaterThan(BigInt(b("ballot_yes").votedAtHeight!))
        expect([b("ballot_non_member").eligible, b("ballot_non_member").choice]).toEqual([false, null])
        expect(b("ballot_invalidated").choice).toBe("yes")
        expect(b("ballot_expired").choice).toBe("yes")
        expect([b("ballot_old_key_before").eligible, b("ballot_old_key_before").choice]).toEqual([true, "yes"])
        expect([b("ballot_old_key_after").eligible, b("ballot_new_key_before").eligible, b("ballot_new_key_after").eligible]).toEqual([false, false, true])
    })

    it("rejects inconsistent or unknown ballot shapes", () => {
        const base = records.ballot_yes
        for (const change of [{ choice: "maybe" }, { votedAtHeight: null }, { choice: null }, { eligible: false }, { votedAtHeight: 283 }, { schema: "memba-weighted-host/v2" }, { extra: true }]) {
            expect(weightedBallotSchema.safeParse({ ...base, ...change }).success, JSON.stringify(change)).toBe(false)
        }
    })

    const pendingRoute = (payload: unknown) => vi.mocked(directRpcCall).mockImplementation(async (_url, method) => {
        if (method === "status") return { node_info: { network: ctx.chainId } }
        return { response: { ResponseBase: { Data: btoa(String.fromCharCode(...new TextEncoder().encode(qevalWire(payload)))), Error: null } } }
    })

    it("reads native pending pages, including a scan-capped page with no items", async () => {
        const voter = (records.pending_page as Json).voter as string
        pendingRoute(records.pending_page)
        const page = await readWeightedPendingVotes(ctx, voter, "0", 20)
        expect([page.items.length, page.next]).toEqual([20, (records.pending_page as Json).next])
        pendingRoute(records.pending_scan_cap)
        const capped = await readWeightedPendingVotes(ctx, (records.pending_scan_cap as Json).voter as string, "0", 50)
        expect(capped.items).toEqual([]); expect(capped.next).toMatch(/^\d+$/)
        pendingRoute(records.pending_after_cap)
        const after = await readWeightedPendingVotes(ctx, (records.pending_after_cap as Json).voter as string, capped.next!, 50)
        expect(after.items.length).toBeGreaterThan(0); expect(after.next).toBeNull()
        for (const key of Object.keys(records).filter(k => k.startsWith("pending_"))) {
            const r = records[key] as { voter: string; items: Json[]; next: string | null }
            pendingRoute(r)
            await expect(readWeightedPendingVotes(ctx, r.voter, "0", 50), key).resolves.toBeTruthy()
        }
    })

    it("refuses mismatched voters, closed or out-of-order items, and bad cursors", async () => {
        const r = records.pending_page as { voter: string; items: Json[]; next: string }
        pendingRoute({ ...r, voter: (records.members as { members: Json[] }).members[0].address })
        await expect(readWeightedPendingVotes(ctx, r.voter)).rejects.toThrow("do not match")
        pendingRoute({ ...r, items: [r.items[1], r.items[0]] })
        await expect(readWeightedPendingVotes(ctx, r.voter)).rejects.toThrow("Invalid pending-vote page")
        pendingRoute({ ...r, items: [records.proposal_2.proposal, ...r.items.slice(1)] })
        await expect(readWeightedPendingVotes(ctx, r.voter)).rejects.toThrow()
        pendingRoute({ ...r, next: "999" })
        await expect(readWeightedPendingVotes(ctx, r.voter)).rejects.toThrow("cursor")
        pendingRoute({ ...r, extra: 1 })
        await expect(readWeightedPendingVotes(ctx, r.voter)).rejects.toThrow()
        await expect(readWeightedPendingVotes(ctx, r.voter, "0", 51)).rejects.toThrow("page size")
        const mis = structuredClone(r); (mis.items[2].action as Json).operation = "grant-everything"
        pendingRoute(mis)
        expect((await readWeightedPendingVotes(ctx, r.voter)).items.filter(isUnreadableProposal)).toHaveLength(1)
    })

    it("reads one ballot and checks it answers the question asked", async () => {
        const b = records.ballot_not_voted as { proposalId: string; voter: string }
        pendingRoute(b)
        expect((await readWeightedBallot(ctx, b.proposalId, b.voter)).choice).toBeNull()
        await expect(readWeightedBallot(ctx, "1", b.voter)).rejects.toThrow("does not match")
        expect(vi.mocked(directRpcCall).mock.calls.some(c => new TextDecoder().decode(Uint8Array.from(String(c[2]?.data).slice(2).match(/../g)!, h => parseInt(h, 16))).endsWith(`GetBallotJSON("${b.proposalId}", "${b.voter}")`))).toBe(true)
        // The ballot read checks the RPC's chain identity before trusting it.
        vi.mocked(directRpcCall).mockClear()
        vi.mocked(directRpcCall).mockImplementation(async (_url, method) => {
            if (method === "status") return { node_info: { network: "gnoland-0" } }
            return { response: { ResponseBase: { Data: btoa(String.fromCharCode(...new TextEncoder().encode(qevalWire(b)))), Error: null } } }
        })
        await expect(readWeightedBallot(ctx, b.proposalId, b.voter)).rejects.toThrow("network")
        expect(vi.mocked(directRpcCall).mock.calls.filter(c => c[1] === "abci_query")).toHaveLength(0)
    })
})

describe("immediate thresholds", () => {
    it("match the vendored policy source recorded in the fixture provenance", async () => {
        const digest = await sha256(policySource)
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
