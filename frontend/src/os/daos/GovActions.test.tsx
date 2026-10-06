import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import native from "../../lib/dao/testdata/memba-gov/native.json"
import type { GovProposal, GovRoster } from "../../lib/dao/membaGov"
import type { SignRequest } from "../sign/signer"
import type { OsSession } from "../shell/useOsSession"

const sign = vi.fn<(req: SignRequest) => boolean>(() => true)
vi.mock("../sign/signerContext", () => ({ useSigner: () => ({ sign, version: 0 }) }))
vi.mock("./sheetFee", async (original) => ({ ...(await original<typeof import("./sheetFee")>()), quoteSheetGasPrice: vi.fn(async () => ({ gas: 1000, ugnot: 1 })) }))
vi.mock("../../lib/dao/membaGov", async (original) => ({
    ...(await original<typeof import("../../lib/dao/membaGov")>()),
    bridgePublished: vi.fn(() => true), readGovProposal: vi.fn(), readGovSnapshot: vi.fn(), readBridgeApproval: vi.fn(), readBridgePauses: vi.fn(),
}))
vi.mock("../../lib/grc20", async (original) => ({ ...(await original<typeof import("../../lib/grc20")>()), assertFeeStillCovers: vi.fn(async () => {}) }))
const { EmergencyPauses, JoinAction, ProposalActions } = await import("./GovActions")
const { readBridgeApproval, readBridgePauses, readGovProposal, readGovSnapshot } = await import("../../lib/dao/membaGov")

const ZX = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", MIKAEL = "g1lyejwwmxef5tn8nx69saykmgm8rlr4xq9yeh3z"
const roster = native.roster as GovRoster
const proposals = [...native.page0.proposals, ...native.page22.proposals] as GovProposal[]
const find = (action: string) => proposals.find((p) => p.action === action)!
// Open for weeks from now: the testdata's own times are the test chain's.
const live = (p: GovProposal, extra: Partial<GovProposal> = {}): GovProposal => ({ ...p, deadline: String(Math.floor(Date.now() / 1000) + 86400), ...extra })
const guest = { status: "guest", address: "", openConnect: vi.fn() } as unknown as OsSession
const member = (address: string) => ({ ...guest, status: "member", address }) as unknown as OsSession
const show = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const lastRequest = () => sign.mock.calls.at(-1)![0]

beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(readGovSnapshot).mockResolvedValue({ roster, page: { total: "0", proposals: [] }, constants: native.const })
})

describe("voting on memba_gov", () => {
    it("offers a guest Connect, and a key without a seat nothing to sign", () => {
        const view = show(<ProposalActions p={live(find("memba_market_config.SetFee"))} roster={roster} session={guest} raw={false} />)
        fireEvent.click(screen.getByRole("button", { name: "Connect to vote" }))
        expect(guest.openConnect).toHaveBeenCalled()
        view.unmount()
        show(<ProposalActions p={live(find("memba_market_config.SetFee"))} roster={roster} session={member(MIKAEL)} raw={false} />)
        expect(screen.getByText(/Only seated members vote/)).toBeInTheDocument()
        expect(screen.queryByRole("button")).toBeNull()
    })

    it("signs exactly the vote reviewed", async () => {
        show(<ProposalActions p={live(find("memba_market_config.SetFee"))} roster={roster} session={member(ZX)} raw={false} />)
        fireEvent.click(screen.getByRole("button", { name: "Vote NO…" }))
        await waitFor(() => expect(sign).toHaveBeenCalled())
        const req = lastRequest()
        expect(req.prepare(undefined).msgs[0].value).toMatchObject({ func: "Vote", args: [find("memba_market_config.SetFee").id, "no"] })
        expect(req.acks).toEqual([])
        expect(req.receipt?.operation).toBe(`vote:${find("memba_market_config.SetFee").id}`)
    })

    it("never offers a one-click YES on an action Memba cannot read", async () => {
        const raw = live(find("x.Op"))
        show(<ProposalActions p={raw} roster={roster} session={member(ZX)} raw />)
        const yes = screen.getByRole("button", { name: "Vote YES…" })
        expect(yes).toBeDisabled()
        expect(screen.getByRole("button", { name: "Vote NO…" })).toBeEnabled()
        fireEvent.click(screen.getByRole("checkbox", { name: /I have read the code of gno.land\/r\/samcrew\/govtest\/app/ }))
        fireEvent.click(yes)
        await waitFor(() => expect(sign).toHaveBeenCalled())
        expect(lastRequest().acks).toEqual(["I have read the code of gno.land/r/samcrew/govtest/app. Memba cannot read this action; if it passes, it runs exactly as shown."])
    })

    it("after the deadline only lets a YES be withdrawn", () => {
        const closed = { ...find("memba_market_config.SetFee"), deadline: "1" }
        const view = show(<ProposalActions p={{ ...closed, ballots: [{ person: "zxxma", vote: "yes", since: "5" }] }} roster={roster} session={member(ZX)} raw={false} />)
        expect(screen.getByRole("button", { name: "Withdraw your YES…" })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /^Vote / })).toBeNull()
        view.unmount()
        show(<ProposalActions p={closed} roster={roster} session={member(ZX)} raw={false} />)
        expect(screen.queryByRole("button")).toBeNull()
    })
})

