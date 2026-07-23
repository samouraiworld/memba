/**
 * TokenTradeModal.test.tsx — OTC approve/allowance must target the engine's
 * resolved on-chain address, not its package path (WAVE1 TR-P0-4).
 *
 * The realm's Approve/Allowance take an `address`; MEMBA_DAO.tokenOtcPath is
 * a path string like "gno.land/r/samcrew/memba_token_otc_v2". Approving the
 * path instead of the resolved address means the realm's own allowance check
 * (against `cur.Address()`) never matches — both List and Fill revert. These
 * tests pin that the resolved address, not the path, is what gets used.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

const ENGINE_ADDRESS = "g1otcenginexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
const OTC_PATH = "gno.land/r/samcrew/memba_token_otc_v2"

const mocks = vi.hoisted(() => ({
    getTokenAllowance: vi.fn(),
    getOtcEngineAddress: vi.fn(),
    buildApproveMsg: vi.fn((caller: string, symbol: string, spender: string, amount: string) => ({
        type: "vm/MsgCall", value: { caller, spender, symbol, amount },
    })),
    doContractBroadcast: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../lib/tokenOtcApi", () => ({
    getTokenAllowance: mocks.getTokenAllowance,
    getOtcEngineAddress: mocks.getOtcEngineAddress,
}))

vi.mock("../../lib/grc20", () => ({
    buildApproveMsg: mocks.buildApproveMsg,
    doContractBroadcast: mocks.doContractBroadcast,
}))

vi.mock("../../lib/marketplace/v3Reads", () => ({
    fetchLaneFeeBps: vi.fn().mockResolvedValue(50),
}))

import { TokenTradeModal } from "./TokenTradeModal"

describe("TokenTradeModal — list flow spender/allowance targeting", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.doContractBroadcast.mockResolvedValue(undefined)
    })

    it("checks allowance against the resolved engine address, not the OTC package path", async () => {
        mocks.getOtcEngineAddress.mockResolvedValue(ENGINE_ADDRESS)
        mocks.getTokenAllowance.mockResolvedValue(0n)

        render(
            <TokenTradeModal
                action="list" symbol="FORGE" callerAddress="g1caller"
                onClose={vi.fn()} onSuccess={vi.fn()}
            />,
        )

        await waitFor(() => expect(mocks.getTokenAllowance).toHaveBeenCalled())

        const [, , spenderArg] = mocks.getTokenAllowance.mock.calls[0]
        expect(spenderArg).toBe(ENGINE_ADDRESS)
        expect(spenderArg).not.toBe(OTC_PATH)
    })

    it("approves the resolved engine address as spender, not the OTC package path", async () => {
        mocks.getOtcEngineAddress.mockResolvedValue(ENGINE_ADDRESS)
        mocks.getTokenAllowance.mockResolvedValue(0n) // forces the "approve" step

        
        render(
            <TokenTradeModal
                action="list" symbol="FORGE" callerAddress="g1caller"
                onClose={vi.fn()} onSuccess={vi.fn()}
            />,
        )

        const approveBtn = await screen.findByRole("button", { name: /approve otc desk/i })
        fireEvent.click(approveBtn)

        await waitFor(() => expect(mocks.buildApproveMsg).toHaveBeenCalled())
        const [, , spenderArg] = mocks.buildApproveMsg.mock.calls[0]
        expect(spenderArg).toBe(ENGINE_ADDRESS)
        expect(spenderArg).not.toBe(OTC_PATH)
    })

    it("refuses to send an approval when the engine address can't be resolved, instead of mis-targeting it", async () => {
        mocks.getOtcEngineAddress.mockRejectedValue(new Error("network down"))

        
        render(
            <TokenTradeModal
                action="list" symbol="FORGE" callerAddress="g1caller"
                onClose={vi.fn()} onSuccess={vi.fn()}
            />,
        )

        // Falls back to the "approve" step (existing catch-and-default behavior).
        const approveBtn = await screen.findByRole("button", { name: /approve otc desk/i })
        fireEvent.click(approveBtn)

        // Must show the guard error, not call buildApproveMsg with a bad/missing spender.
        expect(await screen.findByRole("alert")).toHaveTextContent(/could not resolve/i)
        expect(mocks.buildApproveMsg).not.toHaveBeenCalled()
        expect(mocks.doContractBroadcast).not.toHaveBeenCalled()
    })
})
