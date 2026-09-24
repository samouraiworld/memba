/** Versioned founding DAO contract. Never fall back to legacy Render parsing. */
import { z } from "zod"
import { abciErrorPresent, directRpcCall } from "../rpcFallback"
import type { AminoMsg } from "./shared"
import { address, id, personID, realm, role, time, uint64 } from "./weightedPrimitives"
import { ACCEPT_FUNCS, APPLICATION_LABELS, APPLICATION_POLICY_KEYS, APPLICATION_TARGETS, IMMEDIATE_THRESHOLDS, applicationActionMatchesPolicy, applicationPolicySchemas, expectedCategory, recoverMemberAction, setRoleAction, v12Action, type ApplicationPolicyKey } from "./weightedApplications"
import { v12BudgetWithinCeiling, v12CallBudget, v12ExecuteBudget } from "./weightedBudget"

export const WEIGHTED_SCHEMA = "memba-weighted-host/v1"
export const WEIGHTED_RECOVERY_SCHEMA = "memba-weighted-host/v2"
/** Role, recovery and the ten fixed application adapters (mainnet governing DAO). */
export const WEIGHTED_APPLICATIONS_SCHEMA = "memba-weighted-host/v12"
export const WEIGHTED_SCHEMAS = [WEIGHTED_SCHEMA, WEIGHTED_RECOVERY_SCHEMA, WEIGHTED_APPLICATIONS_SCHEMA] as const
export type WeightedSchemaVersion = (typeof WEIGHTED_SCHEMAS)[number]

// Intermediate host versions (v3..v11) were review candidates, never a
// deployment target; they stay rejected like any other unknown version.
const configBase = {
    kind: z.literal("config"), realmPath: realm,
    rosterSize: z.literal(7), totalPoints: z.literal(8), founderWeight: z.literal(2), developerWeight: z.literal(1),
    votingPeriodSeconds: z.literal(604800), maxProposalPage: z.literal(50),
    mutableRoles: z.tuple([z.literal("admin"), z.literal("finance")]),
    roleChanges: z.strictObject({ category: z.literal("critical"), weightedPoints: z.literal(6), weightedPeople: z.literal(4), weightedDelaySeconds: z.literal(86400), independentDevelopers: z.literal(5), independentDelaySeconds: z.literal(259200) }),
}
const capabilities = (memberReplacement: boolean, applicationActions: boolean) => z.strictObject({ roleProposals: z.literal(true), memberReplacement: z.literal(memberReplacement), migration: z.literal(false), treasuryExecution: z.literal(false), applicationActions: z.literal(applicationActions) })
const v1Config = z.strictObject({ schema: z.literal(WEIGHTED_SCHEMA), ...configBase, capabilities: capabilities(false, false) })
const v2Config = z.strictObject({ schema: z.literal(WEIGHTED_RECOVERY_SCHEMA), ...configBase, capabilities: capabilities(true, false) })
const v12Config = z.strictObject({ schema: z.literal(WEIGHTED_APPLICATIONS_SCHEMA), ...configBase, capabilities: capabilities(true, true), ...applicationPolicySchemas })
export const weightedConfigSchema = z.discriminatedUnion("schema", [v1Config, v2Config, v12Config])
export type WeightedConfig = z.infer<typeof weightedConfigSchema>
export type WeightedV12Config = z.infer<typeof v12Config>

const envelope = { schema: z.enum(WEIGHTED_SCHEMAS) }
const member = z.strictObject({ personId: personID, address, founder: z.boolean(), weight: z.union([z.literal(1), z.literal(2)]), admin: z.boolean(), finance: z.boolean() })
export const weightedMembersSchema = z.strictObject({ ...envelope, kind: z.literal("members"), members: z.array(member).length(7) }).refine(({ members }) =>
    new Set(members.map(m => m.address)).size === 7 && new Set(members.map(m => m.personId)).size === 7 &&
    members.filter(m => m.founder).length === 1 && members.some(m => m.admin) && members.every(m => m.weight === (m.founder ? 2 : 1)), "Invalid founding roster")

/**
 * Why an INVALIDATED proposal stopped: another proposal executed (proposalId
 * names it; target is its application realm, or null for a role or recovery
 * change) or a member's emergency pause of target (proposalId null).
 */
