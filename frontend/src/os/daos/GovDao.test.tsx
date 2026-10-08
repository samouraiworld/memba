import { fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import native from "../../lib/dao/testdata/memba-gov/native.json"
import type { GovProposal, GovSnapshot } from "../../lib/dao/membaGov"
import type { DaoSection } from "../shell/osPath"
import type { OsSession } from "../shell/useOsSession"

vi.mock("../sign/signerContext", () => ({ useSigner: () => ({ sign: vi.fn(), version: 0 }) }))
vi.mock("../../lib/dao/membaGov", async original => ({
    ...(await original<typeof import("../../lib/dao/membaGov")>()),
    govPublished: vi.fn(() => true), readGovSnapshot: vi.fn(), readGovRoster: vi.fn(), readGovProposal: vi.fn(), readTargetManifest: vi.fn(),
}))
const { DaoFolder, DaosApp, ProposalWindow } = await import("./DaoWindows")
const { GovNotFound, govPublished, readGovProposal, readGovRoster, readGovSnapshot, readTargetManifest } = await import("../../lib/dao/membaGov")

const NAME = "samcrew.memba_gov"
const proposals = [...native.page0.proposals, ...native.page22.proposals] as GovProposal[]
const byAction = (action: string) => proposals.find((p) => p.action === action)!
const snapshot = (before = "0"): GovSnapshot => ({
    roster: structuredClone(native.roster) as GovSnapshot["roster"], constants: native.const,
    page: { total: native.page0.total, proposals: (before === "0" ? native.page0 : native.page22).proposals as GovProposal[] },
})
const guest = { status: "guest", address: "", network: { key: "onyx" }, openConnect: vi.fn() } as unknown as OsSession
const as = (address: string) => ({ ...guest, status: "member", address }) as unknown as OsSession
const open = vi.fn()

function show(ui: ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
const folder = (section: DaoSection, session = guest) => show(<DaoFolder name={NAME} section={section} open={open} session={session} />)
const proposal = (p: GovProposal) => {
    vi.mocked(readGovProposal).mockResolvedValue(p)
    return show(<ProposalWindow dao={NAME} n={Number(p.id)} session={guest} open={open} />)
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(govPublished).mockReturnValue(true)
    vi.mocked(readGovSnapshot).mockImplementation(async (_ctx, before = "0") => snapshot(before))
    vi.mocked(readTargetManifest).mockResolvedValue("public")
    vi.mocked(readGovRoster).mockImplementation(async () => snapshot().roster)
})

describe("Memba DAO on memba_gov", () => {
    it("is not read, and says so, where its publication is not recorded", () => {
        vi.mocked(govPublished).mockReturnValue(false)
        folder("overview")
        expect(screen.getByText(/Memba DAO's new governance is not on/)).toBeInTheDocument()
        expect(readGovSnapshot).not.toHaveBeenCalled()
        show(<DaosApp open={open} />)
        expect(screen.getByText("gno.land/r/samcrew/memba_dao")).toBeInTheDocument()
    })

    it("is the featured Memba DAO once published", () => {
        show(<DaosApp open={open} />)
        expect(screen.getByText("gno.land/r/samcrew/memba_gov")).toBeInTheDocument()
        expect(screen.queryByText("gno.land/r/samcrew/memba_dao")).toBeNull()
    })

    it("shows a guest the rules, from the realm's constants, and the open proposals", async () => {
        folder("overview")
        expect(await screen.findByText(/5 seated, total weight 6/)).toBeInTheDocument()
        expect(screen.getByText(/then 1 day; or at least 2\/3 of the people and more than half of the weight, then 3 days/)).toBeInTheDocument()
        expect(screen.getByText(/Voting lasts 7 days/)).toBeInTheDocument()
        expect(screen.getByText(/for 180 days can be removed by a routine vote after 14 days/)).toBeInTheDocument()
        expect(screen.getByText("20 open among the latest 20 of 42.")).toBeInTheDocument()
        expect(screen.queryByText(/You sit as|holds no seat/)).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: /#42 Revoke an invitation/ }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "proposal", dao: NAME, n: 42 } }))
    })

    it("tells a member their seat, and an invited key that it counts once it joins", async () => {
        folder("overview", as("g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"))
        expect(await screen.findByText("zxxma")).toBeInTheDocument()
        folder("overview", as("g12yg9nh4ncma44emgm8msxe8aavzywt0p95tanv"))
        expect(await screen.findByText(/It counts once it signs Join/)).toBeInTheDocument()
    })

    it("pages through proposals and names the unknown one as such", async () => {
        folder("proposals")
        const unknown = await screen.findByRole("button", { name: /#38 Unknown action x\.Op on gno\.land\/r\/samcrew\/govtest\/app/ })
        expect(within(unknown).getByText("Voting")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /#36 App Store · Curate an App Store listing/ })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Older" }))
        expect(await screen.findByRole("button", { name: /#21 / })).toBeInTheDocument()
        expect(readGovSnapshot).toHaveBeenLastCalledWith(expect.anything(), "23", expect.anything())
        fireEvent.click(screen.getByRole("button", { name: "Newest" }))
        expect(await screen.findByRole("button", { name: /#42 / })).toBeInTheDocument()
    })

    it("offers proposing to seated members only, and Connect to a guest", async () => {
        const view = folder("proposals")
        fireEvent.click(await screen.findByRole("button", { name: "Connect to propose" }))
        expect(guest.openConnect).toHaveBeenCalled()
        view.unmount()
        const seated = folder("proposals", as("g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"))
        expect(await screen.findByRole("button", { name: "New proposal…" })).toBeInTheDocument()
        seated.unmount()
        folder("proposals", as("g12yg9nh4ncma44emgm8msxe8aavzywt0p95tanv")) // invited, not seated
        expect(await screen.findByText("Only seated members propose.")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "New proposal…" })).toBeNull()
    })

    it("lists seats with their weight and the open invitations", async () => {
        folder("members")
        expect(await screen.findByText("g1rayfgklwl0aspz488wvrcrvt7t2quy6q06lgk2")).toBeInTheDocument()
        expect(screen.getByText("mikael")).toBeInTheDocument()
        expect(screen.getByText("ghost")).toBeInTheDocument()
        expect(screen.getByText(/An invited key counts only once it signs Join/)).toBeInTheDocument()
    })
})

describe("a memba_gov proposal", () => {
    it("names every value an approval is bound to", async () => {
        proposal(proposals.find((p) => p.action === "escrow_v4.ResolveDispute" && p.args.includes("|b:0|"))!)
        expect(await screen.findByText(/Escrow · Settle an escrow dispute/)).toBeInTheDocument()
        expect(screen.getByText("Platform fee")).toBeInTheDocument()
        expect(screen.getByText("1 GNOT")).toBeInTheDocument()
        expect(screen.getByText(/\(the bridge that governs the Memba apps\)/)).toBeInTheDocument()
        expect(screen.queryByText(/Memba cannot read this action/)).toBeNull()
        expect(readTargetManifest).not.toHaveBeenCalled()
    })

    it("says a proposal filed below its action's class can never execute", async () => {
        proposal({ ...byAction("memba_market_config.SetFee"), class: 1 })
        expect(await screen.findByRole("alert")).toHaveTextContent("This proposal can never execute. It is filed as Routine, below the Financial class this action needs.")
    })

    it("shows a decoded proposal's scope, and says it can never execute when the scope is not the bridge's", async () => {
        proposal({ ...byAction("memba_market_config.SetFee"), scope: "memba_market_config/bogus" })
        expect(await screen.findByRole("alert")).toHaveTextContent('Its scope "memba_market_config/bogus" is not the "memba_market_config" the bridge checks.')
        expect(screen.getByText("memba_market_config/bogus")).toBeInTheDocument()
    })

    it("says there is no such proposal", async () => {
        vi.mocked(readGovProposal).mockRejectedValue(new GovNotFound("99"))
        show(<ProposalWindow dao={NAME} n={99} session={guest} open={open} />)
        expect(await screen.findByText("Memba DAO has no proposal #99.")).toBeInTheDocument()
    })

    it("shows an unknown action raw, with the proposer's note apart, and flags a private or missing target", async () => {
        const raw = byAction("x.Op")
        vi.mocked(readTargetManifest).mockResolvedValue("private")
        const view = proposal(raw)
        expect(await screen.findByText(/Memba cannot read this action/)).toBeInTheDocument()
        expect(screen.getByText("u:7")).toBeInTheDocument()
        expect(await screen.findByText(/its creator can replace its code/)).toBeInTheDocument()
        expect(screen.getByText("an app memba does not know")).toBeInTheDocument()
        expect(screen.getByText(/nothing checks them against the action above/)).toBeInTheDocument()
        view.unmount()
        vi.mocked(readTargetManifest).mockResolvedValue("absent")
        proposal(raw)
        expect(await screen.findByText(/No realm is published at this address on .* now\. One could be published there later/)).toBeInTheDocument()
    })

    it("counts YES by people and weight", async () => {
        proposal(native.one as GovProposal)
        expect(await screen.findByText("YES: 3 of 5 people, weight 4 of 6.")).toBeInTheDocument()
    })
})
