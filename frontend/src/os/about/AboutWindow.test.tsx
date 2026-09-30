import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { APP_VERSION, isFeedEnabled } from "../../lib/config"
import { COMMUNITY_MEMBERSHIP_COPY, useCommunityMembership } from "../../lib/communityMembership"
import { AboutWindow } from "./AboutWindow"
import { ABOUT_LINKS, LICENSE_URL, bootEntryPath, buildCommit } from "./aboutInfo"

vi.mock("../../lib/config", async original => ({ ...(await original<typeof import("../../lib/config")>()), isFeedEnabled: vi.fn() }))
vi.mock("../../lib/communityMembership", async original => ({ ...(await original<typeof import("../../lib/communityMembership")>()), useCommunityMembership: vi.fn() }))

beforeEach(() => {
    vi.mocked(isFeedEnabled).mockReturnValue(true)
    vi.mocked(useCommunityMembership).mockReturnValue("closed")
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })))
})

afterEach(() => {
    vi.unstubAllGlobals()
    document.querySelectorAll('script[data-about-test]').forEach(script => script.remove())
})

const commit = "533b851a87c4efaa306e625bffa651db311c3c1f"
const entry = "assets/index-current123.js"

function draw(info: unknown = { version: APP_VERSION, commit, entry }) {
    const script = document.createElement("script")
    script.type = "module"
    script.src = `/${entry}`
    script.dataset.aboutTest = ""
    document.body.append(script)
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => info })))
    const openApp = vi.fn()
    const open = vi.fn()
    render(<AboutWindow chainId="gnoland-1" openApp={openApp} open={open} />)
    return { openApp, open }
}

describe("AboutWindow", () => {
    it("shows this build and the selected chain without claiming a future OS version", async () => {
        draw()
        expect(screen.getByRole("heading", { name: "Memba OS" })).toBeInTheDocument()
        expect(await screen.findByText(`Version ${APP_VERSION} · Build ${commit.slice(0, 8)} · Chain gnoland-1`)).toBeInTheDocument()
        expect(screen.getByRole("note")).toHaveTextContent("Public Beta")
        expect(screen.queryByText(/manifesto/i)).not.toBeInTheDocument()
    })

    it("does not identify a build using missing or mismatched metadata", async () => {
        expect(buildCommit({ version: "other", commit, entry }, `/${entry}`)).toBeNull()
        expect(buildCommit({ version: APP_VERSION, commit: "unknown", entry }, `/${entry}`)).toBeNull()
        expect(buildCommit({ version: APP_VERSION, commit, entry }, `/${entry}`)).toBe(commit.slice(0, 8))
        draw({ version: "other", commit, entry })
        expect(await screen.findByText(`Version ${APP_VERSION} · Chain gnoland-1`)).toBeInTheDocument()
    })

    it("withholds a same-version deploy commit when this tab booted another entry", async () => {
        draw({ version: APP_VERSION, commit, entry: "assets/index-newer456.js" })
        expect(bootEntryPath()).toBe(`/${entry}`)
        expect(buildCommit({ version: APP_VERSION, commit, entry: "assets/index-newer456.js" }, `/${entry}`)).toBeNull()
        expect(await screen.findByText(`Version ${APP_VERSION} · Chain gnoland-1`)).toBeInTheDocument()
    })

    it("uses verified outside links safely and opens blog and feedback within the OS", () => {
        const { open, openApp } = draw()
        for (const { label, href } of ABOUT_LINKS) {
            const link = screen.getByRole("link", { name: label })
            expect(link).toHaveAttribute("href", href)
            expect(link).toHaveAttribute("target", "_blank")
            expect(link).toHaveAttribute("rel", "noopener noreferrer")
        }
        fireEvent.click(screen.getByRole("button", { name: "Read the blog" }))
        fireEvent.click(screen.getByRole("button", { name: "Send feedback" }))
        expect(openApp).toHaveBeenCalledWith("news")
        expect(open).toHaveBeenCalledWith(expect.objectContaining({ key: "feedback" }))
        expect(screen.getByRole("link", { name: "MIT licence" })).toHaveAttribute("href", LICENSE_URL)
    })

    it("opens the #join composer and says membership is not open while the DAO cannot admit anyone", () => {
        const { open } = draw()
        expect(screen.getByText(COMMUNITY_MEMBERSHIP_COPY.closed)).toBeInTheDocument()
        expect(screen.queryByText(/apply/i)).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Write a #join post" }))
        expect(open).toHaveBeenCalledWith(expect.objectContaining({ key: "flow:feed-join" }))
    })

    it("states open membership only when the chain says so, and nothing about it unread", () => {
        vi.mocked(useCommunityMembership).mockReturnValue("open")
        const { unmount } = render(<AboutWindow chainId="gnoland-1" openApp={vi.fn()} open={vi.fn()} />)
        expect(screen.getByText(COMMUNITY_MEMBERSHIP_COPY.open)).toBeInTheDocument()
        unmount()
        vi.mocked(useCommunityMembership).mockReturnValue("unknown")
        render(<AboutWindow chainId="gnoland-1" openApp={vi.fn()} open={vi.fn()} />)
        expect(screen.getByText(COMMUNITY_MEMBERSHIP_COPY.unknown)).toBeInTheDocument()
        expect(screen.queryByText(/admits members|does not own/)).not.toBeInTheDocument()
    })

    it("offers no join route and reads nothing while the Feed is off", () => {
        vi.mocked(isFeedEnabled).mockReturnValue(false)
        draw()
        expect(screen.queryByRole("button", { name: "Write a #join post" })).not.toBeInTheDocument()
        expect(screen.queryByText(/#join/)).not.toBeInTheDocument()
        expect(useCommunityMembership).toHaveBeenCalledWith(false)
    })
})
