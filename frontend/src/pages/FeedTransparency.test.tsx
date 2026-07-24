import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../test/test-utils"

vi.mock("../lib/feedModerationApi", () => ({
    fetchModerationLog: vi.fn().mockResolvedValue({ entries: [], nextCursor: 0n }),
}))

describe("FeedTransparency", () => {
    beforeEach(() => vi.clearAllMocks())

    it("renders the disclosed-labeling policy, the public log, and the policy link — no bearer prompt", async () => {
        const { default: FeedTransparency } = await import("./FeedTransparency")
        renderWithProviders(<FeedTransparency />)

        expect(screen.getByText(/disclosed labeling/i)).toBeInTheDocument()
        expect(screen.getByRole("heading", { name: /moderation log/i })).toBeInTheDocument()
        expect(screen.getByRole("link", { name: /MODERATION_POLICY/i })).toBeInTheDocument()
        // Public page — it must never ask for the operator bearer.
        expect(screen.queryByLabelText(/moderation bearer/i)).not.toBeInTheDocument()
    })
})
