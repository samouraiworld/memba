import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { FREE_PLAY_REALM, type FreePlayBoardQuery } from "../../../lib/arcadeFreePlay"
import type { ArcadeGame } from "./catalogue"
import { GamePage } from "./GamePage"

vi.mock("../../kit/storefront", () => ({
    DetailLayout: ({ main, side }: { main: ReactNode; side: ReactNode }) => <>{main}{side}</>,
    InfoRows: () => null, MediaGallery: () => null, RatingBadge: () => null,
    useReviewSummaries: () => new Map(),
}))
vi.mock("../store/ReviewsPanel", () => ({ ReviewsPanel: () => null }))
vi.mock("./DailyTop", () => ({ DailyTop: () => null }))
vi.mock("../../../game/components/NextBoardCountdown", () => ({ NextBoardCountdown: () => null }))
vi.mock("../../../lib/config", () => ({ connect4PathFor: () => null, isRealmValidOn: () => false, reviewsPathFor: () => "" }))
vi.mock("../../shell/windows", () => ({ specForTarget: () => ({}) }))

const target = { chainId: "gnoland-1", realm: FREE_PLAY_REALM }
const session = { network: { key: "mainnet", chainId: "gnoland-1" }, status: "guest" } as never
const game = (id: ArcadeGame["id"]): ArcadeGame => ({ id, name: id, section: "game", pitch: "", description: "", howTo: [], tags: [], cost: "free", info: [], reviewSubject: null, enabled: () => true, daily: false, dailyBoard: false, featured: false })
const common = { session, open: () => {}, toLobby: () => {} }

describe("Game page board boundary", () => {
    it.each(["block-party", "space-invaders", "barricade"] as const)("mounts the injected board only for %s", async id => {
        const client = { board: vi.fn(async (query: FreePlayBoardQuery) => ({ ...query, target, entries: [] })) }
        render(<GamePage {...common} game={game(id)} freePlayBoard={{ client, target, game: id, rules: "rules-v1", simVersion: 1 }} />)
        expect(await screen.findByText("No anchored scores yet for these rules.")).toBeVisible()
        expect(client.board).toHaveBeenCalledWith(expect.objectContaining({ game: id }), expect.any(AbortSignal))
    })

    it.each(["connect4", "barricade"] as const)("does not route a Space Invaders board into %s", id => {
        const client = { board: vi.fn() }
        render(<GamePage {...common} game={game(id)} freePlayBoard={{ client, target, game: "space-invaders", rules: "rules-v1", simVersion: 1 }} />)
        expect(screen.queryByRole("heading", { name: "Free play leaderboard" })).not.toBeInTheDocument()
        expect(client.board).not.toHaveBeenCalled()
    })

    it("does not display a board for a different active network", () => {
        const client = { board: vi.fn() }
        render(<GamePage {...common} game={game("space-invaders")} freePlayBoard={{ client, target: { ...target, chainId: "onyx" }, game: "space-invaders", rules: "rules-v1", simVersion: 1 }} />)
        expect(client.board).not.toHaveBeenCalled()
        expect(screen.queryByRole("heading", { name: "Free play leaderboard" })).not.toBeInTheDocument()
    })

    it("leaves the page dormant without runtime injection", () => {
        render(<GamePage {...common} game={game("space-invaders")} />)
        expect(screen.queryByRole("heading", { name: "Free play leaderboard" })).not.toBeInTheDocument()
    })
})