const invalidationSchema = z.strictObject({
    cause: z.enum(["superseded-execution", "pause"]), height: uint64,
    proposalId: id.nullable(), target: z.enum(Object.values(APPLICATION_TARGETS) as [string, ...string[]]).nullable(),
}).refine(v => v.cause === "pause" ? v.proposalId === null && v.target !== null : v.proposalId !== null, "Inconsistent invalidation record")
export type WeightedInvalidation = z.infer<typeof invalidationSchema>

type ProposalState = {
    id: string; action: { type: string; operation?: string }; category: "routine" | "financial" | "critical"; status: string
    qualified: boolean; ready: boolean; votingClosed: boolean; talliesAvailable: boolean
    weightYes: number | null; peopleYes: number | null; developersYes: number | null
    createdAt: string; votingDeadline: string; weightedAfter: string | null; developerAfter: string | null
    invalidation?: WeightedInvalidation | null
}
/**
 * Mirrors the policy's State(): terminal states clear tallies; routine and
 * financial proposals are ready once qualified. Host builds that publish
 * `invalidation` also keep EXPIRED sticky: a proposal that expired before a
 * later reconfiguration stays EXPIRED, with its tallies cleared.
 */
function consistentProposal(p: ProposalState): boolean {
    if (p.category !== expectedCategory(p.action)) return false
    const recordsInvalidation = p.invalidation !== undefined
    if (recordsInvalidation && (p.invalidation === null) === (p.status === "INVALIDATED")) return false
    if (p.invalidation && p.invalidation.proposalId === p.id) return false
    const stickyExpiry = recordsInvalidation && p.status === "EXPIRED" && !p.talliesAvailable
    const cleared = p.status === "EXECUTED" || p.status === "INVALIDATED" || stickyExpiry
    if (p.ready !== (p.status === "READY") || p.talliesAvailable === cleared) return false
    if (Date.parse(p.votingDeadline) - Date.parse(p.createdAt) !== 604800000) return false
    if (p.status === "EXPIRED" && !p.votingClosed) return false
    if (cleared) return p.weightYes === null && p.peopleYes === null && p.developersYes === null && !p.qualified && p.weightedAfter === null && p.developerAfter === null
    if (p.weightYes === null || p.peopleYes === null || p.developersYes === null) return false
    if (p.peopleYes - p.developersYes < 0 || p.peopleYes - p.developersYes > 1 || p.weightYes !== p.developersYes + 2 * (p.peopleYes - p.developersYes)) return false
    if (p.status === "VOTING" && p.votingClosed) return false
    if (p.category !== "critical") {
        const threshold = IMMEDIATE_THRESHOLDS[p.category]
        const qualified = p.weightYes >= threshold.points && p.peopleYes >= threshold.people
        return p.weightedAfter === null && p.developerAfter === null && p.qualified === qualified && (qualified ? p.status === "READY" : p.status === "VOTING" || p.status === "EXPIRED")
    }
    const qualified = (p.weightedAfter !== null || p.developerAfter !== null)
    if (p.qualified !== qualified || p.qualified !== ["TIMELOCKED", "READY"].includes(p.status)) return false
    return (p.weightedAfter === null || p.weightYes >= 6 && p.peopleYes >= 4) && (p.developerAfter === null || p.developersYes >= 5)
}
const tally = (max: number) => z.number().int().min(0).max(max).nullable()
const proposalFields = {
    id, proposer: address,
    category: z.enum(["routine", "financial", "critical"]), status: z.enum(["VOTING", "TIMELOCKED", "READY", "EXPIRED", "INVALIDATED", "EXECUTED"]),
    qualified: z.boolean(), ready: z.boolean(), votingClosed: z.boolean(), talliesAvailable: z.boolean(),
    weightYes: tally(8), peopleYes: tally(7), developersYes: tally(6),
    createdAt: time, votingDeadline: time, weightedAfter: time.nullable(), developerAfter: time.nullable(),
}
// v1/v2 realms deployed before invalidation records omit the field; current
// host builds emit it on every version. v12 always carries it. v1/v2 have no
// application adapters, so only a role or recovery execution can invalidate.
const legacyInvalidationSchema = z.strictObject({ cause: z.literal("superseded-execution"), height: uint64, proposalId: id, target: z.null() })
const proposalFor = <A extends z.ZodType<{ type: string }>>(action: A) => z.strictObject({ ...proposalFields, action, invalidation: legacyInvalidationSchema.nullable().optional() })
    .refine(p => consistentProposal(p as ProposalState), "Inconsistent proposal state")
