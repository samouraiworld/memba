import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ComingSoon } from "./ComingSoon"

afterEach(() => {
    vi.unstubAllEnvs()
})

describe("ComingSoon", () => {
    it("shows gated features as 'soon' tiles", () => {
        vi.stubEnv("VITE_ENABLE_SERVICES", "false")
        vi.stubEnv("VITE_ENABLE_AGENTS", "false")
        vi.stubEnv("VITE_ENABLE_FEED", "false")
        render(<ComingSoon />)
        for (const k of ["services", "agents", "feed"]) {
            expect(screen.getByTestId(`soon-${k}`)).toHaveTextContent(/soon/i)
        }
    })

    it("does NOT list a feature whose flag is live (no marketplace contradiction)", () => {
        vi.stubEnv("VITE_ENABLE_MARKETPLACE", "true")
        vi.stubEnv("VITE_ENABLE_APPSTORE", "true")
        render(<ComingSoon />)
        expect(screen.queryByTestId("soon-marketplace")).not.toBeInTheDocument()
        expect(screen.queryByTestId("soon-apps")).not.toBeInTheDocument()
    })

    it("never renders the upcoming features as navigable links (gated, not live)", () => {
        vi.stubEnv("VITE_ENABLE_SERVICES", "false")
        const { container } = render(<ComingSoon />)
        expect(container.querySelectorAll("a").length).toBe(0)
    })

    it("renders nothing at all when every surface is live", () => {
        for (const flag of [
            "VITE_ENABLE_MARKETPLACE",
            "VITE_ENABLE_APPSTORE",
            "VITE_ENABLE_SPACE_INVADERS",
            "VITE_ENABLE_FEED",
            "VITE_ENABLE_GAME",
            "VITE_ENABLE_SERVICES",
            "VITE_ENABLE_AGENTS",
        ]) {
            vi.stubEnv(flag, "true")
        }
        const { container } = render(<ComingSoon />)
        expect(container.firstChild).toBeNull()
    })
})
