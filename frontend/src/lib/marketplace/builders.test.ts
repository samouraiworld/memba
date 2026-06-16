/**
 * builders.test.ts — regression for the broadcast-type bug.
 *
 * These are the escrow MsgCall builders actually used by FreelanceServices.
 * They broadcast via doContractBroadcast → toAdenaMessages, which only accepts
 * the Amino type "vm/MsgCall" and throws on the Adena wire type "/vm.m_call".
 * Emitting "/vm.m_call" here made every escrow action fail before the wallet.
 */

import { describe, it, expect } from "vitest"
import {
    buildCreateContractMsg,
    buildFundMilestoneMsg,
    buildCompleteMilestoneMsg,
    buildReleaseFundsMsg,
    buildRaiseDisputeMsg,
    buildCancelContractMsg,
    buildClaimRefundMsg,
    buildClaimDisputeTimeoutMsg,
} from "./builders"
import { toAdenaMessages } from "../grc20"

describe("marketplace/escrow builders — broadcast path", () => {
    const caller = "g1testcaller"
    const escrow = "gno.land/r/samcrew/escrow"

    it("every escrow builder survives toAdenaMessages", () => {
        const msgs = [
            buildCreateContractMsg(caller, escrow, "g1free", "t", "d", "m:1000"),
            buildFundMilestoneMsg(caller, escrow, "0", 0, 1000),
            buildCompleteMilestoneMsg(caller, escrow, "0", 0),
            buildReleaseFundsMsg(caller, escrow, "0", 0),
            buildRaiseDisputeMsg(caller, escrow, "0", 0),
            buildCancelContractMsg(caller, escrow, "0"),
            buildClaimRefundMsg(caller, escrow, "0"),
            buildClaimDisputeTimeoutMsg(caller, escrow, "0"),
        ]
        expect(() => toAdenaMessages(msgs)).not.toThrow()
        expect(toAdenaMessages(msgs).every((m) => m.type === "/vm.m_call")).toBe(true)
    })

    it("buildFundMilestoneMsg emits vm/MsgCall", () => {
        expect(buildFundMilestoneMsg(caller, escrow, "0", 0, 1000).type).toBe("vm/MsgCall")
    })
})
