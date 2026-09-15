/** Versioned founding DAO contract. Never fall back to legacy Render parsing. */
import { z } from "zod"
import { abciErrorPresent, directRpcCall } from "../rpcFallback"
import { bech32Encode } from "./realmAddress"
import type { AminoMsg } from "./shared"

export const WEIGHTED_SCHEMA = "memba-weighted-host/v1"
export const WEIGHTED_RECOVERY_SCHEMA = "memba-weighted-host/v2"
const realm = z.string().regex(/^gno\.land\/r\/samcrew\/[a-z][a-z0-9_]{0,63}$/)
const uint64 = z.string().regex(/^(0|[1-9][0-9]{0,19})$/).refine(s => BigInt(s) <= 18446744073709551615n)
const id = uint64.refine(s => s !== "0")
const address = z.string().regex(/^g1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/).refine(value => {
    const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l", bytes: number[] = []
    let acc = 0, bits = 0
    for (const c of value.slice(2, 34)) {
        const word = alphabet.indexOf(c)
        if (word < 0) return false
        acc = (acc << 5) | word; bits += 5
        if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255) }
    }
    return bytes.length === 20 && bech32Encode("g", new Uint8Array(bytes)) === value
}, "Invalid Gno address checksum")
const personID = z.string().min(1).max(320)
const role = z.enum(["admin", "finance"])
const time = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 19) === s.slice(0, 19))
const envelope = { schema: z.enum([WEIGHTED_SCHEMA, WEIGHTED_RECOVERY_SCHEMA]) }
export const weightedConfigSchema = z.strictObject({
    ...envelope, kind: z.literal("config"), realmPath: realm,
    rosterSize: z.literal(7), totalPoints: z.literal(8), founderWeight: z.literal(2), developerWeight: z.literal(1),
    votingPeriodSeconds: z.literal(604800), maxProposalPage: z.literal(50),
    mutableRoles: z.tuple([z.literal("admin"), z.literal("finance")]),
    roleChanges: z.strictObject({ category: z.literal("critical"), weightedPoints: z.literal(6), weightedPeople: z.literal(4), weightedDelaySeconds: z.literal(86400), independentDevelopers: z.literal(5), independentDelaySeconds: z.literal(259200) }),
    capabilities: z.strictObject({ roleProposals: z.literal(true), memberReplacement: z.boolean(), migration: z.literal(false), treasuryExecution: z.literal(false), applicationActions: z.literal(false) }),
}).refine(c => c.capabilities.memberReplacement === (c.schema === WEIGHTED_RECOVERY_SCHEMA), "Capability does not match contract version")
const member = z.strictObject({ personId: personID, address, founder: z.boolean(), weight: z.union([z.literal(1), z.literal(2)]), admin: z.boolean(), finance: z.boolean() })
export const weightedMembersSchema = z.strictObject({ ...envelope, kind: z.literal("members"), members: z.array(member).length(7) }).refine(({ members }) =>
    new Set(members.map(m => m.address)).size === 7 && new Set(members.map(m => m.personId)).size === 7 &&
    members.filter(m => m.founder).length === 1 && members.some(m => m.admin) && members.every(m => m.weight === (m.founder ? 2 : 1)), "Invalid founding roster")
