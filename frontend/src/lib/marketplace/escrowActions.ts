/**
 * escrowActions.ts — which escrow_v4 calls the connected address can make on a
 * contract now, mirroring the realm's own guards (escrow.gno at samcrew-deployer
 * 89f559da). The realm enforces every rule; this list only keeps Memba from
 * offering a call it would refuse, since a refused call still costs its fee.
 *
 * Who and when (role and state decide whether an action is listed at all):
 *
 *   | call                 | caller                 | contract       | milestone          |
 *   |----------------------|------------------------|----------------|--------------------|
 *   | FundMilestone        | client                 | active         | pending            |
 *   | CompleteMilestone    | freelancer             | active         | funded             |
 *   | ReleaseFunds         | client                 | active         | completed          |
 *   | RaiseDispute         | client or freelancer   | active/disputed| funded or completed|
 *   | CancelContract       | client                 | active         | —                  |
 *   | ArchiveContract      | client                 | completed/cancelled (nothing escrowed) |
 *   | ClaimRefund          | anyone                 | —              | funded, past refundAt  |
 *   | ClaimDisputeTimeout  | anyone                 | —              | disputed, past resolveAt |
 *   | ExpireUnfunded       | anyone                 | active, every milestone pending, past expireAt |
 *
 * (ReleaseFunds also accepts the realm admin as arbiter; Memba does not offer
 * that path.) A listed action can still be unavailable, with the reason shown:
 *
 *   - Pause: FundMilestone is refused while paused (assertAcceptsNewMoney);
 *     every other call only while paused and exits are not open yet
 *     (assertOpen: the first MaxPauseBlks blocks of the pause).
 *   - Deadlines: refundAt, resolveAt and expireAt are the realm's own
 *     pause-adjusted heights (GetContractJSON). The realm accepts the call once
 *     the block it lands in is at or past the deadline, and a transaction lands
 *     at the next block or later, so `height >= deadline` never offers a call
 *     too early.
 *   - The permissionless calls need a wallet to sign.
 */
import type { EscrowTxPlan } from "./escrowTx"
import {
    planArchiveContract,
    planCancelContract,
    planClaimDisputeTimeout,
    planClaimRefund,
    planCompleteMilestone,
    planExpireUnfunded,
    planFundMilestone,
    planRaiseDispute,
    planReleaseFunds,
} from "./escrowTx"
import { exitsClosedReason, formatBlocksEta, type EscrowAvailability, type EscrowContractView, type EscrowPauseState } from "./escrowState"
import { formatUgnotExact } from "../dao/v2Budget"

export type EscrowActionKind =
    | "fund"
    | "complete"
    | "release"
    | "dispute"
    | "cancel"
    | "archive"
    | "claimRefund"
    | "claimDisputeTimeout"
    | "expire"

export type EscrowRole = "client" | "freelancer" | "other"

export interface EscrowAction {
    kind: EscrowActionKind
    /** Milestone index for per-milestone calls, null for contract-level calls. */
    milestone: number | null
    availability: EscrowAvailability
    /** Ugnot the call sends: exactly the stored milestone amount for FundMilestone, else 0. */
    sendUgnot: number
}

/** A contract's page, without the network prefix (for useNetworkPath / useNetworkNav): shareable with the freelancer. */
export const escrowContractPath = (id: string) => `marketplace/services/contract/${id}`

/** The connected address's part in the contract. An empty caller is "other". */
export function escrowRole(c: EscrowContractView, caller: string): EscrowRole {
    if (caller && caller === c.client) return "client"
    if (caller && caller === c.freelancer) return "freelancer"
    return "other"
}

const OK: EscrowAvailability = { available: true }

const NEW_MONEY_PAUSED: EscrowAvailability = {
    available: false,
    reason: "Escrow is paused: funding is refused until it is unpaused.",
}

/** assertAcceptsNewMoney: refused whenever the pause flag is set. */
const newMoney = (pause: EscrowPauseState): EscrowAvailability => (pause.paused ? NEW_MONEY_PAUSED : OK)

