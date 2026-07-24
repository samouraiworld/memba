import { describe, it, expect } from "vitest"
import { buildListTokensMsg, buildCancelListingMsg, buildFillListingMsg } from "./tokenOtc"
import { toAdenaMessages } from "./grc20"
import { MEMBA_DAO } from "./config"

// The token OTC builders MUST emit the Amino "vm/MsgCall" type — toAdenaMessages
// (the shared broadcast path) hard-throws on any other type, so a lowercase
// "vm/msg/call" silently broke every token write (list/cancel/fill). These
// tests pin the wire contract by round-tripping through toAdenaMessages.

describe("tokenOtc builders — Amino wire type", () => {
    const caller = "g1caller"

    it("buildCancelListingMsg is a vm/MsgCall that toAdenaMessages accepts", () => {
        const msg = buildCancelListingMsg(caller, "42")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value).toMatchObject({
            caller,
            send: "",
            pkg_path: MEMBA_DAO.tokenOtcPath,
            func: "CancelListing",
            args: ["42"],
        })
        // The real proof: it must survive the broadcast translation, not throw.
        expect(() => toAdenaMessages([msg])).not.toThrow()
    })

    it("buildListTokensMsg is a vm/MsgCall", () => {
        const msg = buildListTokensMsg(caller, "FOO", 100n, 5n)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("ListTokens")
        expect(msg.value.args).toEqual(["FOO", "100", "5"])
        expect(() => toAdenaMessages([msg])).not.toThrow()
    })

    it("buildListTokensMsg round-trips a base-unit amount beyond Number.MAX_SAFE_INTEGER intact", () => {
        // e.g. 10M whole tokens at 18 decimals — exactly the kind of order a
        // JS `number` would have silently mangled before amount/unitPrice
        // became bigint (T3.2).
        const big = 10_000_000n * 10n ** 18n
        const msg = buildListTokensMsg(caller, "FOO", big, 1n)
        expect(msg.value.args).toEqual(["FOO", big.toString(), "1"])
    })

    it("buildFillListingMsg is a vm/MsgCall that sends the exact ugnot cost", () => {
        const msg = buildFillListingMsg(caller, "7", 2n, 5n, 10n)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("Fill")
        expect(msg.value.send).toBe("10ugnot")
        expect(msg.value.args).toEqual(["7", "2", "5"])
        expect(() => toAdenaMessages([msg])).not.toThrow()
    })
})
