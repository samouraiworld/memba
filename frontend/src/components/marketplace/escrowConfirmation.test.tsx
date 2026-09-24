/**
 * The shared confirmation dialog shows an escrow call's storage-deposit cap and,
 * for FundMilestone, the exact ugnot it sends — the same message object the
 * wallet then signs.
 */
import { describe, expect, it, vi } from "vitest"
import { act, render, screen, within } from "@testing-library/react"
import { planCreateContract, planFundMilestone } from "../../lib/marketplace/escrowTx"

const captured = vi.hoisted(() => ({ cb: null as null | ((msgs: unknown[], memo: string) => Promise<boolean>) }))
vi.mock("../../lib/grc20", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/grc20")>()),
    setTxConfirmationCallback: (cb: typeof captured.cb) => { captured.cb = cb },
}))

import { TxConfirmationProvider } from "../ui/TxConfirmation"

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v3"

const row = (label: string) => screen.getByText(label).closest(".tx-confirm-detail-row") as HTMLElement

describe("escrow calls in the confirmation dialog", () => {
    it("FundMilestone shows the exact amount sent and the deposit cap", async () => {
        render(<TxConfirmationProvider><div /></TxConfirmationProvider>)
        const plan = planFundMilestone(CLIENT, ESCROW, "7", 1, 250_000_000)
        await act(async () => { void captured.cb!([plan.msg], "Fund milestone") })
        expect(within(row("Send")).getByText("250000000ugnot")).toBeInTheDocument()
        expect(within(row("Storage deposit cap")).getByText("0.2 GNOT")).toBeInTheDocument()
        expect(screen.getByText("FundMilestone", { selector: ".tx-confirm-func" })).toBeInTheDocument()
    })

    it("CreateContract shows its deposit cap and no send", async () => {
        render(<TxConfirmationProvider><div /></TxConfirmationProvider>)
        const plan = planCreateContract(CLIENT, ESCROW, { freelancer: FREELANCER, title: "Audit", description: "", milestones: [{ title: "A", amountUgnot: 1000 }] })
        await act(async () => { void captured.cb!([plan.msg], "Create escrow") })
        expect(within(row("Storage deposit cap")).getByText(`${plan.maxDepositUgnot / 1_000_000} GNOT`)).toBeInTheDocument()
        expect(screen.queryByText("Send")).not.toBeInTheDocument()
    })
})
