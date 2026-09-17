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