const v1Proposal = proposalFor(z.discriminatedUnion("type", [setRoleAction]))
const v2Proposal = proposalFor(z.discriminatedUnion("type", [setRoleAction, recoverMemberAction]))
const v12Proposal = z.strictObject({ ...proposalFields, action: v12Action, invalidation: invalidationSchema.nullable() })
    .refine(p => consistentProposal(p as ProposalState), "Inconsistent proposal state")
/** Per-version proposal item, reusable by later list reads (for example pending votes). */
export const weightedProposalFor = { [WEIGHTED_SCHEMA]: v1Proposal, [WEIGHTED_RECOVERY_SCHEMA]: v2Proposal, [WEIGHTED_APPLICATIONS_SCHEMA]: v12Proposal } as const
export const weightedProposalSchema = z.discriminatedUnion("schema", [
    z.strictObject({ schema: z.literal(WEIGHTED_SCHEMA), kind: z.literal("proposal"), proposal: v1Proposal }),
    z.strictObject({ schema: z.literal(WEIGHTED_RECOVERY_SCHEMA), kind: z.literal("proposal"), proposal: v2Proposal }),
    z.strictObject({ schema: z.literal(WEIGHTED_APPLICATIONS_SCHEMA), kind: z.literal("proposal"), proposal: v12Proposal }),
])
const pageFor = <S extends WeightedSchemaVersion>(schema: S) => z.strictObject({ schema: z.literal(schema), kind: z.literal("proposals"), total: uint64, proposals: z.array(weightedProposalFor[schema]).max(50), nextBefore: id.nullable() })
export const weightedPageSchema = z.discriminatedUnion("schema", [pageFor(WEIGHTED_SCHEMA), pageFor(WEIGHTED_RECOVERY_SCHEMA), pageFor(WEIGHTED_APPLICATIONS_SCHEMA)])
/** The page envelope is strict; each item is validated on its own (see readWeightedSnapshot). */
const envelopeFor = <S extends WeightedSchemaVersion>(schema: S) => z.strictObject({ schema: z.literal(schema), kind: z.literal("proposals"), total: uint64, proposals: z.array(z.unknown()).max(50), nextBefore: id.nullable() })
const weightedPageEnvelopeSchema = z.discriminatedUnion("schema", [envelopeFor(WEIGHTED_SCHEMA), envelopeFor(WEIGHTED_RECOVERY_SCHEMA), envelopeFor(WEIGHTED_APPLICATIONS_SCHEMA)])
/** Any supported version's proposal; only v12 is guaranteed to carry `invalidation`. */
export type WeightedProposal = Omit<z.infer<typeof v12Proposal>, "invalidation"> & { invalidation?: WeightedInvalidation | null }
/** A list item the contract returned but Memba could not validate. It is shown by ID only and offers no action. */
export type UnreadableWeightedProposal = { id: string; unreadable: true }
export type WeightedPageEntry = WeightedProposal | UnreadableWeightedProposal
export function isUnreadableProposal(p: WeightedPageEntry): p is UnreadableWeightedProposal { return "unreadable" in p }
export type WeightedMember = z.infer<typeof member>
export type WeightedPage = Omit<z.infer<typeof weightedPageSchema>, "proposals"> & { proposals: WeightedPageEntry[] }
export type WeightedContext = { rpcUrl: string; chainId: string; realmPath: string }
export type WeightedAction = { type: "recover"; personId: string; oldAddress: string; newAddress: string } | { type: "propose"; target: string; role: "admin" | "finance"; grant: boolean } | { type: "vote"; id: string; vote: "yes" | "no" | "abstain" } | { type: "execute"; id: string } | { type: "accept"; adapter: ApplicationPolicyKey }

