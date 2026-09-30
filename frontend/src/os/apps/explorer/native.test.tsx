import type { ComponentProps } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DirectoryRealm } from "../../../lib/directory"
import type { DirectoryDiscovery } from "../../../lib/directoryDiscovery"
import { NAMESPACE_LISTING_LIMIT } from "../../../lib/gnoweb"
import ExplorerWindow from "./native"

const mocks = vi.hoisted(() => ({ stats: vi.fn(), discovery: vi.fn(), factory: false }))
vi.mock("../../../lib/validators", () => ({ getNetworkStats: mocks.stats }))
vi.mock("../../../lib/directoryDiscovery", async (original) => ({
    ...(await original<typeof import("../../../lib/directoryDiscovery")>()),
    fetchDirectoryDiscovery: mocks.discovery,
}))
vi.mock("../../../lib/directory", async (original) => ({
    ...(await original<typeof import("../../../lib/directory")>()),
    getDirectoryDAOs: () => [],
}))
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    isRealmValidOn: () => mocks.factory,
}))

const STATS = { blockHeight: 1234567, avgBlockTime: 2.04, totalValidators: 23, totalVotingPower: 23, chainId: "gnoland-1", catchingUp: false, latestBlockTime: "" }
const editorial = (name: string, path: string, description: string): DirectoryRealm =>
    ({ name, path, description, category: "social", networkKey: "mainnet", provenance: "editorial", checkedAt: "2026-09-22" })
const listed = (name: string): DirectoryRealm =>
    ({ name, path: `gno.land/r/samcrew/${name}`, description: "Listed in this network’s samcrew namespace", category: "unknown", networkKey: "mainnet", provenance: "namespace" })
const BLOG = editorial("Blog", "gno.land/r/gnoland/blog", "Official gno.land blog")
const BOARDS = editorial("Boards", "gno.land/r/gnoland/boards2/v0", "Community discussion boards")
const ready = (realms: DirectoryRealm[]): DirectoryDiscovery => ({ packages: [], realms, status: "ready", realmStatus: "ready" })
const many = (n: number) => Array.from({ length: n }, (_, i) => listed(`realm_${String(i + 1).padStart(4, "0")}`))

const session = { status: "guest", address: "", network: { key: "mainnet", chainId: "gnoland-1" } } as never
/** `open`: the address was replaced. `push`: a history entry was added. */
const open = vi.fn()
const push = vi.fn()
const toast = vi.fn()
type Props = Partial<ComponentProps<typeof ExplorerWindow>>
const view = (props: Props) => (
    <ExplorerWindow section={null} session={session} active open={open} push={push} openApp={vi.fn()} close={vi.fn()} toast={toast} fallback={<p>classic page</p>} {...props} />
)
function show(props: Props = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = (p: Props) => <QueryClientProvider client={client}>{view(p)}</QueryClientProvider>
    const result = render(ui(props))
    return { ...result, again: (p: Props) => result.rerender(ui(p)) }
}
/** The address a navigation asked the shell for, replacing the current one or as a history entry. */
const opened = () => open.mock.calls.at(-1)?.[0].target
const pushed = () => push.mock.calls.at(-1)?.[0].target
const explorerAt = (query: string) => ({ kind: "app", app: "explorer", section: null, query })
const rowNames = () => screen.getAllByRole("row").slice(1).map((row) => within(row).getByRole("button").getAttribute("aria-label"))

beforeEach(() => {
    localStorage.clear()
    open.mockReset()
    push.mockReset()
    toast.mockReset()
    mocks.factory = false
    mocks.stats.mockReset().mockResolvedValue(STATS)
    mocks.discovery.mockReset().mockResolvedValue(ready([BOARDS, BLOG, listed("memba_dao")]))
})
afterEach(() => { vi.useRealTimers() })

