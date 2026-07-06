/**
 * FeedComposer — read-freely / connect-on-action. A disconnected visitor still
 * sees the input; clicking Post triggers the wallet connect, and the post is
 * sent automatically once the wallet is connected (one action, not two).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("../../lib/feed", () => ({
    submitFeedMsg: vi.fn(),
    buildCreatePostMsg: vi.fn(() => ({})),
}))
const { submitFeedMsg } = await import("../../lib/feed")
const { FeedComposer } = await import("./FeedComposer")
const mockSubmit = vi.mocked(submitFeedMsg)

beforeEach(() => mockSubmit.mockReset())

describe("FeedComposer connect-on-action", () => {
    it("shows the composer input to a disconnected visitor", () => {
        render(<FeedComposer connected={false} address={undefined} onConnect={() => {}} onPosted={() => {}} />)
        expect(screen.getByTestId("feed-composer-input")).toBeInTheDocument()
    })

    it("clicking Post while disconnected triggers connect and does NOT broadcast", async () => {
        const onConnect = vi.fn().mockResolvedValue(false)
        render(<FeedComposer connected={false} address={undefined} onConnect={onConnect} onPosted={() => {}} />)
        fireEvent.change(screen.getByTestId("feed-composer-input"), { target: { value: "hello world" } })
        fireEvent.click(screen.getByTestId("feed-post-btn"))
        await waitFor(() => expect(onConnect).toHaveBeenCalled())
        expect(mockSubmit).not.toHaveBeenCalled()
    })

    it("auto-submits the pending post once the wallet connects", async () => {
        const onConnect = vi.fn().mockResolvedValue(true)
        mockSubmit.mockResolvedValue("hash")
        const onPosted = vi.fn()
        const { rerender } = render(
            <FeedComposer connected={false} address={undefined} onConnect={onConnect} onPosted={onPosted} />,
        )
        fireEvent.change(screen.getByTestId("feed-composer-input"), { target: { value: "hello world" } })
        fireEvent.click(screen.getByTestId("feed-post-btn"))
        await waitFor(() => expect(onConnect).toHaveBeenCalled())
        // The wallet connected — props flow in.
        rerender(<FeedComposer connected={true} address="g1meeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" onConnect={onConnect} onPosted={onPosted} />)
        await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
        expect(onPosted).toHaveBeenCalledTimes(1)
    })

    it("still posts directly when already connected", async () => {
        mockSubmit.mockResolvedValue("hash")
        const onPosted = vi.fn()
        render(<FeedComposer connected={true} address="g1meeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" onConnect={() => {}} onPosted={onPosted} />)
        fireEvent.change(screen.getByTestId("feed-composer-input"), { target: { value: "direct post" } })
        fireEvent.click(screen.getByTestId("feed-post-btn"))
        await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
    })
})
