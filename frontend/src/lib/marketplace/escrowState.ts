/**
 * escrowState.ts — reads of escrow_v4 state, and what they let a user do now.
 *
 * The realm enforces every rule below; these reads only keep Memba from
 * offering a call the realm would refuse (a refused call still costs its fee):
 *
 *   - Per-client cap: CreateContract is refused while the caller holds
 *     MaxActivePerClient (5) open contracts (`GetClientActiveCount`).
 *   - Time-boxed pause (`PauseState()`): CreateContract and FundMilestone are
 *     refused while Paused; every other state change only while Paused and
 *     not ExitsOpen, i.e. until block ExitsReopenAt.
 *   - ArchiveContract: client only, on a completed or cancelled contract.
 *   - ExpireUnfunded: anyone, on an active contract no milestone of which was
 *     ever funded, UnfundedExpiryBlks after creation (blocks inside a pause's
 *     blocking window do not count).
 *
 * Contract details come from `Render("contract/<id>")`. Its layout is fixed by
 * render.gno, and user text cannot break it: the realm strips `*`, `#`,
 * brackets and line breaks from every stored title and description.
 */
import { queryEval, queryRender } from "../dao/shared"
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

export interface EscrowContractView {
    id: string
    title: string
    description: string
    client: string
    freelancer: string
    status: EscrowContractStatus
    /** Block height of CreateContract. */
    createdAt: number
    milestones: { title: string; amountUgnot: number; status: EscrowMilestoneStatus }[]
}

/** Something a user can or cannot do now, and why. */
export type EscrowAvailability = { available: true; note?: string } | { available: false; reason: string }

/** gnoland-1's observed average block time, used only for rough "about N days" estimates. */
export const APPROX_BLOCK_SECONDS = 3.3

const CONTRACT_STATUSES: ReadonlySet<string> = new Set(["active", "completed", "disputed", "cancelled"])
const MILESTONE_STATUSES: ReadonlySet<string> = new Set(["pending", "funded", "completed", "released", "disputed", "refunded"])

/** `(true bool)` → true. Anything else → null. */
export function parseQevalBool(raw: string | null): boolean | null {
    const m = raw?.trim().match(/^\(\s*(true|false)\s+bool\s*\)$/)
    return m ? m[1] === "true" : null
}

/** `(42 int)` or `(42 int64)` → 42. Anything else, or an unsafe integer → null. */
export function parseQevalInt(raw: string | null): number | null {
    const m = raw?.trim().match(/^\(\s*(-?\d{1,16})\s+int(?:64)?\s*\)$/)
    if (!m) return null
    const n = Number(m[1])
    return Number.isSafeInteger(n) ? n : null
}

/** Read `PauseState()`, field by field. Throws when any field cannot be read. */
export async function readEscrowPauseState(escrowPath: string): Promise<EscrowPauseState> {
    const [paused, exitsOpen, exitsReopenAt, pausedBlocks] = await Promise.all([
        queryEval(GNO_RPC_URL, escrowPath, "PauseState().Paused", true).then(parseQevalBool),
        queryEval(GNO_RPC_URL, escrowPath, "PauseState().ExitsOpen", true).then(parseQevalBool),
        queryEval(GNO_RPC_URL, escrowPath, "PauseState().ExitsReopenAt", true).then(parseQevalInt),
        queryEval(GNO_RPC_URL, escrowPath, "PauseState().PausedBlocks", true).then(parseQevalInt),
    ])
    if (paused === null || exitsOpen === null || exitsReopenAt === null || pausedBlocks === null) {
        throw new Error("Could not read the escrow pause state")
    }
    return { paused, exitsOpen, exitsReopenAt, pausedBlocks }
}

/** Read `GetClientActiveCount(client)`: the open contracts this address created. */
export async function readClientActiveCount(escrowPath: string, client: string): Promise<number> {
    // The address goes into an expression the node evaluates: only a checksummed bech32 address is interpolated.
    if (!isValidGnoAddressChecksum(client)) throw new Error("Invalid client address")
    const n = parseQevalInt(await queryEval(GNO_RPC_URL, escrowPath, `GetClientActiveCount("${client}")`, true))
    if (n === null || n < 0) throw new Error("Could not read your open escrow contracts")
    return n
}

