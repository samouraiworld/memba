import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { weightedConfigSchema, weightedMembersSchema, weightedPageSchema, type WeightedSnapshot } from "../../lib/dao/weighted"
import { weightedFixture } from "../../lib/dao/testdata/weighted"
import v12Native from "../../lib/dao/testdata/weighted-v12/native.json"
import { weightedDaoAddress, type AcceptanceState } from "../../lib/dao/weightedAcceptance"
import { APPLICATION_POLICY_KEYS, type ApplicationPolicyKey } from "../../lib/dao/weightedApplications"
import type { FeeDestination } from "../../lib/dao/weightedTreasury"
import { V12_READ_ONLY, V12_READ_ONLY_OTHER } from "../../lib/dao/weightedView"
import { renderWithProviders } from "../../test/test-utils"
import type { DaoSection } from "../shell/osPath"
import type { OsSession } from "../shell/useOsSession"
import type { OsWindow } from "../shell/windows"

vi.mock("../../lib/config", async original => ({ ...(await original<typeof import("../../lib/config")>()), isFeedEnabled: vi.fn(() => false) }))
vi.mock("./useOsDao", async original => ({
    ...(await original<typeof import("./useOsDao")>()),
    useDaoConfig: vi.fn(() => ({ data: null, isPending: false, isError: false })),
    useDaoProposals: vi.fn(() => ({ data: [], isPending: false, isError: false })),
    useDaoMembers: vi.fn(() => ({ data: [], isPending: false, isError: false })),
}))
vi.mock("../../hooks/useDaoKind", async original => ({ ...(await original<typeof import("../../hooks/useDaoKind")>()), useDaoKind: vi.fn() }))
vi.mock("./ProposeWizard", () => ({ ProposeWizard: ({ dao }: { dao: string }) => <div>wizard for {dao}</div> }))
vi.mock("../../lib/dao/weighted", async original => ({ ...(await original<typeof import("../../lib/dao/weighted")>()), readWeightedSnapshot: vi.fn(), readWeightedBallot: vi.fn() }))
vi.mock("../../lib/dao/weightedAcceptance", async original => ({ ...(await original<typeof import("../../lib/dao/weightedAcceptance")>()), readAcceptanceStates: vi.fn() }))
vi.mock("../../lib/dao/weightedTreasury", async original => ({ ...(await original<typeof import("../../lib/dao/weightedTreasury")>()), readFeeDestinations: vi.fn(), readHeldUgnot: vi.fn() }))
/** What each address holds; an address with no entry is still being read. */
const balances: Record<string, bigint | Error> = {}
const { WindowBody } = await import("../shell/WindowFrame")
// The folder is a lazy chunk of the window frame: loaded here, so a test never waits on its import.
await import("./DaoWindows")
const { WeightedDaoFolder } = await import("./WeightedDaoFolder")
const { useDaoKind } = await import("../../hooks/useDaoKind")
const { useDaoConfig, useDaoMembers, useDaoProposals } = await import("./useOsDao")
const { readWeightedSnapshot } = await import("../../lib/dao/weighted")
const { readAcceptanceStates } = await import("../../lib/dao/weightedAcceptance")
const { readFeeDestinations, readHeldUgnot } = await import("../../lib/dao/weightedTreasury")

const MEMBA_DAO = "gno.land/r/samcrew/memba_dao"
const RESERVE = "g1jw76lxvzjafw2kyjhdnzwggcftyhnlfjaer2u0"
const PUBLISHER = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
const DAO = weightedDaoAddress(MEMBA_DAO)
const r = v12Native.records
const v12 = (page: "proposals_page_1" | "proposals_page_2" | "proposals_empty" = "proposals_page_1") =>
    ({ config: weightedConfigSchema.parse(r.config), members: weightedMembersSchema.parse(r.members).members, page: weightedPageSchema.parse(r[page]) }) as WeightedSnapshot
const guest = { status: "guest", address: "", network: { key: "mainnet" }, layout: { balance: "0" }, openConnect: vi.fn() } as unknown as OsSession
const as = (address: string) => ({ ...guest, status: "member", address }) as unknown as OsSession
const open = vi.fn()
const folderUi = (section: DaoSection, session = guest, realmPath = MEMBA_DAO, name = "memba_dao") =>
    <WeightedDaoFolder name={name} realmPath={realmPath} section={section} open={open} session={session} />
