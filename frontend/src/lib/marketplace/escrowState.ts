/**
 * escrowState.ts — reads of escrow_v4 state, and what they let a user do now.
 *
 * The realm enforces every rule below; these reads only keep Memba from
 * offering a call the realm would refuse (a refused call still costs its fee):
 *
 *   - Per-client cap: CreateContract is refused while the caller holds
 *     MaxActivePerClient (5) open contracts (`GetClientActiveCount`).
 *   - Time-boxed pause (`GetPauseStateJSON`): CreateContract and FundMilestone
 *     are refused while paused; every other state change only while paused
 *     and exits are not open, i.e. until block exitsReopenAt.
 *   - ArchiveContract: client only, on a completed or cancelled contract.
 *   - ExpireUnfunded: anyone, on an active contract no milestone of which was
 *     ever funded, from the realm's pause-adjusted `expireAt`.
 *
 * Every read goes through the realm's JSON views (`GetContractJSON`,
 * `GetClientContractsJSON`, `GetPauseStateJSON`): integers are decimal
 * strings, absent values are null. The parsers accept exactly that shape and
 * throw on anything else, so a changed or unexpected answer never becomes an
 * offered transaction.
 */
import { queryEval } from "../dao/shared"
import { parseQevalGoJSON } from "../goQuote"
import { GNO_RPC_URL } from "../config"
import { isValidGnoAddressChecksum } from "../dao/address"
import { ESCROW_LIMITS } from "./builders"
import { estimateArchiveRefundUgnot } from "./escrowBudget"

export interface EscrowPauseState {
    /** Set by Pause, cleared only by Unpause. New contracts and funding are refused while set. */
    paused: boolean
    /** False only inside the blocking window, when every other state change is refused too. */
    exitsOpen: boolean
    /** First block at which exits reopen (0 when not paused). */
    exitsReopenAt: number
    /** Blocking-window blocks so far, which the timeout clocks skip. */
    pausedBlocks: number
}

export type EscrowContractStatus = "active" | "completed" | "disputed" | "cancelled"
export type EscrowMilestoneStatus = "pending" | "funded" | "completed" | "released" | "disputed" | "refunded"

export interface EscrowMilestoneView {
    index: number
    title: string
    amountUgnot: number
    status: EscrowMilestoneStatus
    fundedAt: number | null
    completedAt: number | null
    disputedAt: number | null
    /** Height from which ClaimRefund is accepted (funded milestones only). */
    refundAt: number | null
    /** Height from which ClaimDisputeTimeout is accepted (disputed milestones only). */
    resolveAt: number | null
}

export interface EscrowContractView {
    id: string
    title: string
    description: string
    client: string
    freelancer: string
    status: EscrowContractStatus
    /** Block height of CreateContract. */
    createdAt: number
    /** First funding height, or null when nothing was ever funded. */
    fundedAt: number | null
    /** Earliest pause-adjusted deadlines (null when none applies). */
    refundAt: number | null
    expireAt: number | null
    resolveAt: number | null
    milestones: EscrowMilestoneView[]
    totals: { amountUgnot: number; escrowedUgnot: number; releasedUgnot: number; refundedUgnot: number }
}

export interface EscrowContractSummary {
    id: string
    status: EscrowContractStatus
    createdAt: number
}

export interface EscrowContractsPage {
    items: EscrowContractSummary[]
    /** Cursor for the next (older) page, or null on the last page. */
    next: string | null
}

/** Something a user can or cannot do now, and why. */
export type EscrowAvailability = { available: true; note?: string } | { available: false; reason: string }

/** gnoland-1's observed average block time, used only for rough "about N days" estimates. */
export const APPROX_BLOCK_SECONDS = 3.3

/** Page size for GetClientContractsJSON (the realm clamps to 1..50). */
export const ESCROW_PAGE_LIMIT = 20

const CONTRACT_STATUSES: ReadonlySet<string> = new Set(["active", "completed", "disputed", "cancelled"])
const MILESTONE_STATUSES: ReadonlySet<string> = new Set(["pending", "funded", "completed", "released", "disputed", "refunded"])
const CONTRACT_ID = /^(0|[1-9]\d{0,8})$/

