import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import native from "../../lib/dao/testdata/memba-gov/native.json"
import type { SignRequest } from "../sign/signer"
import type { OsSession } from "../shell/useOsSession"

const sign = vi.fn<(req: SignRequest) => boolean>(() => true)
vi.mock("../sign/signerContext", () => ({ useSigner: () => ({ sign, version: 0 }) }))
vi.mock("./sheetFee", async (original) => ({ ...(await original<typeof import("./sheetFee")>()), quoteSheetGasPrice: vi.fn(async () => ({ gas: 1000, ugnot: 1 })) }))
vi.mock("../../lib/dao/membaGov", async (original) => ({
    ...(await original<typeof import("../../lib/dao/membaGov")>()),
    bridgePublished: vi.fn(() => true), readBridgeApproval: vi.fn(), readGovSnapshot: vi.fn(),
}))
vi.mock("../../lib/grc20", async (original) => ({ ...(await original<typeof import("../../lib/grc20")>()), assertFeeStillCovers: vi.fn(async () => {}) }))
const { ProposeForm } = await import("./GovPropose")
const { readBridgeApproval, readGovSnapshot } = await import("../../lib/dao/membaGov")

const ZX = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", NEW = "g1v3addmckxxdzjf9mgawecushq7w66pq0lldjgk"
const me = { status: "member", address: ZX, openConnect: vi.fn() } as unknown as OsSession
const show = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(readGovSnapshot).mockResolvedValue({ roster: native.roster, page: { total: "0", proposals: [] }, constants: native.const } as never)
})

describe("proposing on Memba DAO", () => {
    it("encodes a roster change, shows it decoded with its fixed class, and signs exactly that", async () => {
        show(<ProposeForm session={me} onClose={vi.fn()} />)
        choose("About", "roster")
        choose("Action", "AddMember")
        type("Person id (a-z, 0-9, _ or -)", "nina")
        type("Key", NEW)
        choose("Weight", "2")
        type("Your note (optional, shown labelled as yours)", "welcome")
        fireEvent.click(screen.getByRole("button", { name: "Review" }))
        expect(await screen.findByText("Invite a new member", { selector: "b" })).toBeInTheDocument()
        expect(screen.getByText("Critical (fixed for roster changes)")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Propose…" }))
        await waitFor(() => expect(sign).toHaveBeenCalled())
        expect(sign.mock.calls[0][0].prepare(undefined).msgs[0].value).toMatchObject({
            func: "Propose", args: ["gno.land/r/samcrew/memba_gov", "AddMember", `s:4:nina|a:${NEW}|u:2`, "", "3", "welcome"],
        })
    })

    it("files an app action exactly as the bridge answers, at its minimum class or higher", async () => {
        vi.mocked(readBridgeApproval).mockResolvedValue(native.approval as never)
        show(<ProposeForm session={me} onClose={vi.fn()} />)
        choose("About", "memba_market_config")
        choose("Action", "SetFee")
        type("Lane", "service")
        type("New fee", "300")
        fireEvent.click(screen.getByRole("button", { name: "Review" }))
        expect(await screen.findByText("Market config · Set a market fee")).toBeInTheDocument()
        expect(readBridgeApproval).toHaveBeenCalledWith(expect.anything(), "s:6:SetFee|s:7:service|i:300")
        expect(screen.getByText("2% (200 bps)")).toBeInTheDocument() // the fee now, read by the bridge
        expect([...screen.getByLabelText<HTMLSelectElement>("Class").options].map((o) => o.text)).toEqual(["Financial", "Critical"])
        choose("Class", "3")
        fireEvent.click(screen.getByRole("button", { name: "Propose…" }))
        await waitFor(() => expect(sign).toHaveBeenCalled())
        const req = sign.mock.calls[0][0]
        expect(req.prepare(undefined).msgs[0].value).toMatchObject({ args: ["gno.land/r/samcrew/memba_bridge_v1", "memba_market_config.SetFee", "s:7:service|i:300|i:200|u:1", "memba_market_config", "3", ""] })
        vi.mocked(readBridgeApproval).mockResolvedValue({ ...native.approval, args: "s:7:service|i:300|i:250|u:1" } as never)
        await expect(req.recheck!(undefined)).rejects.toThrow("The app changed while you reviewed")
    })

    it("shows why the bridge refuses a call, and offers nothing to sign", async () => {
        vi.mocked(readBridgeApproval).mockRejectedValue(new Error("The bridge refuses this call: nothing staged to cancel for memba_feed_v1"))
        show(<ProposeForm session={me} onClose={vi.fn()} />)
        choose("About", "memba_feed_v1")
        choose("Action", "CancelTransfer")
        fireEvent.click(screen.getByRole("button", { name: "Review" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("nothing staged to cancel for memba_feed_v1")
        expect(screen.queryByRole("button", { name: "Propose…" })).toBeNull()
    })

    it("converts a GNOT amount to ugnot before asking the bridge", async () => {
        vi.mocked(readBridgeApproval).mockRejectedValue(new Error("stop"))
        show(<ProposeForm session={me} onClose={vi.fn()} />)
        choose("About", "memba_appstore_v3")
        choose("Action", "SetRegistrationFee")
        type("New fee", "1.5")
        fireEvent.click(screen.getByRole("button", { name: "Review" }))
        await waitFor(() => expect(readBridgeApproval).toHaveBeenCalledWith(expect.anything(), "s:18:SetRegistrationFee|i:1500000"))
    })
})