/** assertOpen: refused only inside a pause's blocking window. */
function exits(pause: EscrowPauseState, height: number): EscrowAvailability {
    const shut = exitsClosedReason(pause, height)
    return shut ? { available: false, reason: shut } : OK
}

const block = (h: number) => `block ${h.toLocaleString("en-US")}`

/** A permissionless timeout: open from `at` (a pause-adjusted height), then subject to the pause and a wallet. */
function afterDeadline(at: number, what: string, caller: string, pause: EscrowPauseState, height: number): EscrowAvailability {
    if (height <= 0) return { available: false, reason: "Could not read the current block height." }
    if (height < at) return { available: false, reason: `${what} from ${block(at)} (${formatBlocksEta(at - height)}).` }
    const shut = exits(pause, height)
    if (!shut.available) return shut
    return caller ? OK : { available: false, reason: "Connect a wallet to sign this." }
}

const holdsFunds = (c: EscrowContractView) => c.milestones.some((m) => m.status === "funded" || m.status === "completed" || m.status === "disputed")

/**
 * Every call the connected address could make on this contract in its current
 * state: contract-level calls first, then each milestone's in order.
 */
export function escrowActions(c: EscrowContractView, caller: string, pause: EscrowPauseState, height: number): EscrowAction[] {
    const role = escrowRole(c, caller)
    const out: EscrowAction[] = []
    const add = (kind: EscrowActionKind, milestone: number | null, availability: EscrowAvailability, sendUgnot = 0) =>
        out.push({ kind, milestone, availability, sendUgnot })

    if (role === "client" && c.status === "active") add("cancel", null, exits(pause, height))
    if (role === "client" && (c.status === "completed" || c.status === "cancelled")) {
        add("archive", null, holdsFunds(c)
            ? { available: false, reason: "Escrowed funds remain in a milestone, so the contract cannot be archived." }
            : exits(pause, height))
    }
    if (c.status === "active" && c.expireAt !== null && c.milestones.every((m) => m.status === "pending")) {
        add("expire", null, afterDeadline(c.expireAt, "Never funded. Anyone can expire it", caller, pause, height))
    }

    for (const m of c.milestones) {
        const i = m.index
        if (role === "client" && c.status === "active" && m.status === "pending") add("fund", i, newMoney(pause), m.amountUgnot)
        if (role === "freelancer" && c.status === "active" && m.status === "funded") add("complete", i, exits(pause, height))
        if (role === "client" && c.status === "active" && m.status === "completed") add("release", i, exits(pause, height))
        if (role !== "other" && (c.status === "active" || c.status === "disputed") && (m.status === "funded" || m.status === "completed")) {
            add("dispute", i, exits(pause, height))
        }
        if (m.status === "funded" && m.refundAt !== null) {
            add("claimRefund", i, afterDeadline(m.refundAt, "Nobody marked it delivered. Anyone can refund it to the client", caller, pause, height))
        }
        if (m.status === "disputed" && m.resolveAt !== null) {
            add("claimDisputeTimeout", i, afterDeadline(m.resolveAt, "The dispute is open. If no arbiter settles it, anyone can settle it", caller, pause, height))
        }
    }
    return out
}

/** The one plan for an action: `amountUgnot` for FundMilestone is the amount read from the chain, never user input. */
export function planEscrowAction(a: EscrowAction, c: EscrowContractView, caller: string, escrowPath: string): EscrowTxPlan {
    const i = a.milestone ?? -1
    switch (a.kind) {
        case "fund": {
            const m = c.milestones[i]
            if (!m || m.amountUgnot !== a.sendUgnot) throw new Error("The milestone amount changed. Reload the contract.")
            return planFundMilestone(caller, escrowPath, c.id, i, m.amountUgnot)
        }
        case "complete": return planCompleteMilestone(caller, escrowPath, c.id, i)
        case "release": return planReleaseFunds(caller, escrowPath, c.id, i)
        case "dispute": return planRaiseDispute(caller, escrowPath, c.id, i)
        case "cancel": return planCancelContract(caller, escrowPath, c.id)
        case "archive": return planArchiveContract(caller, escrowPath, c.id)
        case "claimRefund": return planClaimRefund(caller, escrowPath, c.id, i)
        case "claimDisputeTimeout": return planClaimDisputeTimeout(caller, escrowPath, c.id, i)
        case "expire": return planExpireUnfunded(caller, escrowPath, c.id)
    }
}

