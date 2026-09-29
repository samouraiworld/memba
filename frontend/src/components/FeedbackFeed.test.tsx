import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FeedbackFeed } from "./FeedbackFeed"
import { queryRender } from "../lib/dao/shared"
import { isFeedbackValid } from "../lib/config"
import { WindowActivityContext } from "../os/page/WindowActivity"

vi.mock("../lib/dao/shared", () => ({ queryRender: vi.fn() }))
vi.mock("../lib/config", () => ({
    GNO_RPC_URL: "https://rpc.example.test",
    FEEDBACK_REALM_PATH: "gno.land/r/samcrew/memba_feedback_v2",
    isFeedbackValid: vi.fn(() => true),
}))

beforeEach(() => vi.mocked(isFeedbackValid).mockReturnValue(true))
afterEach(() => vi.clearAllMocks())

describe("FeedbackFeed", () => {
    it("shows a valid empty board without suggesting an unavailable post action", async () => {
        vi.mocked(queryRender).mockResolvedValue("# #general\n\n*No threads yet. Be the first to post!*\n")
        render(<FeedbackFeed />)
        expect(await screen.findByText(/No on-chain feedback has been posted yet/)).toBeInTheDocument()
        expect(screen.queryByText(/Be the first/)).toBeNull()
        expect(queryRender).toHaveBeenCalledWith("https://rpc.example.test", "gno.land/r/samcrew/memba_feedback_v2", "general", true)
    })

    it("keeps a failed render distinct from an empty board and retries", async () => {
        vi.mocked(queryRender).mockResolvedValueOnce(null).mockResolvedValueOnce("# #general\n\n*No threads yet. Be the first to post!*\n")
        render(<FeedbackFeed />)
        expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
        expect(screen.queryByText(/No on-chain feedback/)).toBeNull()
        expect(queryRender).toHaveBeenCalledWith("https://rpc.example.test", "gno.land/r/samcrew/memba_feedback_v2", "general", true)
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText(/No on-chain feedback has been posted yet/)).toBeInTheDocument()
        expect(queryRender).toHaveBeenCalledTimes(2)
    })

    it("renders live threads and skips invalid realms", async () => {
        vi.mocked(queryRender).mockResolvedValue("# general\n\n### [Helpful idea](:general/1)\nby g1abc123 | 2 replies | block 123")
        const { unmount } = render(<FeedbackFeed />)
        expect(await screen.findByText("Helpful idea")).toBeInTheDocument()
        expect(screen.getByRole("heading", { name: "On-chain feedback preview", level: 2 })).toBeInTheDocument()
        unmount()
        vi.mocked(isFeedbackValid).mockReturnValue(false)
        render(<FeedbackFeed />)
        await waitFor(() => expect(queryRender).toHaveBeenCalledTimes(1))
        expect(screen.queryByText("Helpful idea")).toBeNull()
    })

    it("does not call malformed nonempty output an empty board", async () => {
        vi.mocked(queryRender).mockResolvedValue("unexpected RPC body")
        render(<FeedbackFeed />)
        expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
        expect(screen.queryByText(/No on-chain feedback/)).toBeNull()
    })

    it("defers the realm read while its OS window is inactive", async () => {
        vi.mocked(queryRender).mockResolvedValue("# #general\n\n*No threads yet. Be the first to post!*\n")
        const { rerender } = render(
            <WindowActivityContext.Provider value={false}><FeedbackFeed /></WindowActivityContext.Provider>,
        )
        expect(queryRender).not.toHaveBeenCalled()
        rerender(<WindowActivityContext.Provider value={true}><FeedbackFeed /></WindowActivityContext.Provider>)
        expect(await screen.findByText(/No on-chain feedback has been posted yet/)).toBeInTheDocument()
        expect(queryRender).toHaveBeenCalledTimes(1)
        rerender(<WindowActivityContext.Provider value={false}><FeedbackFeed /></WindowActivityContext.Provider>)
        rerender(<WindowActivityContext.Provider value={true}><FeedbackFeed /></WindowActivityContext.Provider>)
        expect(queryRender).toHaveBeenCalledTimes(1)
    })
})