const proposal = z.strictObject({
    id, proposer: address, action: z.discriminatedUnion("type", [
        z.strictObject({ type: z.literal("set-role"), target: address, role, grant: z.boolean() }),
        z.strictObject({ type: z.literal("recover-member"), personId: personID, oldAddress: address, newAddress: address }).refine(a => a.oldAddress !== a.newAddress),
    ]),
    category: z.literal("critical"), status: z.enum(["VOTING", "TIMELOCKED", "READY", "EXPIRED", "INVALIDATED", "EXECUTED"]),
    qualified: z.boolean(), ready: z.boolean(), votingClosed: z.boolean(), talliesAvailable: z.boolean(),
    weightYes: z.number().int().min(0).max(8).nullable(), peopleYes: z.number().int().min(0).max(7).nullable(), developersYes: z.number().int().min(0).max(6).nullable(),
    createdAt: time, votingDeadline: time, weightedAfter: time.nullable(), developerAfter: time.nullable(),
}).refine(p => {
    const terminal = p.status === "EXECUTED" || p.status === "INVALIDATED"
    if (p.ready !== (p.status === "READY") || p.talliesAvailable === terminal) return false
    if (Date.parse(p.votingDeadline) - Date.parse(p.createdAt) !== 604800000) return false
    if (terminal) return p.weightYes === null && p.peopleYes === null && p.developersYes === null && !p.qualified
    if (p.weightYes === null || p.peopleYes === null || p.developersYes === null) return false
    if (p.peopleYes - p.developersYes < 0 || p.peopleYes - p.developersYes > 1 || p.weightYes !== p.developersYes + 2 * (p.peopleYes - p.developersYes)) return false
    const qualified = (p.weightedAfter !== null || p.developerAfter !== null)
    if (p.qualified !== qualified || p.qualified !== ["TIMELOCKED", "READY"].includes(p.status)) return false
    if (p.status === "EXPIRED" && !p.votingClosed) return false
    if (p.status === "VOTING" && p.votingClosed) return false
    return (p.weightedAfter === null || p.weightYes >= 6 && p.peopleYes >= 4) && (p.developerAfter === null || p.developersYes >= 5)
}, "Inconsistent proposal state")
export const weightedProposalSchema = z.strictObject({ ...envelope, kind: z.literal("proposal"), proposal }).refine(v => v.schema !== WEIGHTED_SCHEMA || v.proposal.action.type === "set-role", "Recovery requires v2")
export const weightedPageSchema = z.strictObject({ ...envelope, kind: z.literal("proposals"), total: uint64, proposals: z.array(proposal).max(50), nextBefore: id.nullable() }).refine(v => v.schema !== WEIGHTED_SCHEMA || v.proposals.every(p => p.action.type === "set-role"), "Recovery requires v2")
export type WeightedProposal = z.infer<typeof proposal>
export type WeightedMember = z.infer<typeof member>
export type WeightedPage = z.infer<typeof weightedPageSchema>
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
    const [config, roster, page] = await Promise.all([
        read(ctx, "GetConfigJSON()", signal).then(v => weightedConfigSchema.parse(v)),
        read(ctx, "GetMembersJSON()", signal).then(v => weightedMembersSchema.parse(v)),
        read(ctx, `GetProposalsJSON(${before}, 20)`, signal).then(v => weightedPageSchema.parse(v)),
    ])
    if (config.realmPath !== ctx.realmPath) throw new Error("DAO realm does not match the requested path")
    if (config.schema !== roster.schema || config.schema !== page.schema) throw new Error("Mixed DAO contract versions")
    let previous = before === "0" ? BigInt(page.total) + 1n : BigInt(before)
    for (const p of page.proposals) {
        if (BigInt(p.id) !== previous - 1n || BigInt(p.id) > BigInt(page.total)) throw new Error("Invalid proposal page")
        const historical = ["EXECUTED", "INVALIDATED"].includes(p.status)
        if (!historical || config.schema === WEIGHTED_SCHEMA) {
            const action = p.action
            const target = action.type === "set-role" ? action.target : action.oldAddress
            if (!roster.members.some(m => m.address === p.proposer) || !roster.members.some(m => m.address === target && (action.type === "set-role" || m.personId === action.personId))) throw new Error("Proposal does not match current members")
        }
        previous = BigInt(p.id)
    }
    const expectedCount = (before === "0" ? BigInt(page.total) : BigInt(before) - 1n)
    if (BigInt(before) > BigInt(page.total) || page.proposals.length !== Number(expectedCount > 20n ? 20n : expectedCount)) throw new Error("Truncated proposal page")
    const remaining = previous > 1n
    if (page.proposals.length > 20 || (page.total !== "0" && before !== "1" && page.proposals.length === 0) || (page.nextBefore !== null) !== remaining || (page.nextBefore !== null && page.nextBefore !== page.proposals.at(-1)?.id)) throw new Error("Invalid proposal cursor")
    return { config, members: roster.members, page }
}

export async function readWeightedProposal(ctx: WeightedContext, proposalId: string, schema?: string) {
    id.parse(proposalId)
    const response = weightedProposalSchema.parse(await read(ctx, `GetProposalJSON(${proposalId})`))
    if (schema && response.schema !== schema) throw new Error("DAO contract version changed")
    const result = response.proposal
    if (result.id !== proposalId) throw new Error("Unexpected proposal ID")
    return result
}

export function buildWeightedMessage(caller: string, realmPath: string, action: WeightedAction): AminoMsg {
    address.parse(caller); realm.parse(realmPath)
    let func: string, args: string[]
    if (action.type === "recover") { func = "ProposeRecovery"; args = [personID.parse(action.personId), address.parse(action.oldAddress), address.parse(action.newAddress)]; if (action.oldAddress === action.newAddress) throw new Error("Recovery must change the address") }
    else if (action.type === "propose") { func = "ProposeRole"; args = [address.parse(action.target), role.parse(action.role), String(z.boolean().parse(action.grant))] }
    else if (action.type === "vote") { func = "Vote"; args = [id.parse(action.id), z.enum(["yes", "no", "abstain"]).parse(action.vote)] }
    else if (action.type === "execute") { func = "Execute"; args = [id.parse(action.id)] }
    else throw new Error("Unsupported weighted action")
    return { type: "vm/MsgCall", value: { caller, send: "", pkg_path: realmPath, func, args } }
}

export function assertWeightedWrites(chainId: string, activeChain: string, walletChain: string) {
    if (chainId === "gnoland-1") throw new Error("Mainnet governance writes remain on hold")
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
