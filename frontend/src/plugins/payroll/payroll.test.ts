import { describe, it, expect } from "vitest"
import {
    isValidRecipient,
    calculatePayrollTotal,
    parsePayrollCSV,
    MAX_PAYROLL_RECIPIENTS,
    type PayrollRecipient,
} from "./types"
import {
    buildBatchPayrollMsgs,
    generatePayrollTitle,
    buildPayrollProposal,
} from "./builders"

// ── Types & Validation ──────────────────────────────────────

describe("isValidRecipient", () => {
    it("accepts valid recipient", () => {
        expect(isValidRecipient({
            address: "g1testaddr123",
            amount: 1_000_000n,
            role: "engineer",
            startBlock: 0,
        })).toBe(true)
    })

    it("rejects non-g1 address", () => {
        expect(isValidRecipient({
            address: "cosmos1abc",
            amount: 100n,
            role: "dev",
            startBlock: 0,
        })).toBe(false)
    })

    it("rejects zero amount", () => {
        expect(isValidRecipient({
            address: "g1test",
            amount: 0n,
            role: "dev",
            startBlock: 0,
        })).toBe(false)
    })

    it("rejects null", () => {
        expect(isValidRecipient(null)).toBe(false)
    })

    it("rejects missing fields", () => {
        expect(isValidRecipient({ address: "g1test" })).toBe(false)
    })
})

describe("calculatePayrollTotal", () => {
    it("sums all recipient amounts", () => {
        const recipients: PayrollRecipient[] = [
            { address: "g1a", amount: 1_000_000n, role: "dev", startBlock: 0 },
            { address: "g1b", amount: 2_000_000n, role: "ops", startBlock: 0 },
            { address: "g1c", amount: 500_000n, role: "design", startBlock: 0 },
        ]
        expect(calculatePayrollTotal(recipients)).toBe(3_500_000n)
    })

    it("returns 0 for empty list", () => {
        expect(calculatePayrollTotal([])).toBe(0n)
    })

    it("handles single recipient", () => {
        expect(calculatePayrollTotal([
            { address: "g1a", amount: 42n, role: "x", startBlock: 0 },
        ])).toBe(42n)
    })
})

// ── CSV Parsing ─────────────────────────────────────────────

describe("parsePayrollCSV", () => {
    it("parses address,amount,role format", () => {
        const csv = `g1alice,1000000,engineer
g1bob,2000000,designer`
        const recipients = parsePayrollCSV(csv)
        expect(recipients).toHaveLength(2)
        expect(recipients[0].address).toBe("g1alice")
        expect(recipients[0].amount).toBe(1000000n)
        expect(recipients[0].role).toBe("engineer")
        expect(recipients[1].address).toBe("g1bob")
        expect(recipients[1].amount).toBe(2000000n)
    })

    it("defaults role to 'member' when not provided", () => {
        const csv = "g1alice,1000000"
        const recipients = parsePayrollCSV(csv)
        expect(recipients[0].role).toBe("member")
    })

    it("skips comment lines", () => {
        const csv = `# This is a comment
g1alice,1000000,dev
# Another comment
g1bob,2000000`
        const recipients = parsePayrollCSV(csv)
        expect(recipients).toHaveLength(2)
    })

    it("skips header row", () => {
        const csv = `address,amount,role
g1alice,1000000,dev`
        const recipients = parsePayrollCSV(csv)
        expect(recipients).toHaveLength(1)
    })

    it("skips empty lines", () => {
        const csv = `g1alice,1000000,dev

g1bob,2000000,ops
`
        const recipients = parsePayrollCSV(csv)
        expect(recipients).toHaveLength(2)
    })

    it("skips invalid addresses", () => {
        const csv = `cosmos1invalid,1000000
g1valid,2000000`
        const recipients = parsePayrollCSV(csv)
        expect(recipients).toHaveLength(1)
        expect(recipients[0].address).toBe("g1valid")
    })

    it("skips zero/negative amounts", () => {
        const csv = `g1alice,0
g1bob,-100
g1carol,500000`
        const recipients = parsePayrollCSV(csv)
        expect(recipients).toHaveLength(1)
        expect(recipients[0].address).toBe("g1carol")
    })

    it("skips non-numeric amounts", () => {
        const csv = `g1alice,notanumber
g1bob,1000000`
        const recipients = parsePayrollCSV(csv)
        expect(recipients).toHaveLength(1)
    })

    it("returns empty for empty input", () => {
        expect(parsePayrollCSV("")).toHaveLength(0)
    })

    it("trims whitespace", () => {
        const csv = "  g1alice , 1000000 , dev  "
        const recipients = parsePayrollCSV(csv)
        expect(recipients[0].address).toBe("g1alice")
        expect(recipients[0].amount).toBe(1000000n)
        expect(recipients[0].role).toBe("dev")
    })
})

// ── Builders ────────────────────────────────────────────────

describe("buildBatchPayrollMsgs", () => {
    const recipients: PayrollRecipient[] = [
        { address: "g1alice", amount: 1_000_000n, role: "dev", startBlock: 0 },
        { address: "g1bob", amount: 2_000_000n, role: "ops", startBlock: 0 },
    ]

    it("generates one MsgSend per recipient", () => {
        const msgs = buildBatchPayrollMsgs("g1treasury", recipients)
        expect(msgs).toHaveLength(2)
        expect(msgs[0].type).toBe("/bank.MsgSend")
        expect(msgs[0].value.from_address).toBe("g1treasury")
        expect(msgs[0].value.to_address).toBe("g1alice")
        expect(msgs[0].value.amount).toBe("1000000ugnot")
    })

    it("uses custom denom", () => {
        const msgs = buildBatchPayrollMsgs("g1treasury", recipients, "gno.land/r/demo/grc20/memba")
        expect(msgs[0].value.amount).toBe("1000000gno.land/r/demo/grc20/memba")
    })

    it("throws for too many recipients", () => {
        const big = Array.from({ length: MAX_PAYROLL_RECIPIENTS + 1 }, (_, i) => ({
            address: `g1addr${i}`,
            amount: 100n,
            role: "x",
            startBlock: 0,
        }))
        expect(() => buildBatchPayrollMsgs("g1t", big)).toThrow(/Too many recipients/)
    })

    it("throws for empty recipients", () => {
        expect(() => buildBatchPayrollMsgs("g1t", [])).toThrow(/No recipients/)
    })
})

describe("generatePayrollTitle", () => {
    it("uses provided period", () => {
        expect(generatePayrollTitle("Q1 2026")).toBe("Q1 2026 Payroll Distribution")
    })

    it("generates month-based title when no period", () => {
        const title = generatePayrollTitle()
        expect(title).toContain("Payroll Distribution")
        expect(title.length).toBeGreaterThan(20) // "March 2026 Payroll Distribution"
    })
})

describe("buildPayrollProposal", () => {
    it("creates proposal with correct total", () => {
        const recipients: PayrollRecipient[] = [
            { address: "g1a", amount: 1_000_000n, role: "dev", startBlock: 0 },
            { address: "g1b", amount: 2_000_000n, role: "ops", startBlock: 0 },
        ]
        const proposal = buildPayrollProposal(recipients, "g1proposer", "March 2026")
        expect(proposal.title).toBe("March 2026 Payroll Distribution")
        expect(proposal.totalAmount).toBe(3_000_000n)
        expect(proposal.proposedBy).toBe("g1proposer")
        expect(proposal.recipients).toHaveLength(2)
        expect(proposal.executedTxHash).toBeUndefined()
    })
})
