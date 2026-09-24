/**
 * marketplace/builders.ts — MsgCall builders for escrow transactions.
 *
 * Matches the escrow_v3 API deployed on gno.land mainnet (callers pass the active
 * realm path from config, so these builders are path-agnostic; the API itself is
 * pinned in builders.test.ts). Each builder checks its inputs the way the realm
 * does, so a call the realm would reject never reaches the wallet, and attaches
 * the storage-deposit cap sized in escrowBudget.ts. Only FundMilestone sends
 * coins: exactly the milestone amount, in ugnot (the realm takes its fee at
 * release, not on top).
 */
import { isValidGnoAddressChecksum } from "../dao/address"
import { createContractBudget, escrowCallBudget, type EscrowFunc } from "./escrowBudget"

export type { EscrowFunc } from "./escrowBudget"

/** Realm limits (escrow.gno constants). Lengths are UTF-8 bytes, as Gno's len(). */
export const ESCROW_V3_LIMITS = {
    maxTitleBytes: 200,
    maxDescriptionBytes: 5000,
    maxMilestones: 20,
    maxMilestoneTitleBytes: 200,
    minMilestoneUgnot: 1000,
} as const

/** Amino MsgCall shape for Adena broadcasting, with its storage-deposit cap. */
export type EscrowMsgCall = {
    type: "vm/MsgCall"
    value: {
        caller: string
        send: string
        pkg_path: string
        func: EscrowFunc
        args: string[]
        max_deposit: string
    }
}

export interface EscrowMilestone {
    title: string
    amountUgnot: number
}

/** An escrow input the realm would reject or reinterpret. */
export class EscrowInputError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "EscrowInputError"
    }
}

const encoder = new TextEncoder()
const bytes = (s: string) => encoder.encode(s).length
const fail = (message: string): never => { throw new EscrowInputError(message) }

/** Largest amount accepted: 15 digits, the same bound the DAO flows use for coin amounts. */
const MAX_UGNOT = 999_999_999_999_999

/**
 * A whole ugnot amount from a number or a canonical decimal string (no sign,
 * no leading zero, no exponent, no spaces, at most 15 digits). Nothing is
 * rounded: anything else throws.
 */
export function parseUgnotAmount(value: unknown): number {
    if (typeof value === "string") {
        if (!/^(0|[1-9]\d{0,14})$/.test(value)) fail(`Invalid amount "${value}": use a whole number of ugnot`)
        return Number(value)
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_UGNOT) {
        fail(`Invalid amount ${String(value)}: use a whole number of ugnot, at most 15 digits`)
    }
    return value as number
}

function milestoneAmount(value: unknown): number {
    const amount = parseUgnotAmount(value)
    if (amount < ESCROW_V3_LIMITS.minMilestoneUgnot) {
        fail(`Each milestone must be at least ${ESCROW_V3_LIMITS.minMilestoneUgnot} ugnot`)
    }
    return amount
}

/** Characters Go's strings.TrimSpace removes that JS trim() may not. */
const EDGE_SPACE = /^[\s\u0085]|[\s\u0085]$/u

function milestoneTitle(title: string): string {
    if (typeof title !== "string" || title === "") fail("Every milestone needs a title")
    if (title.includes(",") || title.includes(":")) fail(`Milestone title "${title}" cannot contain "," or ":"`)
    // The realm trims each title; refuse rather than sign text that is stored differently.
    if (EDGE_SPACE.test(title)) fail(`Milestone title "${title}" cannot start or end with a space`)
    if (bytes(title) > ESCROW_V3_LIMITS.maxMilestoneTitleBytes) {
        fail(`Milestone titles are limited to ${ESCROW_V3_LIMITS.maxMilestoneTitleBytes} bytes`)
    }
    return title
}

/** Encode milestones as the realm's `title:amount,title:amount` argument. */
export function encodeMilestones(milestones: readonly EscrowMilestone[]): string {
    if (!Array.isArray(milestones) || milestones.length === 0) fail("At least one milestone is required")
    if (milestones.length > ESCROW_V3_LIMITS.maxMilestones) fail(`At most ${ESCROW_V3_LIMITS.maxMilestones} milestones are allowed`)
    return milestones.map((m) => `${milestoneTitle(m.title)}:${milestoneAmount(m.amountUgnot)}`).join(",")
}

/**
 * Parse a `title:amount,…` list strictly: no empty entries, no spaces around
 * the separators, canonical whole amounts. Anything the realm would split,
 * trim, skip or refuse throws.
 */
export function parseMilestonesArg(value: string): EscrowMilestone[] {
    if (typeof value !== "string" || value === "") fail("At least one milestone is required")
    const milestones = value.split(",").map((part) => {
        const sep = part.indexOf(":")
        if (sep < 0) fail(`Milestone "${part}" must be written title:amount`)
        return { title: milestoneTitle(part.slice(0, sep)), amountUgnot: milestoneAmount(part.slice(sep + 1)) }
    })
    encodeMilestones(milestones)
    return milestones
}

function address(value: string, what: string): string {
    if (!isValidGnoAddressChecksum(value)) fail(`Invalid ${what} address`)
    return value
}

