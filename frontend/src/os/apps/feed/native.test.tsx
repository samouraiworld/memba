import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { renderWithProviders } from "../../../test/test-utils"
import FeedWindow from "./native"

const gates = vi.hoisted(() => ({ enabled: true, indexer: "/api/indexer" as string | null }))
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    isFeedEnabled: () => gates.enabled,
    getIndexerUrl: () => gates.indexer,
}))
vi.mock("../../../lib/feedApi", () => ({ fetchFeedTimeline: vi.fn() }))
vi.mock("../../../hooks/home/useActorUsernames", () => ({ useActorUsernames: () => new Map() }))
vi.mock("../../../hooks/home/useNow", () => ({ useNow: () => Date.now() }))
vi.mock("../../../components/feed/FeedNotifications", () => ({ FeedNotifications: () => <p>Notifications</p> }))
vi.mock("../../../components/feed/FeedEcosystem", () => ({ FeedEcosystem: () => <p>Ecosystem activity</p> }))
vi.mock("../../../components/feed/FeedComposer", () => ({ FeedComposer: ({ connected, initialBody, onConnect, queueOnConnect }: { connected: boolean; initialBody?: string; onConnect: () => void; queueOnConnect: boolean }) =>
    <div data-testid="composer" data-connected={connected} data-queue={queueOnConnect}>
        {initialBody && <span>Join template</span>}
        <button type="button" onClick={onConnect}>Connect to post</button>
    </div>,
}))
vi.mock("../../../components/feed/PostCard", () => ({ PostCard: ({ post }: { post: { body: string } }) => <article>{post.body}</article> }))

const { fetchFeedTimeline } = await import("../../../lib/feedApi")
const fetch = vi.mocked(fetchFeedTimeline)
const openConnect = vi.fn()
const base = {
    open: vi.fn(), openApp: vi.fn(), close: vi.fn(), toast: vi.fn(),
    fallback: <p>Existing detail page</p>, query: undefined,
}
function show(section: string | null = null, status: "guest" | "member" = "guest", query?: string, network = "mainnet") {
    const session = { status, address: status === "member" ? "g1member" : "", network: { key: network }, openConnect } as never
    return renderWithProviders(<FeedWindow {...base} section={section} query={query} session={session} />, { route: "/os/feed" })
}

describe("native Feed", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        gates.enabled = true
        gates.indexer = "/api/indexer"
        fetch.mockResolvedValue({ posts: [], nextCursor: 0n, indexerLastBlock: 1n })
    })

    it("does not fetch when the build flag or network makes posts unavailable", () => {
        gates.enabled = false
        show()
        expect(screen.getByRole("status")).toHaveTextContent("disabled in this build")
        expect(fetch).not.toHaveBeenCalled()
        gates.enabled = true
        show(null, "guest", undefined, "test13")
        expect(screen.getByText(/Posts are unavailable on this network/)).toBeInTheDocument()
        expect(fetch).not.toHaveBeenCalled()
    })

    it("lets guests read, but sends connect through the OS session", async () => {
        fetch.mockResolvedValue({ posts: [{ id: 2n, author: "g1author", body: "Hello mainnet" } as never], nextCursor: 0n, indexerLastBlock: 1n })
        show()
        expect(await screen.findByText("Hello mainnet")).toBeInTheDocument()
        expect(screen.getByTestId("composer")).toHaveAttribute("data-connected", "false")
        expect(screen.getByTestId("composer")).toHaveAttribute("data-queue", "false")
        expect(fetch).toHaveBeenCalledWith(0n, 20, undefined)
        fireEvent.click(screen.getByRole("button", { name: "Connect to post" }))
        expect(openConnect).toHaveBeenCalledOnce()
    })

    it("keeps the loading state visible until the first page arrives", async () => {
        let resolve!: (page: { posts: []; nextCursor: bigint; indexerLastBlock: bigint }) => void
        const pending = new Promise<{ posts: []; nextCursor: bigint; indexerLastBlock: bigint }>(done => { resolve = done })
        fetch.mockImplementation(() => pending)
        show()
        expect(screen.getByRole("status")).toHaveTextContent("Loading community posts")
        resolve({ posts: [], nextCursor: 0n, indexerLastBlock: 1n })
        expect(await screen.findByText("No community posts have been indexed yet.")).toBeInTheDocument()
    })

    it("loads an older page only on request", async () => {
        fetch.mockImplementation(async (cursor = 0n) => cursor === 0n
            ? { posts: [{ id: 2n, author: "g1author", body: "Newer" } as never], nextCursor: 2n, indexerLastBlock: 1n }
            : { posts: [{ id: 1n, author: "g1author", body: "Older" } as never], nextCursor: 0n, indexerLastBlock: 1n })
        show()
        expect(await screen.findByText("Newer")).toBeInTheDocument()
        expect(screen.queryByText("Older")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Load older posts" }))
        expect(await screen.findByText("Older")).toBeInTheDocument()
        expect(fetch).toHaveBeenCalledWith(2n, 20, undefined)
    })

    it("uses the signed-in OS address for viewer-specific reads and the join preset", async () => {
        show(null, "member", "compose=join&osJoin=1")
        expect(await screen.findByText("No community posts have been indexed yet.")).toBeInTheDocument()
        expect(screen.getByTestId("composer")).toHaveAttribute("data-connected", "true")
        expect(screen.getByText("Join template")).toBeInTheDocument()
        expect(fetch).toHaveBeenCalledWith(0n, 20, "g1member")
    })

    it("keeps load failures distinct from a genuinely empty feed and offers retry", async () => {
        fetch.mockRejectedValueOnce(new Error("offline"))
        show()
        expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded")
        expect(screen.queryByText("No community posts have been indexed yet.")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("No community posts have been indexed yet.")).toBeInTheDocument()
    })

    it("shows explicit ecosystem unavailability and preserves detail pages", async () => {
        gates.indexer = null
        show("ecosystem")
        expect(screen.getByRole("status")).toHaveTextContent("unavailable on this network")
        show("post/12")
        await waitFor(() => expect(screen.getByText("Existing detail page")).toBeInTheDocument())
    })
})
