import { fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { curatedReviewName, GAME_REVIEW_SUBJECTS } from "../../../lib/reviewSubjects"
import ArcadeWindow from "./native"
import { CommunityGames } from "./community"

const flags = vi.hoisted(() => ({ block: true, space: false, barricade: true, connect4: true }))
const summaries = vi.hoisted(() => ({ map: new Map<string, unknown>() }))
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    isGameEnabled: () => flags.block,
    isSpaceInvadersEnabled: () => flags.space,
    isBarricadeEnabled: () => flags.barricade,
    isConnect4Live: () => flags.connect4,
    isAppReviewsAvailable: () => false,
}))
vi.mock("../../kit/storefront", async (original) => ({
    ...(await original<typeof import("../../kit/storefront")>()),
    useReviewSummaries: () => summaries.map,
}))
vi.mock("../store/ReviewsPanel", () => ({ ReviewsPanel: ({ subject, name }: { subject: string; name: string }) => <p>reviews of {subject} as {name}</p> }))
vi.mock("./DailyTop", () => ({ DailyTop: () => <p>daily top</p> }))

const session = { network: { key: "mainnet", chainId: "gnoland-1" }, status: "guest" } as never
const base = { query: undefined, close: () => {}, toast: () => {}, fallback: <p>existing game</p>, session, openApp: () => {}, push: () => {}, active: true }
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