/** A view answer the parser does not recognise. */
export class EscrowViewError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "EscrowViewError"
    }
}

const bad = (what: string): never => { throw new EscrowViewError(`Unexpected escrow answer: ${what}`) }

type Obj = Record<string, unknown>

/** A plain object with exactly these keys. */
function exact(v: unknown, keys: readonly string[], what: string): Obj {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return bad(`${what} is not an object`)
    const got = Object.keys(v).sort()
    const want = [...keys].sort()
    if (got.length !== want.length || got.some((k, i) => k !== want[i])) return bad(`${what} has fields ${got.join(",")}`)
    return v as Obj
}

/** A decimal-string integer, as the realm's jint writes it, within the safe integer range. */
function dec(v: unknown, what: string): number {
    if (typeof v !== "string" || !/^(0|[1-9]\d{0,15})$/.test(v)) return bad(`${what} is not a decimal string`)
    const n = Number(v)
    return Number.isSafeInteger(n) ? n : bad(`${what} is out of range`)
}

/** A block height (jheight): null when unset, else a positive decimal string. */
function height(v: unknown, what: string): number | null {
    if (v === null) return null
    const n = dec(v, what)
    return n > 0 ? n : bad(`${what} is zero`)
}

function str(v: unknown, what: string): string {
    return typeof v === "string" ? v : bad(`${what} is not a string`)
}

function bool(v: unknown, what: string): boolean {
    return typeof v === "boolean" ? v : bad(`${what} is not a boolean`)
}

function addr(v: unknown, what: string): string {
    const s = str(v, what)
    return isValidGnoAddressChecksum(s) ? s : bad(`${what} is not an address`)
}

function oneOf<T extends string>(v: unknown, set: ReadonlySet<string>, what: string): T {
    const s = str(v, what)
    return set.has(s) ? (s as T) : bad(`${what} "${s}"`)
}

/**
 * The JSON payload of a qeval string return, or throw. Decoded with the full
 * strconv.Quote grammar: stored text may hold runes the node prints as
 * `\UXXXXXXXX` (newer emoji, private use), which JSON.parse alone rejects.
 */
function payload(raw: string | null, what: string): unknown {
    if (raw === null) throw new Error(`Could not read ${what}`)
    const v = parseQevalGoJSON(raw)
    return v === null ? bad(`${what} is not JSON`) : v
}

/** Parse GetPauseStateJSON. */
export function parsePauseStateJSON(v: unknown): EscrowPauseState {
    const o = exact(v, ["paused", "pausedAt", "exitsReopenAt", "exitsOpen", "cooldownUntil", "pausedBlocks"], "pause state")
    const paused = bool(o.paused, "paused")
    const exitsOpen = bool(o.exitsOpen, "exitsOpen")
    const pausedAt = height(o.pausedAt, "pausedAt")
    const exitsReopenAt = height(o.exitsReopenAt, "exitsReopenAt")
    dec(o.cooldownUntil, "cooldownUntil")
    const pausedBlocks = dec(o.pausedBlocks, "pausedBlocks")
    // The realm sets both heights exactly while paused, and exits are always open otherwise.
    if (paused ? pausedAt === null || exitsReopenAt === null || exitsReopenAt !== pausedAt + ESCROW_LIMITS.maxPauseBlocks : pausedAt !== null || exitsReopenAt !== null || !exitsOpen) {
        return bad("inconsistent pause state")
    }
    return { paused, exitsOpen, exitsReopenAt: exitsReopenAt ?? 0, pausedBlocks }
}

