/**
 * payroll/builders.ts — MsgSend batch builder for payroll distributions.
 *
 * Sprint 7: Generates a DAO governance proposal containing batch MsgSend
 * messages for distributing payments to multiple recipients.
 */

import type { PayrollRecipient, PayrollProposal } from "./types"
import { calculatePayrollTotal, MAX_PAYROLL_RECIPIENTS } from "./types"

/** Amino MsgSend shape. */
interface MsgSend {
    type: "/bank.MsgSend"
    value: {
        from_address: string
        to_address: string
        amount: string
    }
}

/**
 * Build batch MsgSend messages for a payroll distribution.
 * Each recipient gets one MsgSend with their amount in the specified denom.
 *
 * @throws if recipients exceed MAX_PAYROLL_RECIPIENTS
 */
export function buildBatchPayrollMsgs(
    fromAddress: string,
    recipients: PayrollRecipient[],
    denom: string = "ugnot",
): MsgSend[] {
    if (recipients.length > MAX_PAYROLL_RECIPIENTS) {
        throw new Error(`Too many recipients (${recipients.length}). Maximum is ${MAX_PAYROLL_RECIPIENTS}.`)
    }
    if (recipients.length === 0) {
        throw new Error("No recipients provided.")
    }

    return recipients.map(r => ({
        type: "/bank.MsgSend" as const,
        value: {
            from_address: fromAddress,
            to_address: r.address,
            amount: `${r.amount}${denom}`,
        },
    }))
}

/**
 * Generate a payroll proposal title for a given month/period.
 */
export function generatePayrollTitle(period?: string): string {
    if (period) return `${period} Payroll Distribution`
    const now = new Date()
    const month = now.toLocaleString("en-US", { month: "long", year: "numeric" })
    return `${month} Payroll Distribution`
}

/**
 * Build a complete PayrollProposal from recipients and proposer.
 */
export function buildPayrollProposal(
    recipients: PayrollRecipient[],
    proposedBy: string,
    period?: string,
): PayrollProposal {
    return {
        title: generatePayrollTitle(period),
        recipients,
        totalAmount: calculatePayrollTotal(recipients),
        proposedBy,
    }
}