describe("Explorer home", () => {
    it("shows the chain figures the reader returned and the listed realms", async () => {
        show()
        expect(screen.getByRole("heading", { level: 1, name: "Realm directory" })).toHaveAttribute("tabindex", "-1")
        expect(await screen.findByText("1,234,567")).toBeInTheDocument()
        expect(screen.getByText("23")).toBeInTheDocument()
        expect(screen.getByText("2.0 s")).toBeInTheDocument()
        expect(screen.getByText("gnoland-1")).toBeInTheDocument()
        expect(await screen.findByText("3 realms listed")).toBeInTheDocument()
        expect(rowNames()).toEqual(["Open Boards, gno.land/r/gnoland/boards2/v0", "Open Blog, gno.land/r/gnoland/blog", "Open memba_dao, gno.land/r/samcrew/memba_dao"])
        expect(screen.getByText("Official gno.land blog")).toBeInTheDocument()
        expect(screen.getAllByText("social · Editorial · source checked 2026-09-22")).toHaveLength(2)
        expect(screen.getByText("Namespace listing · read status not checked")).toBeInTheDocument()
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
        expect(mocks.discovery).toHaveBeenCalledWith("mainnet", [])
    })

    it("reads the chain figures again every 30 seconds in front", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        show()
        expect(await screen.findByText("1,234,567")).toBeInTheDocument()
        expect(mocks.stats).toHaveBeenCalledTimes(1)
        await act(() => vi.advanceTimersByTimeAsync(31_000))
        expect(mocks.stats).toHaveBeenCalledTimes(2)
    })

    it("does not retry a failed read of the figures behind another window", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        mocks.stats.mockRejectedValue(new Error("offline"))
        show({ active: false })
        expect(await screen.findByText("The chain figures could not be read from the network.")).toBeInTheDocument()
        await act(() => vi.advanceTimersByTimeAsync(95_000))
        expect(mocks.stats).toHaveBeenCalledTimes(1)
    })

    it("reads once behind another window without polling, and again when brought forward", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        const { again } = show({ active: false })
        expect(await screen.findByText("1,234,567")).toBeInTheDocument()
        expect(await screen.findByText("3 realms listed")).toBeInTheDocument()
        await act(() => vi.advanceTimersByTimeAsync(95_000))
        expect(mocks.stats).toHaveBeenCalledTimes(1)
        again({ active: true })
        await act(() => vi.advanceTimersByTimeAsync(0))
        expect(mocks.stats).toHaveBeenCalledTimes(2)
    })

    it("reads the figures again when brought forward after a read that failed behind another window", async () => {
        mocks.stats.mockRejectedValueOnce(new Error("offline"))
        const { again } = show({ active: false })
        expect(await screen.findByText("The chain figures could not be read from the network.")).toBeInTheDocument()
        expect(mocks.stats).toHaveBeenCalledTimes(1)
        again({ active: true })
        expect(await screen.findByText("1,234,567")).toBeInTheDocument()
        expect(mocks.stats).toHaveBeenCalledTimes(2)
    })

    it("counts as a page visit toward the five-pages quest, as the classic Directory does", () => {
        show()
        expect(JSON.parse(localStorage.getItem("memba_quest_pages")!)).toEqual(["directory"])
    })

    it("leaves out the average block time when the node gave nothing to measure it from", async () => {
        mocks.stats.mockResolvedValue({ ...STATS, avgBlockTime: 0 })
        show()
        expect(await screen.findByText("1,234,567")).toBeInTheDocument()
        expect(screen.queryByText("Average block time")).not.toBeInTheDocument()
    })

    it("says the chain is unreachable instead of showing figures, and reads again on Retry", async () => {
        mocks.stats.mockRejectedValueOnce(new Error("offline"))
        show()
        const alert = await screen.findByRole("alert")
        expect(alert).toHaveTextContent("The chain figures could not be read from the network.")
        expect(screen.queryByText("Block height")).not.toBeInTheDocument()
        fireEvent.click(within(alert).getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("1,234,567")).toBeInTheDocument()
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })

    it("shows an error, never an empty directory, when the listing reader rejects", async () => {
        mocks.discovery.mockRejectedValueOnce(new Error("offline"))
        show()
        expect(await screen.findByText("The realm directory could not be read.")).toBeInTheDocument()
        expect(screen.queryByRole("table")).not.toBeInTheDocument()
        expect(screen.queryByText(/realms? listed/)).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("3 realms listed")).toBeInTheDocument()
    })

    it("says the namespace could not be read when the network returned none of it", async () => {
        mocks.discovery.mockResolvedValueOnce({ packages: [], realms: [BOARDS, BLOG], status: "partial", realmStatus: "unavailable" })
        show()
        const alert = await screen.findByRole("alert")
        expect(alert).toHaveTextContent("The on-chain namespace listing could not be read from the network. Only curated and saved entries are shown.")
        expect(rowNames()).toHaveLength(2)
        fireEvent.click(within(alert).getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("3 realms listed")).toBeInTheDocument()
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })

    it("says nothing is missing when only the packages listing failed and the realm listing was read in full", async () => {
        mocks.discovery.mockResolvedValue({ packages: [], realms: [BLOG, listed("memba_dao")], status: "partial", realmStatus: "ready" })
        show()
        expect(await screen.findByText("2 realms listed")).toBeInTheDocument()
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
        expect(screen.queryByRole("note")).not.toBeInTheDocument()
    })

    it("says the list is the first window of a longer one when the listing was cut at its limit", async () => {
        mocks.discovery.mockResolvedValue({ packages: [], realms: many(NAMESPACE_LISTING_LIMIT), status: "partial", realmStatus: "partial" })
        show()
        expect(await screen.findByRole("note")).toHaveTextContent("Showing the first 1,000 realms of the on-chain namespace listing.")
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })

    it("filters by the search in the address and writes a new search to it", async () => {
        const { again } = show({ query: "find=BLOG" })
        expect(await screen.findByText("1 of 3 listed realms match “BLOG”")).toBeInTheDocument()
        expect(rowNames()).toEqual(["Open Blog, gno.land/r/gnoland/blog"])
        const box = screen.getByRole("searchbox", { name: "Search listed realms, or enter a realm or package path" })
        expect(box).toHaveValue("BLOG")
        fireEvent.change(box, { target: { value: "  samcrew " } })
        fireEvent.click(screen.getByRole("button", { name: "Search" }))
        expect(opened()).toEqual(explorerAt("find=samcrew"))
        fireEvent.click(screen.getByRole("button", { name: "Clear" }))
        expect(opened()).toEqual(explorerAt(""))
        // A search refines the home it is on: no history entry.
        expect(push).not.toHaveBeenCalled()
        // The box follows the address, e.g. after Clear or a return from a classic view.
        again({ query: "" })
        expect(box).toHaveValue("")
        expect(screen.getByText("3 realms listed")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument()
    })

    it("says so when nothing matches", async () => {
        show({ query: "find=nothing-like-this" })
        expect(await screen.findByText("No listed realm matches “nothing-like-this”.")).toBeInTheDocument()
        expect(screen.queryByRole("table")).not.toBeInTheDocument()
    })

    it("pages through the list from the address, keeping the search", async () => {
        mocks.discovery.mockResolvedValue(ready([BLOG, ...many(44)]))
        const { again } = show()
        expect(await screen.findByText("Showing 1–20 of 45")).toBeInTheDocument()
        expect(rowNames()).toHaveLength(20)
        expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
        fireEvent.click(screen.getByRole("button", { name: "Next" }))
        expect(opened()).toEqual(explorerAt("page=2"))

        again({ query: "page=3" })
        expect(screen.getByText("Showing 41–45 of 45")).toBeInTheDocument()
        expect(rowNames()).toHaveLength(5)
        expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
        fireEvent.click(screen.getByRole("button", { name: "Previous" }))
        expect(opened()).toEqual(explorerAt("page=2"))

        // A page past the end (a stale link) lands on the last page.
        again({ query: "page=99" })
        expect(screen.getByText("Showing 41–45 of 45")).toBeInTheDocument()

        again({ query: "find=realm_&page=2" })
        expect(screen.getByText("Showing 21–40 of 44")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Next" }))
        expect(opened()).toEqual(explorerAt("find=realm_&page=3"))
        expect(push).not.toHaveBeenCalled()
    })

    it("opens a realm as the classic realm view in the same window, as a history entry", async () => {
        show()
        fireEvent.click(await screen.findByRole("button", { name: "Open Blog, gno.land/r/gnoland/blog" }))
        expect(pushed()).toEqual(explorerAt("tab=explorer&realm=r%2Fgnoland%2Fblog"))
        expect(push.mock.calls.at(-1)?.[0].key).toBe("app:explorer")
        expect(open).not.toHaveBeenCalled()
    })

    it("offers a typed path even when it is not in the list", async () => {
        show({ query: "find=gno.land%2Fr%2Fdemo%2Fcounter" })
        fireEvent.click(await screen.findByRole("button", { name: "Open gno.land/r/demo/counter" }))
        expect(pushed()).toEqual(explorerAt("tab=explorer&realm=r%2Fdemo%2Fcounter"))
    })

    it("says a listed path cannot be opened rather than doing nothing", async () => {
        mocks.discovery.mockResolvedValue(ready([{ ...BLOG, name: "Short", path: "gno.land/r/short" }]))
        show()
        fireEvent.click(await screen.findByRole("button", { name: "Open Short, gno.land/r/short" }))
        expect(push).not.toHaveBeenCalled()
        expect(open).not.toHaveBeenCalled()
        expect(toast).toHaveBeenCalledWith("Memba cannot open this path in its realm view.")
    })

    it("shows chain text as text", async () => {
        mocks.discovery.mockResolvedValue(ready([{ ...BLOG, name: "Evil‮name", description: "<img src=x onerror=alert(1)> **bold**" }]))
        const { container } = show()
        expect(await screen.findByText("<img src=x onerror=alert(1)> **bold**")).toBeInTheDocument()
        expect(container.querySelector("img")).toBeNull()
        expect(screen.getByText("Evil[U+202E]name")).toBeInTheDocument()
    })

    it.each([
        ["Packages", "packages"], ["DAOs", "daos"], ["Users", "users"], ["GovDAO", "govdao"], ["Leaderboard", "leaderboard"],
    ])("opens the classic %s tab in the same window, as a history entry", (name, tab) => {
        show()
        fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }))
        expect(pushed()).toEqual(explorerAt(`tab=${tab}`))
        expect(open).not.toHaveBeenCalled()
    })

    it("offers the Tokens tab only where the token factory exists", () => {
        const first = show()
        expect(screen.queryByRole("button", { name: /^Tokens/ })).not.toBeInTheDocument()
        first.unmount()
        mocks.factory = true
        show()
        fireEvent.click(screen.getByRole("button", { name: /^Tokens/ }))
        expect(pushed()).toEqual(explorerAt("tab=tokens"))
    })
})

