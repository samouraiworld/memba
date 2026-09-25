import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

// Mock at the RPC client so the real batching loader runs between the bars
// and the wire — that's what keeps a feed page to one request.
vi.mock("../../lib/api", async (orig) => ({
    ...(await orig<typeof import("../../lib/api")>()),
    api: { getPostReactions: vi.fn() },
}))
vi.mock("../../lib/feed", async (orig) => ({
    ...(await orig<typeof import("../../lib/feed")>()),
    submitFeedMsg: vi.fn(),
}))
// The bar renders null off the feed's home network (isFeedWritable — since
// the 2026-08-27 pearl-default flip the DEFAULT network's feed is dark until
// the ceremony). These are INTERACTION tests, so they pin writability true;
// the gate itself is pinned by its own test below.
vi.mock("../../lib/config", async (orig) => ({
    ...(await orig<typeof import("../../lib/config")>()),
    isFeedWritable: vi.fn(() => true),
}))

import { ReactionBar } from "./ReactionBar"
import { api } from "../../lib/api"
import type { EmojiCount } from "../../lib/feedApi"
import { REACTIONS_BATCH_MAX } from "../../lib/feedReactionsLoader"
import { submitFeedMsg } from "../../lib/feed"
import { isFeedWritable } from "../../lib/config"

const mockFetch = vi.mocked(api.getPostReactions)
const mockSubmit = vi.mocked(submitFeedMsg)

