/**
 * marketplace/builders.ts — MsgCall builders for escrow transactions.
 *
 * Matches the frozen escrow_v4 API (`gno.land/r/samcrew/escrow_v4`): the v3 user
 * API plus ArchiveContract and ExpireUnfunded. Callers pass the active realm path
 * from config, so these builders are path-agnostic; the API itself is pinned in
 * builders.test.ts. Each builder checks its inputs the way the realm does, so a
 * call the realm would reject never reaches the wallet, and attaches the
 * storage-deposit cap sized in escrowBudget.ts. Only FundMilestone sends coins:
 * exactly the milestone amount, in ugnot (the realm takes its fee at release,
 * not on top).
 */
import { isValidGnoAddressChecksum } from "../dao/address"
import { createContractBudget, escrowCallBudget, type EscrowFunc } from "./escrowBudget"

export type { EscrowFunc } from "./escrowBudget"

/** Realm limits (escrow_v4 escrow.gno constants). Lengths are UTF-8 bytes, as Gno's len(). */
export const ESCROW_LIMITS = {
    maxTitleBytes: 200,
    maxDescriptionBytes: 5000,
    maxMilestones: 20,
    maxMilestoneTitleBytes: 200,
    /** maxMilestonesArgLen = MaxMilestones × (MaxTitleLen + 64), checked before parsing. */
    maxMilestonesArgBytes: 5280,
    minMilestoneUgnot: 1000,
    /** MaxActivePerClient: open (not completed or cancelled) contracts one client may hold. */
    maxActivePerClient: 5,
    /** UnfundedExpiryBlks (= AutoRefundBlks): blocks after creation before anyone may expire a never-funded contract. */
    unfundedExpiryBlocks: 864_000,
    /** MaxPauseBlks: the blocking window of a pause, after which exits reopen. */
    maxPauseBlocks: 183_273,
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
    if (amount < ESCROW_LIMITS.minMilestoneUgnot) {
        fail(`Each milestone must be at least ${ESCROW_LIMITS.minMilestoneUgnot} ugnot`)
    }
    return amount
}

/**
 * Characters escrow_v4's cleanText removes from the title, the description and
 * every milestone title before storing them (isStripped in escrow.gno). Refuse
 * them, so the stored text is exactly the text signed (and a title made only of
 * them is never stored empty).
 */
