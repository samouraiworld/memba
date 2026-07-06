/**
 * PostCard — Wave-1 UI: identity, the open-thread overlay (a11y), and a flag
 * that responds (optimistic count + surfaced realm errors). The write path
 * (lib/feed) is mocked at the module boundary; everything else is the real
 * component.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import type { UiPost } from "../../lib/feedTypes"

vi.mock("../../lib/feed", () => ({
    submitFeedMsg: vi.fn(),
    buildFlagPostMsg: vi.fn(() => ({})),
}))
const { submitFeedMsg } = await import("../../lib/feed")
const { PostCard } = await import("./PostCard")
const mockSubmit = vi.mocked(submitFeedMsg)

const basePost = (over: Partial<UiPost>): UiPost => ({
    id: 42n,
    author: "g1abcabcabcabcabcabcabcabcabcabcabcabcabc",
    body: "hello feed",
    replyTo: 0n,
    blockH: 100n,
    blockTs: 0n,
    editedAt: 0n,
    flagCount: 2,
    hidden: false,
    deleted: false,
    replyCount: 3,
    ...over,
})

const noop = () => {}

beforeEach(() => mockSubmit.mockReset())

describe("PostCard identity + a11y", () => {
    it("shows a resolved @handle as the name when provided", () => {
        render(<PostCard post={basePost({})} connected={false} selfAddress={undefined} onRefetch={noop} displayName="zooma" />)
        expect(screen.getByText("zooma")).toBeInTheDocument()
    })

    it("renders the body as plain text, not a button", () => {
        render(<PostCard post={basePost({})} connected={false} selfAddress={undefined} onRefetch={noop} onOpenThread={noop} />)
        const body = screen.getByText("hello feed")
        expect(body.tagName).not.toBe("BUTTON")
    })

    it("exposes a single labelled open-thread overlay when clickable", () => {
        render(<PostCard post={basePost({})} connected={false} selfAddress={undefined} onRefetch={noop} onOpenThread={noop} />)
        expect(screen.getByTestId("feed-post-open")).toHaveAttribute("aria-label", "Open thread")
    })
})

describe("PostCard flag that responds", () => {
    const connectedOther = {
        connected: true,
        selfAddress: "g1someoneelseXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        onRefetch: noop,
    }

    it("optimistically shows the bumped flag count on success", async () => {
        mockSubmit.mockResolvedValueOnce("hash")
        render(<PostCard post={basePost({ flagCount: 2 })} {...connectedOther} />)
        fireEvent.click(screen.getByTestId("feed-flag-btn"))
        // flagCount 2 → 3 optimistically.
        await waitFor(() => expect(screen.getByText(/· 3/)).toBeInTheDocument())
        expect(screen.getByText("Flagged")).toBeInTheDocument()
    })

    it("surfaces the realm's actionable error and reverts on failure", async () => {
        mockSubmit.mockRejectedValueOnce(new Error("panic: already flagged"))
        render(<PostCard post={basePost({})} {...connectedOther} />)
        fireEvent.click(screen.getByTestId("feed-flag-btn"))
        await waitFor(() => expect(screen.getByTestId("feed-flag-error")).toHaveTextContent("already flagged"))
        // Reverted: the button is back to "Flag", not stuck "Flagged".
        expect(screen.getByText("Flag")).toBeInTheDocument()
    })

    it("stays silent on a wallet rejection (no error banner)", async () => {
        mockSubmit.mockRejectedValueOnce(new Error("user denied the request"))
        render(<PostCard post={basePost({})} {...connectedOther} />)
        fireEvent.click(screen.getByTestId("feed-flag-btn"))
        await waitFor(() => expect(screen.getByText("Flag")).toBeInTheDocument())
        expect(screen.queryByTestId("feed-flag-error")).toBeNull()
    })
})
