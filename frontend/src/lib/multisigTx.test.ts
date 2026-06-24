import { describe, it, expect } from "vitest"
import { toCanonicalMsg, buildCanonicalFeeJson, buildCanonicalProposePayload, buildAdenaMultisigDoc } from "./multisigTx"

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

describe("buildCanonicalProposePayload", () => {
    it("send → canonical bank.MsgSend + 100000 gas", () => {
        const { msgsJson, feeJson } = buildCanonicalProposePayload(
            [{ type: "bank/MsgSend", value: { from_address: "g1a", to_address: "g1b", amount: [{ denom: "ugnot", amount: "5" }] } }],
            false,
        )
        const msgs = JSON.parse(msgsJson)
        expect(msgs[0]["@type"]).toBe("/bank.MsgSend")
        expect(msgs[0].amount).toBe("5ugnot")
        expect(JSON.parse(feeJson)).toEqual({ gas_wanted: "100000", gas_fee: "10000ugnot" })
    })

    it("call → canonical vm.m_call (args:null) + 2000000 gas", () => {
        const { msgsJson, feeJson } = buildCanonicalProposePayload(
            [{ type: "vm/MsgCall", value: { caller: "g1a", send: "", pkg_path: "gno.land/r/x", func: "F", args: [] } }],
            true,
        )
        const msgs = JSON.parse(msgsJson)
        expect(msgs[0]["@type"]).toBe("/vm.m_call")
        expect(msgs[0].args).toBeNull()
        expect(JSON.parse(feeJson).gas_wanted).toBe("2000000")
    })
})

describe("buildAdenaMultisigDoc", () => {
    it("passes canonical msgs+fee through into Adena's SignMultisigTransaction doc", () => {
        const msg = { "@type": "/vm.m_call", args: null, caller: "g1c", send: "", max_deposit: "", pkg_path: "p", func: "F" }
        const doc = buildAdenaMultisigDoc({
            account_number: "5",
            chain_id: "test-13",
            fee: { gas_wanted: "2000000", gas_fee: "10000ugnot" },
            memo: "hi",
            msgs: [msg],
            sequence: "9",
        })
        expect(doc).toEqual({
            tx: { msg: [msg], fee: { gas_wanted: "2000000", gas_fee: "10000ugnot" }, signatures: null, memo: "hi" },
            chainId: "test-13",
            accountNumber: "5",
            sequence: "9",
        })
    })
})
