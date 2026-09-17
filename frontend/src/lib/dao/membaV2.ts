/**
 * Reader for DAOs generated from template `memba-dao/2`.
 *
 * Every read goes through the realm's JSON exports and a strict schema; Render
 * output is never parsed. Each call checks that the RPC endpoint serves the
 * expected chain before trusting the answer.
 *
 * Not wired into the generic DAO readers yet: the DAO shell selects this
 * module once it has resolved a DAO's kind.
 */
import { z } from "zod"
import { abciErrorPresent, directRpcCall } from "../rpcFallback"
import { validateRealmPath } from "../templates/sanitizer"
import { isChecksummedAddress } from "../templates/dao/v2/bech32"
import { parseWeightedQeval } from "./weighted"

export const MEMBA_V2_TEMPLATE = "memba-dao/2"
export const MEMBA_V2_API = "2.0"
export const MEMBA_V2_MAX_PAGE = 50

export type MembaV2Context = { rpcUrl: string; chainId: string; realmPath: string }

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const proposalId = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const seconds = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const power = z.number().int().min(1).max(1_000_000_000)
const address = z.string().regex(/^g1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/).refine((a) => isChecksummedAddress(a, "g"), "Invalid address checksum")
const label = z.string().regex(/^[a-z][a-z0-9_]{0,29}$/)
const labels = z.array(label).max(16).refine((l) => new Set(l).size === l.length, "Duplicate labels")

export const membaV2ConfigSchema = z.strictObject({
    template_version: z.literal(MEMBA_V2_TEMPLATE),
    api_version: z.literal(MEMBA_V2_API),
    name: z.string().min(3).max(64),
    description: z.string().max(1000),
    threshold: z.number().int().min(51).max(100),
    quorum: z.number().int().min(0).max(100),
    voting_period: z.number().int().min(3600).max(30 * 86400),
    execution_delay: z.number().int().min(0).max(7 * 86400),
    execution_window: z.number().int().min(86400).max(30 * 86400),
    categories: labels.min(1),
    roles: labels,
    archived: z.boolean(),
    member_count: z.number().int().min(1).max(100),
    total_power: z.number().int().min(1).max(100_000_000_000),
    electorate_version: count,
    proposal_count: count,
})

const member = z.strictObject({ address, power, roles: labels })

export const membaV2MembersSchema = z.strictObject({
    total: z.number().int().min(1).max(100),
    offset: count,
    members: z.array(member).max(MEMBA_V2_MAX_PAGE),
}).refine((p) => p.offset + p.members.length <= p.total, "Member page exceeds the total")
    .refine((p) => new Set(p.members.map((m) => m.address)).size === p.members.length, "Duplicate member")

const action = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("text"), target: z.literal(""), power: z.literal(0), roles: z.array(label).length(0) }),
    z.strictObject({ kind: z.literal("archive"), target: z.literal(""), power: z.literal(0), roles: z.array(label).length(0) }),
    z.strictObject({ kind: z.literal("add_member"), target: address, power, roles: labels }),
    z.strictObject({ kind: z.literal("remove_member"), target: address, power: z.literal(0), roles: z.array(label).length(0) }),
    z.strictObject({ kind: z.literal("set_roles"), target: address, power: z.literal(0), roles: labels }),
])

export const MEMBA_V2_STATUSES = ["ACTIVE", "ACCEPTED", "REJECTED", "EXECUTED", "EXPIRED", "LAPSED", "INVALIDATED"] as const

const proposalFields = {
    id: proposalId,
    title: z.string().min(1).max(128 * 4),
    category: label,
    author: address,
    action,
    electorate_power: z.number().int().min(1).max(100_000_000_000),
    electorate_version: count,
    created_at: seconds,
    voting_ends_at: seconds,
    status: z.enum(MEMBA_V2_STATUSES),
    yes: count,
    no: count,
    abstain: count,
    accepted_at: seconds,
    executable_at: seconds,
    execute_by: seconds,
}

type ProposalShape = { [K in keyof typeof proposalFields]: z.infer<(typeof proposalFields)[K]> }

/** Internal consistency every honest v2 realm satisfies. */
function consistent(p: ProposalShape): boolean {
    if (p.yes + p.no + p.abstain > p.electorate_power) return false
    if (p.voting_ends_at <= p.created_at) return false
    const accepted = p.accepted_at > 0
    if (accepted !== ["ACCEPTED", "EXECUTED", "LAPSED"].includes(p.status)) return false
    if (!accepted) return p.executable_at === 0 && p.execute_by === 0
    return p.accepted_at >= p.created_at && p.executable_at >= p.accepted_at && p.execute_by > p.executable_at
}

const proposalSummary = z.strictObject(proposalFields).refine(consistent, "Inconsistent proposal state")
export const membaV2ProposalSchema = z.strictObject({ ...proposalFields, description: z.string().max(8000 * 4) }).refine(consistent, "Inconsistent proposal state")

export const membaV2ProposalsSchema = z.strictObject({
    proposals: z.array(proposalSummary).max(MEMBA_V2_MAX_PAGE),
    next_before: count,
}).refine(({ proposals, next_before }) => {
    for (let i = 1; i < proposals.length; i++) if (proposals[i].id >= proposals[i - 1].id) return false
    return next_before === 0 || next_before === proposals.at(-1)?.id
}, "Invalid proposal page")

export const membaV2VotesSchema = z.strictObject({
    total: count,
    offset: count,
    votes: z.array(z.strictObject({ voter: address, choice: z.enum(["YES", "NO", "ABSTAIN"]), power })).max(MEMBA_V2_MAX_PAGE),
}).refine((p) => p.offset + p.votes.length <= p.total, "Vote page exceeds the total")

