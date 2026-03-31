/**
 * marketplace/builders.ts — MsgCall builders for marketplace transactions.
 *
 * Sprint 6: Generates Amino-compatible messages for marketplace operations.
 */

import type { PaymentConfig } from "./types"
import { calculatePlatformFee } from "./types"

/** Amino MsgCall shape for Adena broadcasting. */
interface MsgCall {
    type: "/vm.m_call"
    value: {
        caller: string
        send: string
        pkg_path: string
        func: string
        args: string[]
    }
}

/**
 * Build a MsgCall to list a new service on the marketplace.
 */
export function buildListServiceMsg(
    caller: string,
    marketplacePath: string,
    title: string,
    description: string,
    pricing: PaymentConfig,
): MsgCall {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: marketplacePath,
            func: "ListService",
            args: [title, description, pricing.denom, String(pricing.amount)],
        },
    }
}

/**
 * Build a MsgCall to purchase/hire a marketplace listing.
 * Sends the listing price + platform fee as attached funds.
 */
export function buildPurchaseMsg(
    caller: string,
    marketplacePath: string,
    listingId: string,
    pricing: PaymentConfig,
): MsgCall {
    const fee = calculatePlatformFee(pricing.amount, pricing.feePercent)
    const totalSend = pricing.amount + fee

    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: `${totalSend}${pricing.denom}`,
            pkg_path: marketplacePath,
            func: "Purchase",
            args: [listingId],
        },
    }
}

/**
 * Build a MsgCall to complete an escrow milestone.
 */
export function buildCompleteEscrowMsg(
    caller: string,
    escrowPath: string,
    contractId: string,
    milestoneId: string,
): MsgCall {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: escrowPath,
            func: "CompleteMilestone",
            args: [contractId, milestoneId],
        },
    }
}

/**
 * Build a MsgCall to dispute an escrow contract.
 */
export function buildDisputeEscrowMsg(
    caller: string,
    escrowPath: string,
    contractId: string,
    reason: string,
): MsgCall {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: escrowPath,
            func: "DisputeContract",
            args: [contractId, reason],
        },
    }
}