function parseMilestone(v: unknown, i: number): EscrowMilestoneView {
    const what = `milestone ${i}`
    const o = exact(v, ["index", "title", "amountUgnot", "status", "fundedAtHeight", "completedAtHeight", "disputedAtHeight", "refundAt", "resolveAt"], what)
    if (dec(o.index, `${what} index`) !== i) bad(`${what} index`)
    return {
        index: i,
        title: str(o.title, `${what} title`),
        amountUgnot: dec(o.amountUgnot, `${what} amount`),
        status: oneOf<EscrowMilestoneStatus>(o.status, MILESTONE_STATUSES, `${what} status`),
        fundedAt: height(o.fundedAtHeight, `${what} fundedAtHeight`),
        completedAt: height(o.completedAtHeight, `${what} completedAtHeight`),
        disputedAt: height(o.disputedAtHeight, `${what} disputedAtHeight`),
        refundAt: height(o.refundAt, `${what} refundAt`),
        resolveAt: height(o.resolveAt, `${what} resolveAt`),
    }
}

/**
 * Parse GetContractJSON(id). Null for an unknown or archived id
 * (`{"exists":false,"id":…}`); throws on any other shape, or when the answer
 * is about another id.
 */
export function parseContractJSON(id: string, v: unknown): EscrowContractView | null {
    if (typeof v === "object" && v !== null && (v as Obj).exists === false) {
        const o = exact(v, ["exists", "id"], "missing contract")
        return o.id === id ? null : bad("answer for another id")
    }
    const o = exact(v, ["exists", "id", "client", "freelancer", "title", "description", "status", "createdAtHeight", "fundedAtHeight", "refundAt", "expireAt", "resolveAt", "milestones", "totals"], "contract")
    if (o.exists !== true) bad("exists")
    if (o.id !== id) bad("answer for another id")
    if (!Array.isArray(o.milestones) || o.milestones.length === 0 || o.milestones.length > ESCROW_LIMITS.maxMilestones) bad("milestones")
    const t = exact(o.totals, ["amountUgnot", "escrowedUgnot", "releasedUgnot", "refundedUgnot"], "totals")
    const createdAt = height(o.createdAtHeight, "createdAtHeight")
    return {
        id,
        client: addr(o.client, "client"),
        freelancer: addr(o.freelancer, "freelancer"),
        title: str(o.title, "title"),
        description: str(o.description, "description"),
        status: oneOf<EscrowContractStatus>(o.status, CONTRACT_STATUSES, "status"),
        createdAt: createdAt ?? bad("createdAtHeight is null"),
        fundedAt: height(o.fundedAtHeight, "fundedAtHeight"),
        refundAt: height(o.refundAt, "refundAt"),
        expireAt: height(o.expireAt, "expireAt"),
        resolveAt: height(o.resolveAt, "resolveAt"),
        milestones: (o.milestones as unknown[]).map(parseMilestone),
        totals: {
            amountUgnot: dec(t.amountUgnot, "total amount"),
            escrowedUgnot: dec(t.escrowedUgnot, "escrowed total"),
            releasedUgnot: dec(t.releasedUgnot, "released total"),
            refundedUgnot: dec(t.refundedUgnot, "refunded total"),
        },
    }
}

/**
 * Parse GetClientContractsJSON: at most `limit` items, ids strictly newest
 * first, and a `next` cursor that is either null or the last id of the page.
 */
export function parseClientContractsJSON(v: unknown, limit: number, before = ""): EscrowContractsPage {
    const o = exact(v, ["items", "next"], "contract page")
    if (!Array.isArray(o.items) || o.items.length > limit) bad("page items")
    const items = (o.items as unknown[]).map((item, i) => {
        const it = exact(item, ["id", "status", "createdAtHeight"], `page item ${i}`)
        const id = str(it.id, "item id")
        if (!CONTRACT_ID.test(id)) bad(`item id "${id}"`)
        const createdAt = height(it.createdAtHeight, "item createdAtHeight")
        return { id, status: oneOf<EscrowContractStatus>(it.status, CONTRACT_STATUSES, "item status"), createdAt: createdAt ?? bad("item createdAtHeight is null") }
    })
    const ids = items.map((it) => Number(it.id))
    if (ids.some((n, i) => i > 0 && n >= ids[i - 1]) || (before !== "" && ids.length > 0 && ids[0] >= Number(before))) bad("page order")
    let next: string | null = null
    if (o.next !== null) {
        next = str(o.next, "next")
        if (items.length === 0 || next !== items[items.length - 1].id) bad("next cursor")
    }
    return { items, next }
}

