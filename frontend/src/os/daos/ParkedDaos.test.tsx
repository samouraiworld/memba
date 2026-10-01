import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

vi.mock("../../lib/config", async (orig) => ({ ...(await orig<typeof import("../../lib/config")>()), GNO_CHAIN_ID: "gnoland-1" }))
vi.mock("../../lib/dao/packageStatus", async (orig) => {
    const real = await orig<typeof import("../../lib/dao/packageStatus")>()
    return {
        ...real,
        // What the chain answers per path: the live one is reported and dropped, as the real check does.
        checkPendingDAOs: vi.fn(async (ctx: { chainId: string }, onLive: (e: import("../../lib/dao/packageStatus").PendingDAO) => void) => {
            const still = []
            for (const entry of real.listPendingDAOs(ctx.chainId)) {
                if (entry.path.endsWith("/live_one")) { onLive(entry); real.removePendingDAO(ctx.chainId, entry.path); continue }
                const check = entry.path.endsWith("/gone") ? "not-found" as const : entry.path.endsWith("/unread") ? "unknown" as const : entry.path.endsWith("/unsaved") ? "live-unsaved" as const : "waiting" as const
                still.push({ ...entry, check })
            }
            return still
        }),
    }
})

import { checkPendingDAOs, clearPendingMemory, savePendingDAO } from "../../lib/dao/packageStatus"
import { getAllSavedDAOs } from "../../lib/daoSlug"
import { queryClient as appQueryClient } from "../../lib/queryClient"
import { ParkedDaos } from "./ParkedDaos"

const ME = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const at = (name: string) => `gno.land/r/${ME}/${name}`
const park = (name: string) => savePendingDAO({ chainId: "gnoland-1", path: at(name), name, txHash: "H", reason: "waiting for a package approver to enable it", wallet: ME, orgId: null, phase: "submitted" })
// The app's query defaults (a 30 s staleTime among them), so a cached answer is what the app would have.
const client = () => new QueryClient({ defaultOptions: appQueryClient.getDefaultOptions() })
const shown = (onEnabled = vi.fn(), c = client()) => render(<QueryClientProvider client={c}><ParkedDaos onEnabled={onEnabled} /></QueryClientProvider>)

afterEach(() => { localStorage.clear(); clearPendingMemory(); vi.clearAllMocks() })

describe("ParkedDaos", () => {
    it("lists this browser's deploys that are not live, re-checked: waiting, or not on chain", async () => {
        park("surf_club")
        park("gone")
        shown()
        expect(await screen.findByText("Submitted · waiting for network approval")).toBeInTheDocument()
        expect(screen.getByText("Not on chain yet: check the transaction before deploying again")).toBeInTheDocument()
        expect(screen.getByText(at("surf_club"))).toBeInTheDocument()
    })

    it("an enabled one leaves the list for the saved DAOs, and the window is told to re-read them", async () => {
        park("live_one")
        park("surf_club")
        const onEnabled = vi.fn()
        shown(onEnabled)
        await screen.findByText("Submitted · waiting for network approval")
        expect(onEnabled).toHaveBeenCalledOnce()
        expect(screen.queryByText(at("live_one"))).toBeNull()
        expect(getAllSavedDAOs().some((d) => d.realmPath === at("live_one"))).toBe(true)
    })

    it("words every answer: unreadable, and live but not saved here", async () => {
        park("unread")
        park("unsaved")
        shown()
        expect(await screen.findByText("Status couldn't be read")).toBeInTheDocument()
        expect(screen.getByText("Live, but this browser couldn't save it: open it by its address below")).toBeInTheDocument()
    })

    it("a failed check says so once for the list, and every row says its status couldn't be read", async () => {
        vi.mocked(checkPendingDAOs).mockRejectedValueOnce(new Error("no node"))
        park("surf_club")
        shown()
        expect(await screen.findByText("Couldn't read the network. Check again in a moment.")).toBeInTheDocument()
        expect(screen.getByText("Status couldn't be read")).toBeInTheDocument()
        expect(screen.getAllByRole("status")).toHaveLength(1)
    })

    it("Check again reads the chain again; it stays focusable while a check runs", async () => {
        park("surf_club")
        shown()
        await screen.findByText("Submitted · waiting for network approval")
        const again = screen.getByRole("button", { name: "Check again" })
        fireEvent.click(again)
        expect(again).not.toBeDisabled()
        await waitFor(() => expect(checkPendingDAOs).toHaveBeenCalledTimes(2))
    })

    it("a deploy parked after an earlier answer shows at once, and one settled elsewhere leaves", async () => {
        park("surf_club")
        const c = client()
        const first = shown(vi.fn(), c)
        await screen.findByText("Submitted · waiting for network approval")
        first.unmount()
        park("second_club")
        const { removePendingDAO } = await import("../../lib/dao/packageStatus")
        removePendingDAO("gnoland-1", at("surf_club"))
        shown(vi.fn(), c)
        expect(screen.getByText(at("second_club"))).toBeInTheDocument()
        expect(screen.queryByText(at("surf_club"))).toBeNull()
        expect(await screen.findByText("Submitted · waiting for network approval")).toBeInTheDocument()
    })

    it("shows nothing and reads nothing when no deploy is parked", async () => {
        const { container } = shown()
        await waitFor(() => expect(container).toBeEmptyDOMElement())
        expect(checkPendingDAOs).not.toHaveBeenCalled()
    })
})
