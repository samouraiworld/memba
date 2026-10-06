/**
 * Reads of memba_gov, the Memba DAO governance core, and of the bridge that
 * governs the ten Memba apps. Every read checks the RPC answers for the
 * selected chain, and every answer is validated: ids and unix times arrive as
 * strings, text is what the realm accepted (printable ASCII, bounded).
 */
import { z } from "zod"
import { isRealmValid } from "../config"
import { MAX_ARGS } from "./daoauth"
import { GOV_PATH } from "./govActions"
import { directRpcCall, abciErrorPresent } from "../rpcFallback"
import { assertWeightedChain, parseWeightedQeval, qevalText } from "./weighted"
import { address, id, uint64 } from "./weightedPrimitives"

export type GovContext = { rpcUrl: string; chainId: string }

/** Memba DAO runs on memba_gov on the active network once its publication is recorded there. */
export const govPublished = () => isRealmValid(GOV_PATH)

const unix = uint64
const ascii = (max: number) => z.string().max(max).regex(/^[\x20-\x7e]*$/)
const personId = z.string().regex(/^[a-z0-9_-]{1,32}$/)
const vote = z.enum(["yes", "no", "abstain"])
export const GOV_STATUSES = ["voting", "timelocked", "ready", "executed", "invalidated", "expired"] as const

const rosterSchema = z.strictObject({
    weight: z.number().int().min(0), persons: z.number().int().min(0),
    members: z.array(z.strictObject({ id: personId, address, weight: z.union([z.literal(1), z.literal(2)]), lastActive: unix })).max(25),
    // A recovery invitation carries no weight of its own.
    invitations: z.array(z.strictObject({ id: personId, address, weight: z.union([z.literal(0), z.literal(1), z.literal(2)]), expires: unix })),
}).refine(r => r.persons === r.members.length && r.weight === r.members.reduce((w, m) => w + m.weight, 0), "Inconsistent roster")

const proposalSchema = z.strictObject({
    id, target: ascii(256), action: ascii(64), args: ascii(MAX_ARGS), scope: ascii(160),
    class: z.union([z.literal(1), z.literal(2), z.literal(3)]), proposer: personId, note: ascii(280),
    created: unix, deadline: unix, status: z.enum(GOV_STATUSES), readyAt: unix,
    ballots: z.array(z.strictObject({ person: personId, vote, since: unix })).max(25),
})

const pageSchema = z.strictObject({ total: uint64, proposals: z.array(proposalSchema).max(20) })

const count = z.number().int().min(0)
/** Durations in seconds, roster bounds, page size. */
const constantsSchema = z.strictObject({
    votingPeriod: count, executionWindow: count, criticalWeightDelay: count, criticalHeadcountDelay: count, rosterDelay: count,
    inactiveDelay: count, inactiveAfter: count, minSeats: count, maxSeats: count, maxListed: count,
})

export type GovRoster = z.infer<typeof rosterSchema>
export type GovProposal = z.infer<typeof proposalSchema>
export type GovConstants = z.infer<typeof constantsSchema>

async function read(ctx: GovContext, path: string, expression: string, signal?: AbortSignal): Promise<unknown> {
    return parseWeightedQeval(await qevalText(ctx.rpcUrl, path, expression, signal))
}

const GOV_PAGE = 20

/** Roster, the page of proposals below `before` (0 = newest) and the fixed policy. */
export async function readGovSnapshot(ctx: GovContext, before = "0", signal?: AbortSignal) {
    uint64.parse(before)
    await assertWeightedChain(ctx, signal)
    const [roster, page, constants] = await Promise.all([
        read(ctx, GOV_PATH, "RosterJSON()", signal).then(v => rosterSchema.parse(v)),
        read(ctx, GOV_PATH, `ProposalsJSON(${before}, ${GOV_PAGE})`, signal).then(v => pageSchema.parse(v)),
        read(ctx, GOV_PATH, "ConstantsJSON()", signal).then(v => constantsSchema.parse(v)),
    ])
    // Proposals are never deleted: a page is every id below its start, newest first.
    const total = BigInt(page.total), first = before === "0" || BigInt(before) > total ? total : BigInt(before) - 1n
    const want = first > BigInt(GOV_PAGE) ? GOV_PAGE : Number(first)
    if (page.proposals.length !== want || page.proposals.some((p, i) => BigInt(p.id) !== first - BigInt(i))) throw new Error("Invalid proposal page")
    return { roster, page, constants }
}
export type GovSnapshot = Awaited<ReturnType<typeof readGovSnapshot>>

export async function readGovProposal(ctx: GovContext, proposalId: string, signal?: AbortSignal): Promise<GovProposal> {
    id.parse(proposalId)
    await assertWeightedChain(ctx, signal)
    const p = proposalSchema.parse(await read(ctx, GOV_PATH, `ProposalJSON(${proposalId})`, signal))
    if (p.id !== proposalId) throw new Error("Unexpected proposal ID")
    return p
}

/**
 * Whether a proposal's target realm exists on this chain, and whether it is
 * private: its creator can redeploy a private realm, so its code can change
 * after the vote.
 */
export async function readTargetManifest(ctx: GovContext, target: string, signal?: AbortSignal): Promise<"absent" | "private" | "public"> {
    if (!/^gno\.land\/r\/[a-z0-9_/.]{1,245}$/.test(target)) throw new Error("Invalid target")
    await assertWeightedChain(ctx, signal)
    const answer = await abciQuery(ctx, "vm/qfile", `${target}/gnomod.toml`, signal)
    if (answer.failed) return "absent"
    return /^\s*private\s*=\s*true\s*$/m.test(answer.text) ? "private" : "public"
}

async function abciQuery(ctx: GovContext, path: string, query: string, signal?: AbortSignal) {
    const data = Array.from(new TextEncoder().encode(query), b => b.toString(16).padStart(2, "0")).join("")
    const result = await directRpcCall(ctx.rpcUrl, "abci_query", { path: `"${path}"`, data: `0x${data}` }, signal)
    const base = z.object({ response: z.object({ ResponseBase: z.object({ Data: z.string().nullable(), Error: z.unknown().optional(), Log: z.string().optional() }) }) })
        .parse(result).response.ResponseBase
    if (abciErrorPresent(base.Error)) return { failed: true as const, log: base.Log ?? "" }
    return { failed: false as const, text: new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(base.Data ?? ""), c => c.charCodeAt(0))) }
}