/** Read GetPauseStateJSON(). */
export async function readEscrowPauseState(escrowPath: string): Promise<EscrowPauseState> {
    return parsePauseStateJSON(payload(await queryEval(GNO_RPC_URL, escrowPath, "GetPauseStateJSON()", true), "the escrow pause state"))
}

/** Read `GetClientActiveCount(client)`: the open contracts this address created. */
export async function readClientActiveCount(escrowPath: string, client: string): Promise<number> {
    // The address goes into an expression the node evaluates: only a checksummed bech32 address is interpolated.
    if (!isValidGnoAddressChecksum(client)) throw new Error("Invalid client address")
    const n = parseQevalInt(await queryEval(GNO_RPC_URL, escrowPath, `GetClientActiveCount("${client}")`, true))
    if (n === null || n < 0) throw new Error("Could not read your open escrow contracts")
    return n
}

/** Read one contract, or null when the id is unknown or the contract was archived. */
export async function readEscrowContract(escrowPath: string, id: string): Promise<EscrowContractView | null> {
    if (!CONTRACT_ID.test(id)) throw new Error(`Invalid contract id "${id}"`)
    return parseContractJSON(id, payload(await queryEval(GNO_RPC_URL, escrowPath, `GetContractJSON("${id}")`, true), "the escrow contract"))
}

/** Read one page of the contracts `client` created, newest first. `before` is "" or the previous page's `next`. */
export async function readClientContracts(escrowPath: string, client: string, before = "", limit = ESCROW_PAGE_LIMIT): Promise<EscrowContractsPage> {
    if (!isValidGnoAddressChecksum(client)) throw new Error("Invalid client address")
    if (before !== "" && !CONTRACT_ID.test(before)) throw new Error(`Invalid page cursor "${before}"`)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid page size")
    const raw = await queryEval(GNO_RPC_URL, escrowPath, `GetClientContractsJSON("${client}", "${before}", ${limit})`, true)
    return parseClientContractsJSON(payload(raw, "your escrow contracts"), limit, before)
}

/** Read `GetCreatedCount()`: every contract ever created, so the next id is this number. */
export async function readCreatedCount(escrowPath: string): Promise<number> {
    const n = parseQevalInt(await queryEval(GNO_RPC_URL, escrowPath, "GetCreatedCount()", true))
    if (n === null || n < 0) throw new Error("Could not read the escrow contract counter")
    return n
}

/**
 * After a CreateContract landed, find the contract it made: the client's
 * newest contract, if its id is at least `createdBefore` (GetCreatedCount()
 * read before broadcasting, so an older contract can never be taken for it)
 * and it has this freelancer, title, description and milestones. Null when it
 * cannot be confirmed (for example a node that has not caught up yet).
 */
export async function findCreatedContract(
    escrowPath: string,
    client: string,
    createdBefore: number,
    expected: { freelancer: string; title: string; description: string; milestones: readonly { title: string; amountUgnot: number }[] },
): Promise<string | null> {
    if (!Number.isSafeInteger(createdBefore) || createdBefore < 0) return null
    const page = await readClientContracts(escrowPath, client, "", 1)
    const newest = page.items[0]
    if (!newest || Number(newest.id) < createdBefore) return null
    const c = await readEscrowContract(escrowPath, newest.id)
    const same = c !== null && c.client === client && c.freelancer === expected.freelancer && c.title === expected.title &&
        c.description === expected.description && c.milestones.length === expected.milestones.length &&
        c.milestones.every((m, i) => m.title === expected.milestones[i].title && m.amountUgnot === expected.milestones[i].amountUgnot)
    return same ? newest.id : null
}

/** `(42 int)` → 42. Anything else, or an unsafe integer → null. */
export function parseQevalInt(raw: string | null): number | null {
    const m = raw?.trim().match(/^\(\s*(-?\d{1,16})\s+int(?:64)?\s*\)$/)
    if (!m) return null
    const n = Number(m[1])
    return Number.isSafeInteger(n) ? n : null
}

