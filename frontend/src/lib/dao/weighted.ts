/** Versioned founding DAO contract. Never fall back to legacy Render parsing. */
import { z } from "zod"
import { abciErrorPresent, directRpcCall } from "../rpcFallback"
import type { AminoMsg } from "./shared"
import { address, id, personID, realm, role, time, uint64 } from "./weightedPrimitives"
import { APPLICATION_POLICY_KEYS, IMMEDIATE_THRESHOLDS, applicationActionMatchesPolicy, applicationPolicySchemas, expectedCategory, recoverMemberAction, setRoleAction, v12Action } from "./weightedApplications"

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

type ProposalState = {
    action: { type: string; operation?: string }; category: "routine" | "financial" | "critical"; status: string
    qualified: boolean; ready: boolean; votingClosed: boolean; talliesAvailable: boolean
    weightYes: number | null; peopleYes: number | null; developersYes: number | null
    createdAt: string; votingDeadline: string; weightedAfter: string | null; developerAfter: string | null
}
/** Mirrors the policy's State(): terminal states clear tallies; routine/financial are ready once qualified. */
function consistentProposal(p: ProposalState): boolean {
    if (p.category !== expectedCategory(p.action)) return false
    const terminal = p.status === "EXECUTED" || p.status === "INVALIDATED"
    if (p.ready !== (p.status === "READY") || p.talliesAvailable === terminal) return false
    if (Date.parse(p.votingDeadline) - Date.parse(p.createdAt) !== 604800000) return false
    if (terminal) return p.weightYes === null && p.peopleYes === null && p.developersYes === null && !p.qualified && p.weightedAfter === null && p.developerAfter === null
    if (p.weightYes === null || p.peopleYes === null || p.developersYes === null) return false
    if (p.peopleYes - p.developersYes < 0 || p.peopleYes - p.developersYes > 1 || p.weightYes !== p.developersYes + 2 * (p.peopleYes - p.developersYes)) return false
    if (p.status === "EXPIRED" && !p.votingClosed) return false
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
const proposalFor = <A extends z.ZodType<{ type: string }>>(action: A) => z.strictObject({
    id, proposer: address, action,
    category: z.enum(["routine", "financial", "critical"]), status: z.enum(["VOTING", "TIMELOCKED", "READY", "EXPIRED", "INVALIDATED", "EXECUTED"]),
    qualified: z.boolean(), ready: z.boolean(), votingClosed: z.boolean(), talliesAvailable: z.boolean(),
    weightYes: tally(8), peopleYes: tally(7), developersYes: tally(6),
    createdAt: time, votingDeadline: time, weightedAfter: time.nullable(), developerAfter: time.nullable(),
}).refine(p => consistentProposal(p as ProposalState), "Inconsistent proposal state")
const v1Proposal = proposalFor(z.discriminatedUnion("type", [setRoleAction]))
const v2Proposal = proposalFor(z.discriminatedUnion("type", [setRoleAction, recoverMemberAction]))
const v12Proposal = proposalFor(v12Action)
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
export type WeightedProposal = z.infer<typeof v12Proposal>
/** A list item the contract returned but Memba could not validate. It is shown by ID only and offers no action. */
export type UnreadableWeightedProposal = { id: string; unreadable: true }
export type WeightedPageEntry = WeightedProposal | UnreadableWeightedProposal
export function isUnreadableProposal(p: WeightedPageEntry): p is UnreadableWeightedProposal { return "unreadable" in p }
export type WeightedMember = z.infer<typeof member>
export type WeightedPage = Omit<z.infer<typeof weightedPageSchema>, "proposals"> & { proposals: WeightedPageEntry[] }
export type WeightedContext = { rpcUrl: string; chainId: string; realmPath: string }
export type WeightedAction = { type: "recover"; personId: string; oldAddress: string; newAddress: string } | { type: "propose"; target: string; role: "admin" | "finance"; grant: boolean } | { type: "vote"; id: string; vote: "yes" | "no" | "abstain" } | { type: "execute"; id: string }

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

async function read(ctx: WeightedContext, expression: string, signal?: AbortSignal): Promise<unknown> {
    realm.parse(ctx.realmPath)
    if (signal?.aborted) throw new Error("Read cancelled")
    const data = Array.from(new TextEncoder().encode(`${ctx.realmPath}.${expression}`), b => b.toString(16).padStart(2, "0")).join("")
    const result = await directRpcCall(ctx.rpcUrl, "abci_query", { path: '"vm/qeval"', data: `0x${data}` }, signal)
    const parsed = z.object({ response: z.object({ ResponseBase: z.object({ Data: z.string(), Error: z.unknown().optional() }) }) }).parse(result)
    if (signal?.aborted || abciErrorPresent(parsed.response.ResponseBase.Error)) throw new Error("DAO read failed")
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(parsed.response.ResponseBase.Data), c => c.charCodeAt(0)))
    return parseWeightedQeval(raw)
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

/**
 * Contract versions Memba builds transactions for. v12 (the mainnet governing
 * DAO) is read-only on every network until its write slices land.
 */
export const WEIGHTED_WRITABLE_SCHEMAS: readonly string[] = [WEIGHTED_SCHEMA, WEIGHTED_RECOVERY_SCHEMA]
export function weightedWritesSupported(schema: string): boolean { return WEIGHTED_WRITABLE_SCHEMAS.includes(schema) }

export function buildWeightedMessage(caller: string, realmPath: string, action: WeightedAction, schema: string): AminoMsg {
    if (!weightedWritesSupported(schema)) throw new Error("This DAO version is read-only in Memba")
    address.parse(caller); realm.parse(realmPath)
    let func: string, args: string[]
    if (action.type === "recover") { func = "ProposeRecovery"; args = [personID.parse(action.personId), address.parse(action.oldAddress), address.parse(action.newAddress)]; if (action.oldAddress === action.newAddress) throw new Error("Recovery must change the address") }
    else if (action.type === "propose") { func = "ProposeRole"; args = [address.parse(action.target), role.parse(action.role), String(z.boolean().parse(action.grant))] }
    else if (action.type === "vote") { func = "Vote"; args = [id.parse(action.id), z.enum(["yes", "no", "abstain"]).parse(action.vote)] }
    else if (action.type === "execute") { func = "Execute"; args = [id.parse(action.id)] }
    else throw new Error("Unsupported weighted action")
    return { type: "vm/MsgCall", value: { caller, send: "", pkg_path: realmPath, func, args } }
}

export function assertWeightedWrites(chainId: string, activeChain: string, walletChain: string, schema: string) {
    if (chainId === "gnoland-1") throw new Error("Mainnet governance writes remain on hold")
    if (!weightedWritesSupported(schema)) throw new Error("This DAO version is read-only in Memba")
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
