/**
 * PostCard — Wave-1 behavior: moderation suppression (hidden/deleted → tombstone,
 * never the body), identity, the open-thread overlay (a11y), and a flag that
 * responds (optimistic count + surfaced realm errors + connect-on-action). The
 * write path (lib/feed) is mocked; everything else is the real component.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import type { UiPost } from "../../lib/feedTypes"

vi.mock("../../lib/feed", () => ({
    submitFeedMsg: vi.fn(),
    buildFlagPostMsg: vi.fn(() => ({})),
    buildEditPostMsg: vi.fn(() => ({})),
    buildDeletePostMsg: vi.fn(() => ({})),
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

describe("PostCard moderation suppression", () => {
    it("renders a tombstone, not the body, for a deleted post", () => {
        render(<PostCard post={basePost({ deleted: true })} connected={false} selfAddress={undefined} onRefetch={noop} />)
        expect(screen.queryByText("hello feed")).toBeNull()
        expect(screen.getByTestId("feed-post-tombstone")).toBeInTheDocument()
    })

    it("renders a tombstone, not the body, for a flag-hidden post", () => {
        render(<PostCard post={basePost({ hidden: true })} connected={false} selfAddress={undefined} onRefetch={noop} />)
        expect(screen.queryByText("hello feed")).toBeNull()
        expect(screen.getByTestId("feed-post-tombstone")).toBeInTheDocument()
    })

    it("renders the body normally for a visible post (no over-suppression)", () => {
        render(<PostCard post={basePost({})} connected={false} selfAddress={undefined} onRefetch={noop} />)
        expect(screen.getByText("hello feed")).toBeInTheDocument()
        expect(screen.queryByTestId("feed-post-tombstone")).toBeNull()
    })

    it("copies a permalink to the clipboard and confirms, on any post (no wallet needed)", async () => {
        const writeText = vi.fn(() => Promise.resolve())
        Object.assign(navigator, { clipboard: { writeText } })
        render(<PostCard post={basePost({ id: 42n })} connected={false} selfAddress={undefined} onRefetch={noop} />)

        const btn = screen.getByTestId("feed-copy-link-btn")
        fireEvent.click(btn)
        expect(writeText).toHaveBeenCalledTimes(1)
        expect(writeText.mock.calls[0][0]).toMatch(/\/feed\/post\/42$/)
        // transient "Copied" confirmation
        expect(await screen.findByText("Copied")).toBeInTheDocument()
    })

    it("offers copy-link on an optimistic post only once it has a real id", () => {
        const { rerender } = render(
            <PostCard post={basePost({ optimistic: true })} connected={false} selfAddress={undefined} onRefetch={noop} />,
        )
        expect(screen.queryByTestId("feed-copy-link-btn")).toBeNull()
        rerender(<PostCard post={basePost({ optimistic: false })} connected={false} selfAddress={undefined} onRefetch={noop} />)
        expect(screen.getByTestId("feed-copy-link-btn")).toBeInTheDocument()
    })

    it("does not offer a flag action on a hidden post even to a connected non-author", () => {
        render(
            <PostCard
                post={basePost({ hidden: true })}
                connected={true}
                selfAddress="g1someoneelseXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                onRefetch={noop}
            />,
        )
        expect(screen.queryByTestId("feed-flag-btn")).toBeNull()
    })
})

describe("PostCard identity + a11y", () => {
    it("shows a resolved @handle as the name when provided", () => {
        render(<PostCard post={basePost({})} connected={false} selfAddress={undefined} onRefetch={noop} displayName="zooma" />)
        expect(screen.getByText("zooma")).toBeInTheDocument()
    })

    it("renders the body as plain text, not a button", () => {
        render(<PostCard post={basePost({})} connected={false} selfAddress={undefined} onRefetch={noop} onOpenThread={noop} />)
        expect(screen.getByText("hello feed").tagName).not.toBe("BUTTON")
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
        await waitFor(() => expect(screen.getByText(/· 3/)).toBeInTheDocument())
        expect(screen.getByText("Flagged")).toBeInTheDocument()
    })

    it("surfaces the realm's actionable error and reverts on failure", async () => {
        mockSubmit.mockRejectedValueOnce(new Error("panic: already flagged"))
        render(<PostCard post={basePost({})} {...connectedOther} />)
        fireEvent.click(screen.getByTestId("feed-flag-btn"))
        await waitFor(() => expect(screen.getByTestId("feed-flag-error")).toHaveTextContent("already flagged"))
        expect(screen.getByText("Flag")).toBeInTheDocument()
    })

    it("shows the flag to a disconnected visitor and connects on click (no broadcast)", async () => {
        const onConnect = vi.fn()
        render(<PostCard post={basePost({})} connected={false} selfAddress={undefined} onRefetch={noop} onConnect={onConnect} />)
        fireEvent.click(screen.getByTestId("feed-flag-btn"))
        await waitFor(() => expect(onConnect).toHaveBeenCalled())
        expect(mockSubmit).not.toHaveBeenCalled()
    })

    it("stays silent on a wallet rejection (no error banner)", async () => {
        mockSubmit.mockRejectedValueOnce(new Error("user denied the request"))
        render(<PostCard post={basePost({})} {...connectedOther} />)
        fireEvent.click(screen.getByTestId("feed-flag-btn"))
        await waitFor(() => expect(screen.getByText("Flag")).toBeInTheDocument())
        expect(screen.queryByTestId("feed-flag-error")).toBeNull()
    })
})

describe("PostCard author edit / delete", () => {
    // basePost author === this selfAddress → isOwn.
    const own = { connected: true, selfAddress: "g1abcabcabcabcabcabcabcabcabcabcabcabcabc", onRefetch: noop }

    it("shows the manage menu only for the author's own post", () => {
        const { rerender } = render(<PostCard post={basePost({})} {...own} />)
        expect(screen.getByTestId("feed-post-menu")).toBeInTheDocument()
        rerender(<PostCard post={basePost({})} connected={true} selfAddress="g1someoneelseXXXXXXXXXXXXXXXXXXXXXXXXXXXX" onRefetch={noop} />)
        expect(screen.queryByTestId("feed-post-menu")).toBeNull()
    })

    it("disables paint containment while the manage menu is open (so the dropdown isn't clipped)", () => {
        const { container } = render(<PostCard post={basePost({})} {...own} />)
        const article = container.querySelector("article.feed-post")!
        // Closed: content-visibility containment is active (no opt-out class).
        expect(article.className).not.toContain("feed-post--cv-off")
        fireEvent.click(screen.getByTestId("feed-post-menu"))
        // Open: containment disabled so the downward dropdown can overflow the card.
        expect(article.className).toContain("feed-post--cv-off")
    })

    it("closes the manage menu on Escape (useDismissable)", () => {
        render(<PostCard post={basePost({})} {...own} />)
        fireEvent.click(screen.getByTestId("feed-post-menu"))
        expect(screen.getByTestId("feed-post-edit")).toBeInTheDocument()
        fireEvent.keyDown(document, { key: "Escape" })
        expect(screen.queryByTestId("feed-post-edit")).toBeNull()
    })

    it("labels the edit textarea for assistive tech", () => {
        render(<PostCard post={basePost({})} {...own} />)
        fireEvent.click(screen.getByTestId("feed-post-menu"))
        fireEvent.click(screen.getByTestId("feed-post-edit"))
        expect(screen.getByLabelText("Edit your post")).toBeInTheDocument()
    })

    it("edits: broadcasts EditPost and optimistically shows the new body", async () => {
        mockSubmit.mockResolvedValueOnce("hash")
        render(<PostCard post={basePost({})} {...own} />)
        fireEvent.click(screen.getByTestId("feed-post-menu"))
        fireEvent.click(screen.getByTestId("feed-post-edit"))
        fireEvent.change(screen.getByTestId("feed-edit-input"), { target: { value: "edited body" } })
        // Wait for the controlled input's re-render to commit before saving: under CI
        // load React can time-slice that render, and clicking early submits a stale
        // saveEdit closure holding the old body (the Node-20 main flake of 2026-07-08).
        await waitFor(() => expect(screen.getByTestId("feed-edit-input")).toHaveValue("edited body"))
        fireEvent.click(screen.getByTestId("feed-edit-save"))
        await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
        expect(await screen.findByText("edited body")).toBeInTheDocument()
        expect(screen.queryByText("hello feed")).toBeNull()
    })

    it("deletes: confirm discloses on-chain permanence, then broadcasts DeletePost → tombstone", async () => {
        mockSubmit.mockResolvedValueOnce("hash")
        render(<PostCard post={basePost({})} {...own} />)
        fireEvent.click(screen.getByTestId("feed-post-menu"))
        fireEvent.click(screen.getByTestId("feed-post-delete"))
        expect(screen.getByTestId("feed-delete-confirm")).toHaveTextContent(/on-chain|permanent/i)
        fireEvent.click(screen.getByTestId("feed-delete-yes"))
        await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
        expect(await screen.findByTestId("feed-post-tombstone")).toBeInTheDocument()
    })

    it("cancels a delete without broadcasting", () => {
        render(<PostCard post={basePost({})} {...own} />)
        fireEvent.click(screen.getByTestId("feed-post-menu"))
        fireEvent.click(screen.getByTestId("feed-post-delete"))
        fireEvent.click(screen.getByTestId("feed-delete-no"))
        expect(screen.queryByTestId("feed-delete-confirm")).toBeNull()
        expect(mockSubmit).not.toHaveBeenCalled()
    })
})
