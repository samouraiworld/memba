import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/retiredSite", async original => ({
    ...(await original<typeof import("../../lib/retiredSite")>()),
    isRetiredHost: vi.fn(() => true),
}))
const { MovedNotice } = await import("./MovedNotice")
const { isRetiredHost: mockedHost } = await import("../../lib/retiredSite")

const at = (url: string) => render(<MemoryRouter initialEntries={[url]}><MovedNotice /></MemoryRouter>)

afterEach(() => { sessionStorage.clear(); vi.mocked(mockedHost).mockReturnValue(true) })

describe("MovedNotice", () => {
    it("on the retired site, links the same page on memba.club and names what stays behind", () => {
        at("/mainnet/feed/post/12?x=1#reply")
        expect(screen.getByText("Memba has moved to memba.club.")).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "Open this page on memba.club" })).toHaveAttribute("href", "https://memba.club/mainnet/feed/post/12?x=1#reply")
        expect(screen.getByTestId("moved-notice")).toHaveTextContent("saved DAOs, drafts and settings")
    })

    it("stays hidden for the session once dismissed", () => {
        at("/mainnet/")
        fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }))
        expect(screen.queryByTestId("moved-notice")).not.toBeInTheDocument()
        at("/mainnet/dao")
        expect(screen.queryByTestId("moved-notice")).not.toBeInTheDocument()
    })

    it("is absent on any other host", () => {
        vi.mocked(mockedHost).mockReturnValue(false)
        at("/mainnet/")
        expect(screen.queryByTestId("moved-notice")).not.toBeInTheDocument()
    })
})

describe("isRetiredHost", () => {
    it("matches the retired domain and its canary host exactly, never memba.club or a deploy preview", async () => {
        const { isRetiredHost } = await vi.importActual<typeof import("../../lib/retiredSite")>("../../lib/retiredSite")
        expect(isRetiredHost("memba.samourai.app")).toBe(true)
        expect(isRetiredHost("memba-multisig.netlify.app")).toBe(true)
        expect(isRetiredHost("memba.club")).toBe(false)
        expect(isRetiredHost("deploy-preview-12--memba-multisig.netlify.app")).toBe(false)
        expect(isRetiredHost("localhost")).toBe(false)
    })
})