/** Decode the Go string literal, including non-JSON \x, \U and octal escapes. */
export function parseWeightedQeval(raw: string): unknown {
    if (raw.length > 1_000_000) throw new Error("DAO response is too large")
    const match = raw.match(/^\(\s*"([\s\S]*)"\s+string\s*\)\s*$/)
    if (!match) throw new Error("Invalid DAO string response")
    const source = match[1], bytes: number[] = [], encoder = new TextEncoder()
    const escapes: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, '"': 34 }
    for (let i = 0; i < source.length;) {
        const c = source[i++]
        if (c !== "\\") {
            if (c === '"' || c.charCodeAt(0) < 32) throw new Error("Invalid Go string")
            const point = source.codePointAt(i - 1)!
            if (point >= 0xd800 && point <= 0xdfff) throw new Error("Invalid Unicode")
            bytes.push(...encoder.encode(String.fromCodePoint(point)))
            if (point > 0xffff) i++
            continue
        }
        const escape = source[i++]
        if (escape in escapes) { bytes.push(escapes[escape]); continue }
        const count = escape === "x" ? 2 : escape === "u" ? 4 : escape === "U" ? 8 : /[0-7]/.test(escape || "") ? 3 : 0
        if (!count) throw new Error("Invalid Go escape")
        const octal = /[0-7]/.test(escape), digits = source.slice(octal ? --i : i, i + count)
        if (!(octal ? /^[0-7]+$/ : /^[0-9a-fA-F]+$/).test(digits) || digits.length !== count) throw new Error("Invalid Go escape")
        i += count
        const value = parseInt(digits, octal ? 8 : 16)
        if (octal || escape === "x") { if (value > 255) throw new Error("Invalid byte"); bytes.push(value) }
        else { if (value > 0x10ffff || value >= 0xd800 && value <= 0xdfff) throw new Error("Invalid Unicode"); bytes.push(...encoder.encode(String.fromCodePoint(value))) }
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes))
    const value: unknown = JSON.parse(text)
    // JSON.parse otherwise silently accepts duplicate keys. Validate object keys
    // after syntax parsing; string tokens keep punctuation inside values opaque.
    const stack: { keys: Set<string> | null; key: boolean }[] = []
    for (const token of text.match(/"(?:\\.|[^"\\])*"|[{}[\],:]/g) || []) {
        if (token === "{" || token === "[") stack.push({ keys: token === "{" ? new Set() : null, key: true })
        else if (token === "}" || token === "]") stack.pop()
        else if (token === ",") { if (stack.length) stack[stack.length - 1].key = true }
        else if (token.startsWith('"')) {
            const frame = stack[stack.length - 1]
            if (frame?.keys && frame.key) {
                const key = JSON.parse(token) as string
                if (frame.keys.has(key)) throw new Error("Duplicate DAO JSON field")
                frame.keys.add(key); frame.key = false
            }
        }
    }
    return value
}

/** Raw `vm/qeval` result text of `<pkgPath>.<expression>` (a samcrew realm only). */
export async function qevalText(rpcUrl: string, pkgPath: string, expression: string, signal?: AbortSignal): Promise<string> {
    realm.parse(pkgPath)
    if (signal?.aborted) throw new Error("Read cancelled")
    const data = Array.from(new TextEncoder().encode(`${pkgPath}.${expression}`), b => b.toString(16).padStart(2, "0")).join("")
    const result = await directRpcCall(rpcUrl, "abci_query", { path: '"vm/qeval"', data: `0x${data}` }, signal)
    const parsed = z.object({ response: z.object({ ResponseBase: z.object({ Data: z.string(), Error: z.unknown().optional() }) }) }).parse(result)
    if (signal?.aborted || abciErrorPresent(parsed.response.ResponseBase.Error)) throw new Error("Chain read failed")
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(parsed.response.ResponseBase.Data), c => c.charCodeAt(0)))
}

async function read(ctx: WeightedContext, expression: string, signal?: AbortSignal): Promise<unknown> {
    try { return parseWeightedQeval(await qevalText(ctx.rpcUrl, ctx.realmPath, expression, signal)) }
    catch (err) { if (err instanceof Error && err.message === "Chain read failed") throw new Error("DAO read failed"); throw err }
}