function realmPath(value: string): string {
    if (typeof value !== "string" || !/^gno\.land\/r\/[a-z0-9_]+(\/[a-z0-9_]+)*$/.test(value)) fail("Invalid escrow realm path")
    return value
}

/** Contract ids are the realm's strconv.Itoa counter: "0", "1", … */
function contractIdArg(value: string): string {
    if (typeof value !== "string" || !/^(0|[1-9]\d{0,8})$/.test(value)) fail(`Invalid contract id "${String(value)}"`)
    return value
}

function milestoneIdxArg(value: number): string {
    if (!Number.isSafeInteger(value) || value < 0 || value >= ESCROW_V3_LIMITS.maxMilestones) fail(`Invalid milestone index ${String(value)}`)
    return String(value)
}

function textArg(value: string, what: string, min: number, maxBytes: number): string {
    if (typeof value !== "string") fail(`Invalid ${what}`)
    const n = bytes(value)
    if (n < min || n > maxBytes) fail(`The ${what} must be ${min}-${maxBytes} bytes`)
    return value
}

function msgCall(caller: string, escrowPath: string, func: EscrowFunc, args: string[], send: string, maxDepositUgnot: number): EscrowMsgCall {
    return {
        type: "vm/MsgCall",
        value: {
            caller: address(caller, "caller"),
            send,
            pkg_path: realmPath(escrowPath),
            func,
            args,
            max_deposit: `${maxDepositUgnot}ugnot`,
        },
    }
}

const stateCall = (caller: string, escrowPath: string, func: EscrowFunc, args: string[], send = "") =>
    msgCall(caller, escrowPath, func, args, send, escrowCallBudget(func).maxDepositUgnot)

/** Build a MsgCall to create a new escrow contract with milestones. The caller becomes the client. */
export function buildCreateContractMsg(
    caller: string,
    escrowPath: string,
    freelancer: string,
    title: string,
    description: string,
    milestones: readonly EscrowMilestone[],
): EscrowMsgCall {
    address(freelancer, "freelancer")
    if (freelancer === caller) fail("You cannot hire yourself")
    textArg(title, "title", 1, ESCROW_V3_LIMITS.maxTitleBytes)
    textArg(description, "description", 0, ESCROW_V3_LIMITS.maxDescriptionBytes)
    const milestonesArg = encodeMilestones(milestones)
    const { maxDepositUgnot } = createContractBudget({ titleBytes: bytes(title), descriptionBytes: bytes(description), milestonesArg })
    return msgCall(caller, escrowPath, "CreateContract", [freelancer, title, description, milestonesArg], "", maxDepositUgnot)
}

/** Build a MsgCall to fund a milestone. Client only; sends exactly the milestone amount. */
export function buildFundMilestoneMsg(
    caller: string,
    escrowPath: string,
    contractId: string,
    milestoneIdx: number,
    amountUgnot: number,
): EscrowMsgCall {
    const args = [contractIdArg(contractId), milestoneIdxArg(milestoneIdx)]
    return stateCall(caller, escrowPath, "FundMilestone", args, `${milestoneAmount(amountUgnot)}ugnot`)
}

/** Build a MsgCall to mark a funded milestone as completed. Freelancer only. */
export function buildCompleteMilestoneMsg(caller: string, escrowPath: string, contractId: string, milestoneIdx: number): EscrowMsgCall {
    return stateCall(caller, escrowPath, "CompleteMilestone", [contractIdArg(contractId), milestoneIdxArg(milestoneIdx)])
}

/** Build a MsgCall to release a completed milestone to the freelancer. Client or Admin. */
export function buildReleaseFundsMsg(caller: string, escrowPath: string, contractId: string, milestoneIdx: number): EscrowMsgCall {
    return stateCall(caller, escrowPath, "ReleaseFunds", [contractIdArg(contractId), milestoneIdxArg(milestoneIdx)])
}

/** Build a MsgCall to raise a dispute on a funded or completed milestone. Client or Freelancer. */
export function buildRaiseDisputeMsg(caller: string, escrowPath: string, contractId: string, milestoneIdx: number): EscrowMsgCall {
    return stateCall(caller, escrowPath, "RaiseDispute", [contractIdArg(contractId), milestoneIdxArg(milestoneIdx)])
}

/** Build a MsgCall to cancel an active contract. Client only. */
export function buildCancelContractMsg(caller: string, escrowPath: string, contractId: string): EscrowMsgCall {
    return stateCall(caller, escrowPath, "CancelContract", [contractIdArg(contractId)])
}

/** Build a MsgCall to refund a funded milestone after the timeout. Anyone. */
export function buildClaimRefundMsg(caller: string, escrowPath: string, contractId: string, milestoneIdx: number): EscrowMsgCall {
    return stateCall(caller, escrowPath, "ClaimRefund", [contractIdArg(contractId), milestoneIdxArg(milestoneIdx)])
}

/** Build a MsgCall to settle a dispute the admin left open past the timeout. Anyone. */
export function buildClaimDisputeTimeoutMsg(caller: string, escrowPath: string, contractId: string, milestoneIdx: number): EscrowMsgCall {
    return stateCall(caller, escrowPath, "ClaimDisputeTimeout", [contractIdArg(contractId), milestoneIdxArg(milestoneIdx)])
}
