/**
 * FeedComposer — Wave-1 behavior: read-freely / connect-on-action (the input is
 * always shown; clicking Post connects the wallet and auto-submits once
 * connected) and the on-chain permanence disclosure. The write path (lib/feed)
 * is mocked at the module boundary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

// Pin the feed write-gate ON: these suites assert the normal composer/actions.
// Without this they resolve isFeedWritable() from ambient env (vite envDir:".."),
// so a root .env with VITE_GNO_CHAIN_ID=topaz would fail them locally while CI
// (which has no root .env) stayed green.
vi.mock("../../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/config")>()),
    isFeedWritable: () => true,
}))
vi.mock("../../lib/feed", () => ({
    submitFeedMsg: vi.fn(),
    buildCreatePostMsg: vi.fn(() => ({})),
}))
const { submitFeedMsg, buildCreatePostMsg } = await import("../../lib/feed")
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

    it("keeps an OS guest's draft actionable after a cancelled sign-in", async () => {
        const onConnect = vi.fn().mockReturnValue(false)
        const { rerender } = render(<FeedComposer connected={false} address={undefined} onConnect={onConnect} onPosted={() => {}} queueOnConnect={false} />)
        const input = screen.getByTestId("feed-composer-input")
        fireEvent.change(input, { target: { value: "my draft" } })
        fireEvent.click(screen.getByRole("button", { name: "Connect to post" }))
        expect(onConnect).toHaveBeenCalledOnce()
        expect(screen.getByRole("button", { name: "Connect to post" })).toBeEnabled()
        expect(input).toHaveValue("my draft")
        rerender(<FeedComposer connected={true} address="g1meeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" onConnect={onConnect} onPosted={() => {}} queueOnConnect={false} />)
        expect(mockSubmit).not.toHaveBeenCalled()
        expect(screen.getByRole("button", { name: "Post" })).toBeEnabled()
        expect(input).toHaveValue("my draft")
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

describe("FeedComposer permanence disclosure", () => {
    it("discloses that posts are public and permanent on-chain", () => {
        render(
            <FeedComposer
                connected={true}
                address="g1abcabcabcabcabcabcabcabcabcabcabcabcabc"
                onConnect={() => {}}
                onPosted={() => {}}
            />,
        )
        expect(screen.getByText(/permanent/i)).toBeInTheDocument()
        expect(screen.getByText(/on-chain|public/i)).toBeInTheDocument()
    })
})

describe("FeedComposer length cap", () => {
    it("counts UTF-8 bytes like the realm and blocks an over-long post", async () => {
        render(<FeedComposer connected={true} address="g1meeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" onConnect={() => {}} onPosted={() => {}} />)
        fireEvent.change(screen.getByTestId("feed-composer-input"), { target: { value: "é".repeat(501) } })
        expect(await screen.findByText("1002/1000")).toBeInTheDocument()
        expect(screen.getByTestId("feed-post-btn")).toBeDisabled()
    })
})

describe("FeedComposer join preset", () => {
    it("keeps an unsaved draft when a join link enters an existing Feed", () => {
        const props = { connected: false, address: undefined, onConnect: vi.fn(), onPosted: vi.fn() }
        const { rerender } = render(<FeedComposer {...props} />)
        const input = screen.getByTestId("feed-composer-input")
        fireEvent.change(input, { target: { value: "my unsaved work" } })
        rerender(<FeedComposer {...props} initialBody="#join template" />)
        expect(input).toHaveValue("my unsaved work")
        expect(screen.getByRole("button", { name: "Replace draft with #join template" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Replace draft with #join template" }))
        expect(input).toHaveValue("#join template")
    })

    it("shows the byte and cooldown limits before connecting", () => {
        render(<FeedComposer connected={false} address={undefined} onConnect={vi.fn()} onPosted={vi.fn()} />)
        expect(screen.getByTestId("feed-composer-limits")).toHaveTextContent("1000 bytes")
        expect(screen.getByTestId("feed-composer-limits")).toHaveTextContent("12 blocks")
    })

    it("keeps text after the realm rejects a post for cooldown", async () => {
        vi.mocked(buildCreatePostMsg).mockImplementationOnce(() => { throw new Error("VM panic: posting too fast: wait 12 blocks between posts") })
        render(<FeedComposer connected={true} address="g1meeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" onConnect={vi.fn()} onPosted={vi.fn()} />)
        fireEvent.change(screen.getByTestId("feed-composer-input"), { target: { value: "my post" } })
        fireEvent.click(screen.getByTestId("feed-post-btn"))
        expect(await screen.findByText(/needs 12 more blocks/)).toBeInTheDocument()
        expect(screen.getByTestId("feed-composer-input")).toHaveValue("my post")
    })
})