export async function readWeightedSnapshot(ctx: WeightedContext, before = "0", signal?: AbortSignal) {
    uint64.parse(before)
    const status = z.object({ node_info: z.object({ network: z.string() }) }).parse(await directRpcCall(ctx.rpcUrl, "status", {}, signal))
    if (status.node_info.network !== ctx.chainId) throw new Error("RPC network does not match the selected chain")
    const [config, roster, envelope] = await Promise.all([
        read(ctx, "GetConfigJSON()", signal).then(v => weightedConfigSchema.parse(v)),
        read(ctx, "GetMembersJSON()", signal).then(v => weightedMembersSchema.parse(v)),
        read(ctx, `GetProposalsJSON(${before}, 20)`, signal).then(v => weightedPageEnvelopeSchema.parse(v)),
    ])
    if (config.realmPath !== ctx.realmPath) throw new Error("DAO realm does not match the requested path")
    if (config.schema !== roster.schema || config.schema !== envelope.schema) throw new Error("Mixed DAO contract versions")
    const itemSchema = weightedProposalFor[envelope.schema]
    let previous = before === "0" ? BigInt(envelope.total) + 1n : BigInt(before)
    const proposals: WeightedPageEntry[] = []
    for (const raw of envelope.proposals) {
        // Config, roster and page shape stay strict. One item the reader cannot
        // validate (for example an operation encoded differently) is listed by
        // its ID only, so the rest of the governance history stays readable.
        const parsed = itemSchema.safeParse(raw)
        const rawID = typeof raw === "object" && raw !== null && "id" in raw ? raw.id : undefined
        const itemID = parsed.success ? parsed.data.id : id.parse(rawID)
        if (BigInt(itemID) !== previous - 1n || BigInt(itemID) > BigInt(envelope.total)) throw new Error("Invalid proposal page")
        previous = BigInt(itemID)
        if (!parsed.success) { proposals.push({ id: itemID, unreadable: true }); continue }
        const p = parsed.data as WeightedProposal
        const action = p.action
        const historical = ["EXECUTED", "INVALIDATED"].includes(p.status)
        if (!historical || config.schema === WEIGHTED_SCHEMA) {
            if (!roster.members.some(m => m.address === p.proposer)) throw new Error("Proposal does not match current members")
            // Only role and recovery actions name a DAO seat; application
            // actions target a fixed realm and are checked against the config.
            if (action.type === "set-role" || action.type === "recover-member") {
                const target = action.type === "set-role" ? action.target : action.oldAddress
                if (!roster.members.some(m => m.address === target && (action.type === "set-role" || m.personId === action.personId))) throw new Error("Proposal does not match current members")
            }
        }
        const configured = action.type === "set-role" || action.type === "recover-member" || (config.schema === WEIGHTED_APPLICATIONS_SCHEMA && applicationActionMatchesPolicy(action, config))
        proposals.push(configured ? p : { id: itemID, unreadable: true })
    }
    const page: WeightedPage = { ...envelope, proposals }
    const expectedCount = (before === "0" ? BigInt(page.total) : BigInt(before) - 1n)
    if (BigInt(before) > BigInt(page.total) || page.proposals.length !== Number(expectedCount > 20n ? 20n : expectedCount)) throw new Error("Truncated proposal page")
    const remaining = previous > 1n
    if (page.proposals.length > 20 || (page.total !== "0" && before !== "1" && page.proposals.length === 0) || (page.nextBefore !== null) !== remaining || (page.nextBefore !== null && page.nextBefore !== page.proposals.at(-1)?.id)) throw new Error("Invalid proposal cursor")
    return { config, members: roster.members, page }
}
export type WeightedSnapshot = Awaited<ReturnType<typeof readWeightedSnapshot>>

/** Adapter policies in host order; empty before v12. */
export function weightedApplicationPolicies(config: WeightedConfig) {
    if (config.schema !== WEIGHTED_APPLICATIONS_SCHEMA) return []
    return APPLICATION_POLICY_KEYS.map(key => ({ key, policy: config[key] }))
}

export async function readWeightedProposal(ctx: WeightedContext, proposalId: string, schema?: string) {
    id.parse(proposalId)
    const response = weightedProposalSchema.parse(await read(ctx, `GetProposalJSON(${proposalId})`))
    if (schema && response.schema !== schema) throw new Error("DAO contract version changed")
    const result = response.proposal
    if (result.id !== proposalId) throw new Error("Unexpected proposal ID")
    return result
}

