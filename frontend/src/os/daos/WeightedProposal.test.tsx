import { fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { weightedConfigSchema, weightedMembersSchema, weightedPageSchema, type WeightedBallot, type WeightedSnapshot } from "../../lib/dao/weighted"
import { weightedFixture } from "../../lib/dao/testdata/weighted"
import v12Native from "../../lib/dao/testdata/weighted-v12/native.json"
import { renderWithProviders } from "../../test/test-utils"
import type { OsSession } from "../shell/useOsSession"

vi.mock("../../lib/dao/weighted", async original => ({ ...(await original<typeof import("../../lib/dao/weighted")>()), readWeightedSnapshot: vi.fn(), readWeightedBallot: vi.fn() }))
const { WeightedProposalWindow } = await import("./WeightedProposal")
const { readWeightedBallot, readWeightedSnapshot } = await import("../../lib/dao/weighted")

const MEMBA_DAO = "gno.land/r/samcrew/memba_dao"
const r = v12Native.records
const v12 = (page: "proposals_page_1" | "proposals_page_2" = "proposals_page_1") =>
    ({ config: weightedConfigSchema.parse(r.config), members: weightedMembersSchema.parse(r.members).members, page: weightedPageSchema.parse(r[page]) }) as WeightedSnapshot
const openConnect = vi.fn()
const guest = { status: "guest", address: "", network: { key: "mainnet" }, openConnect } as unknown as OsSession
const as = (address: string) => ({ ...guest, status: "member", address }) as unknown as OsSession
const MIKAEL = "g1lyejwwmxef5tn8nx69saykmgm8rlr4xq9yeh3z"
const show = (id: string, session = guest) => renderWithProviders(<WeightedProposalWindow realmPath={MEMBA_DAO} id={id} session={session} />)
const pagesRead = () => vi.mocked(readWeightedSnapshot).mock.calls.map((call) => call[1])
const ballot = (over: Partial<WeightedBallot>): WeightedBallot => ({ schema: "memba-weighted-host/v12", proposalId: "17", voter: MIKAEL, eligible: true, choice: null, votedAtHeight: null, ...over })

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readWeightedSnapshot).mockImplementation(async (_ctx, before = "0") => v12(before === "0" ? "proposals_page_1" : "proposals_page_2"))
    vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, voter) => ballot({ proposalId, voter }))
})

