import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderWithProviders } from "../../test/test-utils"

vi.mock("../../lib/feedModerationApi", () => ({ fetchModerationLog: vi.fn() }))
const mod = await import("../../lib/feedModerationApi")

describe("FeedModAuditLog", () => {
    beforeEach(() => vi.clearAllMocks())

    it("renders body-free audit entries (action, post id, actor)", async () => {
        vi.mocked(mod.fetchModerationLog).mockResolvedValue({
            entries: [
                { seq: 3n, postId: 7n, action: "mod_removed", actor: "g1abcdef12345678", blockH: 100n },
                { seq: 2n, postId: 5n, action: "flagged", actor: "g1zzzz9999", blockH: 90n },
            ],
            nextCursor: 0n,
        } as never)
        const { default: FeedModAuditLog } = await import("./FeedModAuditLog")

        renderWithProviders(<FeedModAuditLog />)

        await waitFor(() => expect(screen.getByText("post #7")).toBeInTheDocument())
        expect(screen.getByText("post #5")).toBeInTheDocument()
        // never renders any post BODY — the audit log is body-free by construction
        expect(screen.queryByText(/body/i)).not.toBeInTheDocument()
    })

    it("shows an empty state when there are no events", async () => {
        vi.mocked(mod.fetchModerationLog).mockResolvedValue({ entries: [], nextCursor: 0n } as never)
        const { default: FeedModAuditLog } = await import("./FeedModAuditLog")

        renderWithProviders(<FeedModAuditLog />)

        await waitFor(() => expect(screen.getByText(/no moderation events/i)).toBeInTheDocument())
    })
})
