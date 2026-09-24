/**
 * Curated Services listings are reviewed code: every entry must be a listing
 * the escrow realm would accept a contract for.
 */
import { describe, expect, it } from "vitest"
import { CURATED_SERVICES } from "./curatedServices"
import { isValidGnoAddressChecksum } from "../dao/address"
import { checkHireDraft } from "./hireByAddress"

const CLIENT = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v4"

describe("CURATED_SERVICES", () => {
    it("holds the Samourai Coop listing only, with its full address", () => {
        expect(CURATED_SERVICES.map((s) => [s.id, s.title, s.category, s.freelancer])).toEqual([
            ["samourai-coop-dev", "Samourai Coop — dev services", "Development", "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"],
        ])
    })

    it.each(CURATED_SERVICES.map((s) => [s.id, s] as const))("%s: a checksummed address and a title prefix the realm accepts", (_id, s) => {
        expect(isValidGnoAddressChecksum(s.freelancer)).toBe(true)
        expect(new Set(CURATED_SERVICES.map((x) => x.id)).size).toBe(CURATED_SERVICES.length)
        const r = checkHireDraft(CLIENT, ESCROW, { freelancer: s.freelancer, title: `${s.titlePrefix}work`, description: "", milestones: [{ title: "M", amountGnot: "1" }] })
        expect(r.ok).toBe(true)
    })

    it("the listed freelancer cannot hire itself", () => {
        const s = CURATED_SERVICES[0]
        const r = checkHireDraft(s.freelancer, ESCROW, { freelancer: s.freelancer, title: `${s.titlePrefix}work`, description: "", milestones: [{ title: "M", amountGnot: "1" }] })
        expect(r).toMatchObject({ ok: false, field: "freelancer", message: expect.stringMatching(/cannot hire yourself/) })
    })
})