// ── Per-voter reads (host builds that publish ballots; v12) ─────────────────

const choice = z.enum(["yes", "no", "abstain"])
export const weightedBallotSchema = z.strictObject({
    schema: z.literal(WEIGHTED_APPLICATIONS_SCHEMA), proposalId: id, voter: address,
    eligible: z.boolean(), choice: choice.nullable(), votedAtHeight: uint64.nullable(),
}).refine(b => (b.choice === null) === (b.votedAtHeight === null) && (b.eligible || b.choice === null), "Inconsistent ballot")
export type WeightedBallot = z.infer<typeof weightedBallotSchema>
const pendingEnvelopeSchema = z.strictObject({ schema: z.literal(WEIGHTED_APPLICATIONS_SCHEMA), voter: address, items: z.array(z.unknown()).max(50), next: id.nullable() })
export type WeightedPendingVotes = { voter: string; items: WeightedPageEntry[]; next: string | null }

/** Refuse an RPC that answers for another chain than the selected one. */
export async function assertWeightedChain(ctx: Pick<WeightedContext, "rpcUrl" | "chainId">, signal?: AbortSignal) {
    const status = z.object({ node_info: z.object({ network: z.string() }) }).parse(await directRpcCall(ctx.rpcUrl, "status", {}, signal))
    if (status.node_info.network !== ctx.chainId) throw new Error("RPC network does not match the selected chain")
}

/** One address's ballot on one proposal. Eligibility is the electorate frozen when the proposal was created. */
export async function readWeightedBallot(ctx: WeightedContext, proposalId: string, voter: string, signal?: AbortSignal): Promise<WeightedBallot> {
    id.parse(proposalId); address.parse(voter)
    await assertWeightedChain(ctx, signal)
    const ballot = weightedBallotSchema.parse(await read(ctx, `GetBallotJSON("${proposalId}", "${voter}")`, signal))
    if (ballot.proposalId !== proposalId || ballot.voter !== voter) throw new Error("Ballot does not match the request")
    return ballot
}

/**
 * Open proposals where `voter` is eligible and has not voted, newest first.
 * The host examines at most 200 proposals per call, so `next` can be set on
 * a page with no items. Items it cannot validate are listed by ID only.
 */
export async function readWeightedPendingVotes(ctx: WeightedContext, voter: string, before = "0", limit = 20, signal?: AbortSignal): Promise<WeightedPendingVotes> {
    address.parse(voter); uint64.parse(before)
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid pending-vote page size")
    await assertWeightedChain(ctx, signal)
    const envelope = pendingEnvelopeSchema.parse(await read(ctx, `GetPendingVotesJSON("${voter}", "${before}", ${limit})`, signal))
    if (envelope.voter !== voter) throw new Error("Pending votes do not match the request")
    if (envelope.items.length > limit) throw new Error("Invalid pending-vote page")
    let previous = before === "0" ? null : BigInt(before)
    const items: WeightedPageEntry[] = []
    for (const raw of envelope.items) {
        const parsed = v12Proposal.safeParse(raw)
        const rawID = typeof raw === "object" && raw !== null && "id" in raw ? raw.id : undefined
        const itemID = parsed.success ? parsed.data.id : id.parse(rawID)
        if (previous !== null && BigInt(itemID) >= previous) throw new Error("Invalid pending-vote page")
        previous = BigInt(itemID)
        if (!parsed.success) { items.push({ id: itemID, unreadable: true }); continue }
        const p = parsed.data
        if (p.votingClosed || !["VOTING", "TIMELOCKED", "READY"].includes(p.status)) throw new Error("Pending votes include a closed proposal")
        items.push(p)
    }
    if (envelope.next !== null && previous !== null && BigInt(envelope.next) > previous) throw new Error("Invalid pending-vote cursor")
    if (envelope.next !== null && before !== "0" && BigInt(envelope.next) >= BigInt(before)) throw new Error("Invalid pending-vote cursor")
    return { voter, items, next: envelope.next }
}

/** Short, display-only description of a proposal's action. */
export function weightedProposalTitle(p: WeightedPageEntry): string {
    if (isUnreadableProposal(p)) return `Unreadable proposal #${p.id}`
    const a = p.action
    if (a.type === "set-role") return `${a.grant ? "Grant" : "Remove"} ${a.role}`
    if (a.type === "recover-member") return "Recover member key"
    return `${APPLICATION_LABELS[a.type]} · ${a.operation}`
}