const STRIPPED = /[[\]()#*`!<>|\\_~\n\r\t]/
const STRIPPED_LIST = "[ ] ( ) # * ` ! < > | \\ _ ~"

/**
 * Code points escrow_v4's cleanText refuses outright: the control characters
 * (C0 except tab, line feed and carriage return, which it strips; DEL; C1) and
 * every format character (\p{Cf}) in the Unicode 15.0.0 table of the Gno
 * standard library at the gnoland-1 pin. Kept as an explicit list rather than
 * a \p{Cf} class, whose contents follow the browser's Unicode version.
 * Inclusive ranges.
 */
export const ESCROW_REFUSED_CODE_POINTS: ReadonlyArray<readonly [number, number]> = [
    // Cc
    [0x0000, 0x0008], [0x000b, 0x000c], [0x000e, 0x001f], [0x007f, 0x009f],
    // Cf (Unicode 15.0.0)
    [0x00ad, 0x00ad], [0x0600, 0x0605], [0x061c, 0x061c], [0x06dd, 0x06dd], [0x070f, 0x070f],
    [0x0890, 0x0891], [0x08e2, 0x08e2], [0x180e, 0x180e], [0x200b, 0x200f], [0x202a, 0x202e],
    [0x2060, 0x2064], [0x2066, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb], [0x110bd, 0x110bd],
    [0x110cd, 0x110cd], [0x13430, 0x1343f], [0x1bca0, 0x1bca3], [0x1d173, 0x1d17a], [0xe0001, 0xe0001],
    [0xe0020, 0xe007f],
]

export function isRefusedCodePoint(cp: number): boolean {
    return ESCROW_REFUSED_CODE_POINTS.some(([lo, hi]) => cp >= lo && cp <= hi)
}

/** A UTF-16 surrogate without its pair: it has no UTF-8 encoding, and the chain would store U+FFFD instead. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`

function charName(c: string): string {
    if (c === "\n" || c === "\r") return "a line break"
    if (c === "\t") return "a tab"
    return `"${c}"`
}

/**
 * Refuse text escrow_v4 would reject (not valid UTF-8, control or format
 * characters) or store differently (characters it strips).
 */
function storedAsSigned(value: string, what: string): string {
    if (LONE_SURROGATE.test(value)) fail(`The ${what} is not valid text (an unpaired surrogate): the escrow contract accepts only valid UTF-8`)
    for (const c of value) {
        const cp = c.codePointAt(0) as number
        if (STRIPPED.test(c)) {
            fail(`Remove ${charName(c)} from the ${what}: the escrow contract strips ${STRIPPED_LIST}, tabs and line breaks, so it would store different text`)
        }
        if (isRefusedCodePoint(cp)) {
            fail(`Remove the invisible or control character ${hex(cp)} from the ${what}: the escrow contract refuses it`)
        }
    }
    return value
}

/**
 * Go's strings.TrimSpace set (unicode.IsSpace). JS \s differs: it lacks U+0085
 * and adds U+FEFF, which the realm refuses anyway.
 */
const GO_SPACE = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000"
const EDGE_SPACE = new RegExp(`^[${GO_SPACE}]|[${GO_SPACE}]$`)
const ALL_SPACE = new RegExp(`^[${GO_SPACE}]*$`)

function milestoneTitle(title: string): string {
    if (typeof title !== "string" || title === "") fail("Every milestone needs a title")
    if (title.includes(",") || title.includes(":")) fail(`Milestone title "${title}" cannot contain "," or ":"`)
    storedAsSigned(title, "milestone title")
    // The realm trims each title; refuse rather than sign text that is stored differently.
    if (EDGE_SPACE.test(title)) fail(`Milestone title "${title}" cannot start or end with a space`)
    if (bytes(title) > ESCROW_LIMITS.maxMilestoneTitleBytes) {
        fail(`Milestone titles are limited to ${ESCROW_LIMITS.maxMilestoneTitleBytes} bytes`)
    }
    return title
}

/** Encode milestones as the realm's `title:amount,title:amount` argument. */
export function encodeMilestones(milestones: readonly EscrowMilestone[]): string {
    if (!Array.isArray(milestones) || milestones.length === 0) fail("At least one milestone is required")
    if (milestones.length > ESCROW_LIMITS.maxMilestones) fail(`At most ${ESCROW_LIMITS.maxMilestones} milestones are allowed`)
    const arg = milestones.map((m) => `${milestoneTitle(m.title)}:${milestoneAmount(m.amountUgnot)}`).join(",")
    // Unreachable with 20 titles of 200 bytes and 15-digit amounts (4,339 bytes); kept for parity with the realm.
    if (bytes(arg) > ESCROW_LIMITS.maxMilestonesArgBytes) fail(`The milestones are limited to ${ESCROW_LIMITS.maxMilestonesArgBytes} bytes in total`)
    return arg
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
    if (!Number.isSafeInteger(value) || value < 0 || value >= ESCROW_LIMITS.maxMilestones) fail(`Invalid milestone index ${String(value)}`)
    return String(value)
}

function textArg(value: string, what: string, min: number, maxBytes: number): string {
    if (typeof value !== "string") fail(`Invalid ${what}`)
    const n = bytes(value)
    if (n < min || n > maxBytes) fail(`The ${what} must be ${min}-${maxBytes} bytes`)
    return storedAsSigned(value, what)
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
    textArg(title, "title", 1, ESCROW_LIMITS.maxTitleBytes)
    // The realm refuses a title that is only spaces (strings.TrimSpace of the stored title is empty).
    if (ALL_SPACE.test(title)) fail("The title must contain visible characters")
    textArg(description, "description", 0, ESCROW_LIMITS.maxDescriptionBytes)
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

/** Build a MsgCall to cancel a never-funded contract once UnfundedExpiryBlks have passed since creation. Anyone. */
export function buildExpireUnfundedMsg(caller: string, escrowPath: string, contractId: string): EscrowMsgCall {
    return stateCall(caller, escrowPath, "ExpireUnfunded", [contractIdArg(contractId)])
}

/**
 * Build a MsgCall to delete a settled (completed or cancelled) contract. Client
 * only. The chain refunds the freed storage deposit to the signer, which is the
 * client who paid it at creation.
 */
export function buildArchiveContractMsg(caller: string, escrowPath: string, contractId: string): EscrowMsgCall {
    return stateCall(caller, escrowPath, "ArchiveContract", [contractIdArg(contractId)])
}
