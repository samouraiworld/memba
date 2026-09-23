import { describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"

const captured = vi.hoisted(() => ({ cb: null as null | ((msgs: unknown[], memo: string) => Promise<boolean>) }))
vi.mock("../../lib/grc20", () => ({ setTxConfirmationCallback: (cb: typeof captured.cb) => { captured.cb = cb } }))

import { TxConfirmationProvider } from "./TxConfirmation"

describe("TxConfirmation", () => {
    it("summarises a realm deploy with its path and storage deposit cap instead of an unknown action", async () => {
        render(<TxConfirmationProvider><div /></TxConfirmationProvider>)
        const msg = { type: "/vm.m_addpkg", value: { creator: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", package: { path: "gno.land/r/nym-alice123/team", files: [] }, send: "", max_deposit: "13000000ugnot" } }
        await act(async () => { void captured.cb!([msg], "Deploy realm gno.land/r/nym-alice123/team") })
        expect(screen.getByText("Deploy realm gno.land/r/nym-alice123/team", { selector: ".tx-confirm-func" })).toBeInTheDocument()
        expect(screen.getByText("Storage deposit cap")).toBeInTheDocument()
        expect(screen.getByText("13 GNOT")).toBeInTheDocument()
        expect(screen.queryByText("unknown")).not.toBeInTheDocument()
    })

    it("still shows the function of a contract call", async () => {
        render(<TxConfirmationProvider><div /></TxConfirmationProvider>)
        const call = { type: "vm/MsgCall", value: { caller: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", send: "", pkg_path: "gno.land/r/x/dao", func: "Vote", args: ["1", "YES"] } }
        await act(async () => { void captured.cb!([call], "vote") })
        expect(screen.getByText("Vote", { selector: ".tx-confirm-func" })).toBeInTheDocument()
        expect(screen.queryByText("Storage deposit cap")).not.toBeInTheDocument()
    })

    it("shows the full contract path and the storage deposit cap of a DAO call", async () => {
        render(<TxConfirmationProvider><div /></TxConfirmationProvider>)
        const call = { type: "vm/MsgCall", value: { caller: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", send: "", pkg_path: "gno.land/r/nym-alice123/team_dao", func: "ProposeText", args: ["Title", "", "governance"], max_deposit: "1610000ugnot" } }
        await act(async () => { void captured.cb!([call], "Propose: Title") })
        expect(screen.getByText("gno.land/r/nym-alice123/team_dao", { selector: ".tx-confirm-path" })).toBeInTheDocument()
        expect(screen.getByText("Storage deposit cap")).toBeInTheDocument()
        expect(screen.getByText("1.61 GNOT")).toBeInTheDocument()
    })
})

describe("TxConfirmation arguments", () => {
    const CALLER = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
    const TARGET = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
    // Differs from TARGET only in the middle, where a head…tail shortening would hide it.
    const LOOKALIKE = "g1u7y667z64x2h7vqqqqqqqqqqqqqqq33jaww9zq"
    const open = async (args: string[], extra: Record<string, unknown> = {}) => {
        render(<TxConfirmationProvider><div /></TxConfirmationProvider>)
        const call = { type: "vm/MsgCall", value: { caller: CALLER, send: "", pkg_path: "gno.land/r/x/dao", func: "Do", args, ...extra } }
        await act(async () => { void captured.cb!([call], "memo") })
    }

    it("shows a bech32 address argument in full, with a copy button", async () => {
        const writeText = vi.fn(async () => {})
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
        await open([TARGET])
        expect(screen.getByText(TARGET, { selector: ".tx-confirm-arg" })).toBeInTheDocument()
        await act(async () => { screen.getByRole("button", { name: `Copy ${TARGET}` }).click() })
        expect(writeText).toHaveBeenCalledWith(TARGET)
    })

    it("never hides the middle of an address that differs from a lookalike", async () => {
        await open([LOOKALIKE])
        expect(screen.getByText(LOOKALIKE, { selector: ".tx-confirm-arg" })).toBeInTheDocument()
        expect(screen.queryByText(/\.\.\./)).not.toBeInTheDocument()
    })

    it("shows the caller address in full", async () => {
        await open(["1"])
        expect(screen.getByText(CALLER, { selector: ".tx-confirm-addr" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: `Copy ${CALLER}` })).toBeInTheDocument()
    })

    it("shows a realm path argument in full", async () => {
        const path = "gno.land/r/nym-alice123/some_long_realm_name/v2"
        await open([path])
        expect(screen.getByText(path, { selector: ".tx-confirm-arg" })).toBeInTheDocument()
    })

    it("shows in full any argument that carries an address, such as a list", async () => {
        const list = `${TARGET},${LOOKALIKE}`
        await open([list])
        expect(screen.getByText(list, { selector: ".tx-confirm-arg" })).toBeInTheDocument()
    })

    it("truncates other long arguments only behind a visible marker and an explicit Show full toggle", async () => {
        const long = "a".repeat(100) + "TAIL"
        await open([long])
        expect(screen.queryByText(long)).not.toBeInTheDocument()
        expect(screen.getByText(/more characters hidden/)).toBeInTheDocument()
        await act(async () => { screen.getByRole("button", { name: "Show full argument" }).click() })
        expect(screen.getByText(long, { selector: ".tx-confirm-arg" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument()
    })

    it("reveals invisible formatting characters that could reorder an argument, and still copies the exact value", async () => {
        const writeText = vi.fn(async () => {})
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
        const spoof = `${TARGET.slice(0, 20)}\u202E${TARGET.slice(20)}`
        await open([spoof, "to\u200Bken"])
        expect(screen.getByText(`${TARGET.slice(0, 20)}[U+202E]${TARGET.slice(20)}`, { selector: ".tx-confirm-arg" })).toBeInTheDocument()
        expect(screen.getByText("to[U+200B]ken", { selector: ".tx-confirm-arg" })).toBeInTheDocument()
        await act(async () => { screen.getAllByRole("button", { name: /^Copy g1u7y/ })[0].click() })
        expect(writeText).toHaveBeenCalledWith(spoof)
    })

    it("shows in full an address glued to other text", async () => {
        const glued = "x".repeat(70) + TARGET
        await open([glued])
        expect(screen.getByText(glued, { selector: ".tx-confirm-arg" })).toBeInTheDocument()
    })

    it("shows short arguments as they are", async () => {
        await open(["1", "YES"])
        expect(screen.getByText("YES", { selector: ".tx-confirm-arg" })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Show full argument" })).not.toBeInTheDocument()
    })

    it("pins arguments, the sender and the memo to their signed left-to-right order", async () => {
        render(<TxConfirmationProvider><div /></TxConfirmationProvider>)
        const call = { type: "vm/MsgCall", value: { caller: CALLER, send: "", pkg_path: "gno.land/r/x/dao", func: "Do", args: ["100 \u05D0 5"] } }
        await act(async () => { void captured.cb!([call], "memo \u05D0 1") })
        for (const el of [screen.getByText("100 \u05D0 5", { selector: ".tx-confirm-arg" }), screen.getByText(CALLER, { selector: ".tx-confirm-addr" }), screen.getByText("memo \u05D0 1")]) {
            expect(el).toHaveAttribute("dir", "ltr")
            expect(el).toHaveClass("signing-text")
        }
    })

    it("recognises an address split by a Hangul filler or a variation selector, and reveals it", async () => {
        const split = `${TARGET.slice(0, 20)}\u3164${TARGET.slice(20)}\uFE0F`
        await open(["x".repeat(70) + split])
        expect(screen.getByText("x".repeat(70) + `${TARGET.slice(0, 20)}[U+3164]${TARGET.slice(20)}[U+FE0F]`, { selector: ".tx-confirm-arg" })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Show full argument" })).not.toBeInTheDocument()
    })
})