describe("Explorer fallback", () => {
    it.each([
        ["a classic tab", "tab=daos"],
        ["the default tab named outright", "tab=packages"],
        ["an unknown tab", "tab=bogus"],
        ["the realm view", "tab=explorer&realm=r%2Fgnoland%2Fblog"],
        ["a package drawer on the default tab", "realm=p%2Fdemo%2Favl"],
        ["a classic search", "q=dao"],
    ])("leaves %s to the classic page, under a way back to the home, and reads nothing", (_, query) => {
        show({ query })
        expect(screen.getByText("classic page")).toBeInTheDocument()
        expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument()
        expect(mocks.stats).not.toHaveBeenCalled()
        expect(mocks.discovery).not.toHaveBeenCalled()
        expect(localStorage.getItem("memba_quest_pages")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Realm directory" }))
        expect(pushed()).toEqual(explorerAt(""))
    })

    it.each(["explorer/r/gnoland/blog", "explorer", "r/gnoland/blog", "nowhere"])("hands the %s section to the fallback untouched", (section) => {
        const { container } = show({ section })
        expect(container.innerHTML).toBe("<p>classic page</p>")
        expect(mocks.stats).not.toHaveBeenCalled()
        expect(mocks.discovery).not.toHaveBeenCalled()
    })

    it("takes the home under its classic name too", async () => {
        show({ section: "directory" })
        expect(await screen.findByText("3 realms listed")).toBeInTheDocument()
    })

    it("moves focus into the view a control opened: the way back, then the home heading", async () => {
        const { again } = show()
        const card = screen.getByRole("button", { name: /^DAOs/ })
        card.focus()
        fireEvent.click(card)
        again({ query: "tab=daos" })
        const back = screen.getByRole("button", { name: "Realm directory" })
        expect(back).toHaveFocus()
        fireEvent.click(back)
        again({ query: "" })
        expect(screen.getByRole("heading", { level: 1 })).toHaveFocus()
    })

    it("moves focus in from the frame around the view too, where a click can leave it", () => {
        const frame = document.body.appendChild(document.createElement("section"))
        frame.tabIndex = -1
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const ui = (query: string) => <QueryClientProvider client={client}>{view({ query })}</QueryClientProvider>
        const { rerender, unmount } = render(ui(""), { container: frame })
        frame.focus()
        rerender(ui("tab=daos"))
        expect(screen.getByRole("button", { name: "Realm directory" })).toHaveFocus()
        unmount()
        frame.remove()
    })

    it("leaves focus alone when it is on a control somewhere else", () => {
        const outside = document.body.appendChild(document.createElement("button"))
        const { again } = show()
        outside.focus()
        again({ query: "tab=daos" })
        expect(outside).toHaveFocus()
        outside.remove()
    })
})
