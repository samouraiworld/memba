/**
 * hireByAddress — the hire-by-address form's checks are the realm-parity
 * builder checks, with exact GNOT → ugnot conversion and the field each
 * refusal is about.
 */
import { describe, expect, it } from "vitest"
import { checkHireDraft, parseGnotInput, type HireDraft } from "./hireByAddress"
import { planHireService } from "./escrowTx"

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v4"

const draft = (over: Partial<HireDraft> = {}): HireDraft => ({
    freelancer: FREELANCER,
    title: "Logo design",
    description: "Two concepts, one revision.",
    milestones: [{ title: "Concepts", amountGnot: "1.5" }, { title: "Final", amountGnot: "0.001" }],
    ...over,
})

describe("parseGnotInput", () => {
    it.each([
        ["1", 1_000_000], ["1.5", 1_500_000], ["0.001", 1_000], ["0.000001", 1], [" 2.25 ", 2_250_000], ["999999999.999999", 999_999_999_999_999],
    ])("%s GNOT is exactly %i ugnot", (input, ugnot) => {
        expect(parseGnotInput(input)).toBe(ugnot)
    })

    it.each(["", "1.", ".5", "01", "1.0000001", "-1", "1e3", "1,5", "1 000", "0x10", "1000000000"])("refuses %j", (input) => {
        expect(() => parseGnotInput(input)).toThrow(/not an amount in GNOT/)
    })
})

describe("checkHireDraft", () => {
    it("builds the listing the hire dialog signs, with the exact total", () => {
        const r = checkHireDraft(CLIENT, ESCROW, draft())
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.service).toEqual({ freelancer: FREELANCER, title: "Logo design", description: "Two concepts, one revision.", milestones: "Concepts:1500000,Final:1000" })
        expect(r.totalUgnot).toBe(1_501_000n)
        // The dialog plans the same CreateContract from it.
        expect(planHireService(CLIENT, ESCROW, r.service).msg.value.args).toEqual([FREELANCER, "Logo design", "Two concepts, one revision.", "Concepts:1500000,Final:1000"])
    })

    it("trims the pasted address", () => {
        const r = checkHireDraft(CLIENT, ESCROW, draft({ freelancer: `  ${FREELANCER}\n` }))
        expect(r.ok && r.service.freelancer).toBe(FREELANCER)
    })

    it.each([
        [{ freelancer: "" }, "freelancer", /Enter the freelancer's address/],
        [{ freelancer: "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zr" }, "freelancer", /not a valid gno.land address/],
        [{ freelancer: "G1U7Y667Z64X2H7VC6FMPCPRGEY4CK233JAWW9ZQ" }, "freelancer", /not a valid gno.land address/],
        [{ freelancer: CLIENT }, "freelancer", /cannot hire yourself/],
        [{ title: "" }, "title", /title must be 1-200 bytes/],
        [{ title: "   " }, "title", /visible characters/],
        [{ title: "a".repeat(201) }, "title", /1-200 bytes/],
        [{ title: "Logo [v2]" }, "title", /Remove "\[" from the title/],
        [{ title: "Logo‮" }, "title", /U\+202E from the title/],
        [{ description: "x".repeat(5001) }, "description", /0-5000 bytes/],
        [{ description: "line\nbreak" }, "description", /a line break from the description/],
        [{ milestones: [] }, "milestones", /at least one milestone/],
        [{ milestones: Array.from({ length: 21 }, () => ({ title: "M", amountGnot: "1" })) }, "milestones", /At most 20 milestones/],
        [{ milestones: [{ title: "M", amountGnot: "0.0009" }] }, "milestones", /at least 1000 ugnot/],
        [{ milestones: [{ title: "M", amountGnot: "abc" }] }, "milestones", /Milestone 1: "abc" is not an amount/],
        [{ milestones: [{ title: "", amountGnot: "1" }] }, "milestones", /needs a title/],
        [{ milestones: [{ title: "a:b", amountGnot: "1" }] }, "milestones", /cannot contain "," or ":"/],
        [{ milestones: [{ title: " M", amountGnot: "1" }] }, "milestones", /cannot start or end with a space/],
    ] as const)("refuses %j on the %s field", (over, field, message) => {
        const r = checkHireDraft(CLIENT, ESCROW, draft(over as Partial<HireDraft>))
        expect(r.ok).toBe(false)
        if (r.ok) return
        expect(r.field).toBe(field)
        expect(r.message).toMatch(message)
    })

    it("needs a connected wallet", () => {
        expect(checkHireDraft("", ESCROW, draft())).toEqual({ ok: false, field: null, message: "Connect your wallet to hire." })
    })

    it("refuses another realm than the configured escrow", () => {
        const r = checkHireDraft(CLIENT, "gno.land/r/samcrew/escrow_v3", draft())
        expect(r.ok).toBe(false)
    })
})
