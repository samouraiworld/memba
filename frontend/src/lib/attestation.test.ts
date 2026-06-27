import { describe, it, expect } from "vitest"
import { create } from "@bufbuild/protobuf"
import { parseGoString, buildRecordCompletionMsg } from "./attestation"
import { AttestationVoucherSchema } from "../gen/memba/v1/memba_pb"

describe("parseGoString", () => {
    it("unwraps a gno string qeval result", () => {
        expect(parseGoString(`("connect-wallet,use-cmdk" string)`)).toBe("connect-wallet,use-cmdk")
    })
    it("handles an empty string result", () => {
        expect(parseGoString(`("" string)`)).toBe("")
    })
    it("falls back to the trimmed raw value when unwrapped", () => {
        expect(parseGoString("  raw  ")).toBe("raw")
    })
})

describe("buildRecordCompletionMsg", () => {
    it("builds a vm/MsgCall with args in the realm's order (addr, questId, xp, nonce, sig)", () => {
        const v = create(AttestationVoucherSchema, {
            questId: "connect-wallet", xp: 10, nonce: "abc123", sigHex: "deadbeef",
        })
        const msg = buildRecordCompletionMsg("g1alice", "gno.land/r/samcrew/memba_quest_attestation_v1", v)
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value).toMatchObject({
            caller: "g1alice",
            pkg_path: "gno.land/r/samcrew/memba_quest_attestation_v1",
            func: "RecordCompletion",
            args: ["g1alice", "connect-wallet", "10", "abc123", "deadbeef"],
        })
    })

    it("stringifies xp (the realm's xp param is an int, gnokey passes string args)", () => {
        const v = create(AttestationVoucherSchema, { questId: "q", xp: 350, nonce: "n", sigHex: "s" })
        const msg = buildRecordCompletionMsg("g1bob", "realm", v)
        expect((msg.value.args as string[])[2]).toBe("350")
    })
})
