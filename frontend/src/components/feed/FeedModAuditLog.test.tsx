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

    it("with hideFlagger, masks the community flagger but still shows accountable moderators", async () => {
        vi.mocked(mod.fetchModerationLog).mockResolvedValue({
            entries: [
                { seq: 3n, postId: 7n, action: "mod_removed", actor: "g1moderator00000000", blockH: 100n },
                { seq: 2n, postId: 5n, action: "flagged", actor: "g1flagger999999999", blockH: 90n },
            ],
            nextCursor: 0n,
        } as never)
        const { default: FeedModAuditLog } = await import("./FeedModAuditLog")

        renderWithProviders(<FeedModAuditLog hideFlagger />)

        await waitFor(() => expect(screen.getByText("post #5")).toBeInTheDocument())
        expect(screen.getByText(/community flag/i)).toBeInTheDocument()
        expect(screen.queryByText(/g1flagge/)).not.toBeInTheDocument() // masked in visible text
        expect(screen.queryByTitle(/g1flagge/)).not.toBeInTheDocument() // …and not leaked via a title attr
        expect(screen.getByText(/g1modera/)).toBeInTheDocument() // moderator still shown
    })

    it("shows an empty state when there are no events", async () => {
        vi.mocked(mod.fetchModerationLog).mockResolvedValue({ entries: [], nextCursor: 0n } as never)
        const { default: FeedModAuditLog } = await import("./FeedModAuditLog")

        renderWithProviders(<FeedModAuditLog />)

        await waitFor(() => expect(screen.getByText(/no moderation events/i)).toBeInTheDocument())
    })
})
