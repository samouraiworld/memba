import { useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MonitoringValidatorData } from "../../../lib/gnomonitoring"
import type { NetworkStats, ValidatorInfo } from "../../../lib/validators"
import type { ValoperWithStatus } from "../../../lib/valopers"
import { classicForSection } from "../../page/classicRoute"
import { urlForWindow, type WindowSpec } from "../../shell/windows"
import ValidatorsWindow from "./native"

// The chain and monitoring readers are replaced at the module boundary; the
// roster assembly, the merges and the health engine under them are the real ones.
const read = vi.hoisted(() => ({
    snapshot: vi.fn(), validators: vi.fn(), stats: vi.fn(), monikers: vi.fn(), signatures: vi.fn(), monitoring: vi.fn(), valopers: vi.fn(),
}))
vi.mock("../../../lib/validators", async (actual) => ({
    ...await actual<typeof import("../../../lib/validators")>(),
    getValidatorRpcSnapshot: read.snapshot, getValidators: read.validators, getNetworkStats: read.stats,
    fetchValoperMonikers: read.monikers, fetchLastBlockSignatures: read.signatures,
}))
vi.mock("../../../lib/gnomonitoring", async (actual) => ({
    ...await actual<typeof import("../../../lib/gnomonitoring")>(),
    fetchAllMonitoringData: read.monitoring,
}))
vi.mock("../../../lib/valopers", async (actual) => ({
    ...await actual<typeof import("../../../lib/valopers")>(),
    fetchValopers: read.valopers,
}))

const address = (letter: string) => `g1${letter.repeat(38)}`
// Three validators whose rank, name, uptime and health each order them differently.
const BASALT = address("a") // rank 1, monitored, signs every block: healthy
const ALDER = address("c") // rank 2, monitored at 100% uptime, signed nothing in the window: down
const NAMELESS = address("e") // rank 3, no moniker, not monitored, missed the latest block: degraded
const BASALT_CELL = "Basaltg1aaaa…aaaaaa"
const ALDER_CELL = "Alderg1cccc…cccccc"
const NAMELESS_CELL = "g1eeee…eeeeee"

function validator(gnoAddr: string, rank: number, votingPower: number): ValidatorInfo {
    return {
        address: gnoAddr, gnoAddr, moniker: "", pubkey: "", pubkeyType: "", votingPower, powerPercent: votingPower, rank, active: true,
        proposerPriority: 0, participationRate: null, uptimePercent: null, profileUrl: "", lastBlockSignatures: [], startTime: "",
        healthStatus: "unknown", healthMeta: null, missedBlocks: null, incidents: [], operationTime: null, txContrib: null, lastIncidentDate: null,
    } as ValidatorInfo
}
const monitored = (addr: string, participationRate: number | null, uptime: number): [string, MonitoringValidatorData] =>
    [addr, { addr, moniker: "", participationRate, uptime, firstSeen: null, missedBlocks: 0, incidents: [], operationTime: null, lastDownDate: null, txContrib: null }]
const operator = (moniker: string, letter: string, signingAddress: string, serverType: string): ValoperWithStatus =>
    ({ moniker, description: "", operatorAddress: address(letter), signingAddress, signingPubKey: "", serverType, status: "candidate" })

const STATS: NetworkStats = { blockHeight: 451780, avgBlockTime: 5.2, totalValidators: 3, totalVotingPower: 100, chainId: "gnoland-1", catchingUp: false, latestBlockTime: "" }
const SNAPSHOT = { url: "https://rpc.example", chainId: "gnoland-1", height: 451780, blockHash: "hash", status: {} }
const session = { status: "guest", address: "", network: { key: "mainnet", chainId: "gnoland-1" }, openConnect: vi.fn() } as never
const allSigned = new Array<boolean>(20).fill(true)

/** `opened`: the address was replaced. `pushed`: a history entry was added. */
const opened = vi.fn<(spec: WindowSpec) => void>()
const pushed = vi.fn<(spec: WindowSpec) => void>()
let client: QueryClient

/** Stands in for the window frame: `open` and `push` retarget the window, which hands the new section and query back. */
function Frame({ section, query, active = true }: { section: string | null; query?: string; active?: boolean }) {
    const [target, setTarget] = useState({ section, query })
    const retarget = (record: (spec: WindowSpec) => void) => (spec: WindowSpec) => {
        record(spec)
        if (spec.target?.kind === "app") setTarget({ section: spec.target.section, query: spec.target.query })
    }
    return <ValidatorsWindow section={target.section} query={target.query} session={session} active={active}
        open={retarget(opened)} push={retarget(pushed)}
        openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} fallback={<p>classic page</p>} />
}

