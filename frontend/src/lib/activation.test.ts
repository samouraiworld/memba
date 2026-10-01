import { describe, expect, it } from "vitest"
import { activationCosts, activationMsgs } from "./activation"

const ME = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

describe("activation", () => {
    it("sends 1 ugnot from the address to itself: nothing is written, nothing leaves the address", () => {
        expect(activationMsgs(ME)).toEqual([{ type: "/bank.MsgSend", value: { from_address: ME, to_address: ME, amount: "1ugnot" } }])
    })

    it("costs the network fee only: 2,000,000 gas at the live price, with 20 % headroom", () => {
        expect(activationCosts({ gas: 1000, ugnot: 1 })).toEqual({ gasWanted: 2_000_000, feeUgnot: 2_400 })
    })
})
