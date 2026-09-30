import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ProfileCanvas } from "./ProfileCanvas"
import { shownProfile } from "./profileModel"

const mocks = vi.hoisted(() => ({ fetchReviews: vi.fn(), fetchModerator: vi.fn() }))
vi.mock("../../lib/reviews", async (importActual) => ({
    ...await importActual<typeof import("../../lib/reviews")>(),
    fetchReviews: mocks.fetchReviews,
    fetchModerator: mocks.fetchModerator,
}))
vi.mock("../../hooks/useBalance", () => ({ useBalance: () => ({ balance: "1 GNOT", loading: false, error: null }) }))
vi.mock("./profileHome", () => ({ readHomeRealm: async () => null }))
vi.mock("./profileMemberships", () => ({ readProfileMemberships: async () => ({ memberships: [], checked: 0, failed: 0, omitted: 0, checkedRealms: [] }) }))
vi.mock("../../lib/nftApi", () => ({ fetchNFTPortfolio: async () => [] }))
vi.mock("../../lib/badges", () => ({ fetchUserBadges: async () => ({ badges: [] }) }))
vi.mock("../../lib/feedApi", () => ({ fetchUserFeed: async () => ({ posts: [] }) }))

const ADDRESS = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const TEAM = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"

function show() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}><MemoryRouter><ProfileCanvas profile={shownProfile(ADDRESS, null, null)} /></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
    mocks.fetchReviews.mockReset().mockResolvedValue([{ id: 1, subject: ADDRESS, author: "g1a", rating: 4, body: "Reliable", createdAt: 1, editedAt: 0, deleted: false, likes: 0, dislikes: 0, flags: 0, reputation: 0 }])
    mocks.fetchModerator.mockReset().mockResolvedValue(TEAM)
})

describe("Profile canvas reviews", () => {
    it("ends its review list with the same moderation policy as every other list", async () => {
        show()
        expect(await screen.findByText(/Reliable/)).toBeInTheDocument()
        const policy = (await screen.findByText("How reviews are moderated")).closest("details")!
        expect(policy).toHaveTextContent(`The moderator is the Samourai team multisig: ${TEAM}.`)
    })

    it("states no policy for a reviews realm that returns no moderator", async () => {
        mocks.fetchModerator.mockResolvedValue(null)
        show()
        expect(await screen.findByText(/Reliable/)).toBeInTheDocument()
        expect(await screen.findByText(/How these reviews are moderated cannot be shown/)).toBeInTheDocument()
        expect(screen.queryByText("How reviews are moderated")).not.toBeInTheDocument()
    })
})