/** "about 3 days", "about 5 hours", "about 12 minutes" for a number of blocks. */
export function formatBlocksEta(blocks: number, blockSeconds = APPROX_BLOCK_SECONDS): string {
    const minutes = Math.max(1, Math.round((Math.max(0, blocks) * blockSeconds) / 60))
    if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`
    const hours = Math.round(minutes / 60)
    if (hours < 48) return `about ${hours} hour${hours === 1 ? "" : "s"}`
    return `about ${Math.round(hours / 24)} days`
}

const reopenAt = (pause: EscrowPauseState, height: number) =>
    `block ${pause.exitsReopenAt.toLocaleString("en-US")}${height > 0 && pause.exitsReopenAt > height ? ` (${formatBlocksEta(pause.exitsReopenAt - height)})` : ""}`

/** Why exits are shut, with the reopen height and a rough time, or null when they are open. */
export function exitsClosedReason(pause: EscrowPauseState, height: number): string | null {
    if (!pause.paused || pause.exitsOpen) return null
    return `Escrow is paused. This action reopens at ${reopenAt(pause, height)}, even if nobody unpauses it.`
}

/** Whether CreateContract would be accepted for a client holding `activeCount` open contracts. */
export function hireAvailability(pause: EscrowPauseState, activeCount: number, height: number): EscrowAvailability {
    if (pause.paused) {
        const others = pause.exitsOpen ? "" : ` Other actions reopen at ${reopenAt(pause, height)}.`
        return { available: false, reason: `Escrow is paused: new contracts and funding are refused until it is unpaused.${others}` }
    }
    if (activeCount >= ESCROW_LIMITS.maxActivePerClient) {
        return {
            available: false,
            reason: `You already have ${activeCount} open escrow contracts, the most one client can hold (${ESCROW_LIMITS.maxActivePerClient}). A contract stops counting once it is completed or cancelled.`,
        }
    }
    return { available: true }
}

const holdsFunds = (c: EscrowContractView) => c.milestones.some((m) => m.status === "funded" || m.status === "completed" || m.status === "disputed")

/** Whether `caller` can archive this contract now. Null when archiving does not apply to them. */
export function archiveAvailability(c: EscrowContractView, caller: string, pause: EscrowPauseState, height: number): EscrowAvailability | null {
    if (!caller || caller !== c.client) return null
    if (c.status !== "completed" && c.status !== "cancelled") {
        return { available: false, reason: "Only a completed or cancelled contract can be archived." }
    }
    if (holdsFunds(c)) return { available: false, reason: "Escrowed funds remain in a milestone, so the contract cannot be archived." }
    const shut = exitsClosedReason(pause, height)
    return shut ? { available: false, reason: shut } : { available: true }
}

/**
 * Whether anyone can expire this contract now. Null when it was funded or is
 * no longer active (the realm then reports no `expireAt`). `expireAt` is the
 * realm's own pause-adjusted deadline, assuming no further pause.
 */
export function expireAvailability(c: EscrowContractView, pause: EscrowPauseState, height: number): EscrowAvailability | null {
    if (c.status !== "active" || c.expireAt === null || c.milestones.some((m) => m.status !== "pending")) return null
    if (height <= 0) return { available: false, reason: "Could not read the current block height." }
    if (height < c.expireAt) {
        return { available: false, reason: `Never funded. Anyone can expire it from block ${c.expireAt.toLocaleString("en-US")} (${formatBlocksEta(c.expireAt - height)}).` }
    }
    const shut = exitsClosedReason(pause, height)
    return shut ? { available: false, reason: shut } : { available: true }
}

/** About how much ArchiveContract would refund for this contract, in ugnot. */
export function archiveRefundEstimateUgnot(c: EscrowContractView): number {
    const bytes = (s: string) => new TextEncoder().encode(s).length
    return estimateArchiveRefundUgnot({
        titleBytes: bytes(c.title),
        descriptionBytes: bytes(c.description),
        milestoneTitleBytes: c.milestones.map((m) => bytes(m.title)),
    })
}

/** "~0.47 GNOT" */
export function formatApproxGnot(ugnot: number): string {
    return `~${(ugnot / 1_000_000).toFixed(2)} GNOT`
}