// No router around it: a native view that read one would throw here.
function show(section: string | null = null, query?: string, active = true) {
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    return render(<Frame section={section} query={query} active={active} />, { wrapper })
}

const lastTarget = () => opened.mock.calls.at(-1)![0].target
const lastPushed = () => pushed.mock.calls.at(-1)![0].target
/** One column of every body row, top to bottom (the Validator or Hosting column by default). */
const column = (index = 1) => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[index].textContent)
const rowOf = (openLabel: string) => screen.getByRole("button", { name: openLabel }).closest("tr")!
const cells = (openLabel: string) => within(rowOf(openLabel)).getAllByRole("cell").map((cell) => cell.textContent)
const stat = (label: string) => screen.getByText(label, { selector: ".os-stat-l" }).parentElement!
const healthChips = () => within(screen.getByRole("group", { name: "Filter by health" }))

beforeEach(() => {
    vi.clearAllMocks()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    read.snapshot.mockResolvedValue(SNAPSHOT)
    read.validators.mockResolvedValue([validator(BASALT, 1, 50), validator(ALDER, 2, 30), validator(NAMELESS, 3, 20)])
    read.stats.mockResolvedValue(STATS)
    read.monikers.mockResolvedValue(new Map([[BASALT, "Basalt"], [ALDER, "Alder"]]))
    // Alder is absent: a validator that signed nothing leaves no address in the block data.
    read.signatures.mockResolvedValue(new Map([[BASALT, allSigned], [NAMELESS, [false, ...allSigned.slice(1)]]]))
    read.monitoring.mockResolvedValue(new Map([monitored(BASALT, 99.5, 99.2), monitored(ALDER, 97, 100)]))
    read.valopers.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers() })

describe("Validators window · which sections it takes", () => {
    it.each(["hacker", "alerts", BASALT, `valoper/${BASALT}`, "no/such/page"])("leaves %s to what the window showed before, and reads nothing", (section) => {
        show(section)
        expect(screen.getByText("classic page")).toBeInTheDocument()
        expect(screen.queryByRole("heading", { name: "Validators" })).toBeNull()
        expect(read.snapshot).not.toHaveBeenCalled()
    })

    it("leaves the Network view of the home section to the classic page, and reads nothing", () => {
        show(null, "tab=network")
        expect(screen.getByText("classic page")).toBeInTheDocument()
        expect(screen.queryByRole("heading", { name: "Validators" })).toBeNull()
        expect(read.snapshot).not.toHaveBeenCalled()
    })

    it.each([null, "validators"])("takes the home section (%s)", async (section) => {
        show(section)
        expect(screen.getByRole("heading", { level: 1, name: "Validators" })).toHaveAttribute("tabindex", "-1")
        expect(screen.getByRole("status")).toHaveTextContent("Reading the validator set…")
        expect(screen.queryByText("classic page")).toBeNull()
        expect(await screen.findByRole("table")).toBeInTheDocument()
        expect(screen.queryByRole("status")).toBeNull()
    })
})

