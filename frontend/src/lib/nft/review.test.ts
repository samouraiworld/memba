import { describe, expect, it } from "vitest"
import { NFT_CURATION_PATH } from "./curation"
import { buildApplyMsg, buildReviewMsg } from "./review"

const FOUNDER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const MANAGER = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const text = { cid: `bafkrei${"a".repeat(52)}`, hash: "c".repeat(64) }

describe("curation review calls", () => {
    it("applies with the statement's hash and CID, nothing attached", () => {
        expect(buildApplyMsg(FOUNDER, "C3", text)).toEqual({
            type: "vm/MsgCall",
            value: { caller: FOUNDER, send: "", pkg_path: NFT_CURATION_PATH, func: "Apply", args: ["C3", text.hash, text.cid], max_deposit: "1000000ugnot" },
        })
    })

    it("decides on the revision the manager read, with the reason's hash and CID", () => {
        expect(buildReviewMsg(MANAGER, "C3", 2n, "recommended", text)).toEqual({
            type: "vm/MsgCall",
            value: { caller: MANAGER, send: "", pkg_path: NFT_CURATION_PATH, func: "Review", args: ["C3", "2", "recommended", text.hash, text.cid], max_deposit: "200000ugnot" },
        })
    })

    it.each([
        ["a revision of zero", () => buildReviewMsg(MANAGER, "C3", 0n, "declined", text), "Invalid revision"],
        ["the founder's own status", () => buildReviewMsg(MANAGER, "C3", 1n, "submitted" as never, text), "Invalid decision"],
        ["a malformed collection ID", () => buildApplyMsg(FOUNDER, "C03", text), "Invalid collection ID"],
        ["an all-caps hash", () => buildApplyMsg(FOUNDER, "C3", { ...text, hash: "C".repeat(64) }), "Invalid statement hash"],
        ["a CID the realm refuses", () => buildReviewMsg(MANAGER, "C3", 1n, "declined", { ...text, cid: "bafz" }), "Invalid reason CID"],
        ["an account in capitals", () => buildApplyMsg(FOUNDER.toUpperCase(), "C3", text), "Invalid account"],
    ])("refuses %s", (_name, build, message) => {
        expect(build).toThrow(new RegExp(`^${message}$`))
    })
})
