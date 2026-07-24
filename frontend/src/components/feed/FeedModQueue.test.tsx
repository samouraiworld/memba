import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor, fireEvent } from "@testing-library/react"
import { renderWithProviders } from "../../test/test-utils"

vi.mock("../../lib/feedModerationApi", () => ({
    fetchFlaggedPosts: vi.fn(),
    postModeration: vi.fn(),
}))
const mod = await import("../../lib/feedModerationApi")

const FLAGGED_POST = {
    id: 42n,
    author: "g1author0000000000",
    body: "this is the flagged body a moderator must be able to read",
    replyTo: 0n,
    blockH: 10n,
    editedAt: 0n,
    flagCount: 5,
    hidden: true,
    deleted: false,
    replyCount: 0,
    blockTs: 0n,
    viewerHasFlagged: false,
}

describe("FeedModQueue", () => {
    beforeEach(() => vi.clearAllMocks())

    it("renders the flagged post BODY (not a tombstone) with its flag count", async () => {
        vi.mocked(mod.fetchFlaggedPosts).mockResolvedValue({ posts: [FLAGGED_POST], nextCursor: 0n } as never)
        const { default: FeedModQueue } = await import("./FeedModQueue")

        renderWithProviders(<FeedModQueue bearer="s3cret" />)

        await waitFor(() => expect(screen.getByText(/flagged body a moderator must be able to read/)).toBeInTheDocument())
        expect(mod.fetchFlaggedPosts).toHaveBeenCalledWith("s3cret", 0n, expect.any(Number))
    })

    it.each([
        ["Restore", "override_serve"],
        ["Clear override", "clear_override"],
        ["Block", "block"],
        ["Unblock", "unblock"],
    ])("%s fires %s via postModeration with the bearer + post id", async (label, action) => {
        vi.mocked(mod.fetchFlaggedPosts).mockResolvedValue({ posts: [FLAGGED_POST], nextCursor: 0n } as never)
        vi.mocked(mod.postModeration).mockResolvedValue(undefined as never)
        const { default: FeedModQueue } = await import("./FeedModQueue")

        renderWithProviders(<FeedModQueue bearer="s3cret" />)

        // aria-label is `${label} post #42`; anchor so "Block" doesn't match "Unblock".
        const btn = await screen.findByRole("button", { name: new RegExp(`^${label} post`, "i") })
        fireEvent.click(btn)

        await waitFor(() =>
            expect(mod.postModeration).toHaveBeenCalledWith(
                expect.objectContaining({ postId: 42n, action }),
                "s3cret",
            ),
        )
    })

    it("paginates via ‘Load older’, requesting the cursor returned by the first page", async () => {
        vi.mocked(mod.fetchFlaggedPosts)
            .mockResolvedValueOnce({ posts: [{ ...FLAGGED_POST, id: 42n, body: "page one body" }], nextCursor: 5n } as never)
            .mockResolvedValueOnce({ posts: [{ ...FLAGGED_POST, id: 5n, body: "page two body" }], nextCursor: 0n } as never)
        const { default: FeedModQueue } = await import("./FeedModQueue")

        renderWithProviders(<FeedModQueue bearer="s3cret" />)

        await waitFor(() => expect(screen.getByText("page one body")).toBeInTheDocument())
        fireEvent.click(screen.getByRole("button", { name: /load older/i }))

        await waitFor(() => expect(screen.getByText("page two body")).toBeInTheDocument())
        expect(mod.fetchFlaggedPosts).toHaveBeenNthCalledWith(2, "s3cret", 5n, expect.any(Number))
    })

    it("surfaces an auth error instead of showing an empty queue", async () => {
        vi.mocked(mod.fetchFlaggedPosts).mockRejectedValue(new Error("unauthenticated"))
        const { default: FeedModQueue } = await import("./FeedModQueue")

        renderWithProviders(<FeedModQueue bearer="wrong" />)

        await waitFor(() => expect(screen.getByText(/couldn.t load|bearer|rejected|unauthenticated/i)).toBeInTheDocument())
    })
})