/** Which calls Memba builds for a contract version on a chain. */
export type WeightedWriteKind = WeightedAction["type"]
const NO_WRITES: ReadonlySet<WeightedWriteKind> = new Set()
const WRITE_KINDS: Record<WeightedSchemaVersion, ReadonlySet<WeightedWriteKind>> = {
    [WEIGHTED_SCHEMA]: new Set(["propose", "vote", "execute"]),
    [WEIGHTED_RECOVERY_SCHEMA]: new Set(["propose", "recover", "vote", "execute"]),
    // v12 (the mainnet governing DAO): adapter acceptance, ballots and
    // execution. Role and key-recovery proposals arrive in a later slice.
    [WEIGHTED_APPLICATIONS_SCHEMA]: new Set(["accept", "vote", "execute"]),
}

/** The gnoland-1 governance write hold. Lifting it is a separate, owner-gated change. */
export const WEIGHTED_WRITE_HOLD_CHAINS: readonly string[] = ["gnoland-1"]

/**
 * Calls Memba may build for `schema` on `chainId`: none on a held chain
 * (gnoland-1) or for an unknown version.
 */
export function weightedWriteKinds(schema: string, chainId: string): ReadonlySet<WeightedWriteKind> {
    if (WEIGHTED_WRITE_HOLD_CHAINS.includes(chainId) || !Object.hasOwn(WRITE_KINDS, schema)) return NO_WRITES
    return WRITE_KINDS[schema as WeightedSchemaVersion]
}
/** True when some write exists for this version off the held chains. */
export function weightedWritesSupported(schema: string): boolean { return Object.hasOwn(WRITE_KINDS, schema) }

/** A signable call: the exact message, and for v12 the gas limit and deposit cap it is sent with. */
export interface WeightedTxPlan {
    msg: AminoMsg
    gasWanted?: number
    /** Storage deposit cap in ugnot, also carried in `msg.value.max_deposit` (v12). */
    maxDepositUgnot?: number
}

/**
 * Build the one realm call for `action`. On a held chain nothing is built.
 * v12 calls carry their measured `max_deposit`; an Execute needs the stored
 * action it runs (`executes`) to size it.
 */
export function planWeightedTx(caller: string, realmPath: string, action: WeightedAction, schema: string, chainId: string, executes?: { type: string; operation?: string; grant?: boolean }): WeightedTxPlan {
    if (WEIGHTED_WRITE_HOLD_CHAINS.includes(chainId)) throw new Error("Mainnet governance writes remain on hold")
    if (!weightedWriteKinds(schema, chainId).has(action.type)) throw new Error("This DAO version is read-only in Memba for this action")
    address.parse(caller); realm.parse(realmPath)
    let func: string, args: string[]
    if (action.type === "recover") { func = "ProposeRecovery"; args = [personID.parse(action.personId), address.parse(action.oldAddress), address.parse(action.newAddress)]; if (action.oldAddress === action.newAddress) throw new Error("Recovery must change the address") }
    else if (action.type === "propose") { func = "ProposeRole"; args = [address.parse(action.target), role.parse(action.role), String(z.boolean().parse(action.grant))] }
    else if (action.type === "vote") { func = "Vote"; args = [id.parse(action.id), z.enum(["yes", "no", "abstain"]).parse(action.vote)] }
    else if (action.type === "execute") { func = "Execute"; args = [id.parse(action.id)] }
    else if (action.type === "accept") {
        if (!Object.hasOwn(ACCEPT_FUNCS, action.adapter)) throw new Error("Unknown application adapter")
        func = ACCEPT_FUNCS[action.adapter]; args = []
    }
    else throw new Error("Unsupported weighted action")
    const value = { caller, send: "", pkg_path: realmPath, func, args }
    if (schema !== WEIGHTED_APPLICATIONS_SCHEMA) return { msg: { type: "vm/MsgCall", value } }
    if (action.type === "execute" && !executes) throw new Error("Execute needs the proposal's action to size its budget")
    const budget = action.type === "execute" ? v12ExecuteBudget(executes!) : v12CallBudget(func)
    if (!v12BudgetWithinCeiling(budget)) throw new Error("Call budget is above the storage-deposit ceiling")
    return {
        msg: { type: "vm/MsgCall", value: { ...value, max_deposit: `${budget.maxDepositUgnot}ugnot` } },
        gasWanted: budget.gasWanted, maxDepositUgnot: budget.maxDepositUgnot,
    }
}

