import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isFeedbackValid } from "../lib/config"
import { completeQuest, trackPageVisit } from "../lib/quests"
import { WindowActivityContext } from "../os/page/WindowActivity"
import FeedbackPage from "./FeedbackPage"

vi.mock("../lib/config", () => ({ isFeedbackValid: vi.fn(() => true) }))
vi.mock("../lib/quests", () => ({ completeQuest: vi.fn(), trackPageVisit: vi.fn() }))
vi.mock("../components/FeedbackFeed", () => ({ FeedbackFeed: () => <div data-testid="feedback-feed" /> }))

const issue = (number: number, label: string, title: string, pullRequest = false) => ({
    id: number,
    number,
    title,
    state: "open",
    comments: 1,
    created_at: "2026-09-27T12:00:00Z",
    labels: [{ name: label, color: "00aa99" }],
    user: { login: "member" },
    ...(pullRequest ? { pull_request: { url: "https://api.github.com/pulls/1" } } : {}),
})

function mockIssues(items: ReturnType<typeof issue>[]) {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ items }) }))
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
}

beforeEach(() => {
    vi.mocked(isFeedbackValid).mockReturnValue(true)
    document.title = "Memba OS"
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe("FeedbackPage", () => {
    it("lists only open feedback issues, excluding PRs even when they carry a matching label", async () => {
        const fetchMock = mockIssues([
            issue(101, "bug", "PR title", true),
            issue(102, "bug", "Fix broken wallet"),
            issue(103, "enhancement", "Add sorting"),
            issue(104, "feedback", "Improve wording"),
            issue(105, "internal", "Internal task"),
            { ...issue(106, "bug", "Closed issue"), state: "closed" },
        ])
        render(<FeedbackPage />)

        expect(await screen.findByRole("link", { name: /Fix broken wallet/ })).toHaveAttribute("href", "https://github.com/samouraiworld/Memba/issues/102")
        expect(screen.getByRole("link", { name: /Add sorting/ })).toBeInTheDocument()
        expect(screen.getByRole("link", { name: /Improve wording/ })).toBeInTheDocument()
        expect(screen.queryByText("PR title")).toBeNull()
        expect(screen.queryByText("Internal task")).toBeNull()
        expect(screen.queryByText("Closed issue")).toBeNull()
        const url = new URL(fetchMock.mock.calls[0][0] as string)
        expect(url.pathname).toBe("/search/issues")
        expect(url.searchParams.get("q")).toContain("is:issue is:open")
        expect(url.searchParams.get("q")).toContain("label:bug,enhancement,feedback")
        expect(trackPageVisit).toHaveBeenCalledWith("feedback")
    })

    it("opens the existing GitHub issue chooser without awarding the submission quest", async () => {
        mockIssues([])
        render(<FeedbackPage />)
        const submit = screen.getByRole("link", { name: /Submit Feedback/ })
        expect(submit).toHaveAttribute("href", "https://github.com/samouraiworld/Memba/issues/new/choose")
        expect(submit).toHaveAttribute("rel", "noopener noreferrer")
        fireEvent.click(submit)
        expect(completeQuest).not.toHaveBeenCalled()
    })

    it("changes the document title only while its OS window is active", async () => {
        mockIssues([])
        const { rerender, unmount } = render(
            <WindowActivityContext.Provider value={false}><FeedbackPage /></WindowActivityContext.Provider>,
        )
        expect(document.title).toBe("Memba OS")
        rerender(<WindowActivityContext.Provider value={true}><FeedbackPage /></WindowActivityContext.Provider>)
        expect(document.title).toBe("Feedback — Memba")
        rerender(<WindowActivityContext.Provider value={false}><FeedbackPage /></WindowActivityContext.Provider>)
        expect(document.title).toBe("Memba OS")
        unmount()
        expect(document.title).toBe("Memba OS")
    })

    it("defers the GitHub request and page visit until the window becomes active", async () => {
        const fetchMock = mockIssues([])
        const { rerender } = render(
            <WindowActivityContext.Provider value={false}><FeedbackPage /></WindowActivityContext.Provider>,
        )
        expect(fetchMock).not.toHaveBeenCalled()
        expect(trackPageVisit).not.toHaveBeenCalled()
        rerender(<WindowActivityContext.Provider value={true}><FeedbackPage /></WindowActivityContext.Provider>)
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
        expect(trackPageVisit).toHaveBeenCalledTimes(1)
        rerender(<WindowActivityContext.Provider value={false}><FeedbackPage /></WindowActivityContext.Provider>)
        rerender(<WindowActivityContext.Provider value={true}><FeedbackPage /></WindowActivityContext.Provider>)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(trackPageVisit).toHaveBeenCalledTimes(1)
    })

    it("shows a future notice only where the on-chain realm is unavailable", async () => {
        mockIssues([])
        const { unmount } = render(<FeedbackPage />)
        expect(screen.queryByText("NOT AVAILABLE HERE YET")).toBeNull()
        unmount()
        vi.mocked(isFeedbackValid).mockReturnValue(false)
        render(<FeedbackPage />)
        expect(screen.getByText("NOT AVAILABLE HERE YET")).toBeInTheDocument()
        expect(screen.getByText(/On-chain feedback is not available on this network yet/)).toBeInTheDocument()
    })

    it("keeps a direct GitHub fallback when the issue API fails", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [issue(102, "bug", "Recovered issue")] }) })
        vi.stubGlobal("fetch", fetchMock)
        render(<FeedbackPage />)
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Could not load GitHub issues/))
        expect(screen.getByRole("link", { name: /View directly on GitHub/ })).toHaveAttribute("href", "https://github.com/samouraiworld/Memba/issues")
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByRole("link", { name: /Recovered issue/ })).toBeInTheDocument()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })
})