/** Button label. */
export function escrowActionLabel(a: EscrowAction): string {
    switch (a.kind) {
        case "fund": return `Fund milestone (${formatUgnotExact(a.sendUgnot)})`
        case "complete": return "Mark delivered"
        case "release": return "Release payment"
        case "dispute": return "Raise dispute"
        case "cancel": return "Cancel contract"
        case "archive": return "Archive and reclaim deposit"
        case "claimRefund": return "Refund to client"
        case "claimDisputeTimeout": return "Settle expired dispute"
        case "expire": return "Expire unfunded contract"
    }
}

/** What the call does, shown next to its button before signing. */
export function escrowActionEffect(a: EscrowAction): string {
    switch (a.kind) {
        case "fund": return `Sends exactly ${formatUgnotExact(a.sendUgnot)} into escrow. The freelancer is paid only when you release it.`
        case "complete": return "Tells the client the work for this milestone is delivered. The client then releases the payment or raises a dispute."
        case "release": return "Pays this milestone to the freelancer, minus the service fee. This cannot be undone."
        case "dispute": return "Freezes the contract and asks the arbiter to settle this milestone. If nobody settles it in time, anyone can settle it: delivered work is paid, undelivered work refunded."
        case "cancel": return "Ends the contract. Each funded milestone is refunded to you minus 5% paid to the freelancer; each milestone marked delivered is paid to the freelancer minus the service fee."
        case "archive": return "Deletes the contract from the escrow realm. The chain refunds the freed storage deposit to the signer, which is you, the client. The amount is an estimate. The contract's history stays in its transaction events."
        case "claimRefund": return "Returns this milestone's funds to the client. Anyone can do this once the refund deadline has passed."
        case "claimDisputeTimeout": return "Settles the dispute as the realm rules: paid to the freelancer if the work was marked delivered, refunded to the client otherwise."
        case "expire": return "Cancels a contract that was never funded. No funds move; its client keeps the storage deposit to reclaim by archiving."
    }
}

/** Wallet memo. */
export function escrowActionMemo(a: EscrowAction, id: string): string {
    const m = a.milestone === null ? "" : ` milestone ${a.milestone}`
    switch (a.kind) {
        case "fund": return `Fund escrow ${id}${m}`
        case "complete": return `Complete escrow ${id}${m}`
        case "release": return `Release escrow ${id}${m}`
        case "dispute": return `Dispute escrow ${id}${m}`
        case "cancel": return `Cancel escrow ${id}`
        case "archive": return `Archive escrow ${id}`
        case "claimRefund": return `Refund escrow ${id}${m}`
        case "claimDisputeTimeout": return `Settle dispute escrow ${id}${m}`
        case "expire": return `Expire escrow ${id}`
    }
}

/** What the page says once the call landed. */
export function escrowActionDone(a: EscrowAction, id: string): string {
    const m = a.milestone === null ? "" : `Milestone ${a.milestone + 1} of contract ${id}`
    switch (a.kind) {
        case "fund": return `${m} is funded.`
        case "complete": return `${m} is marked delivered.`
        case "release": return `${m} is released to the freelancer.`
        case "dispute": return `${m} is in dispute.`
        case "cancel": return `Contract ${id} is cancelled.`
        case "archive": return `Contract ${id} archived. The chain refunds its storage deposit to you.`
        case "claimRefund": return `${m} is refunded to the client.`
        case "claimDisputeTimeout": return `The dispute on ${m.toLowerCase()} is settled.`
        case "expire": return `Contract ${id} expired. Its client can now archive it to reclaim the deposit.`
    }
}
