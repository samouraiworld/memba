import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("../../lib/feedApi", async (orig) => ({
    ...(await orig<typeof import("../../lib/feedApi")>()),
    fetchPostReactions: vi.fn(),
}))
vi.mock("../../lib/feed", async (orig) => ({
    ...(await orig<typeof import("../../lib/feed")>()),
    submitFeedMsg: vi.fn(),
}))

import { ReactionBar } from "./ReactionBar"
import { fetchPostReactions, type EmojiCount } from "../../lib/feedApi"
import { submitFeedMsg } from "../../lib/feed"

const mockFetch = vi.mocked(fetchPostReactions)
const mockSubmit = vi.mocked(submitFeedMsg)

function withClient(ui: ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const reactions = (arr: EmojiCount[]) => new Map<bigint, EmojiCount[]>([[7n, arr]])

beforeEach(() => {
    mockFetch.mockReset()
    mockSubmit.mockReset()
    mockSubmit.mockResolvedValue("hash")
})
afterEach(() => vi.unstubAllEnvs())

describe("ReactionBar", () => {
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
})