export function buildWeightedMessage(caller: string, realmPath: string, action: WeightedAction, schema: string, chainId: string, executes?: { type: string; operation?: string; grant?: boolean }): AminoMsg {
    return planWeightedTx(caller, realmPath, action, schema, chainId, executes).msg
}

/**
 * Re-check a v12 plan right before signing: the message carries exactly the
 * reviewed cap, in canonical form, and it stays under the 10 GNOT ceiling.
 */
export function assertWeightedPlanSignable(plan: WeightedTxPlan): void {
    const raw = (plan.msg.value as Record<string, unknown>).max_deposit
    if (plan.maxDepositUgnot === undefined) { if (raw !== undefined) throw new Error("Unexpected storage-deposit cap"); return }
    const m = typeof raw === "string" ? /^(\d{1,15})ugnot$/.exec(raw) : null
    if (!m || Number(m[1]) !== plan.maxDepositUgnot) throw new Error("The transaction's storage-deposit cap differs from the one reviewed. Review it again.")
    if (!v12BudgetWithinCeiling({ gasWanted: plan.gasWanted ?? 0, maxDepositUgnot: plan.maxDepositUgnot })) throw new Error("The storage-deposit cap is above the 10 GNOT ceiling")
    if (!Number.isSafeInteger(plan.gasWanted) || plan.gasWanted! <= 0) throw new Error("Invalid gas limit")
}

export function assertWeightedWrites(chainId: string, activeChain: string, walletChain: string, schema: string, kind?: WeightedWriteKind) {
    if (WEIGHTED_WRITE_HOLD_CHAINS.includes(chainId)) throw new Error("Mainnet governance writes remain on hold")
    const kinds = weightedWriteKinds(schema, chainId)
    if (kinds.size === 0 || (kind !== undefined && !kinds.has(kind))) throw new Error("This DAO version is read-only in Memba")
    if (chainId !== activeChain || chainId !== walletChain) throw new Error("Wallet or selected network changed")
}

/** Bind a confirmation to the exact roster and roles the member reviewed. */
export function weightedAuthority(snapshot: Awaited<ReturnType<typeof readWeightedSnapshot>>): string {
    return JSON.stringify([snapshot.config, [...snapshot.members].sort((a, b) => a.personId.localeCompare(b.personId))])
}

export function validateWeightedRecovery(snapshot: Awaited<ReturnType<typeof readWeightedSnapshot>>, action: Extract<WeightedAction, { type: "recover" }>) {
    if (!snapshot.config.capabilities.memberReplacement || snapshot.config.schema !== WEIGHTED_RECOVERY_SCHEMA) throw new Error("This DAO does not support member-key recovery")
    address.parse(action.newAddress)
    if (!snapshot.members.some(m => m.personId === action.personId && m.address === action.oldAddress)) throw new Error("Recovery seat changed; refresh before preparing again")
    if (snapshot.members.some(m => m.address === action.newAddress)) throw new Error("Replacement address already belongs to a DAO member")
}

export type WeightedVoteChoice = "yes" | "no" | "abstain"
/**
 * Ballots the realm would record for this voter (v12). The policy accepts a
 * vote from an eligible member while the proposal is active and before its
 * deadline, in VOTING, TIMELOCKED or READY alike; a change of choice is
 * allowed until then, and the same choice again is a no-op. Nothing is
 * offered until the voter's ballot has been read.
 */
export function weightedVoteChoices(p: Pick<WeightedProposal, "status" | "votingClosed">, ballot: WeightedBallot | "error" | undefined): ReadonlySet<WeightedVoteChoice> {
    if (!ballot || ballot === "error" || !ballot.eligible) return new Set()
    if (p.votingClosed || !["VOTING", "TIMELOCKED", "READY"].includes(p.status)) return new Set()
    return new Set((["yes", "no", "abstain"] as const).filter(choice => choice !== ballot.choice))
}
