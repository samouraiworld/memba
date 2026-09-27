import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

vi.mock("react-router-dom", () => ({ useParams: () => ({ address: "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }) }))
vi.mock("../hooks/useAdena", () => ({ useAdena: () => ({ address: undefined, connected: false, connect: vi.fn() }) }))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => vi.fn() }))
vi.mock("../hooks/home/useActorUsernames", () => ({ useActorUsernames: () => new Map() }))
vi.mock("../lib/feedApi", () => ({ fetchUserFeed: vi.fn() }))

const { fetchUserFeed } = await import("../lib/feedApi")
const FeedProfile = (await import("./FeedProfile")).default

describe("FeedProfile availability", () => {
    it("offers retry after a failed read instead of declaring that an author has no posts", async () => {
        vi.mocked(fetchUserFeed).mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce({ posts: [], nextCursor: 0n })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(<QueryClientProvider client={client}><FeedProfile /></QueryClientProvider>)
        expect(await screen.findByText("Couldn't load posts")).toBeInTheDocument()
        expect(screen.queryByText("No posts yet")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("No posts yet")).toBeInTheDocument()
    })
})
