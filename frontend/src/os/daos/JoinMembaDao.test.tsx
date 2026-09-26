import { fireEvent, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"

vi.mock("../../lib/config", async original => ({
    ...(await original<typeof import("../../lib/config")>()),
    isFeedEnabled: vi.fn(() => true),
}))
vi.mock("../../lib/feedJoin", async original => ({
    ...(await original<typeof import("../../lib/feedJoin")>()),
    fetchJoinCandidates: vi.fn(async () => ({
        scanned: 300,
        complete: false,
        posts: [{ id: 42n, author: "g1alice", body: "#join I build realms", blockTs: 0n }],
    })),
}))
vi.mock("../../hooks/home/useActorUsernames", () => ({ useActorUsernames: () => new Map([["g1alice", "@alice"]]) }))

const { JoinMembaDao } = await import("./JoinMembaDao")
const { isFeedEnabled } = await import("../../lib/config")
const { fetchJoinCandidates } = await import("../../lib/feedJoin")

beforeEach(() => {
    vi.mocked(isFeedEnabled).mockReturnValue(true)
    vi.mocked(fetchJoinCandidates).mockClear()
})

describe("Memba DAO community applications", () => {
    it("distinguishes community access from voting, opens the composer, and limits candidate claims", async () => {
        const open = vi.fn()
        renderWithProviders(<JoinMembaDao open={open} />)
        expect(screen.getByText(/posting does not grant membership or a voting seat/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Apply with a Feed post" }))
        expect(open).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: "app", app: "feed", section: null, query: "compose=join" } }))
        fireEvent.click(await screen.findByRole("button", { name: /@alice/ }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ app: "feed", section: "post/42" }) }))
        expect(screen.getByText(/Older applications may not appear here/)).toBeInTheDocument()
    })

    it("does not promise an application route while the Feed flag is off", () => {
        vi.mocked(isFeedEnabled).mockReturnValue(false)
        renderWithProviders(<JoinMembaDao open={vi.fn()} />)
        expect(screen.getByText(/will open when the Feed is available/)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Apply with a Feed post" })).toBeNull()
        expect(fetchJoinCandidates).not.toHaveBeenCalled()
    })
})
