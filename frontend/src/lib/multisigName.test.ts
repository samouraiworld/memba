import { describe, expect, it } from "vitest"
import type { Multisig } from "../gen/memba/v1/memba_pb"
import { multisigLabel, namedByText } from "./multisigName"

const BOB = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const ms = (m: Partial<Multisig>) => ({ name: "", sharedName: "", namedBy: "", joined: true, ...m }) as Multisig

describe("a multisig's name as a member sees it", () => {
    it("prefers the member's own name, then another member's marked with who gave it, then the neutral word", () => {
        expect(multisigLabel(ms({ name: "Mine", sharedName: "Reserve", namedBy: BOB }), "Multisig", false)).toEqual({ name: "Mine", namedBy: "" })
        expect(multisigLabel(ms({ sharedName: "Reserve", namedBy: BOB }), "Multisig", false)).toEqual({ name: "Reserve", namedBy: BOB })
        expect(multisigLabel(ms({}), "Multisig", false)).toEqual({ name: "Multisig", namedBy: "" })
    })
    it("shows another member's name for an unjoined account only on its own page", () => {
        const shared = ms({ joined: false, sharedName: "URGENT: sign now", namedBy: BOB })
        expect(multisigLabel(shared, "Multisig shared with you", false)).toEqual({ name: "Multisig shared with you", namedBy: "" })
        expect(multisigLabel(shared, "Multisig shared with you", true)).toEqual({ name: "URGENT: sign now", namedBy: BOB })
    })
    it("reveals invisible formatting and shortens who named it", () => {
        expect(multisigLabel(ms({ sharedName: "Re​serve", namedBy: BOB }), "Multisig", true).name).toBe("Re[U+200B]serve")
        expect(namedByText(BOB)).toBe("named by g1747t5m…x59c")
    })
})
