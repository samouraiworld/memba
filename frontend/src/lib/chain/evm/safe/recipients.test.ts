import { describe, expect, it } from "vitest"
import { getAddress, type Hex } from "viem"
import { addressGroups, knownRecipients, parseRecipient, recipientWarnings } from "./recipients"

const checksum = (a: Hex) => getAddress(a)
const SAFE: Hex = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
const vitalik = VITALIK.toLowerCase() as Hex
const OWNER: Hex = "0xa11ce00000000000000000000000000000000001"
const TOKEN: Hex = "0x7070000000000000000000000000000000000003"

describe("reading a recipient address", () => {
    it("accepts a checksummed, all-lowercase or all-uppercase address and keeps it lowercase, with its checksum for display", () => {
        for (const input of [VITALIK, vitalik, `0x${VITALIK.slice(2).toUpperCase()}`, `  ${VITALIK}\n`]) {
            expect(parseRecipient(input, checksum)).toEqual({ ok: true, address: vitalik, display: VITALIK })
        }
    })

    it("refuses mixed case that breaks the checksum: one character is probably wrong", () => {
        const typo = `${VITALIK.slice(0, 5)}${VITALIK[5] === "a" ? "A" : "a"}${VITALIK.slice(6)}`
        const r = parseRecipient(typo, checksum)
        expect(r.ok).toBe(false)
        expect(!r.ok && r.error).toMatch(/checksum/)
    })

    it("refuses partial addresses, ENS-like names, and the zero address", () => {
        for (const input of ["", "0x1234", `${VITALIK}00`, "vitalik.eth", VITALIK.slice(2), `0X${VITALIK.slice(2)}`]) {
            expect(parseRecipient(input, checksum).ok).toBe(false)
        }
        const zero = parseRecipient("0x0000000000000000000000000000000000000000", checksum)
        expect(!zero.ok && zero.error).toMatch(/zero address/)
    })
})

describe("the recipients Memba may suggest", () => {
    it("lists each address once, owners first, then saved, then those this Safe paid; drops invalid entries", () => {
        expect(knownRecipients({
            sentBefore: [VITALIK, "not-an-address", TOKEN],
            saved: [{ address: vitalik, label: "V" }],
            owners: [OWNER.toUpperCase().replace("0X", "0x")],
        })).toEqual([
            { address: OWNER, source: "owner" },
            { address: vitalik, source: "saved", label: "V" },
            { address: TOKEN, source: "sent-before" },
        ])
        expect(knownRecipients({})).toEqual([])
    })
})

describe("warnings on a recipient", () => {
    const known = knownRecipients({ owners: [OWNER], sentBefore: [vitalik] })
    const codes = (to: Hex, ctx: Partial<Parameters<typeof recipientWarnings>[1]> = {}) =>
        recipientWarnings(to, { safe: SAFE, known, ...ctx }).map((w) => [w.code, w.severity])

    it("says nothing about a known recipient", () => {
        expect(codes(vitalik)).toEqual([])
        expect(codes(VITALIK as Hex)).toEqual([])
    })

    it("flags a look-alike of a known address, or of the Safe, as danger and names what it imitates", () => {
        const poisoned: Hex = `0x${vitalik.slice(2, 6)}${"0".repeat(32)}${vitalik.slice(-4)}`
        const w = recipientWarnings(poisoned, { safe: SAFE, known })
        expect(w.map((x) => [x.code, x.severity])).toEqual([["look-alike", "danger"], ["new", "caution"]])
        expect(w[0].resembles).toBe(vitalik)
        const safeLike: Hex = `0x5afe${"1".repeat(32)}5afe`
        expect(recipientWarnings(safeLike, { safe: SAFE, known })[0]).toMatchObject({ code: "look-alike", resembles: SAFE })
        // Sharing only the start, or only the end, is not a look-alike.
        expect(codes(`0x${vitalik.slice(2, 6)}${"0".repeat(36)}`)).toEqual([["new", "caution"]])
    })

    it("flags the token's own contract, the Safe itself, a first-time recipient and a contract", () => {
        expect(codes(TOKEN, { token: TOKEN, isContract: true })).toEqual([["token-contract", "danger"], ["new", "caution"]])
        expect(codes(SAFE, { isContract: true })).toEqual([["self", "caution"]])
        expect(codes("0x1111111111111111111111111111111111111111", { isContract: true })).toEqual([["new", "caution"], ["contract", "caution"]])
    })
})

describe("showing an address in full", () => {
    it("splits it after 0x into groups of four", () => {
        expect(addressGroups(VITALIK)).toEqual(["0x", "d8dA", "6BF2", "6964", "aF9D", "7eEd", "9e03", "E534", "15D3", "7aA9", "6045"])
    })
})
