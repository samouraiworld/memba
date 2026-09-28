/**
 * Leaderboard — player names. The backend's `username` field is the free-text
 * profile title, which anyone can set; the page must show the on-chain
 * registered username (r/sys/users) or a short address, never that title.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor, fireEvent } from "@testing-library/react"
import { useLocation } from "react-router-dom"
import { create } from "@bufbuild/protobuf"
import { renderWithProviders } from "../test/test-utils"
import { GetLeaderboardResponseSchema, LeaderboardEntrySchema } from "../gen/memba/v1/memba_pb"

vi.mock("../hooks/useAdena", () => ({ useAdena: () => ({ address: undefined, connected: false }) }))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkKey: () => "gnoland1" }))
vi.mock("../lib/quests", () => ({ trackPageVisit: vi.fn() }))
vi.mock("../lib/api", () => ({ api: { getLeaderboard: vi.fn() } }))
vi.mock("../lib/profile", () => ({ resolveOnChainUsername: vi.fn() }))

const { api } = await import("../lib/api")
const { resolveOnChainUsername } = await import("../lib/profile")
const Leaderboard = (await import("./Leaderboard")).default

const ALICE = "g1alicealicealicealicealicealicealice00"
const BOB = "g1bobbobbobbobbobbobbobbobbobbobbobbob00"

function respond(entries: { address: string; username?: string }[], totalCount = entries.length) {
    vi.mocked(api.getLeaderboard).mockResolvedValue(create(GetLeaderboardResponseSchema, {
        entries: entries.map((e, i) => create(LeaderboardEntrySchema, {
            address: e.address, username: e.username ?? "", rankTier: 0, rankName: "Newcomer",
            totalXp: 100 - i, questsCompleted: 1,
        })),
        totalCount,
    }))
}

const short = (a: string) => `${a.slice(0, 10)}...${a.slice(-4)}`

function LocationProbe() {
    const location = useLocation()
    return <output data-testid="location">{location.search}</output>
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe("Leaderboard player names", () => {
    it("shows the registered on-chain username", async () => {
        respond([{ address: ALICE, username: "Gno dev" }])
        vi.mocked(resolveOnChainUsername).mockResolvedValue("@alice")
        renderWithProviders(<Leaderboard />, { route: "/gnoland1/leaderboard" })
        expect(await screen.findByText("@alice")).toBeInTheDocument()
        expect(screen.queryByText(short(ALICE))).not.toBeInTheDocument()
    })

    it("shows a short address when the wallet has no registered username", async () => {
        respond([{ address: BOB }])
        vi.mocked(resolveOnChainUsername).mockResolvedValue("")
        renderWithProviders(<Leaderboard />, { route: "/gnoland1/leaderboard" })
        expect(await screen.findByText(short(BOB))).toBeInTheDocument()
        await waitFor(() => expect(resolveOnChainUsername).toHaveBeenCalledWith(BOB))
        expect(screen.getByText(short(BOB))).toBeInTheDocument()
    })

    it("never shows the free-text profile title as the player's name", async () => {
        // Bob sets his title to look like Alice's handle.
        respond([{ address: BOB, username: "@alice" }])
        vi.mocked(resolveOnChainUsername).mockResolvedValue("")
        renderWithProviders(<Leaderboard />, { route: "/gnoland1/leaderboard" })
        await screen.findByText(short(BOB))
        await waitFor(() => expect(resolveOnChainUsername).toHaveBeenCalledWith(BOB))
        expect(screen.queryByText(/alice/)).not.toBeInTheDocument()
    })

    it("falls back to the short address when the lookup fails", async () => {
        respond([{ address: ALICE }, { address: BOB }])
        vi.mocked(resolveOnChainUsername).mockImplementation(async (a: string) => {
            if (a === ALICE) throw new Error("rpc down")
            return "@bob"
        })
        renderWithProviders(<Leaderboard />, { route: "/gnoland1/leaderboard" })
        expect(await screen.findByText("@bob")).toBeInTheDocument()
        expect(screen.getByText(short(ALICE))).toBeInTheDocument()
    })

    it("resolves only the addresses on the current page", async () => {
        respond([{ address: ALICE }, { address: BOB }])
        vi.mocked(resolveOnChainUsername).mockResolvedValue("")
        renderWithProviders(<Leaderboard />, { route: "/gnoland1/leaderboard" })
        await screen.findByText(short(ALICE))
        await waitFor(() => expect(resolveOnChainUsername).toHaveBeenCalledTimes(2))
        expect(vi.mocked(resolveOnChainUsername).mock.calls.map(c => c[0]).sort()).toEqual([ALICE, BOB].sort())
    })

    it("loads a shared page URL and updates the URL when paging", async () => {
        respond([{ address: ALICE }], 120)
        vi.mocked(resolveOnChainUsername).mockResolvedValue("")
        renderWithProviders(<><Leaderboard /><LocationProbe /></>, { route: "/gnoland1/leaderboard?page=2" })
        await screen.findByText(short(ALICE))
        expect(vi.mocked(api.getLeaderboard).mock.calls[0][0].offset).toBe(50)
        expect(screen.getByText("Page 2 of 3")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Next" }))
        await waitFor(() => expect(vi.mocked(api.getLeaderboard).mock.calls.at(-1)?.[0].offset).toBe(100))
        expect(screen.getByTestId("location")).toHaveTextContent("?page=3")
    })

    it("offers retry after a failed request and clears the error on success", async () => {
        vi.mocked(api.getLeaderboard).mockRejectedValueOnce(new Error("offline"))
        respond([{ address: ALICE }])
        vi.mocked(resolveOnChainUsername).mockResolvedValue("")
        renderWithProviders(<Leaderboard />, { route: "/gnoland1/leaderboard" })
        fireEvent.click(await screen.findByRole("button", { name: "Try again" }))
        expect(await screen.findByText(short(ALICE))).toBeInTheDocument()
        expect(screen.queryByText(/Unable to load leaderboard/)).toBeNull()
    })

    it("gives an out-of-range shared page a direct way back", async () => {
        respond([], 3)
        renderWithProviders(<><Leaderboard /><LocationProbe /></>, { route: "/gnoland1/leaderboard?page=9" })
        fireEvent.click(await screen.findByRole("button", { name: "Back to first page" }))
        expect(screen.getByTestId("location")).toHaveTextContent("")
    })
})
