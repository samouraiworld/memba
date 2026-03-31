/**
 * payroll/types.ts — Data model for the Payroll plugin.
 *
 * Sprint 7: Batch payment distribution for operational DAOs.
 */

// ── Config ──────────────────────────────────────────────────

export interface PayrollConfig {
    /** Payment recipients. */
    recipients: PayrollRecipient[]
    /** Payment schedule. */
    schedule: "monthly" | "biweekly" | "custom"
    /** Token denomination (default: "ugnot"). */
    denom: string
    /** DAO realm path that governs this payroll. */
    daoRealmPath: string
    /** Role required to create payroll proposals. */
    adminRole: string
}

// ── Recipient ───────────────────────────────────────────────

export interface PayrollRecipient {
    /** Gno address (g1...). */
    address: string
    /** Optional display name. */
    username?: string
    /** Payment amount in smallest unit. */
    amount: bigint
    /** Role/position label. */
    role: string
    /** Block height when payments started. */
    startBlock: number
    /** Optional vesting period in blocks. */
    vestingBlocks?: number
}

// ── Proposal ────────────────────────────────────────────────

export interface PayrollProposal {
    /** e.g., "March 2026 Payroll Distribution" */
    title: string
    /** Recipients included in this distribution. */
    recipients: PayrollRecipient[]
    /** Total amount (sum of all recipients). */
    totalAmount: bigint
    /** Proposer address. */
    proposedBy: string
    /** TX hash after execution (undefined = not yet executed). */
    executedTxHash?: string
}

// ── Validation ──────────────────────────────────────────────

/** Maximum recipients per batch payroll (gas limit safety). */
export const MAX_PAYROLL_RECIPIENTS = 50

/** Validate a recipient has required fields. */
export function isValidRecipient(r: unknown): r is PayrollRecipient {
    if (typeof r !== "object" || r === null) return false
    const rec = r as Record<string, unknown>
    return (
        typeof rec.address === "string" && rec.address.startsWith("g1") &&
        typeof rec.amount === "bigint" && rec.amount > 0n &&
        typeof rec.role === "string"
    )
}

/** Calculate total payroll amount. */
export function calculatePayrollTotal(recipients: PayrollRecipient[]): bigint {
    return recipients.reduce((sum, r) => sum + r.amount, 0n)
}

// ── CSV Parsing ─────────────────────────────────────────────

/**
 * Parse a CSV string into PayrollRecipient[].
 * Expected format: address,amount[,role]
 * Lines starting with # are ignored (comments).
 * Empty lines are skipped.
 */
export function parsePayrollCSV(csv: string): PayrollRecipient[] {
    const recipients: PayrollRecipient[] = []
    const lines = csv.split("\n")

    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("address")) continue

        const cols = trimmed.split(",").map(c => c.trim())
        if (cols.length < 2) continue

        const address = cols[0]
        if (!address.startsWith("g1")) continue

        let amount: bigint
        try {
            amount = BigInt(cols[1])
            if (amount <= 0n) continue
        } catch {
            continue
        }

        recipients.push({
            address,
            amount,
            role: cols[2] || "member",
            startBlock: 0,
        })
    }

    return recipients
}
