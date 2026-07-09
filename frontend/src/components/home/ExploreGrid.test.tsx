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

    it("does NOT surface a gated feature (it belongs to ComingSoon)", () => {
        vi.stubEnv("VITE_ENABLE_APPSTORE", "false")
        vi.stubEnv("VITE_ENABLE_FEED", "false")
        vi.stubEnv("VITE_ENABLE_GAME", "false")
        renderIt()
        expect(screen.queryByTestId("explore-apps")).not.toBeInTheDocument()
        expect(screen.queryByTestId("explore-feed")).not.toBeInTheDocument()
        expect(screen.queryByTestId("explore-game")).not.toBeInTheDocument()
    })
})