function withClient(ui: ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

type Resp = Awaited<ReturnType<typeof api.getPostReactions>>
const wire = (byPost: [bigint, EmojiCount[]][]) => ({
    posts: byPost.map(([postId, arr]) => ({
        postId,
        reactions: arr.map(e => ({ emoji: e.emoji, count: BigInt(e.count), viewerReacted: e.viewerReacted })),
    })),
}) as unknown as Resp
const reactions = (arr: EmojiCount[]) => wire([[7n, arr]])

beforeEach(() => {
    mockFetch.mockReset()
    mockSubmit.mockReset()
    mockSubmit.mockResolvedValue("hash")
})
afterEach(async () => {
    vi.unstubAllEnvs()
    // The app-wide loader holds a batch open for a few ms; let any load a test
    // left queued go out before the next test resets the mock and counts calls.
    await new Promise(r => setTimeout(r, 30))
})

describe("ReactionBar", () => {
    it("renders nothing off the feed's home network (pearl default, feed on sapphire)", () => {
        vi.stubEnv("VITE_ENABLE_REACTIONS", "true")
        vi.mocked(isFeedWritable).mockReturnValueOnce(false)
        mockFetch.mockResolvedValue(reactions([{ emoji: "👍", count: 3, viewerReacted: false }]))
        const { container } = withClient(<ReactionBar postId={7n} connected selfAddress="g1me" onConnect={vi.fn()} />)
        expect(container.firstChild).toBeNull()
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it("renders nothing when the flag is off", () => {
        mockFetch.mockResolvedValue(reactions([{ emoji: "👍", count: 3, viewerReacted: false }]))
        const { container } = withClient(<ReactionBar postId={7n} connected selfAddress="g1me" onConnect={vi.fn()} />)
        expect(container.firstChild).toBeNull()
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it("shows live counts and highlights the viewer's own reactions", async () => {
        vi.stubEnv("VITE_ENABLE_REACTIONS", "true")
        mockFetch.mockResolvedValue(reactions([
            { emoji: "👍", count: 3, viewerReacted: true },
            { emoji: "🔥", count: 1, viewerReacted: false },
        ]))
        withClient(<ReactionBar postId={7n} connected selfAddress="g1me" onConnect={vi.fn()} />)

        const own = await screen.findByLabelText("👍 3")
        expect(own).toHaveAttribute("aria-pressed", "true")
        expect(await screen.findByLabelText("🔥 1")).toHaveAttribute("aria-pressed", "false")
    })

    it("toggles a reaction with an on-chain tx when connected", async () => {
        vi.stubEnv("VITE_ENABLE_REACTIONS", "true")
        mockFetch.mockResolvedValue(reactions([{ emoji: "👍", count: 3, viewerReacted: false }]))
        withClient(<ReactionBar postId={7n} connected selfAddress="g1me" onConnect={vi.fn()} />)

        fireEvent.click(await screen.findByLabelText("👍 3"))
        await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
        // AddReaction (not reacted yet) broadcast.
        expect(mockSubmit.mock.calls[0][1]).toMatch(/react/i)
    })

    it("connects first when a disconnected visitor taps a reaction", async () => {
        vi.stubEnv("VITE_ENABLE_REACTIONS", "true")
        mockFetch.mockResolvedValue(reactions([{ emoji: "👍", count: 3, viewerReacted: false }]))
        const onConnect = vi.fn()
        withClient(<ReactionBar postId={7n} connected={false} onConnect={onConnect} />)

        fireEvent.click(await screen.findByLabelText("👍 3"))
        await waitFor(() => expect(onConnect).toHaveBeenCalled())
        expect(mockSubmit).not.toHaveBeenCalled()
    })

    it("opens the emoji picker", async () => {
        vi.stubEnv("VITE_ENABLE_REACTIONS", "true")
        mockFetch.mockResolvedValue(reactions([]))
        withClient(<ReactionBar postId={7n} connected selfAddress="g1me" onConnect={vi.fn()} />)

        fireEvent.click(await screen.findByTestId("feed-reaction-add"))
        expect(await screen.findByTestId("feed-reaction-picker")).toBeInTheDocument()
    })

    describe("batched reads", () => {
        const ids = (n: number) => Array.from({ length: n }, (_, i) => BigInt(i + 1))
        const echo = () => mockFetch.mockImplementation(async (req) => {
            const postIds = (req as { postIds: bigint[] }).postIds
            return wire(postIds.map(id => [id, [{ emoji: "👍", count: Number(id), viewerReacted: false }]]))
        })
        const bars = (list: bigint[], selfAddress?: string) => withClient(
            <>{list.map(id => <ReactionBar key={id.toString()} postId={id} connected={!!selfAddress} selfAddress={selfAddress} onConnect={vi.fn()} />)}</>,
        )

        it("loads a page of bars with one request and hands each bar its own counts", async () => {
            vi.stubEnv("VITE_ENABLE_REACTIONS", "true")
            echo()
            bars(ids(20), "g1me")

            for (const id of ids(20)) expect(await screen.findByLabelText(`👍 ${id}`)).toBeInTheDocument()
            expect(mockFetch).toHaveBeenCalledTimes(1)
            expect(mockFetch.mock.calls[0][0]).toEqual({ postIds: ids(20), viewer: "g1me" })
        })

        it("splits more bars than the server cap into capped requests", async () => {
            vi.stubEnv("VITE_ENABLE_REACTIONS", "true")
            echo()
            const n = REACTIONS_BATCH_MAX + 3
            bars(ids(n))

            expect(await screen.findByLabelText(`👍 ${n}`)).toBeInTheDocument()
            expect(await screen.findByLabelText("👍 1")).toBeInTheDocument()
            expect(mockFetch).toHaveBeenCalledTimes(2)
            const sizes = mockFetch.mock.calls.map(c => (c[0] as { postIds: bigint[] }).postIds.length)
            expect(sizes).toEqual([REACTIONS_BATCH_MAX, 3])
        })

        it("shows each bar's error state when the batch fails, and retries that post", async () => {
            vi.stubEnv("VITE_ENABLE_REACTIONS", "true")
            mockFetch.mockRejectedValueOnce(new Error("resource_exhausted"))
            bars(ids(3))

            await waitFor(() => expect(screen.getAllByLabelText("Reactions failed to load. Retry")).toHaveLength(3))
            const retries = screen.getAllByLabelText("Reactions failed to load. Retry")
            expect(mockFetch).toHaveBeenCalledTimes(1)

            echo()
            fireEvent.click(retries[1])
            expect(await screen.findByLabelText("👍 2")).toBeInTheDocument()
            expect(mockFetch).toHaveBeenCalledTimes(2)
            expect((mockFetch.mock.calls[1][0] as { postIds: bigint[] }).postIds).toEqual([2n])
            expect(screen.getAllByLabelText("Reactions failed to load. Retry")).toHaveLength(2)
        })

        it("refreshes only the reacted post's counts after a reaction", async () => {
            vi.stubEnv("VITE_ENABLE_REACTIONS", "true")
            echo()
            bars(ids(3), "g1me")
            fireEvent.click(await screen.findByLabelText("👍 2"))

            // The chain now holds the viewer's reaction on post 2.
            mockFetch.mockImplementation(async () => wire([[2n, [{ emoji: "👍", count: 3, viewerReacted: true }]]]))
            await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))

            // Post 2 now reads 👍 3 (pressed) beside post 3's untouched 👍 3.
            await waitFor(() => expect(screen.getAllByLabelText("👍 3")).toHaveLength(2))
            expect(screen.getAllByLabelText("👍 3").map(b => b.getAttribute("aria-pressed"))).toEqual(["true", "false"])
            expect(screen.getByLabelText("👍 1")).toBeInTheDocument()
            expect(mockFetch).toHaveBeenCalledTimes(2)
            expect(mockFetch.mock.calls[1][0]).toEqual({ postIds: [2n], viewer: "g1me" })
        })
    })
})