describe("Validators window · the active set", () => {
    it("lists every validator with its power, monitoring figures and health", async () => {
        show()
        await screen.findByRole("table")
        expect(column()).toEqual([BASALT_CELL, ALDER_CELL, NAMELESS_CELL])
        expect(cells("Open validator Basalt")).toEqual(["1", BASALT_CELL, "50", "50.0%", "99.5%", "99.2%", "Healthy"])
        // Signing nothing in the window outranks a perfect long-window uptime, and the row says why.
        expect(cells("Open validator Alder")).toEqual(["2", ALDER_CELL, "30", "30.0%", "97%", "100%", "Down20 consecutive blocks missed"])
        expect(read.valopers).not.toHaveBeenCalled()
    })

    it("shows a validator nobody monitors with dashes that say so, never a zero", async () => {
        show()
        await screen.findByRole("table")
        const row = rowOf(`Open validator ${NAMELESS_CELL}`)
        expect(within(row).getAllByText("No monitoring data")).toHaveLength(2)
        expect(cells(`Open validator ${NAMELESS_CELL}`)).toEqual(["3", NAMELESS_CELL, "20", "20.0%", "—No monitoring data", "—No monitoring data", "Degraded1 recent block missed"])
        expect(screen.queryByRole("note")).toBeNull()
    })

    it("summarises the network from what was read", async () => {
        show()
        await screen.findByRole("table")
        expect(stat("Block height")).toHaveTextContent(`${(451780).toLocaleString()}The RPC node reports it is in sync`)
        expect(stat("Average block time")).toHaveTextContent("5.2sOver the last 10 blocks")
        expect(stat("Active validators")).toHaveTextContent("3100 total voting power")
        expect(stat("Healthy")).toHaveTextContent("1 of 31 degraded · 1 down · 0 unknown")
        expect(stat("Average uptime")).toHaveTextContent("99.6%Validators with monitoring data")
    })

    it("leaves a figure out when it was not read, and says when the node is catching up", async () => {
        read.stats.mockResolvedValue({ ...STATS, avgBlockTime: 0, catchingUp: true })
        show()
        await screen.findByRole("table")
        expect(screen.queryByText("Average block time")).toBeNull()
        expect(stat("Block height")).toHaveTextContent("The RPC node is still catching up")
    })

    it("sorts by a column header, ascending then descending, and says so", async () => {
        show()
        await screen.findByRole("table")
        const power = screen.getByRole("button", { name: "Voting power" })
        fireEvent.click(power)
        expect(column()).toEqual([NAMELESS_CELL, ALDER_CELL, BASALT_CELL])
        expect(power.closest("th")).toHaveAttribute("aria-sort", "ascending")
        fireEvent.click(power)
        expect(column()).toEqual([BASALT_CELL, ALDER_CELL, NAMELESS_CELL])
        expect(power.closest("th")).toHaveAttribute("aria-sort", "descending")
        // Health sorts worst first; a missing uptime sorts below every reported one; names sort as shown.
        fireEvent.click(screen.getByRole("button", { name: "Health" }))
        expect(column()).toEqual([ALDER_CELL, NAMELESS_CELL, BASALT_CELL])
        expect(power.closest("th")).not.toHaveAttribute("aria-sort")
        fireEvent.click(screen.getByRole("button", { name: "Uptime" }))
        expect(column()).toEqual([NAMELESS_CELL, BASALT_CELL, ALDER_CELL])
        fireEvent.click(screen.getByRole("button", { name: "Validator" }))
        expect(column()).toEqual([ALDER_CELL, BASALT_CELL, NAMELESS_CELL])
    })

    it("searches by name or address and keeps the search in the window's address", async () => {
        show()
        await screen.findByRole("table")
        const search = screen.getByRole("searchbox", { name: "Search validators" })
        fireEvent.change(search, { target: { value: "ALD" } })
        expect(column()).toEqual([ALDER_CELL])
        expect(lastTarget()).toEqual({ kind: "app", app: "validators", section: null, query: "q=ALD" })
        fireEvent.change(search, { target: { value: "eeee" } })
        expect(column()).toEqual([NAMELESS_CELL])
        fireEvent.change(search, { target: { value: "nobody" } })
        expect(screen.queryByRole("table")).toBeNull()
        expect(screen.getByText("No validator matches this search and filter.")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
        expect(search).toHaveValue("")
        // The button left with the empty list: focus is on the search it cleared, not lost.
        expect(search).toHaveFocus()
        expect(column()).toHaveLength(3)
        expect(lastTarget()).toEqual({ kind: "app", app: "validators", section: null, query: "" })
        // A search refines the page it is on: no history entry.
        expect(pushed).not.toHaveBeenCalled()
    })

    it("filters by health, with a count on every chip", async () => {
        show()
        await screen.findByRole("table")
        expect(healthChips().getAllByRole("button").map((chip) => chip.textContent)).toEqual(["All 3", "Healthy 1", "Degraded 1", "Down 1", "Unknown 0"])
        fireEvent.click(healthChips().getByRole("button", { name: "Down 1" }))
        expect(column()).toEqual([ALDER_CELL])
        expect(healthChips().getByRole("button", { name: "Down 1" })).toHaveAttribute("aria-pressed", "true")
        expect(lastTarget()).toEqual({ kind: "app", app: "validators", section: null, query: "health=down" })
    })

    it("restores the search and the filter from the window's address", async () => {
        show(null, "q=a&health=healthy")
        await screen.findByRole("table")
        expect(screen.getByRole("searchbox")).toHaveValue("a")
        expect(healthChips().getByRole("button", { name: "Healthy 1" })).toHaveAttribute("aria-pressed", "true")
        // "a" also matches Alder, which the filter then leaves out.
        expect(column()).toEqual([BASALT_CELL])
    })

    it("treats a health value it does not know as no filter", async () => {
        show(null, "health=perfect")
        await screen.findByRole("table")
        expect(column()).toHaveLength(3)
        expect(healthChips().getByRole("button", { name: "All 3" })).toHaveAttribute("aria-pressed", "true")
    })

    it("opens a validator's page in the same window as a history entry, carrying the view for the way back", async () => {
        show(null, "q=basalt")
        fireEvent.click(await screen.findByRole("button", { name: "Open validator Basalt" }))
        expect(opened).not.toHaveBeenCalled()
        const spec = pushed.mock.calls.at(-1)![0]
        expect(spec.key).toBe("app:validators")
        expect(spec.target).toEqual({ kind: "app", app: "validators", section: BASALT, query: "from=q%3Dbasalt" })
        expect(urlForWindow(spec)).toBe(`/os/validators/${BASALT}?from=q%3Dbasalt`)
        expect(classicForSection("validators", BASALT)).toBe(`validators/${BASALT}`)
        // The window now shows what it showed before this view existed: the classic validator page.
        expect(screen.getByText("classic page")).toBeInTheDocument()
    })

    it("opens a validator under a clean address when there is no view to carry", async () => {
        show()
        fireEvent.click(await screen.findByRole("button", { name: `Open validator ${NAMELESS_CELL}` }))
        expect(lastPushed()).toEqual({ kind: "app", app: "validators", section: NAMELESS, query: "" })
    })

    it.each([["Hacker mode", "hacker", "validators/hacker"], ["Alerts", "alerts", "alerts"]])("%s opens its classic page in this window, as a history entry", (label, section, page) => {
        show()
        fireEvent.click(screen.getByRole("button", { name: label }))
        expect(lastPushed()).toEqual({ kind: "app", app: "validators", section, query: "" })
        expect(opened).not.toHaveBeenCalled()
        expect(classicForSection("validators", section)).toBe(page)
        expect(screen.getByText("classic page")).toBeInTheDocument()
    })

    it("Network opens the classic page's Network view in this window, as a history entry", () => {
        show(null, "q=basalt")
        fireEvent.click(screen.getByRole("button", { name: "Network" }))
        const spec = pushed.mock.calls.at(-1)![0]
        expect(spec.target).toEqual({ kind: "app", app: "validators", section: null, query: "tab=network" })
        expect(urlForWindow(spec)).toBe("/os/validators?tab=network")
        expect(opened).not.toHaveBeenCalled()
        expect(screen.getByText("classic page")).toBeInTheDocument()
    })
})

describe("Validators window · when a source is missing", () => {
    it("says the RPC could not be read, shows no figure at all, and recovers on Retry", async () => {
        read.snapshot.mockRejectedValueOnce(new Error("Failed to fetch"))
        show()
        expect(await screen.findByRole("alert")).toHaveTextContent("The validator set could not be read from the gnoland-1 RPC.")
        expect(screen.queryByRole("table")).toBeNull()
        expect(screen.queryByText("Block height")).toBeNull()
        expect(screen.queryByText(/healthy/i)).toBeNull()
        expect(screen.queryByRole("group")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByRole("button", { name: "Open validator Basalt" })).toBeInTheDocument()
        expect(screen.queryByRole("alert")).toBeNull()
    })

    it("still lists the set without monitoring: dashes instead of figures, and health from signatures alone", async () => {
        read.monitoring.mockResolvedValue(new Map())
        show()
        await screen.findByRole("table")
        expect(screen.getByRole("note")).toHaveTextContent("No monitoring data could be read.")
        expect(screen.getAllByText("No monitoring data")).toHaveLength(6)
        expect(cells("Open validator Alder")).toEqual(["2", ALDER_CELL, "30", "30.0%", "—No monitoring data", "—No monitoring data", "Down20 consecutive blocks missed"])
        expect(cells("Open validator Basalt").at(-1)).toBe("Healthy")
        expect(screen.queryByText("Average uptime")).toBeNull()
    })

    it("shows a participation figure the monitoring service did not give as missing, and says so", async () => {
        read.monitoring.mockResolvedValue(new Map([monitored(BASALT, null, 99.2), monitored(ALDER, null, 100)]))
        show()
        await screen.findByRole("table")
        expect(cells("Open validator Basalt")[4]).toBe("—No monitoring data")
        expect(cells("Open validator Basalt")[5]).toBe("99.2%")
        expect(screen.getByRole("note")).toHaveTextContent("Participation could not be read from the monitoring service.")
    })

    it("says when recent block signatures could not be read and health rests on monitoring alone", async () => {
        read.signatures.mockResolvedValue(new Map())
        show()
        await screen.findByRole("table")
        expect(screen.getByRole("note")).toHaveTextContent("Recent block signatures could not be read: health relies on monitoring data alone.")
    })

    it("reports unknown health, never healthy, when neither monitoring nor signatures could be read", async () => {
        read.monitoring.mockResolvedValue(new Map())
        read.signatures.mockResolvedValue(new Map())
        show()
        await screen.findByRole("table")
        expect(stat("Healthy")).toHaveTextContent("0 of 30 degraded · 0 down · 3 unknown")
        expect(cells("Open validator Basalt").at(-1)).toBe("UnknownNo monitoring data available")
    })

    it("keeps the last set on screen and says it is not live when a refresh fails", async () => {
        show()
        await screen.findByRole("table")
        read.snapshot.mockRejectedValue(new Error("Failed to fetch"))
        await act(() => client.refetchQueries())
        expect(await screen.findByRole("alert")).toHaveTextContent(/^The last refresh failed\. This is the validator set as read at .+: heights and health are not live\.Retry$/)
        expect(column()).toHaveLength(3)
    })

    it("says so when the RPC returns an empty set, with no table and no filters", async () => {
        read.validators.mockResolvedValue([])
        read.stats.mockResolvedValue({ ...STATS, totalValidators: 0, totalVotingPower: 0 })
        show()
        expect(await screen.findByText("The gnoland-1 RPC returned an empty validator set.")).toBeInTheDocument()
        expect(screen.queryByRole("table")).toBeNull()
        expect(screen.queryByRole("searchbox")).toBeNull()
    })

    it("reads the set again every 30 seconds", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        show()
        await screen.findByRole("table")
        expect(read.snapshot).toHaveBeenCalledTimes(1)
        await act(() => vi.advanceTimersByTimeAsync(20_000))
        expect(read.snapshot).toHaveBeenCalledTimes(1)
        await act(() => vi.advanceTimersByTimeAsync(11_000))
        expect(read.snapshot).toHaveBeenCalledTimes(2)
    })

    it("does not retry a failed read behind another window", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        read.snapshot.mockRejectedValue(new Error("Failed to fetch"))
        show(null, undefined, false)
        expect(await screen.findByRole("alert")).toHaveTextContent("The validator set could not be read")
        await act(() => vi.advanceTimersByTimeAsync(95_000))
        expect(read.snapshot).toHaveBeenCalledTimes(1)
    })

    it("reads again when brought forward after a read that failed behind another window", async () => {
        read.snapshot.mockRejectedValueOnce(new Error("Failed to fetch"))
        const view = show(null, undefined, false)
        expect(await screen.findByRole("alert")).toHaveTextContent("could not be read")
        expect(read.snapshot).toHaveBeenCalledTimes(1)
        view.rerender(<Frame section={null} active />)
        expect(await screen.findByRole("table")).toBeInTheDocument()
        expect(read.snapshot).toHaveBeenCalledTimes(2)
    })

    it("reads once behind another window without polling, and again when brought forward", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        const view = show(null, undefined, false)
        await screen.findByRole("table")
        expect(read.snapshot).toHaveBeenCalledTimes(1)
        await act(() => vi.advanceTimersByTimeAsync(95_000))
        expect(read.snapshot).toHaveBeenCalledTimes(1)
        view.rerender(<Frame section={null} active />)
        await act(() => vi.advanceTimersByTimeAsync(0))
        expect(read.snapshot).toHaveBeenCalledTimes(2)
        await act(() => vi.advanceTimersByTimeAsync(31_000))
        expect(read.snapshot).toHaveBeenCalledTimes(3)
    })
})