export type MembaV2Config = z.infer<typeof membaV2ConfigSchema>
export type MembaV2Members = z.infer<typeof membaV2MembersSchema>
export type MembaV2Proposal = z.infer<typeof membaV2ProposalSchema>
export type MembaV2Proposals = z.infer<typeof membaV2ProposalsSchema>
export type MembaV2Votes = z.infer<typeof membaV2VotesSchema>
export type MembaV2Page = { offset: number; limit: number }

function checkContext(ctx: MembaV2Context) {
    const err = validateRealmPath(ctx.realmPath)
    if (err) throw new Error(`Invalid DAO realm path: ${err}`)
}

function checkPage(page: MembaV2Page) {
    if (!Number.isSafeInteger(page.offset) || page.offset < 0) throw new Error("Invalid page offset")
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > MEMBA_V2_MAX_PAGE) throw new Error("Invalid page size")
}

function checkId(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid proposal id")
}

async function assertChain(ctx: MembaV2Context, signal?: AbortSignal) {
    const status = z.object({ node_info: z.object({ network: z.string() }) }).parse(await directRpcCall(ctx.rpcUrl, "status", {}, signal))
    if (status.node_info.network !== ctx.chainId) throw new Error("RPC network does not match the selected chain")
}

async function qeval(ctx: MembaV2Context, expression: string, signal?: AbortSignal): Promise<string> {
    checkContext(ctx)
    if (signal?.aborted) throw new Error("Read cancelled")
    await assertChain(ctx, signal)
    const data = Array.from(new TextEncoder().encode(`${ctx.realmPath}.${expression}`), (b) => b.toString(16).padStart(2, "0")).join("")
    const result = await directRpcCall(ctx.rpcUrl, "abci_query", { path: '"vm/qeval"', data: `0x${data}` }, signal)
    const parsed = z.object({ response: z.object({ ResponseBase: z.object({ Data: z.string().nullable(), Error: z.unknown().optional() }) }) }).parse(result)
    if (signal?.aborted || abciErrorPresent(parsed.response.ResponseBase.Error) || !parsed.response.ResponseBase.Data) throw new Error("DAO read failed")
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(parsed.response.ResponseBase.Data), (c) => c.charCodeAt(0)))
}

async function readJSON<T>(ctx: MembaV2Context, expression: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    return schema.parse(parseWeightedQeval(await qeval(ctx, expression, signal)))
}

export function readV2Config(ctx: MembaV2Context, signal?: AbortSignal): Promise<MembaV2Config> {
    return readJSON(ctx, "GetConfigJSON()", membaV2ConfigSchema, signal)
}

export async function readV2Members(ctx: MembaV2Context, page: MembaV2Page = { offset: 0, limit: MEMBA_V2_MAX_PAGE }, signal?: AbortSignal): Promise<MembaV2Members> {
    checkPage(page)
    const result = await readJSON(ctx, `GetMembersJSON(${page.offset}, ${page.limit})`, membaV2MembersSchema, signal)
    if (result.offset !== page.offset || result.members.length > page.limit) throw new Error("Unexpected member page")
    if (result.members.length !== Math.min(page.limit, Math.max(0, result.total - page.offset))) throw new Error("Truncated member page")
    return result
}

/** Newest first. Pass `before = 0` for the first page and `next_before` for the next one. */
export async function readV2Proposals(ctx: MembaV2Context, before = 0, limit = 20, signal?: AbortSignal): Promise<MembaV2Proposals> {
    if (!Number.isSafeInteger(before) || before < 0) throw new Error("Invalid page cursor")
    checkPage({ offset: 0, limit })
    const result = await readJSON(ctx, `GetProposalsJSON(${before}, ${limit})`, membaV2ProposalsSchema, signal)
    if (result.proposals.length > limit) throw new Error("Unexpected proposal page")
    if (before > 0 && result.proposals.some((p) => p.id >= before)) throw new Error("Proposal page does not match the cursor")
    if (result.next_before !== 0 && result.proposals.length !== limit) throw new Error("Invalid proposal cursor")
    return result
}

export async function readV2Proposal(ctx: MembaV2Context, id: number, signal?: AbortSignal): Promise<MembaV2Proposal> {
    checkId(id)
    const result = await readJSON(ctx, `GetProposalJSON(${id})`, membaV2ProposalSchema, signal)
    if (result.id !== id) throw new Error("Unexpected proposal id")
    return result
}

export async function readV2Votes(ctx: MembaV2Context, id: number, page: MembaV2Page = { offset: 0, limit: MEMBA_V2_MAX_PAGE }, signal?: AbortSignal): Promise<MembaV2Votes> {
    checkId(id)
    checkPage(page)
    const result = await readJSON(ctx, `GetVotesJSON(${id}, ${page.offset}, ${page.limit})`, membaV2VotesSchema, signal)
    if (result.offset !== page.offset || result.votes.length > page.limit) throw new Error("Unexpected vote page")
    return result
}

export async function hasVotedV2(ctx: MembaV2Context, id: number, voter: string, signal?: AbortSignal): Promise<boolean> {
    checkId(id)
    address.parse(voter)
    const raw = (await qeval(ctx, `HasVoted(${id}, address("${voter}"))`, signal)).trim()
    if (raw === "(true bool)") return true
    if (raw === "(false bool)") return false
    throw new Error("Invalid DAO bool response")
}