describe("a weighted DAO proposal window", () => {
    it("shows what the proposal does, where its vote stands and what executing it costs the others", async () => {
        show("17")
        expect(await screen.findByRole("heading", { name: "#17 Market config · set-fee" })).toBeInTheDocument()
        expect(screen.getByText("Ready to execute")).toBeInTheDocument()
        expect(screen.getByText("Financial decision")).toBeInTheDocument()
        expect(screen.getByText(/^Proposed by mikael on /)).toBeInTheDocument()
        // The first match is the proposal's own fact; the frozen target state repeats some labels below.
        const facts = (label: string) => screen.getAllByText(label)[0].nextElementSibling!
        expect(facts("Target realm")).toHaveTextContent("gno.land/r/samcrew/memba_market_config")
        expect(facts("lane")).toHaveTextContent("service")
        expect(facts("bps")).toHaveTextContent("150")
        expect(screen.getByText("Points voting yes").parentElement!).toHaveTextContent("5 of 8")
        expect(screen.getByText("People voting yes").parentElement!).toHaveTextContent("4 of 7")
        expect(screen.getByText("Developers voting yes").parentElement!).toHaveTextContent("3 of 6")
        expect(screen.getByText("Financial proposals can execute as soon as they pass.")).toBeInTheDocument()
        expect(screen.getByText("Executing this proposal invalidates every other outstanding proposal.")).toBeInTheDocument()
        expect(facts("Voting closes").querySelector("time")).toHaveAttribute("dateTime", v12().page.proposals.find((p) => p.id === "17")!.votingDeadline)
        const frozen = screen.getByText("State frozen at proposal time").closest("details")!
        expect(within(frozen).getByText("treasury").nextElementSibling!).toHaveTextContent("g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf")
        expect(pagesRead()).toEqual(["0"])
    })

    it("lets a guest read everything and asks to connect only to act", async () => {
        show("17")
        fireEvent.click(await screen.findByRole("button", { name: "Connect" }))
        expect(openConnect).toHaveBeenCalledTimes(1)
        expect(screen.getByText("Seat holders vote on it or execute it. Connect a wallet to act.")).toBeInTheDocument()
        expect(readWeightedBallot).not.toHaveBeenCalled()
        expect(screen.queryByText(/^You /)).toBeNull()
    })

    it("shows a seat holder their own ballot", async () => {
        vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, voter) => ballot({ proposalId, voter, choice: "yes", votedAtHeight: "283" }))
        show("17", as(MIKAEL))
        expect(await screen.findByText("You voted yes (block 283).")).toBeInTheDocument()
        expect(screen.getByText("From the workspace in this DAO's Proposals section, you can vote on it or execute it.")).toBeInTheDocument()
        expect(readWeightedBallot).toHaveBeenCalledWith(expect.objectContaining({ realmPath: MEMBA_DAO }), "17", MIKAEL, expect.anything())
        expect(screen.queryByRole("button", { name: "Connect" })).toBeNull()
    })

    it("tells a connected account without a seat why it can only read", async () => {
        const outsider = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
        vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, voter) => ballot({ proposalId, voter, eligible: false }))
        show("17", as(outsider))
        expect(await screen.findByText("Your address holds none of this DAO's seats, so you can read this proposal but not act on it.")).toBeInTheDocument()
        expect(await screen.findByText("Your address is not eligible to vote on this proposal.")).toBeInTheDocument()
    })

    it("offers a seat holder the frozen electorate leaves out only the execution", async () => {
        vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, voter) => ballot({ proposalId, voter, eligible: false }))
        show("17", as(MIKAEL))
        expect(await screen.findByText("Your address is not eligible to vote on this proposal.")).toBeInTheDocument()
        expect(screen.getByText("From the workspace in this DAO's Proposals section, you can execute it.")).toBeInTheDocument()
    })

    it("offers no vote once voting is over, only what is left to do", async () => {
        const data = v12()
        const at = data.page.proposals.findIndex((p) => p.id === "26")
        data.page.proposals[at] = { ...data.page.proposals[at], votingClosed: true } as typeof data.page.proposals[number]
        vi.mocked(readWeightedSnapshot).mockImplementation(async () => data)
        show("26", as(MIKAEL))
        expect(await screen.findByText("From the workspace in this DAO's Proposals section, you can execute it once it can.")).toBeInTheDocument()
        expect(screen.getByText("Voting closed")).toBeInTheDocument()
        expect(screen.queryByText(/vote on it/)).toBeNull()
    })

    it("says voting is over for a proposal executed before its deadline, not when it would close", async () => {
        const data = v12()
        const at = data.page.proposals.findIndex((p) => p.id === "13")
        data.page.proposals[at] = { ...data.page.proposals[at], votingClosed: false } as typeof data.page.proposals[number]
        vi.mocked(readWeightedSnapshot).mockImplementation(async () => data)
        show("13", as(MIKAEL))
        expect(await screen.findByText("Over (the proposal is executed)")).toBeInTheDocument()
        expect(screen.queryByText(/^Voting clos/)).toBeNull()
        expect(screen.queryByText(/workspace/)).toBeNull()
    })

    it("reads no ballot from a contract version that publishes none", async () => {
        const v2 = weightedFixture(2)
        vi.mocked(readWeightedSnapshot).mockImplementation(async () => ({ config: weightedConfigSchema.parse(v2.config), members: v2.members, page: weightedPageSchema.parse(v2.page) }) as WeightedSnapshot)
        show("1", as(v2.members[1].address))
        expect(await screen.findByRole("heading", { name: "#1 Grant admin" })).toBeInTheDocument()
        // An older version at the released DAO's address is not the release: it stays held.
        expect(screen.getByText(/^This DAO is read-only in Memba on gnoland-1/)).toBeInTheDocument()
        expect(readWeightedBallot).not.toHaveBeenCalled()
        expect(screen.queryByText(/^You /)).toBeNull()
    })

    it("says a ballot could not be read rather than that the member has not voted", async () => {
        vi.mocked(readWeightedBallot).mockRejectedValue(new Error("DAO read failed"))
        show("17", as(MIKAEL))
        expect(await screen.findByText("Your ballot could not be read.")).toBeInTheDocument()
    })

    it("reads an older proposal from the page that starts at it, and explains why it was invalidated", async () => {
        show("2")
        expect(await screen.findByRole("heading", { name: "#2 Grant admin" })).toBeInTheDocument()
        expect(pagesRead()).toEqual(["0", "3"])
        expect(screen.getByText("Invalidated at block 127: proposal #4 executed (gno.land/r/samcrew/memba_market_config).")).toBeInTheDocument()
        expect(screen.getByText("Historical vote totals are unavailable.")).toBeInTheDocument()
        expect(screen.queryByText("Executing this proposal invalidates every other outstanding proposal.")).toBeNull()
        // A proposal that is over has no acting step: nobody is asked to connect for it.
        expect(screen.queryByRole("button", { name: "Connect" })).toBeNull()
        expect(screen.queryByText(/Connect a wallet to act/)).toBeNull()
    })

    it("retries the older page when its read fails", async () => {
        vi.mocked(readWeightedSnapshot).mockImplementation(async (_ctx, before = "0") => {
            if (before !== "0" && pagesRead().filter((cursor) => cursor === before).length === 1) throw new Error("DAO read failed")
            return v12(before === "0" ? "proposals_page_1" : "proposals_page_2")
        })
        show("2")
        expect(await screen.findByRole("alert")).toHaveTextContent("DAO read failed")
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByRole("heading", { name: "#2 Grant admin" })).toBeInTheDocument()
        expect(pagesRead()).toEqual(["0", "3", "3"])
    })

    it("on a DAO held read-only, says so instead of pointing to a workspace or asking to connect", async () => {
        const other = "gno.land/r/samcrew/memba_dao_v2"
        vi.mocked(readWeightedSnapshot).mockImplementation(async () => ({ ...v12(), config: { ...v12().config, realmPath: other } }))
        const held = "This DAO is read-only in Memba on gnoland-1: Memba builds no governance transaction for it here."
        const seat = renderWithProviders(<WeightedProposalWindow realmPath={other} id="17" session={as(MIKAEL)} />)
        expect(await screen.findByText(held)).toBeInTheDocument()
        expect(screen.queryByText(/workspace/)).toBeNull()
        seat.unmount()
        renderWithProviders(<WeightedProposalWindow realmPath={other} id="17" session={guest} />)
        expect(await screen.findByText(held)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Connect" })).toBeNull()
    })

    it("asks nothing of a session that is still resuming", async () => {
        show("17", { ...guest, status: "resuming" } as unknown as OsSession)
        expect(await screen.findByRole("heading", { name: "#17 Market config · set-fee" })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Connect" })).toBeNull()
        expect(readWeightedBallot).not.toHaveBeenCalled()
    })

    it("never shows one wallet's ballot to another", async () => {
        const GHOST = "g12yg9nh4ncma44emgm8msxe8aavzywt0p95tanv"
        vi.mocked(readWeightedBallot).mockImplementation(async (_ctx, proposalId, voter) => ballot({ proposalId, voter, ...(voter === MIKAEL ? { choice: "yes" as const, votedAtHeight: "283" } : {}) }))
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const ui = (address: string) => <QueryClientProvider client={client}><WeightedProposalWindow realmPath={MEMBA_DAO} id="17" session={as(address)} /></QueryClientProvider>
        const view = render(ui(MIKAEL))
        expect(await screen.findByText("You voted yes (block 283).")).toBeInTheDocument()
        view.rerender(ui(GHOST))
        expect(await screen.findByText("You have not voted.")).toBeInTheDocument()
        expect(screen.queryByText(/You voted yes/)).toBeNull()
        expect(readWeightedBallot).toHaveBeenLastCalledWith(expect.anything(), "17", GHOST, expect.anything())
    })

    it("reads the newest proposal from the newest page only", async () => {
        show("26")
        expect(await screen.findByRole("heading", { name: "#26 Feedback · create-text-channel" })).toBeInTheDocument()
        expect(screen.getByText("It passed. It can execute from the earliest time below.")).toBeInTheDocument()
        expect(screen.getByText("Executable from (points vote)")).toBeInTheDocument()
        expect(screen.getByText("Executable from (developers' vote)")).toBeInTheDocument()
        expect(pagesRead()).toEqual(["0"])
    })

    it("says a number the DAO has not reached does not exist, without asking the chain for it", async () => {
        show("99")
        expect(await screen.findByText("This DAO has no proposal #99.")).toBeInTheDocument()
        expect(pagesRead()).toEqual(["0"])
    })

    it("names the member and the change of a role proposal, and both addresses of a key recovery", async () => {
        show("15")
        expect(await screen.findByRole("heading", { name: "#15 Grant admin" })).toBeInTheDocument()
        expect(screen.getByText("Member").nextElementSibling!).toHaveTextContent("ghost")
        expect(screen.getByText("Change").nextElementSibling!).toHaveTextContent("Grant the admin role")
        show("16")
        expect(await screen.findByRole("heading", { name: "#16 Recover member key" })).toBeInTheDocument()
        expect(screen.getByText("Old address").nextElementSibling!).toHaveTextContent("g1jjeuv48j3pmsmnvga8jwfnc2amfyv9c30zx04y")
        expect(screen.getByText("Replacement address").nextElementSibling!).toHaveTextContent("g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqquyl3wcje")
        expect(screen.getByText("The person keeps their identity, voting weight and roles; only the address changes.")).toBeInTheDocument()
    })

    it("shows a proposal Memba cannot validate by its number only", async () => {
        const data = v12()
        data.page.proposals[3] = { id: "23", unreadable: true }
        vi.mocked(readWeightedSnapshot).mockImplementation(async () => data)
        show("23", as(MIKAEL))
        expect(await screen.findByRole("heading", { name: "Unreadable proposal #23" })).toBeInTheDocument()
        expect(readWeightedBallot).not.toHaveBeenCalled()
    })

    it("shows a failed read as an error with a retry", async () => {
        vi.mocked(readWeightedSnapshot).mockRejectedValueOnce(new Error("RPC network does not match the selected chain"))
        show("17")
        expect(await screen.findByRole("alert")).toHaveTextContent("RPC network does not match the selected chain")
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByRole("heading", { name: "#17 Market config · set-fee" })).toBeInTheDocument()
    })
})
