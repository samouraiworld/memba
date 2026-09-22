import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { RecentSubmissionsSection } from "./RecentSubmissionsSection"

const network = vi.hoisted(() => ({ key: "mainnet" }))
vi.mock("../../hooks/useNetwork", () => ({ useNetwork: () => ({ networkKey: network.key }) }))
vi.mock("../../lib/config", async importOriginal => ({ ...await importOriginal<typeof import("../../lib/config")>(), isExplorerEnabled: () => true }))
vi.mock("./RealmDetailDrawer", () => ({ RealmDetailDrawer: ({ path }: { path: string }) => <output data-testid="submission-source">{path}</output> }))

const HASH = "LEDHNAXCxlrRMTKCsmlLNDMkIK1eLhfWUGxSAzFcEV4="
const HEX = "2c40c73405c2c65ad1313282b2694b34332420ad5e2e17d6506c5203315c115e"
const REALM = "gno.land/r/demo/one"
const PACKAGE = "gno.land/p/demo/two"

function doc(rows = [
    { path: REALM, kind: "realm", creator: "g1realm", txHash: HASH, blockHeight: 20_000, txIndex: 1 },
    { path: PACKAGE, kind: "package", creator: "g1package", txHash: HASH, blockHeight: 19_999, txIndex: 0 },
]) {
    return { chainId: "gnoland-1", source: "official-mainnet-tx-indexer", checkedAt: "2026-09-22T14:26:04Z", indexedHeight: 20_000, windowStart: 9_801, windowEnd: 20_000, coverage: "window-only", rows }
}

function mount(kind: "realm" | "package") {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(<MemoryRouter initialEntries={["/mainnet/directory"]}><QueryClientProvider client={client}><RecentSubmissionsSection kind={kind} /></QueryClientProvider></MemoryRouter>)
    return { ...view, client }
}

beforeEach(() => { network.key = "mainnet" })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe("RecentSubmissionsSection", () => {
    it("keeps editorial tabs separate and shows exact mainnet links and provenance", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(doc()), { status: 200 }))
        vi.stubGlobal("fetch", fetchMock)
        mount("realm")
        expect(screen.getByText("Checking recent submissions…")).toBeInTheDocument()
        expect(await screen.findByText(REALM)).toBeInTheDocument()
        expect(screen.queryByText(PACKAGE)).not.toBeInTheDocument()
        expect(screen.getByText("Added on chain; activation not checked.")).toBeInTheDocument()
        expect(screen.getByText(/Indexed through block 20,000 · checked at 14:26 UTC/)).toBeInTheDocument()
        expect(screen.getByRole("link", { name: /Transaction for/ })).toHaveAttribute("href", `https://rpc.gno.land/tx?hash=0x${HEX}`)
        expect(screen.getByRole("link", { name: /Block 20000 for/ })).toHaveAttribute("href", "https://rpc.gno.land/block?height=20000")
        expect(screen.getByRole("link", { name: "In-app Explorer" })).toHaveAttribute("href", "/mainnet/directory?tab=explorer&realm=r/demo/one")
        fireEvent.click(screen.getByRole("button", { name: `View source for ${REALM}` }))
        expect(screen.getByTestId("submission-source")).toHaveTextContent(REALM)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("never fetches or displays mainnet submissions on Pearl", () => {
        network.key = "pearl"
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        mount("package")
        expect(screen.queryByText(/Recent package submissions/)).not.toBeInTheDocument()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("shows a valid empty window, then retries manually without a poll", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(doc([])), { status: 200 }))
        vi.stubGlobal("fetch", fetchMock)
        mount("package")
        expect(await screen.findByText("No submissions in the checked window.")).toBeInTheDocument()
        await new Promise(resolve => setTimeout(resolve, 30))
        expect(fetchMock).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    })

    it("retains checked rows and timestamp when a refresh fails", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(doc()), { status: 200 })).mockResolvedValueOnce(new Response("{}", { status: 503 }))
        vi.stubGlobal("fetch", fetchMock)
        mount("package")
        expect(await screen.findByText(PACKAGE)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
        expect(await screen.findByText(/Stale · Showing previously checked submissions/)).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
        expect(screen.getByText(PACKAGE)).toBeInTheDocument()
        expect(screen.getByText(/checked at 14:26 UTC/)).toBeInTheDocument()
    })

    it("distinguishes a wrong-source first load from an empty window", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...doc(), chainId: "pearl-1" }), { status: 200 })))
        mount("realm")
        expect(await screen.findByText("The submission source could not be verified for gno.land.")).toBeInTheDocument()
        expect(screen.queryByText("No submissions in the checked window.")).not.toBeInTheDocument()
        expect(screen.queryByText(REALM)).not.toBeInTheDocument()
    })

    it("keeps a first-load request visible until it finishes", async () => {
        let finish!: (response: Response) => void
        vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve })))
        mount("realm")
        expect(screen.getByText("Checking recent submissions…")).toBeInTheDocument()
        finish(new Response(JSON.stringify(doc()), { status: 200 }))
        expect(await screen.findByText(REALM)).toBeInTheDocument()
    })
})