let client: QueryClient
/** Rendered in a query client the test can reach (`rerender` keeps its providers). */
function show(...args: Parameters<typeof folderUi>) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(folderUi(...args), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}
/** Market config is nominated to the DAO; the DAO already controls the other nine. */
const states = (): Partial<Record<ApplicationPolicyKey, AcceptanceState | "error">> =>
    Object.fromEntries(APPLICATION_POLICY_KEYS.map((key) => [key, key === "marketPolicy" ? { kind: "ready", current: PUBLISHER } : { kind: "dao", pending: "" }]))
const fees = (market: string | null, appstore: string | null): FeeDestination[] => [
    { key: "marketPolicy", fees: "Market fees", target: "gno.land/r/samcrew/memba_market_config", policyTreasury: RESERVE, current: market },
    { key: "appstorePolicy", fees: "App Store registration fees", target: "gno.land/r/samcrew/memba_appstore_v3", policyTreasury: RESERVE, current: appstore },
]

beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(balances)) delete balances[key]
    vi.mocked(readWeightedSnapshot).mockImplementation(async (_ctx, before = "0") => v12(before === "0" ? "proposals_page_1" : "proposals_page_2"))
    vi.mocked(readAcceptanceStates).mockImplementation(async () => states())
    vi.mocked(readFeeDestinations).mockImplementation(async () => fees(PUBLISHER, PUBLISHER))
    vi.mocked(readHeldUgnot).mockImplementation((_ctx, address) => {
        const value = balances[address]
        return value === undefined ? new Promise<bigint>(() => {}) : value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
    })
})