const MILESTONE_LINE = /^- \*\*([^*]*)\*\* — (\d{1,16}) ugnot \[([a-z]+)\](?: \((?:funded|completed|disputed) block \d+\))*$/

/**
 * Parse `Render("contract/<id>")`. Returns null for an unknown or archived id
 * (the realm answers "# 404"), and throws on output it does not recognise.
 */
export function parseContractRender(id: string, md: string): EscrowContractView | null {
    const lines = md.replace(/\r\n/g, "\n").split("\n")
    if (lines[0] === "# 404" && (lines[1] ?? "").startsWith("Contract not found")) return null
    const unexpected = (): never => { throw new Error(`Unexpected escrow contract page for id ${id}`) }
    if (!lines[0]?.startsWith("# ")) unexpected()
    const title = lines[0].slice(2)
    const field = (label: string) => {
        const line = lines.find((l) => l.startsWith(`**${label}:** `))
        return line === undefined ? unexpected() : line.slice(label.length + 6)
    }
    const idIndex = lines.findIndex((l) => l.startsWith("**ID:** "))
    if (idIndex < 1 || field("ID") !== id) unexpected()
    const description = lines.slice(1, idIndex).filter((l) => l !== "").join("\n")
    const client = field("Client")
    const freelancer = field("Freelancer")
    const status = field("Status")
    const created = field("Created").match(/^block (\d{1,16})$/)
    if (!isValidGnoAddressChecksum(client) || !isValidGnoAddressChecksum(freelancer) || !CONTRACT_STATUSES.has(status) || !created) unexpected()
    const start = lines.indexOf("## Milestones")
    if (start < 0) unexpected()
    const milestones = lines.slice(start + 1).filter((l) => l !== "").map((l) => {
        const m = l.match(MILESTONE_LINE)
        if (!m || !MILESTONE_STATUSES.has(m[3])) return unexpected()
        return { title: m[1], amountUgnot: Number(m[2]), status: m[3] as EscrowMilestoneStatus }
    })
    if (milestones.length === 0 || milestones.length > ESCROW_LIMITS.maxMilestones) unexpected()
    return {
        id,
        title,
        description,
        client,
        freelancer,
        status: status as EscrowContractStatus,
        createdAt: Number(created![1]),
        milestones,
    }
}

/** Read one contract, or null when the id is unknown or the contract was archived. */
export async function readEscrowContract(escrowPath: string, id: string): Promise<EscrowContractView | null> {
    if (!/^(0|[1-9]\d{0,8})$/.test(id)) throw new Error(`Invalid contract id "${id}"`)
    const md = await queryRender(GNO_RPC_URL, escrowPath, `contract/${id}`, true)
    if (md === null) throw new Error("Could not read the escrow contract")
    return parseContractRender(id, md)
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
 * no longer active. The realm skips blocks inside a pause's blocking window,
 * counted from the contract's creation; that mark is not readable, so after a
 * pause the earliest block is known only within `pausedBlocks`.
 */
export function expireAvailability(c: EscrowContractView, pause: EscrowPauseState, height: number): EscrowAvailability | null {
    if (c.status !== "active" || c.milestones.some((m) => m.status !== "pending")) return null
    if (height <= 0) return { available: false, reason: "Could not read the current block height." }
    const earliest = c.createdAt + ESCROW_LIMITS.unfundedExpiryBlocks
    if (height < earliest) {
        return { available: false, reason: `Never funded. Anyone can expire it from block ${earliest.toLocaleString("en-US")} (${formatBlocksEta(earliest - height)}).` }
    }
    const shut = exitsClosedReason(pause, height)
    if (shut) return { available: false, reason: shut }
    if (pause.pausedBlocks > 0 && height < earliest + pause.pausedBlocks) {
        return {
            available: true,
            note: `A pause may have moved this deadline by up to ${pause.pausedBlocks.toLocaleString("en-US")} blocks. If it is still too early, the escrow contract refuses the call and only the fee is spent.`,
        }
    }
    return { available: true }
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