describe("Arcade lobby", () => {
    beforeEach(() => { summaries.map = new Map() })

    it("shows every game as a capsule: details open its page, Play opens the game", () => {
        const open = vi.fn()
        const push = vi.fn()
        wrap(<ArcadeWindow {...base} section={null} open={open} push={push} />)
        expect(screen.getByRole("navigation", { name: "Arcade" })).toBeInTheDocument()
        expect(screen.getByText(/leaderboard is server-verified when Daily is live/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Details for BARRICADE" }))
        // Details is a page change: a history entry, not a new window.
        expect(push).toHaveBeenLastCalledWith(expect.objectContaining({ key: "app:arcade", target: expect.objectContaining({ section: "g/barricade" }) }))
        expect(open).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Play BARRICADE" }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ key: "game:barricade", target: expect.objectContaining({ section: "barricade" }) }))
        fireEvent.click(screen.getByRole("button", { name: "Play Connect 4" }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ key: "game:connect4", title: "Connect 4 · Arcade" }))
        // A game this build cannot run has no Play button; its page explains why.
        expect(screen.queryByRole("button", { name: "Play Space Invaders" })).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Details for Space Invaders" })).toBeInTheDocument()
    })

    it("features games in a carousel", () => {
        wrap(<ArcadeWindow {...base} section={null} open={vi.fn()} />)
        expect(screen.getByRole("region", { name: "Featured games" })).toBeInTheDocument()
    })

    it("lists only games with enough ratings under Top rated, best first", () => {
        summaries.map = new Map([
            [GAME_REVIEW_SUBJECTS.barricade, { count: 3, sum: 12, average: 4 }],
            [GAME_REVIEW_SUBJECTS["block-party"], { count: 5, sum: 24, average: 4.8 }],
            [GAME_REVIEW_SUBJECTS["space-invaders"], { count: 2, sum: 10, average: 5 }],
        ])
        wrap(<ArcadeWindow {...base} section={null} open={vi.fn()} />)
        expect(screen.getByRole("heading", { name: "Top rated by the community" })).toBeInTheDocument()
        const shelf = within(screen.getByRole("region", { name: "Top rated by the community" }))
        const names = shelf.getAllByRole("button", { name: /^Details for / }).map((button) => button.getAttribute("aria-label"))
        expect(names).toEqual(["Details for Block Party", "Details for BARRICADE"])
        expect(shelf.queryByRole("button", { name: "Details for Space Invaders" })).not.toBeInTheDocument()
    })

    it("has no Top rated shelf while nothing is rated", () => {
        wrap(<ArcadeWindow {...base} section={null} open={vi.fn()} />)
        expect(screen.queryByRole("heading", { name: "Top rated by the community" })).not.toBeInTheDocument()
    })

    it("shows injected local history without offering a new launch", () => {
        const open = vi.fn(), recover = vi.fn()
        wrap(<ArcadeWindow {...base} section="runs" open={open} savedRuns={{ storage: { getItem: () => null, setItem: vi.fn() }, onOpenSavedRun: recover }} />)
        expect(screen.getByText("No saved Free play results for this game yet.")).toBeVisible()
        expect(screen.queryByRole("button", { name: /^Play / })).not.toBeInTheDocument()
        expect(open).not.toHaveBeenCalled()
        expect(recover).not.toHaveBeenCalled()
    })

    it("states the limits of runs and the daily board", () => {
        const open = vi.fn()
        const { rerender } = wrap(<ArcadeWindow {...base} section="runs" open={open} />)
        expect(screen.getByRole("heading", { name: "Your runs" })).toBeInTheDocument()
        expect(screen.getByRole("status")).toHaveTextContent("not a certified Arcade record")
        rerender(<QueryClientProvider client={new QueryClient()}><ArcadeWindow {...base} section="daily-board" open={open} /></QueryClientProvider>)
        expect(screen.getByRole("status")).toHaveTextContent("attestation is off")
        expect(screen.getByRole("status")).toHaveTextContent("Block Party has its own server-verified Daily leaderboard")
    })

    it("opens a game page with its reviews, and plays from it", () => {
        const open = vi.fn()
        const push = vi.fn()
        wrap(<ArcadeWindow {...base} section="g/barricade" open={open} push={push} />)
        expect(screen.getByRole("heading", { level: 1, name: "BARRICADE" })).toBeInTheDocument()
        expect(screen.getByText("reviews of gno.land/r/samcrew/barricade as BARRICADE")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Play BARRICADE" }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ key: "game:barricade" }))
        fireEvent.click(screen.getByRole("button", { name: "← Arcade" }))
        expect(push).toHaveBeenLastCalledWith(expect.objectContaining({ key: "app:arcade", target: expect.objectContaining({ section: null }) }))
        expect(open).toHaveBeenCalledTimes(1)
    })

    it("reviews each deployed game under its pinned display name, and Connect 4 has no reviews yet", () => {
        const pinned = [["block-party", "Block Party"], ["space-invaders", "Space Invaders"], ["barricade", "BARRICADE"], ["connect4", "Connect 4"]] as const
        for (const [id, name] of pinned) {
            const { unmount } = wrap(<ArcadeWindow {...base} section={`g/${id}`} open={vi.fn()} />)
            expect(curatedReviewName(GAME_REVIEW_SUBJECTS[id]!)).toBe(name)
            expect(screen.getByText(`reviews of ${GAME_REVIEW_SUBJECTS[id]} as ${name}`)).toBeInTheDocument()
            unmount()
        }
        // Where Connect 4 has no realm, the page says when its reviews open.
        wrap(<ArcadeWindow {...base} session={{ network: { key: "test13", chainId: "test13" }, status: "guest" } as never} section="g/connect4" open={vi.fn()} />)
        expect(screen.getByRole("heading", { level: 1, name: "Connect 4" })).toBeInTheDocument()
        expect(screen.getByText("Reviews open once Connect 4 is live on mainnet.")).toBeInTheDocument()
        expect(screen.queryByText(/^reviews of /)).not.toBeInTheDocument()
    })

    it("offers no Connect 4 review where its realm is live but the reviews realm is not listed", () => {
        wrap(<ArcadeWindow {...base} session={{ network: { key: "onyx", chainId: "onyx-1" }, status: "guest" } as never} section="g/connect4" open={vi.fn()} />)
        expect(screen.getByText("Onchain reviews are not available here yet.")).toBeInTheDocument()
        expect(screen.queryByText(/^reviews of /)).not.toBeInTheDocument()
    })

    it("shows the daily top only on Block Party's page", () => {
        const { unmount } = wrap(<ArcadeWindow {...base} section="g/block-party" open={vi.fn()} />)
        expect(screen.getByText("daily top")).toBeInTheDocument()
        unmount()
        wrap(<ArcadeWindow {...base} section="g/barricade" open={vi.fn()} />)
        expect(screen.queryByText("daily top")).not.toBeInTheDocument()
    })

    it("explains a game this build cannot run, and See why opens its section", () => {
        const open = vi.fn()
        wrap(<ArcadeWindow {...base} section="g/space-invaders" open={open} />)
        expect(screen.getByText("This game is unavailable in this build.")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Play Space Invaders" })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "See why" }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ key: "game:space-invaders" }))
    })

    it("moves focus to the game page title and back to the Details button", () => {
        const push = vi.fn()
        const client = new QueryClient()
        const at = (section: string | null) => <QueryClientProvider client={client}><ArcadeWindow {...base} section={section} open={vi.fn()} push={push} /></QueryClientProvider>
        const view = render(at(null))
        fireEvent.click(screen.getByRole("button", { name: "Details for BARRICADE" }))
        view.rerender(at("g/barricade"))
        expect(screen.getByRole("heading", { level: 1, name: "BARRICADE" })).toHaveFocus()
        fireEvent.click(screen.getByRole("button", { name: "← Arcade" }))
        view.rerender(at(null))
        expect(screen.getByRole("button", { name: "Details for BARRICADE" })).toHaveFocus()
    })

    it("falls back for an unknown game page", () => {
        wrap(<ArcadeWindow {...base} section="g/nope" open={vi.fn()} />)
        expect(screen.getByText("existing game")).toBeInTheDocument()
    })

    it("links community games out of Memba with a disclaimer", () => {
        wrap(<ArcadeWindow {...base} section={null} open={vi.fn()} />)
        expect(screen.getByRole("heading", { name: "From the community" })).toBeInTheDocument()
        const gnofly = screen.getByRole("link", { name: "Visit gnofly (opens in a new tab)" })
        expect(gnofly).toHaveAttribute("href", "https://gnofly.xyz/")
        expect(gnofly).toHaveAttribute("target", "_blank")
        expect(gnofly).toHaveAttribute("rel", "noopener noreferrer")
        expect(gnofly).toHaveTextContent("External")
        expect(screen.getByText(/not reviewed or audited by Memba/)).toHaveTextContent("some charge GNOT. Check their network and costs before connecting a wallet.")
        expect(screen.queryByRole("link", { name: /Bubble Rumble/ })).not.toBeInTheDocument()
    })

    it("omits the community section when there are no community games", () => {
        const { container } = render(<CommunityGames games={[]} />)
        expect(container).toBeEmptyDOMElement()
    })
})
