import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ExploreGrid } from "./ExploreGrid"

const renderIt = () => render(<MemoryRouter><ExploreGrid networkKey="test13" /></MemoryRouter>)

afterEach(() => {
    vi.unstubAllEnvs()
})

describe("ExploreGrid", () => {
    it("renders the always-live surfaces with network-aware hrefs", () => {
        renderIt()
        expect(screen.getByTestId("explore-tokens")).toHaveAttribute("href", "/test13/tokens")
        expect(screen.getByTestId("explore-directory")).toHaveAttribute("href", "/test13/directory")
        expect(screen.getByTestId("explore-validators")).toHaveAttribute("href", "/test13/validators")
        expect(screen.getByTestId("explore-gnolove")).toHaveAttribute("href", "/test13/gnolove")
        expect(screen.getByTestId("explore-quests")).toHaveAttribute("href", "/test13/quests")
        expect(screen.getByTestId("explore-multisig")).toHaveAttribute("href", "/test13/multisig")
        expect(screen.getByTestId("explore-blog")).toHaveAttribute("href", "/test13/blog")
    })

    it("labels the unavailable mainnet token launchpad", () => {
        render(<MemoryRouter><ExploreGrid networkKey="mainnet" /></MemoryRouter>)
        expect(screen.getByTestId("explore-tokens")).toHaveTextContent("not available on this network")
    })

    it("surfaces a flag-enabled feature as a live tile", () => {
        vi.stubEnv("VITE_ENABLE_APPSTORE", "true")
        vi.stubEnv("VITE_ENABLE_SPACE_INVADERS", "true")
        renderIt()
        expect(screen.getByTestId("explore-apps")).toHaveAttribute("href", "/test13/apps")
        expect(screen.getByTestId("explore-space-invaders")).toHaveAttribute(
            "href",
            "/test13/game/space-invaders",
        )
    })

    it("keeps ecosystem discovery available while gated app features stay hidden", () => {
        vi.stubEnv("VITE_ENABLE_APPSTORE", "false")
        vi.stubEnv("VITE_ENABLE_FEED", "false")
        vi.stubEnv("VITE_ENABLE_GAME", "false")
        renderIt()
        expect(screen.getByTestId("explore-apps")).toHaveAttribute("href", "/test13/apps")
        expect(screen.queryByTestId("explore-feed")).not.toBeInTheDocument()
        expect(screen.queryByTestId("explore-game")).not.toBeInTheDocument()
    })
})