describe("Validators window · candidates", () => {
    const ZED = operator("Zed Ops", "z", address("y"), "data-center")
    beforeEach(() => {
        read.valopers.mockResolvedValue([
            ZED,
            operator("Basalt Ops", "n", BASALT, "cloud"),
            operator("Acme", "m", "", ""),
            // A hosting word named like an Object.prototype key is shown as written.
            operator("Bravo", "p", address("q"), "constructor"),
        ])
    })

    it("switches list through the window's address", async () => {
        show()
        await screen.findByRole("table")
        const lists = within(screen.getByRole("group", { name: "Validator lists" }))
        expect(lists.getByRole("button", { name: "Active set" })).toHaveAttribute("aria-pressed", "true")
        fireEvent.click(lists.getByRole("button", { name: "Candidates" }))
        expect(lastTarget()).toEqual({ kind: "app", app: "validators", section: null, query: "tab=candidates" })
        expect(pushed).not.toHaveBeenCalled()
        expect(await screen.findByRole("button", { name: "Open operator Zed Ops" })).toBeInTheDocument()
        expect(lists.getByRole("button", { name: "Candidates" })).toHaveAttribute("aria-pressed", "true")
        expect(screen.queryByRole("searchbox")).toBeNull()
    })

    it("lists the registered operators outside the consensus set, read at the roster's node and height", async () => {
        show(null, "tab=candidates")
        await screen.findByRole("button", { name: "Open operator Zed Ops" })
        // Basalt Ops signs with a key in the set: it is a validator, not a candidate.
        expect(column(0)).toEqual(["Acme", "Bravo", "Zed Ops"])
        expect(column(1)).toEqual(["—Not stated", "constructor", "Data center"])
        expect(cells("Open operator Zed Ops")).toEqual(["Zed Ops", "Data center", ZED.operatorAddress])
        const [, activeSigning, snapshot] = read.valopers.mock.calls[0]
        expect([...activeSigning]).toEqual([BASALT, ALDER, NAMELESS])
        expect(snapshot).toBe(SNAPSHOT)
    })

    it("opens an operator's page with the way back to this list", async () => {
        show(null, "tab=candidates")
        fireEvent.click(await screen.findByRole("button", { name: "Open operator Zed Ops" }))
        expect(lastPushed()).toEqual({ kind: "app", app: "validators", section: ZED.operatorAddress, query: "from=tab%3Dcandidates" })
    })

    it("reads the registry again every five minutes in front, and not at all behind another window", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        const view = show(null, "tab=candidates")
        await screen.findByRole("button", { name: "Open operator Zed Ops" })
        expect(read.valopers).toHaveBeenCalledTimes(1)
        await act(() => vi.advanceTimersByTimeAsync(301_000))
        expect(read.valopers).toHaveBeenCalledTimes(2)
        view.rerender(<Frame section={null} query="tab=candidates" active={false} />)
        await act(() => vi.advanceTimersByTimeAsync(601_000))
        expect(read.valopers).toHaveBeenCalledTimes(2)
    })

    it("says the registry could not be read, keeping the network summary", async () => {
        read.valopers.mockRejectedValue(new Error("Valoper RPC HTTP 502"))
        show(null, "tab=candidates")
        expect(await screen.findByRole("alert")).toHaveTextContent("The operator registry could not be read.")
        expect(stat("Block height")).toBeInTheDocument()
        expect(screen.queryByRole("table")).toBeNull()
    })

    it("keeps the last list and says it may be out of date when a later read of the registry fails", async () => {
        show(null, "tab=candidates")
        await screen.findByRole("button", { name: "Open operator Zed Ops" })
        read.valopers.mockRejectedValue(new Error("Valoper RPC HTTP 502"))
        await act(() => client.refetchQueries())
        expect(await screen.findByRole("alert")).toHaveTextContent("The last read of the operator registry failed: this list may be out of date.")
        expect(column(0)).toEqual(["Acme", "Bravo", "Zed Ops"])
    })

    it("says so when no operator is outside the set", async () => {
        read.valopers.mockResolvedValue([operator("Basalt Ops", "n", BASALT, "cloud")])
        show(null, "tab=candidates")
        expect(await screen.findByText("No registered operator is outside the consensus set.")).toBeInTheDocument()
        expect(screen.queryByRole("table")).toBeNull()
    })
})
