import { describe, expect, it } from "vitest"
import type { AminoMsg } from "../../lib/grc20"
import { adenaChecklist, formatSend, sameMsgs } from "./decode"

const vote: AminoMsg = {
    type: "vm/MsgCall",
    value: { caller: "g1x", send: "", pkg_path: "gno.land/r/alice/team", func: "Vote", args: ["12", "YES"], max_deposit: "2000000ugnot" },
}

describe("adenaChecklist", () => {
    it("lists what Adena will show for a call, then the network", () => {
        const rows = adenaChecklist([vote], "gnoland-1")
        expect(rows.map((r) => [r.label, r.value])).toEqual([
            ["Function", "Vote"],
            ["Realm", "gno.land/r/alice/team"],
            ["Arguments", "12 · YES"],
            ["Deposit cap", expect.stringContaining("2")],
            ["Network", "gnoland-1"],
        ])
    })

    it("shows funds a call sends", () => {
        const rows = adenaChecklist([{ ...vote, value: { ...vote.value, send: "1500000ugnot", max_deposit: "" } }], "gnoland-1")
        expect(rows.find((r) => r.label === "Sends")?.value).toBe("1.5 GNOT")
        expect(rows.some((r) => r.label === "Deposit cap")).toBe(false)
    })

    it("describes a deploy by its path", () => {
        const rows = adenaChecklist([{ type: "/vm.m_addpkg", value: { creator: "g1x", package: { name: "team", path: "gno.land/r/alice/team", files: [] }, max_deposit: "3000000ugnot" } }], "gnoland-1")
        expect(rows[0]).toEqual({ label: "Action", value: "Deploy a package" })
        expect(rows[1].value).toBe("gno.land/r/alice/team")
    })
})

describe("formatSend", () => {
    it("formats ugnot exactly", () => {
        expect(formatSend("1ugnot")).toBe("0.000001 GNOT")
        expect(formatSend("100000000ugnot")).toBe("100 GNOT")
        expect(formatSend("")).toBeNull()
    })
})

describe("sameMsgs", () => {
    it("matches regardless of key order, and catches any change", () => {
        const reordered: AminoMsg = { type: "vm/MsgCall", value: { args: ["12", "YES"], func: "Vote", pkg_path: "gno.land/r/alice/team", send: "", caller: "g1x", max_deposit: "2000000ugnot" } }
        expect(sameMsgs([vote], [reordered])).toBe(true)
        expect(sameMsgs([vote], [{ ...vote, value: { ...vote.value, args: ["12", "NO"] } }])).toBe(false)
        expect(sameMsgs([vote], [{ ...vote, value: { ...vote.value, max_deposit: "9000000ugnot" } }])).toBe(false)
        expect(sameMsgs([vote], [vote, vote])).toBe(false)
        expect(sameMsgs([vote], [])).toBe(false)
    })

})

describe("adenaChecklist for a GNOT send", () => {
    it("shows it as Adena labels it", () => {
        const rows = adenaChecklist([{ type: "/bank.MsgSend", value: { from_address: "g1a", to_address: "g1b", amount: "1500000ugnot" } }], "gnoland-1")
        expect(rows).toEqual([
            { label: "Action", value: "Transfer" }, { label: "To", value: "g1b", mono: true }, { label: "Amount", value: "1.5 GNOT" },
            { label: "Network", value: "gnoland-1", mono: true },
        ])
    })
})