describe("executing a memba_gov proposal", () => {
    const ready = (p: GovProposal) => live(p, { status: "ready" })

    it("runs an app action through its bridge entrypoint, and stops if the app changed since the vote", async () => {
        const fee = ready(find("memba_market_config.SetFee"))
        show(<ProposalActions p={fee} roster={roster} session={member(ZX)} raw={false} />)
        fireEvent.click(screen.getByRole("button", { name: "Execute…" }))
        await waitFor(() => expect(sign).toHaveBeenCalled())
        const req = lastRequest()
        expect(req.prepare(undefined).msgs[0].value).toMatchObject({ pkg_path: "gno.land/r/samcrew/memba_bridge_v1", func: "SetFee", args: [fee.id, "service", "300"] })
        vi.mocked(readGovProposal).mockResolvedValue(fee)
        vi.mocked(readBridgeApproval).mockResolvedValue(native.approval as never)
        await expect(req.recheck!(undefined)).resolves.toBeUndefined()
        expect(readBridgeApproval).toHaveBeenCalledWith(expect.anything(), "s:6:SetFee|s:7:service|i:300")
        vi.mocked(readBridgeApproval).mockResolvedValue({ ...native.approval, args: "s:7:service|i:300|i:250|u:1" } as never)
        await expect(req.recheck!(undefined)).rejects.toThrow("The app changed since the vote")
    })

    it("offers no Execute for a proposal that can never run, nor for one its own realm executes", () => {
        const view = show(<ProposalActions p={ready({ ...find("memba_market_config.SetFee"), scope: "bogus" })} roster={roster} session={member(ZX)} raw={false} />)
        expect(screen.queryByRole("button", { name: "Execute…" })).toBeNull()
        view.unmount()
        show(<ProposalActions p={ready(find("x.Op"))} roster={roster} session={member(ZX)} raw />)
        expect(screen.queryByRole("button", { name: "Execute…" })).toBeNull()
        expect(screen.getByText(/its target realm runs it when called/)).toBeInTheDocument()
    })
})

describe("joining and pausing", () => {
    it("lets an invited key join, and nobody else", async () => {
        const view = show(<JoinAction roster={roster} session={member(ZX)} />)
        expect(screen.queryByRole("button")).toBeNull()
        view.unmount()
        show(<JoinAction roster={roster} session={member(MIKAEL)} />)
        fireEvent.click(screen.getByRole("button", { name: "Join as mikael…" }))
        await waitFor(() => expect(sign).toHaveBeenCalled())
        expect(lastRequest().prepare(undefined).msgs[0].value).toMatchObject({ func: "Join", caller: MIKAEL })
        expect(lastRequest().warns).toEqual(["Joining ends every open proposal: members vote again on the new roster."])
    })

    it("lets a seated member pause an app, and anyone connected end a pause that is over", async () => {
        const now = Math.floor(Date.now() / 1000)
        vi.mocked(readBridgePauses).mockResolvedValue({ escrow_v4: 0, memba_appstore_v3: now + 3600, memba_arcade_leaderboard_v1: 1, gnobuilders_badges_v2: 0, memba_feed_v1: 0, memba_dao_channels_v2: 0, memba_feedback_v2: 0 })
        const view = show(<EmergencyPauses roster={roster} session={member(ZX)} />)
        expect(await screen.findAllByRole("button", { name: "Pause…" })).toHaveLength(5)
        expect(screen.getByText(/Paused until/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "End the pause…" }))
        await waitFor(() => expect(sign).toHaveBeenCalled())
        expect(lastRequest().prepare(undefined).msgs[0].value).toMatchObject({ func: "ExpirePause", args: ["memba_arcade_leaderboard_v1"] })
        view.unmount()
        show(<EmergencyPauses roster={roster} session={member(MIKAEL)} />)
        expect(await screen.findByRole("button", { name: "End the pause…" })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Pause…" })).toBeNull()
    })
})
