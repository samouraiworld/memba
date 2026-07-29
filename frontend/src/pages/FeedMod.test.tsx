import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderWithProviders } from "../test/test-utils"

// Keep the child data calls inert so this test isolates the bearer gate.
vi.mock("../lib/feedModerationApi", () => ({
    fetchFlaggedPosts: vi.fn().mockResolvedValue({ posts: [], nextCursor: 0n }),
    fetchModerationLog: vi.fn().mockResolvedValue({ entries: [], nextCursor: 0n }),
    postModeration: vi.fn(),
}))

describe("FeedMod page", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sessionStorage.clear()
    })

    it("prompts for the bearer when none is set, and hides the flagged queue", async () => {
        const { default: FeedMod } = await import("./FeedMod")
        renderWithProviders(<FeedMod />)

        expect(screen.getByLabelText(/moderation bearer/i)).toBeInTheDocument()
        expect(screen.queryByRole("heading", { name: /flagged queue/i })).not.toBeInTheDocument()
    })

    it("shows the flagged queue once a bearer is present in sessionStorage", async () => {
        sessionStorage.setItem("memba_feed_mod_bearer", "s3cret")
        const { default: FeedMod } = await import("./FeedMod")
        renderWithProviders(<FeedMod />)

        await waitFor(() => expect(screen.getByRole("heading", { name: /flagged queue/i })).toBeInTheDocument())
    })
})
