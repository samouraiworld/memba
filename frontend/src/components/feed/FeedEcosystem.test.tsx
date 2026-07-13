/**
 * FeedEcosystem — the "Ecosystem" feed tab. A thin wrapper that mounts the
 * shared Home ActivityFeed (live cross-gno.land activity) inside the feed,
 * seeded with the active network key. ActivityFeed is mocked here so this test
 * asserts only the wiring (intro + ActivityFeed with the right network key),
 * not the activity stack itself.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("../home/ActivityFeed", () => ({
    ActivityFeed: ({ networkKey }: { networkKey: string }) => (
        <div data-testid="activity-feed">network:{networkKey}</div>
    ),
}))
vi.mock("../../lib/config", () => ({ ACTIVE_NETWORK_KEY: "test13" }))

const { FeedEcosystem } = await import("./FeedEcosystem")

describe("FeedEcosystem", () => {
    it("renders the shared ActivityFeed seeded with the active network key", () => {
        render(<FeedEcosystem />)
        const af = screen.getByTestId("activity-feed")
        expect(af).toBeInTheDocument()
        expect(af).toHaveTextContent("network:test13")
    })

    it("shows a short intro so the tab reads as ecosystem activity, not posts", () => {
        render(<FeedEcosystem />)
        expect(screen.getByTestId("feed-ecosystem")).toBeInTheDocument()
        expect(screen.getByText(/live across gno\.land/i)).toBeInTheDocument()
    })
})