describe("a weighted DAO's overview", () => {
    it("states the seats, the points and how each kind of decision passes, from the contract", async () => {
        show("overview")
        expect(await screen.findByText("Memba DAO")).toBeInTheDocument()
        expect(screen.getByText("7 seats · 8 voting points · gnoland-1")).toBeInTheDocument()
        expect(screen.getByText("Role changes, key recoveries, authority handoffs and appointments")).toBeInTheDocument()
        expect(screen.getByText("6 points and at least 4 people, then 24 hours")).toBeInTheDocument()
        expect(screen.getByText(/^or\s*5 developers, then 72 hours$/)).toBeInTheDocument()
        expect(screen.getByText("5 points and at least 3 people, with no delay")).toBeInTheDocument()
        expect(screen.getByText("3 points and at least 2 people, with no delay")).toBeInTheDocument()
        expect(screen.getByText(/Executing any proposal, or any emergency pause, invalidates every other open proposal\./)).toBeInTheDocument()
        // A guest reads all of it, with no note about a seat, and is told the DAO is read-only in Memba.
        expect(screen.queryByText(/Your seat|none of the/)).toBeNull()
        expect(screen.getByText(V12_READ_ONLY)).toBeInTheDocument()
    })

    it("says how many proposals are open, lists the newest three and opens one in its window", async () => {
        show("overview")
        const first = await screen.findByRole("button", { name: /#26 Feedback · Create a channel/ })
        expect(screen.getByText("12 open among the latest 20 proposals. The newest three:")).toBeInTheDocument()
        expect(within(first).getByText("Waiting for its delay")).toBeInTheDocument()
        expect(within(first).getByText("Critical · 7 points · 6 people · 5 developers voting yes")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /#24 Feed · Add a moderator/ })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /#23 / })).toBeNull()
        fireEvent.click(first)
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "proposal", dao: "memba_dao", n: 26 } }))
        fireEvent.click(screen.getByRole("button", { name: "All 26 proposals" }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "dao", name: "memba_dao", section: "proposals" } }))
    })

    it("claims no proposal is closed when one of them could not be read", async () => {
        // The whole history is this one page of six.
        const data = v12("proposals_page_2")
        data.page = { ...data.page, total: "6" }
        data.page.proposals[1] = { id: "5", unreadable: true }
        vi.mocked(readWeightedSnapshot).mockImplementation(async () => data)
        show("overview")
        expect(await screen.findByText("No readable proposal is open; 1 of all 6 proposals could not be read.")).toBeInTheDocument()
    })

    it("says so when the DAO has recorded no proposal", async () => {
        vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12("proposals_empty"))
        show("overview")
        expect(await screen.findByText("None: the DAO has recorded no proposal yet.")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /proposals$/ })).toBeNull()
    })

    it("shows who controls each governed application, in the handoff order", async () => {
        show("overview")
        const apps = await screen.findAllByRole("listitem", { name: /^(Market config|Badges|Feed|Feedback|DAO channels|Reviews|Arcade|Quests|App Store|Escrow)$/ })
        expect(apps.map((li) => li.getAttribute("aria-label"))).toEqual(["Market config", "Badges", "Feed", "Feedback", "DAO channels", "Reviews", "Arcade", "Quests", "App Store", "Escrow"])
        const market = apps[0]
        expect(await within(market).findByText("Ready to accept")).toBeInTheDocument()
        expect(within(market).getByText(/^Current admin:/)).toHaveTextContent("Current admin: g136j0m0…5cpf")
        expect(within(apps[9]).getByText("DAO controls")).toBeInTheDocument()
        expect(screen.getByText(/The DAO controls 9 of 10 today\./)).toBeInTheDocument()
    })

    it("shows each application's rules from the DAO's policy, to a guest too", async () => {
        show("overview")
        const rules = (label: string) => within(screen.getByRole("listitem", { name: label })).getByText("Its rules").closest("details")!
        await screen.findByRole("listitem", { name: "App Store" })
        const config = v12().config
        expect(rules("Market config")).toHaveTextContent(`Financial votes cover fees and the treasury.Handing it back takes a critical vote and goes only to ${config.marketPolicy.successor}, who must accept.`)
        expect(rules("App Store")).toHaveTextContent("Critical votes cover who curates and permanently closing listing imports.Financial votes cover fees and the treasury.Routine votes cover approving, rejecting, delisting and restoring listings, and clearing their flags.While the DAO controls it, any member can pause it at once; unpausing takes a financial vote.A fee vote can set at most 100 GNOT.")
        expect(rules("Reviews")).toHaveTextContent("Routine votes cover hiding reviews and comments and showing them again.")
        expect(rules("Escrow")).toHaveTextContent("Financial votes cover settling disputes (refunding the client or paying the freelancer) and nominating the fallback fee recipient.")
        expect(rules("DAO channels")).toHaveTextContent("Critical votes cover its members, members' roles and creating channels.")
    })

    it("says who is nominated for an application the DAO is not nominated for yet", async () => {
        vi.mocked(readAcceptanceStates).mockImplementation(async () => ({ ...states(), marketPolicy: { kind: "awaiting", current: PUBLISHER, pending: RESERVE }, badgesPolicy: { kind: "awaiting", current: PUBLISHER, pending: "" } }))
        show("overview")
        const market = await screen.findByRole("listitem", { name: "Market config" })
        expect(await within(market).findByText(/^Current admin:/)).toHaveTextContent("Current admin: g136j0m0…5cpf · nominated: g1jw76lx…r2u0")
        expect(within(screen.getByRole("listitem", { name: "Badges" })).getByText(/^Current owner:/)).toHaveTextContent("Current owner: g136j0m0…5cpf · nominated: nobody yet")
    })

    it("keeps the applications' previous read, and says so, when a later read fails", async () => {
        show("overview")
        const market = await screen.findByRole("listitem", { name: "Market config" })
        expect(await within(market).findByText("Ready to accept")).toBeInTheDocument()
        vi.mocked(readAcceptanceStates).mockRejectedValue(new Error("Chain read failed"))
        await act(async () => { await client.refetchQueries({ queryKey: ["dao", "weighted"] }) })
        expect(await screen.findByText("The applications' current owners could not be read again. This is the previous read.")).toBeInTheDocument()
        expect(within(market).getByText("Ready to accept")).toBeInTheDocument()
        expect(screen.queryByText("Not readable")).toBeNull()
    })

    it("marks an application whose owner could not be read, and claims no count from a partial or failed read", async () => {
        vi.mocked(readAcceptanceStates).mockImplementation(async () => ({ ...states(), escrowPolicy: "error" }))
        const partial = show("overview")
        expect(await within(await screen.findByRole("listitem", { name: "Escrow" })).findByText("Not readable")).toBeInTheDocument()
        expect(screen.getByText(/1 of 10 could not be read\./)).toBeInTheDocument()
        expect(screen.queryByText(/The DAO controls/)).toBeNull()
        partial.unmount()
        vi.mocked(readAcceptanceStates).mockRejectedValue(new Error("RPC network does not match the selected chain"))
        show("overview")
        expect(await screen.findByText("The applications' current owners could not be read.")).toBeInTheDocument()
        expect(screen.queryByText(/The DAO controls|\d+ of \d+ could not be read/)).toBeNull()
    })

    it("tells a seat holder their seat and anyone else that they hold none", async () => {
        const data = v12()
        show("overview", as(data.members[1].address))
        expect(await screen.findByText(/^Your seat:/)).toHaveTextContent("Your seat: mikael · Core developer · 1 point · Finance")
        show("overview", as("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"))
        expect(await screen.findByText("Your address holds none of the 7 seats.")).toBeInTheDocument()
    })

    it("offers no acceptance and no connect prompt to a guest, a seat holder or an address without a seat", async () => {
        for (const session of [guest, as(v12().members[1].address), as("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")]) {
            const view = show("overview", session)
            const market = await screen.findByRole("listitem", { name: "Market config" })
            expect(await within(market).findByText("Ready to accept")).toBeInTheDocument()
            expect(screen.getByText(V12_READ_ONLY)).toBeInTheDocument()
            expect(screen.queryByRole("button", { name: /Propose|Connect/ })).toBeNull()
            view.unmount()
        }
        expect(guest.openConnect).not.toHaveBeenCalled()
    })

    it("says another v12 DAO is read-only in Memba without claiming Memba DAO's move", async () => {
        const other = "gno.land/r/samcrew/memba_dao_v2"
        vi.mocked(readWeightedSnapshot).mockImplementation(async () => ({ ...v12(), config: { ...v12().config, realmPath: other } }))
        show("overview", guest, other, "samcrew.memba_dao_v2")
        expect(await screen.findByText(V12_READ_ONLY_OTHER)).toBeInTheDocument()
        expect(screen.queryByText(V12_READ_ONLY)).toBeNull()
        expect(screen.getByText("samcrew.memba_dao_v2")).toBeInTheDocument()
    })

    it("offers only the critical route and no applications for an older contract version", async () => {
        const v1 = weightedFixture(1)
        vi.mocked(readWeightedSnapshot).mockImplementation(async () => ({ config: weightedConfigSchema.parse(v1.config), members: v1.members, page: weightedPageSchema.parse(v1.page) }) as WeightedSnapshot)
        show("overview")
        expect(await screen.findByText("Role changes")).toBeInTheDocument()
        expect(screen.queryByText(/with no delay/)).toBeNull()
        expect(screen.getByText(/Executing any proposal invalidates every other open proposal\./)).toBeInTheDocument()
        expect(screen.queryByText("Applications the DAO governs")).toBeNull()
        expect(readAcceptanceStates).not.toHaveBeenCalled()
        // An older version on gnoland-1 is held, and is not Memba DAO v12.
        expect(screen.getByText("This DAO is read-only in Memba on gnoland-1: Memba builds no governance transaction for it here.")).toBeInTheDocument()
        expect(screen.queryByText(V12_READ_ONLY)).toBeNull()
    })

    it("keeps the previous read on screen, and says so, when a later read fails", async () => {
        show("overview")
        expect(await screen.findByText("Memba DAO")).toBeInTheDocument()
        vi.mocked(readWeightedSnapshot).mockRejectedValue(new Error("DAO read failed"))
        fireEvent.click(screen.getByRole("button", { name: "All 26 proposals" }))
        await act(async () => { await client.invalidateQueries({ queryKey: ["dao", "weighted"] }) })
        expect(await screen.findByRole("alert")).toHaveTextContent("DAO read failed This is the previous read.")
        expect(screen.getByText("7 seats · 8 voting points · gnoland-1")).toBeInTheDocument()
    })

    it("reads the DAO again each minute, so a proposal's new status shows by itself", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        try {
            show("overview")
            const row = await screen.findByRole("button", { name: /#26 Feedback/ })
            expect(within(row).getByText("Waiting for its delay")).toBeInTheDocument()
            const later = v12()
            later.page.proposals[0] = { ...later.page.proposals[0], status: "READY", ready: true } as typeof later.page.proposals[0]
            vi.mocked(readWeightedSnapshot).mockImplementation(async () => later)
            const reads = vi.mocked(readWeightedSnapshot).mock.calls.length
            await act(async () => { await vi.advanceTimersByTimeAsync(59_000) })
            expect(vi.mocked(readWeightedSnapshot).mock.calls.length).toBe(reads)
            await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
            expect(await within(screen.getByRole("button", { name: /#26 Feedback/ })).findByText("Ready to execute")).toBeInTheDocument()
        } finally { vi.useRealTimers() }
    })

    it("shows a failed read as an error with a retry, never as an empty DAO", async () => {
        vi.mocked(readWeightedSnapshot).mockRejectedValueOnce(new Error("RPC network does not match the selected chain"))
        show("overview")
        expect(await screen.findByRole("alert")).toHaveTextContent("RPC network does not match the selected chain")
        expect(screen.queryByText(/seats/)).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("Memba DAO")).toBeInTheDocument()
    })
})

describe("a weighted DAO's members", () => {
    it("lists the seven seats with their points and roles, and says the roster is fixed", async () => {
        show("members")
        expect(await screen.findByText("Founder · 2 points")).toBeInTheDocument()
        expect(screen.getAllByText("Core developer · 1 point")).toHaveLength(6)
        expect(screen.getByText("g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c")).toBeInTheDocument()
        expect(screen.getByText("Admin · Finance")).toBeInTheDocument()
        expect(screen.getByText(/The DAO has exactly 7 seats and 8 voting points\. It cannot admit or remove a member; a critical vote can only move a seat to a new address of the same person\./)).toBeInTheDocument()
        expect(screen.getByText(/Admin and finance roles add no voting power and no exclusive right to execute\./)).toBeInTheDocument()
    })
})

describe("a weighted DAO's proposals", () => {
    it("lists a page of proposals with category, tally and status, and pages to older ones", async () => {
        show("proposals")
        expect(await screen.findByText("26 proposals recorded")).toBeInTheDocument()
        expect(screen.getAllByRole("button", { name: /^#\d+ / })).toHaveLength(20)
        const ready = screen.getByRole("button", { name: /#17 Market config · Set a fee/ })
        expect(within(ready).getByText("Ready to execute")).toBeInTheDocument()
        expect(within(ready).getByText("Financial · 5 points · 4 people · 3 developers voting yes")).toBeInTheDocument()
        expect(within(screen.getByRole("button", { name: /#13 Feedback · Accept the handover/ })).getByText("Executed")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Older proposals" }))
        expect(await screen.findByRole("button", { name: /#1 / })).toBeInTheDocument()
        expect(vi.mocked(readWeightedSnapshot).mock.calls.map((call) => call[1])).toEqual(["0", "7"])
        expect(screen.queryByRole("button", { name: "Older proposals" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Newest proposals" }))
        expect(await screen.findByRole("button", { name: /#26 / })).toBeInTheDocument()
    })

    it("lists a proposal Memba cannot validate by its number only, with nothing to open", async () => {
        const data = v12()
        data.page.proposals[3] = { id: "23", unreadable: true }
        vi.mocked(readWeightedSnapshot).mockImplementation(async () => data)
        show("proposals")
        expect(await screen.findByText("Unreadable proposal #23")).toBeInTheDocument()
        expect(screen.getAllByRole("button", { name: /^#\d+ / })).toHaveLength(19)
    })

    it("retries the older page when its read fails", async () => {
        show("proposals")
        vi.mocked(readWeightedSnapshot).mockRejectedValueOnce(new Error("DAO read failed"))
        fireEvent.click(await screen.findByRole("button", { name: "Older proposals" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("DAO read failed")
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByRole("button", { name: /#1 / })).toBeInTheDocument()
        expect(vi.mocked(readWeightedSnapshot).mock.calls.map((call) => call[1])).toEqual(["0", "7", "7"])
    })

    it("keeps an older page's previous read, and says so, when a later read of it fails", async () => {
        show("proposals")
        fireEvent.click(await screen.findByRole("button", { name: "Older proposals" }))
        expect(await screen.findByRole("button", { name: /#1 / })).toBeInTheDocument()
        vi.mocked(readWeightedSnapshot).mockImplementation(async (_ctx, before = "0") => { if (before === "0") return v12(); throw new Error("DAO read failed") })
        await act(async () => { await client.refetchQueries({ queryKey: ["dao", "weighted"] }) })
        expect(await screen.findByRole("alert")).toHaveTextContent("DAO read failed This is the previous read.")
        expect(screen.getByRole("button", { name: /#1 / })).toBeInTheDocument()
    })

    it("says an empty DAO has no proposals", async () => {
        vi.mocked(readWeightedSnapshot).mockImplementation(async () => v12("proposals_empty"))
        show("proposals")
        expect(await screen.findByText("0 proposals recorded")).toBeInTheDocument()
        expect(screen.getByText("No proposals yet.")).toBeInTheDocument()
    })

    it("asks nothing of a session that is still resuming", async () => {
        show("proposals", { ...guest, status: "resuming" } as unknown as OsSession)
        expect(await screen.findByText("26 proposals recorded")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /vote or execute$/ })).toBeNull()
    })

})

describe("a weighted DAO's treasury", () => {
    it("says the DAO holds and spends nothing, and shows where fees go today against what its policy names", async () => {
        Object.assign(balances, { [DAO]: 0n, [RESERVE]: 1_337_000n, [PUBLISHER]: 221_040_000n })
        show("treasury")
        expect(await screen.findByText("This DAO has no treasury and cannot spend funds")).toBeInTheDocument()
        expect(screen.getByText(/no vote can pay the DAO itself/)).toBeInTheDocument()
        expect(screen.getByText(DAO)).toBeInTheDocument()
        expect(await screen.findByText("0 GNOT")).toBeInTheDocument()
        const market = (await screen.findByText("Market fees")).closest("li")!
        expect(market).toHaveTextContent("Paid today to g136j0m0…5cpf.")
        expect(market).toHaveTextContent("The DAO's policy names g1jw76lx…r2u0 instead. While the DAO controls Market config with no handover pending, a financial vote can move the fees there, and to no other address.")
        expect(screen.getByText("App Store registration fees").closest("li")!).toHaveTextContent("While the DAO controls App Store with no handover pending, a financial vote")
        expect(screen.getByText(/^Escrow pays its service fee to the Market treasury\./)).toHaveTextContent("while the DAO controls Escrow, a financial vote can propose another one, who must accept, and never the DAO itself.")
        const reserve = screen.getByText("Reserve wallet").closest("li")!
        expect(reserve).toHaveTextContent(RESERVE)
        expect(reserve).toHaveTextContent("The team declares it a 4-of-7 multisig.")
        expect(await within(reserve).findByText("1.337 GNOT")).toBeInTheDocument()
        const publisher = screen.getByText("Publisher wallet").closest("li")!
        expect(publisher).toHaveTextContent("The team declares it a 2-of-3 multisig.")
        expect(publisher).toHaveTextContent("221.04 GNOT")
        expect(screen.getByText("Spending from a wallet takes its own signers, not a DAO vote.")).toBeInTheDocument()
        // Nothing here moves funds or proposes where fees go.
        expect(screen.getByText(V12_READ_ONLY)).toBeInTheDocument()
        expect(screen.queryByRole("button")).toBeNull()
        expect(screen.queryByRole("link")).toBeNull()
    })

    it("says when an application has no treasury set, and offers a seat holder no vote to move its fees", async () => {
        vi.mocked(readFeeDestinations).mockImplementation(async () => fees(PUBLISHER, ""))
        show("treasury", as(v12().members[1].address))
        expect((await screen.findByText("App Store registration fees")).closest("li")!).toHaveTextContent("It has no treasury set.")
        expect(screen.queryByRole("button")).toBeNull()
    })

    it("drops the policy note once an application pays the address the policy names", async () => {
        vi.mocked(readFeeDestinations).mockImplementation(async () => fees(RESERVE, RESERVE))
        show("treasury")
        expect((await screen.findByText("Market fees")).closest("li")!).toHaveTextContent("Paid today to g1jw76lx…r2u0, the address the DAO's policy names.")
        expect(screen.queryByText(/instead|a financial vote can move/)).toBeNull()
        expect(screen.queryByText("Publisher wallet")).toBeNull()
        // Nothing can move there: whether the DAO controls the applications is not read.
        expect(readAcceptanceStates).not.toHaveBeenCalled()
    })

    it("says what it could not read instead of showing the policy's address as the current one", async () => {
        vi.mocked(readFeeDestinations).mockImplementation(async () => fees(null, ""))
        balances[DAO] = new Error("HTTP 502")
        show("treasury")
        const market = (await screen.findByText("Market fees")).closest("li")!
        expect(market).toHaveTextContent("Its treasury could not be read.")
        // No difference is claimed from a value that was never read.
        expect(market).toHaveTextContent("The DAO's policy names g1jw76lx…r2u0.")
        expect(market).not.toHaveTextContent(/instead|financial vote/)
        const appstore = screen.getByText("App Store registration fees").closest("li")!
        expect(appstore).toHaveTextContent("It has no treasury set.")
        expect(appstore).toHaveTextContent("The DAO's policy names g1jw76lx…r2u0. A financial vote can move the fees there only once App Store has a treasury set and the DAO controls it.")
        const failed = await screen.findByText(/^Could not be read/)
        balances[DAO] = 4_000_000n
        fireEvent.click(within(failed).getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("4 GNOT")).toBeInTheDocument()
    })

    it("keeps the previous fee destinations and balances, and says so, when a later read fails", async () => {
        Object.assign(balances, { [DAO]: 0n, [RESERVE]: 1_337_000n, [PUBLISHER]: 221_040_000n })
        show("treasury")
        expect((await screen.findByText("Market fees")).closest("li")!).toHaveTextContent("Paid today to g136j0m0…5cpf.")
        expect(await screen.findByText("0 GNOT")).toBeInTheDocument()
        vi.mocked(readFeeDestinations).mockRejectedValue(new Error("Chain read failed"))
        balances[DAO] = new Error("HTTP 502")
        await act(async () => { await client.refetchQueries({ queryKey: ["dao", "weighted"] }) })
        expect(await screen.findByText("The applications' treasuries could not be read again. This is the previous read.")).toBeInTheDocument()
        expect(screen.getByText("Market fees").closest("li")!).toHaveTextContent("Paid today to g136j0m0…5cpf.")
        expect(screen.getByText("0 GNOT").closest("dd")!).toHaveTextContent("Previous read: the latest could not be read.")
    })

    it("warns that coins at the DAO's own address are stuck there, without claiming it holds none", async () => {
        balances[DAO] = 2_500_000n
        show("treasury")
        expect(await screen.findByText("Coins at the DAO's own address cannot be withdrawn: the contract has no way to send them.")).toBeInTheDocument()
        expect(screen.getByText("2.5 GNOT")).toBeInTheDocument()
        expect(readHeldUgnot).toHaveBeenCalledWith(expect.objectContaining({ chainId: "gnoland-1" }), DAO, expect.anything())
        expect(screen.queryByText(/holds no funds/)).toBeNull()
    })

    it("shows no fee destinations for a contract version that governs no application", async () => {
        const v2 = weightedFixture(2)
        vi.mocked(readWeightedSnapshot).mockImplementation(async () => ({ config: weightedConfigSchema.parse(v2.config), members: v2.members, page: weightedPageSchema.parse(v2.page) }) as WeightedSnapshot)
        show("treasury")
        expect(await screen.findByText("This DAO has no treasury and cannot spend funds")).toBeInTheDocument()
        expect(screen.getByText("It votes only on role changes and key recoveries; no vote moves funds.")).toBeInTheDocument()
        expect(screen.queryByText(/fees|Escrow/)).toBeNull()
        expect(screen.queryByText("Where fees go")).toBeNull()
        expect(readFeeDestinations).not.toHaveBeenCalled()
    })
})

// ── The folder window around the sections ───────────────────────────────────

const windowFor = (key: string, title: string, target: OsWindow["target"]): OsWindow => ({ id: "w1", key, title, app: "daos", x: 0, y: 0, width: 560, height: 420, z: 1, min: false, max: false, target })
const showTarget = (win: OsWindow) => renderWithProviders(<WindowBody win={win} session={guest} open={open} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} active />)
const showWindow = (name: string, section: DaoSection = "overview") => showTarget(windowFor(`dao:${name}`, name, { kind: "dao", name, section }))
const showProposal = (dao: string, n: number) => showTarget(windowFor(`prop:${dao}:${n}`, `${dao} · Proposal #${n}`, { kind: "proposal", dao, n }))
const showNewProposal = (dao: string) => showTarget(windowFor(`flow:prop:${dao}`, `New proposal · ${dao}`, { kind: "new-proposal", dao }))
const kindState = (state: { kind: string | null; loading?: boolean; error?: string | null }) =>
    vi.mocked(useDaoKind).mockReturnValue({ loading: false, error: null, capabilities: { propose: [] }, ...state } as unknown as ReturnType<typeof useDaoKind>)

describe("a weighted DAO's folder window", () => {
    it("shows the four sections natively, with no link out of Memba OS and nothing read through the other DAO kinds' loaders", async () => {
        kindState({ kind: "weighted" })
        showWindow("memba_dao")
        expect(await screen.findByText("7 seats · 8 voting points · gnoland-1")).toBeInTheDocument()
        expect(within(screen.getByRole("tablist", { name: "DAO sections" })).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Proposals", "Members", "Treasury"])
        expect(screen.queryByRole("link")).toBeNull()
        expect(useDaoConfig).toHaveBeenLastCalledWith(MEMBA_DAO, false)
        expect(useDaoProposals).toHaveBeenLastCalledWith(MEMBA_DAO, false)
        // The Memba DAO's #join posts stay on its overview.
        expect(screen.getByText(/#join posts are Feed posts/)).toBeInTheDocument()
    })

    it("keeps the #join posts off the other sections, and reads no member list through the other kinds' loader", async () => {
        kindState({ kind: "weighted" })
        showWindow("memba_dao", "members")
        expect(await screen.findByText("Founder · 2 points")).toBeInTheDocument()
        expect(screen.queryByText(/#join posts/)).toBeNull()
        expect(useDaoMembers).toHaveBeenLastCalledWith(MEMBA_DAO, undefined, false)
    })

    it("leaves the other DAO kinds on their own loaders", async () => {
        kindState({ kind: "memba-v2" })
        showWindow("samcrew.team")
        expect(await screen.findByRole("tablist", { name: "DAO sections" })).toBeInTheDocument()
        expect(readWeightedSnapshot).not.toHaveBeenCalled()
        expect(useDaoConfig).toHaveBeenLastCalledWith("gno.land/r/samcrew/team", true)
    })
})

describe("a DAO folder before its contract is known", () => {
    it("shows no sections and reads nothing while the contract is being identified", async () => {
        kindState({ kind: null, loading: true })
        showWindow("memba_dao")
        expect(await screen.findByText("Loading the DAO contract…")).toBeInTheDocument()
        expect(screen.queryByRole("tablist")).toBeNull()
        expect(useDaoConfig).toHaveBeenLastCalledWith(MEMBA_DAO, false)
        expect(readWeightedSnapshot).not.toHaveBeenCalled()
    })

    it("says the contract could not be identified, retries that read, and never claims the DAO is absent", async () => {
        const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries")
        kindState({ kind: null, error: "RPC unavailable" })
        showWindow("memba_dao")
        expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this DAO's contract.")
        expect(screen.queryByText(/No DAO answers/)).toBeNull()
        expect(screen.queryByRole("tablist")).toBeNull()
        expect(useDaoConfig).toHaveBeenLastCalledWith(MEMBA_DAO, false)
        // The #join posts do not depend on the DAO read.
        expect(screen.getByText(/#join posts are Feed posts/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Try again" }))
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dao", "kind", "gnoland-1", MEMBA_DAO], exact: true })
        invalidate.mockRestore()
    })
})

describe("the proposal windows of a DAO", () => {
    it("show a weighted DAO's proposal from its own contract, reading nothing through the other kinds' loaders", async () => {
        kindState({ kind: "weighted" })
        showProposal("memba_dao", 17)
        expect(await screen.findByRole("heading", { name: "#17 Market config · Set a fee" })).toBeInTheDocument()
        expect(useDaoConfig).not.toHaveBeenCalled()
        expect(useDaoMembers).not.toHaveBeenCalled()
    })

    it("send a weighted DAO's new-proposal address to the Proposals section of its DAO window, without mounting the wizard", async () => {
        kindState({ kind: "weighted" })
        showNewProposal("memba_dao")
        expect(await screen.findByText("This DAO votes by points")).toBeInTheDocument()
        // A DAO held read-only offers no action there either: the pointer promises only its proposals.
        expect(screen.getByText("Its proposals are in its DAO window, under Proposals.")).toBeInTheDocument()
        expect(screen.queryByText(/wizard for/)).toBeNull()
        expect(useDaoConfig).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Open memba_dao" }))
        expect(open).toHaveBeenCalledWith(expect.objectContaining({ key: "dao:memba_dao", target: { kind: "dao", name: "memba_dao", section: "proposals" } }))
    })

    it("read nothing before the contract is known, and retry the contract read when it fails", async () => {
        kindState({ kind: null, loading: true })
        showProposal("memba_dao", 12)
        expect(await screen.findByText("Loading proposal #12…")).toBeInTheDocument()
        showNewProposal("memba_dao")
        expect(await screen.findByText("Loading the DAO contract…")).toBeInTheDocument()
        expect(screen.queryByText(/wizard for/)).toBeNull()
        expect(useDaoConfig).not.toHaveBeenCalled()
        expect(readWeightedSnapshot).not.toHaveBeenCalled()
        const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries")
        kindState({ kind: null, error: "RPC unavailable" })
        showProposal("memba_dao", 12)
        fireEvent.click((await screen.findAllByRole("button", { name: "Try again" }))[0])
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dao", "kind", "gnoland-1", MEMBA_DAO], exact: true })
        invalidate.mockRestore()
    })

    it("open the wizard for the DAO kinds it serves", async () => {
        kindState({ kind: "memba-v2" })
        showNewProposal("samcrew.team")
        expect(await screen.findByText("wizard for samcrew.team")).toBeInTheDocument()
    })
})
