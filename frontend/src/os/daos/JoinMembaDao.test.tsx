import { fireEvent, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import { appSpec, EMPTY_WINDOWS, windowsReducer } from "../shell/windows"
import { applyToJoinSpec } from "./joinSpec"

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
        expect(open).toHaveBeenCalledWith(expect.objectContaining({ key: "flow:feed-join", target: { kind: "app", app: "feed", section: null, query: "compose=join" } }))
        fireEvent.click(await screen.findByRole("button", { name: /g1alice/ }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ app: "feed", section: "post/42" }) }))
        expect(screen.getByText(/Older applications may not appear here/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Refresh applications" }))
        await waitFor(() => expect(fetchJoinCandidates).toHaveBeenCalledTimes(2))
    })

    it("opens a separate join window so an existing Feed thread keeps its reply draft", () => {
        const desk = { w: 1200, h: 760 }
        const thread = windowsReducer(EMPTY_WINDOWS, { type: "open", spec: appSpec("feed", "post/12"), desk })
        const joined = windowsReducer(thread, { type: "open", spec: applyToJoinSpec(), desk })

        expect(joined.wins).toHaveLength(2)
        expect(joined.wins[0]).toMatchObject({ id: thread.wins[0].id, key: "app:feed", target: { section: "post/12" } })
        expect(joined.wins[1]).toMatchObject({ key: "flow:feed-join", target: { section: null, query: "compose=join" } })
    })

    it("does not promise an application route while the Feed flag is off", () => {
        vi.mocked(isFeedEnabled).mockReturnValue(false)
        renderWithProviders(<JoinMembaDao open={vi.fn()} />)
        expect(screen.getByText(/will open when the Feed is available/)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Apply with a Feed post" })).toBeNull()
        expect(fetchJoinCandidates).not.toHaveBeenCalled()
    })
})
