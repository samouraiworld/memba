/**
 * Leaderboard — player names. The backend's `username` field is the free-text
 * profile title, which anyone can set; the page must show the on-chain
 * registered username (r/sys/users) or a short address, never that title.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
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

function respond(entries: { address: string; username?: string }[]) {
    vi.mocked(api.getLeaderboard).mockResolvedValue(create(GetLeaderboardResponseSchema, {
        entries: entries.map((e, i) => create(LeaderboardEntrySchema, {
            address: e.address, username: e.username ?? "", rankTier: 0, rankName: "Newcomer",
            totalXp: 100 - i, questsCompleted: 1,
        })),
        totalCount: entries.length,
    }))
}

const short = (a: string) => `${a.slice(0, 10)}...${a.slice(-4)}`

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
})
