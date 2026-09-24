import { afterEach, describe, expect, it } from "vitest"
import { buildSendMsg, checkSend, clearSendLock, formatUgnot, nameToLookUp, parseGnot, readRecipient, readRecipients, readSendLock, rememberRecipient, writeSendLock } from "./send"

const A = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const B = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const ctx = (over: Partial<Parameters<typeof checkSend>[1]> = {}) => ({ from: A, balance: 200_000_000n, fee: 2_400n, mainnet: true, known: () => false, ...over })

afterEach(() => localStorage.clear())

describe("amounts", () => {
    it("parse exact ugnot, up to 6 decimals, and refuse anything else", () => {
        expect(parseGnot("1")).toBe(1_000_000n)
        expect(parseGnot("12.5")).toBe(12_500_000n)
        expect(parseGnot("0.000001")).toBe(1n)
        expect(parseGnot("1 000")).toBe(1_000_000_000n)
        for (const bad of ["", "0", "0.0000001", "-1", "1e3", "abc", "1.2.3", "12,5", "1,000"]) expect(parseGnot(bad), bad).toBeNull()
    })

    it("format exactly", () => {
        expect(formatUgnot(12_500_000n)).toBe("12.5 GNOT")
        expect(formatUgnot(1n)).toBe("0.000001 GNOT")
        expect(formatUgnot(1_234_000_000n)).toBe("1,234 GNOT")
    })
})

describe("recipients", () => {
    it("take a checksummed g1 address", () => {
        expect(readRecipient(B)).toEqual({ kind: "address", address: B })
        expect(readRecipient(`${B.slice(0, -1)}q`)).toMatchObject({ kind: "error", error: expect.stringContaining("typo") })
        expect(readRecipient("")).toBeNull()
    })

    it("take an @name through the user registry (D23), lower-cased, with its resolved address", () => {
        const found = () => ({ status: "found", address: B }) as const
        expect(readRecipient("@Alice", found)).toEqual({ kind: "name", name: "alice", address: B })
        expect(readRecipient("@alice", () => ({ status: "loading" }))).toEqual({ kind: "pending", name: "alice" })
        expect(readRecipient("@alice")).toEqual({ kind: "pending", name: "alice" })
        expect(readRecipient("@nobody", () => ({ status: "missing" }))).toMatchObject({ kind: "error", error: expect.stringContaining("No gno.land user") })
        expect(readRecipient("@alice", () => ({ status: "error" }))).toMatchObject({ kind: "error", error: expect.stringContaining("Couldn't look up") })
    })

    it("never trust a looked-up address that fails its checksum", () => {
        expect(readRecipient("@alice", () => ({ status: "found", address: `${B.slice(0, -1)}q` }))).toMatchObject({ kind: "error" })
    })

    it("refuse what the registry would never hold, and ask for the @ on a bare word", () => {
        for (const bad of ["@", "@1abc", "@al ice", "@a__b", `@${"a".repeat(65)}`]) expect(readRecipient(bad, () => ({ status: "found", address: B })), bad).toMatchObject({ kind: "error", error: expect.stringContaining("username") })
        expect(readRecipient("alice")).toMatchObject({ kind: "error", error: expect.stringContaining("@") })
    })

    it("names the lookup to run: only for a well-formed @name", () => {
        expect(nameToLookUp("@Alice ")).toBe("alice")
        expect(nameToLookUp("@1abc")).toBeNull()
        expect(nameToLookUp(B)).toBeNull()
    })
})

describe("checkSend", () => {
    it("sends to a name's address: pending blocks, your own name is refused, and the tiers use the address", () => {
        const found = (address: string) => () => ({ status: "found", address }) as const
        const d = { to: "@alice", amount: "1", memo: "", save: false }
        expect(checkSend(d, ctx()).problems.to).toMatch(/Looking up @alice/)
        const ok = checkSend(d, ctx({ lookup: found(B) }))
        expect(ok.problems.to).toBeUndefined()
        expect(ok.recipient).toEqual({ kind: "name", name: "alice", address: B })
        expect(ok.tiers).toContain("new address")
        expect(checkSend(d, ctx({ lookup: found(B), known: (a) => a === B })).tiers).not.toContain("new address")
        expect(checkSend(d, ctx({ lookup: found(A) })).problems.to).toMatch(/own address/)
    })


    it("refuses your own address, a missing amount and more than the balance keeps for the fee", () => {
        expect(checkSend({ to: A, amount: "1", memo: "", save: false }, ctx()).problems.to).toMatch(/own address/)
        expect(checkSend({ to: B, amount: "", memo: "", save: false }, ctx()).problems.amount).toBeDefined()
        expect(checkSend({ to: B, amount: "12,5", memo: "", save: false }, ctx()).problems.amount).toMatch(/no commas/)
        expect(checkSend({ to: B, amount: "200", memo: "", save: false }, ctx()).problems.amount).toMatch(/More than you have/)
        expect(checkSend({ to: B, amount: "199.99", memo: "", save: false }, ctx()).problems).toEqual({})
        expect(checkSend({ to: B, amount: "1", memo: "x".repeat(257), save: false }, ctx()).problems.memo).toBeDefined()
    })

    it("asks for the address check on mainnet for a new address or 100 GNOT or more (D17, D24)", () => {
        expect(checkSend({ to: B, amount: "1", memo: "", save: false }, ctx()).tiers).toEqual(["new address"])
        expect(checkSend({ to: B, amount: "100", memo: "", save: false }, ctx({ known: () => true })).tiers).toEqual(["100 GNOT or more"])
        expect(checkSend({ to: B, amount: "99.999999", memo: "", save: false }, ctx({ known: () => true })).tiers).toEqual([])
        expect(checkSend({ to: B, amount: "500", memo: "", save: false }, ctx({ mainnet: false, balance: 10_000_000_000n })).tiers).toEqual([])
    })

    it("builds the one message shape Adena accepts (D37)", () => {
        expect(buildSendMsg(A, B, 1_500_000n)).toEqual({ type: "/bank.MsgSend", value: { from_address: A, to_address: B, amount: "1500000ugnot" } })
    })
})

describe("browser storage", () => {
    it("keeps recents first and deduplicated, and saved addresses, per wallet", () => {
        rememberRecipient("gnoland-1", A, B, false)
        rememberRecipient("gnoland-1", A, B, true)
        expect(readRecipients("gnoland-1", A)).toEqual({ recent: [B], saved: [B] })
        expect(readRecipients("gnoland-1", B)).toEqual({ recent: [], saved: [] })
        localStorage.setItem(`memba_os_recipients:gnoland-1:${B}`, JSON.stringify({ recent: ["<script>"], saved: [] }))
        expect(readRecipients("gnoland-1", B)).toEqual({ recent: [], saved: [] })
    })

    it("holds the send lock until cleared", () => {
        writeSendLock("gnoland-1", A, { label: "Send 1 GNOT", hash: "", at: 1 })
        expect(readSendLock("gnoland-1", A)?.label).toBe("Send 1 GNOT")
        clearSendLock("gnoland-1", A)
        expect(readSendLock("gnoland-1", A)).toBeNull()
    })
})
