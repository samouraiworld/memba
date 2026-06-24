import { describe, it, expect } from "vitest"
import { toCanonicalMsg, buildCanonicalFeeJson } from "./multisigTx"

describe("toCanonicalMsg", () => {
    it("bank/MsgSend → @type-inlined, amount as ugnot string", () => {
        expect(
            toCanonicalMsg({
                type: "bank/MsgSend",
                value: {
                    from_address: "g1from",
                    to_address: "g1to",
                    amount: [{ denom: "ugnot", amount: "1500000" }],
                },
            }),
        ).toEqual({
            "@type": "/bank.MsgSend",
            from_address: "g1from",
            to_address: "g1to",
            amount: "1500000ugnot",
        })
    })

    it("vm/MsgCall with no args → args:null, send/max_deposit present", () => {
        expect(
            toCanonicalMsg({
                type: "vm/MsgCall",
                value: { caller: "g1c", send: "", pkg_path: "gno.land/r/x", func: "F", args: [] },
            }),
        ).toEqual({
            "@type": "/vm.m_call",
            args: null,
            caller: "g1c",
            send: "",
            max_deposit: "",
            pkg_path: "gno.land/r/x",
            func: "F",
        })
    })

    it("vm/MsgCall with args → args array + send preserved", () => {
        const got = toCanonicalMsg({
            type: "vm/MsgCall",
            value: { caller: "g1c", send: "5000000ugnot", pkg_path: "gno.land/r/x", func: "F", args: ["a", "b"] },
        }) as Record<string, unknown>
        expect(got.args).toEqual(["a", "b"])
        expect(got.send).toBe("5000000ugnot")
        expect(got["@type"]).toBe("/vm.m_call")
    })

    it("unsupported msg type throws", () => {
        expect(() => toCanonicalMsg({ type: "vm/MsgAddPackage", value: {} })).toThrow()
    })
})

describe("buildCanonicalFeeJson", () => {
    it("emits {gas_wanted, gas_fee}", () => {
        expect(JSON.parse(buildCanonicalFeeJson("2000000", "1000000ugnot"))).toEqual({
            gas_wanted: "2000000",
            gas_fee: "1000000ugnot",
        })
    })
})
