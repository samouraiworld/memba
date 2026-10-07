/**
 * Reads of memba_gov, the Memba DAO governance core, and of the bridge that
 * governs the ten Memba apps. Every read checks the RPC answers for the
 * selected chain, and every answer is validated: ids and unix times arrive as
 * strings, text is what the realm accepted (printable ASCII, bounded).
 */
import { z } from "zod"
import { isRealmValid } from "../config"
import { MAX_ARGS } from "./daoauth"
import { BRIDGE_APPS, BRIDGE_PATH, GOV_PATH } from "./govActions"
import { directRpcCall, abciErrorPresent } from "../rpcFallback"
import { assertWeightedChain, parseWeightedQeval, qevalText } from "./weighted"
import { packageAddress } from "./weightedApplications"
import { address, id, uint64 } from "./weightedPrimitives"

export type GovContext = { rpcUrl: string; chainId: string }

/** Memba DAO runs on memba_gov on the active network once its publication is recorded there. */
export const govPublished = () => isRealmValid(GOV_PATH)
/** The apps' governed calls also need the bridge's publication recorded. */
export const bridgePublished = () => govPublished() && isRealmValid(BRIDGE_PATH)
export const PAUSABLE_APPS = Object.keys(BRIDGE_APPS).filter((app) => BRIDGE_APPS[app].pause)

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
/** Durations in seconds, roster bounds, page size. Unknown keys are ignored: a new constant must not hide the DAO. */
const constantsSchema = z.object({
    votingPeriod: count, executionWindow: count, criticalWeightDelay: count, criticalHeadcountDelay: count, rosterDelay: count,
    inactiveDelay: count, inactiveAfter: count, minSeats: count, maxSeats: count, maxListed: count,
})

const approvalSchema = z.strictObject({
    target: z.literal(BRIDGE_PATH), action: ascii(64), args: ascii(MAX_ARGS), scope: ascii(160),
    class: z.union([z.literal(1), z.literal(2), z.literal(3)]),
})

export type GovRoster = z.infer<typeof rosterSchema>
export type GovProposal = z.infer<typeof proposalSchema>
export type GovConstants = z.infer<typeof constantsSchema>
export type GovApproval = z.infer<typeof approvalSchema>

async function read(ctx: GovContext, path: string, expression: string, signal?: AbortSignal): Promise<unknown> {
    return parseWeightedQeval(await qevalText(ctx.rpcUrl, path, expression, signal))
}

const GOV_PAGE = 20

/** The realm has no proposal with this id. */
export class GovNotFound extends Error {
    constructor(id: string) { super(`Memba DAO has no proposal #${id}.`) }
}

/** The roster alone. */
export async function readGovRoster(ctx: GovContext, signal?: AbortSignal): Promise<GovRoster> {
    await assertWeightedChain(ctx, signal)
    return rosterSchema.parse(await read(ctx, GOV_PATH, "RosterJSON()", signal))
}

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
    const raw = await read(ctx, GOV_PATH, `ProposalJSON(${proposalId})`, signal)
    if (raw === null) throw new GovNotFound(proposalId)
    const p = proposalSchema.parse(raw)
    if (p.id !== proposalId) throw new Error("Unexpected proposal ID")
    return p
}

/**
 * The exact proposal a bridge entrypoint call needs now, built by the
 * bridge's own code; `call` is the daoauth encoding of the entrypoint's name
 * and its arguments after the proposal id. The chain refuses a call the
 * entrypoint would refuse before a vote.
 */
export async function readBridgeApproval(ctx: GovContext, call: string, signal?: AbortSignal): Promise<GovApproval> {
    if (call.length > MAX_ARGS || !/^[\x20-\x7e]*$/.test(call)) throw new Error("Invalid call") // the bridge parses it as daoauth
    await assertWeightedChain(ctx, signal)
    const answer = await abciQuery(ctx, "vm/qeval", `${BRIDGE_PATH}.Approval(${JSON.stringify(call)})`, signal) // printable ASCII: JSON quoting is a valid Gno literal
    if (answer.failed) {
        // The bridge's own refusal ("memba_bridge: role already in that state").
        const reason = answer.log.match(/(?:memba_bridge|daoauth): ([\x20-\x7e]{1,200}?)(?:\\n|\n|"|$)/)?.[1]
        throw new Error(reason ? `The bridge refuses this call: ${reason}` : "Chain read failed")
    }
    return approvalSchema.parse(parseWeightedQeval(answer.text))
}

/**
 * Whether a proposal's target realm is published on this chain now, and
 * whether it is private: its creator can redeploy a private realm, so its code
 * can change after the vote. Only the chain's "not available" answer means
 * absent; any other failure is an error.
 */
export async function readTargetManifest(ctx: GovContext, target: string, signal?: AbortSignal): Promise<"absent" | "private" | "public"> {
    if (!/^gno\.land\/r\/[a-z0-9_/.]{1,245}$/.test(target)) throw new Error("Invalid target")
    await assertWeightedChain(ctx, signal)
    const answer = await abciQuery(ctx, "vm/qfile", `${target}/gnomod.toml`, signal)
    if (answer.failed) {
        if (/file "[^"]*" is not available/.test(answer.log)) return "absent"
        throw new Error("Chain read failed")
    }
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

/** The getter of each pausable app's current admin: the bridge pauses only an app it governs. */
const ADMIN_GETTER: Record<string, string> = {
    escrow_v4: "GetAdmin()", memba_appstore_v3: "GetOwner()", memba_arcade_leaderboard_v1: "GetOwner()", gnobuilders_badges_v2: "GetOwner()",
    memba_feed_v1: "GetOwner()", memba_dao_channels_v2: "GetOwner()", memba_feedback_v2: "GetOwner()",
}

export type BridgePause = { until: number; governed: boolean }

/**
 * For each pausable app: when the bridge's pause ends (unix seconds, 0 for
 * none) and whether the bridge governs the app now (is its admin).
 */
export async function readBridgePauses(ctx: GovContext, signal?: AbortSignal): Promise<Record<string, BridgePause>> {
    await assertWeightedChain(ctx, signal)
    const bridge = packageAddress(BRIDGE_PATH)
    const raw = await Promise.all(PAUSABLE_APPS.flatMap((app) => [
        qevalText(ctx.rpcUrl, BRIDGE_PATH, `PausedUntil("${app}")`, signal),
        qevalText(ctx.rpcUrl, `gno.land/r/samcrew/${app}`, ADMIN_GETTER[app], signal),
    ]))
    return Object.fromEntries(PAUSABLE_APPS.map((app, i) => {
        const until = raw[2 * i].match(/^\((0|[1-9][0-9]{0,11}) int64\)\s*$/)
        if (!until) throw new Error("Invalid pause read")
        const admin = raw[2 * i + 1].match(/^\("(g1[0-9a-z]{38})" (?:string|\.uverse\.address)\)\s*$/)?.[1]
        return [app, { until: Number(until[1]), governed: admin === bridge }]
    }))
}
