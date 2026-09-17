/**
 * ChannelsPage.test.tsx — owner-only CreateChannel control.
 *
 * CreateChannel is owner-only on-chain (assertCallerIsOwner). These tests cover
 * the UI gate (button shown only to the realm owner, resolved via GetOwner()) and
 * the create flow (build CreateChannel msg → broadcast → refresh).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"

// Fresh client per render: retry off (a failing query must fail now, not after
// backoff) and zero cache sharing between tests.
function render(ui: ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
import { ChannelsPage } from "./ChannelsPage"

const mockNavigate = vi.fn()
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => mockNavigate }))
vi.mock("../hooks/useDaoRoute", () => ({
    useDaoRoute: () => ({ realmPath: "gno.land/r/user/mydao", encodedSlug: "mydao", channelName: undefined }),
}))

const mockAdena = { connected: true, address: "g1owner", installed: true, loading: false }
const mockAuth = { isAuthenticated: true, address: "g1owner", token: { value: "t" }, loading: false, error: null }
vi.mock("react-router-dom", () => ({ useOutletContext: () => ({ adena: mockAdena, auth: mockAuth }) }))

// detectChannelRealm runs for real; only the chain read underneath is mocked.
vi.mock("../plugins/board/parser", async (orig) => ({
    ...(await orig<typeof import("../plugins/board/parser")>()),
    getBoardInfo: vi.fn(() => Promise.resolve({
        name: "MyDAO Channels",
        channels: [{ name: "general", type: "text", threadCount: 0, archived: false }],
    })),
}))
vi.mock("../plugins/board/BoardView", () => ({ default: () => <div data-testid="board-view" /> }))
vi.mock("../lib/dao", () => ({ getDAOMembers: vi.fn(() => Promise.resolve([])) }))
vi.mock("../plugins/board/boardHelpers", () => ({
    hasChannelUnread: () => false, markChannelVisited: vi.fn(), updateChannelThreadCount: vi.fn(),
}))
vi.mock("./channelHelpers", () => ({ channelIcon: () => "#", defaultChannel: () => "general" }))
vi.mock("../lib/config", () => ({
    GNO_RPC_URL: "https://rpc.test.gno.land",
    MEMBA_DAO: { realmPath: "gno.land/r/samcrew/memba_dao", channelsPath: "gno.land/r/samcrew/memba_dao_channels_v2" },
}))
vi.mock("../lib/grc20", () => ({ doContractBroadcast: vi.fn(() => Promise.resolve()) }))
vi.mock("../lib/dao/shared", () => ({
    queryEval: vi.fn(() => Promise.resolve('("g1owner" .uverse.address)')),
    // Both this DAO's channels realm and MembaDAO's exist; the page must pick the DAO's own.
    queryRender: vi.fn((_rpc: string, path: string) => Promise.resolve(
        path === "gno.land/r/user/mydao_channels" || path === "gno.land/r/samcrew/memba_dao_channels_v2" ? "# Channels" : null,
    )),
}))
vi.mock("../lib/channelTemplate", () => ({
    buildCreateChannelMsg: vi.fn(() => ({ type: "vm/MsgCall", value: { func: "CreateChannel" } })),
    parseOwnerAddress: vi.fn((r: string | null) => (r ? "g1owner" : "")),
    isValidChannelName: vi.fn(() => true),
}))

const grc20 = await import("../lib/grc20")
const channelTpl = await import("../lib/channelTemplate")

beforeEach(() => {
    vi.clearAllMocks()
    mockAdena.address = "g1owner"
    vi.mocked(channelTpl.parseOwnerAddress).mockImplementation((r) => (r ? "g1owner" : ""))
    vi.mocked(channelTpl.isValidChannelName).mockReturnValue(true)
    vi.mocked(grc20.doContractBroadcast).mockResolvedValue(undefined as never)
})

describe("ChannelsPage — owner-only CreateChannel", () => {
    it("hides the create control when the connected user is NOT the realm owner", async () => {
        mockAdena.address = "g1notowner"
        vi.mocked(channelTpl.parseOwnerAddress).mockReturnValue("g1owner")
        render(<ChannelsPage />)
        // Wait for the main layout (BoardView stub) to render, then assert no control.
        await screen.findByTestId("board-view")
        expect(screen.queryByLabelText("New channel")).not.toBeInTheDocument()
    })

    it("shows the create control for the owner and creates a channel via broadcast", async () => {
        render(<ChannelsPage />)
        const newBtn = await screen.findByLabelText("New channel")
        fireEvent.click(newBtn)

        fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "proposals" } })
        fireEvent.change(screen.getByLabelText("Channel type"), { target: { value: "announcements" } })
        fireEvent.click(screen.getByRole("button", { name: "Create channel" }))

        await waitFor(() => expect(grc20.doContractBroadcast).toHaveBeenCalled())
        expect(channelTpl.buildCreateChannelMsg).toHaveBeenCalledWith(
            "g1owner", "gno.land/r/user/mydao_channels", "proposals", "", "announcements",
        )
    })

    it("blocks an invalid channel name before broadcasting", async () => {
        vi.mocked(channelTpl.isValidChannelName).mockReturnValue(false)
        render(<ChannelsPage />)
        fireEvent.click(await screen.findByLabelText("New channel"))
        fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "Bad Name!" } })
        fireEvent.click(screen.getByRole("button", { name: "Create channel" }))
        await waitFor(() => expect(screen.getByText(/Invalid name/)).toBeInTheDocument())
        expect(grc20.doContractBroadcast).not.toHaveBeenCalled()
    })

    it("rejects an underscore name even when the shared validator allows it (realm forbids _)", async () => {
        vi.mocked(channelTpl.isValidChannelName).mockReturnValue(true)
        render(<ChannelsPage />)
        fireEvent.click(await screen.findByLabelText("New channel"))
        fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "my_channel" } })
        fireEvent.click(screen.getByRole("button", { name: "Create channel" }))
        await waitFor(() => expect(screen.getByText(/no underscores/)).toBeInTheDocument())
        expect(grc20.doContractBroadcast).not.toHaveBeenCalled()
    })
})
