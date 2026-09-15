import { describe, it, expect, afterEach, vi } from "vitest"
import { screen } from "@testing-library/react"
import { Routes, Route } from "react-router-dom"
import { renderWithProviders } from "../../test/test-utils"
import { AppStoreGate } from "./AppStoreGate"

afterEach(() => vi.unstubAllEnvs())
function mount(route: string) {
    return renderWithProviders(<Routes><Route path="/:network/apps/*" element={<AppStoreGate><div>REGISTRY_CONTENT</div></AppStoreGate>} /></Routes>, { route })
}

describe("App Store directory and registry boundary", () => {
    it.each(["/mainnet/apps", "/pearl/apps/"])("keeps ecosystem links available with the registry off at %s", route => {
        vi.stubEnv("VITE_ENABLE_APPSTORE", "false")
        mount(route)
        for (const name of ["Adena", "GnoSwap", "Boards", "Akkadia", "GnoScan", "Gno Playground"]) {
            const link = screen.getByRole("link", { name: `Visit ${name} (opens in a new tab)` })
            expect(link.getAttribute("href")).toMatch(/^https:\/\//)
            expect(link).toHaveAttribute("rel", "noopener noreferrer")
        }
        expect(screen.queryByText("REGISTRY_CONTENT")).not.toBeInTheDocument()
        expect(screen.getByText("Builder preview")).toBeInTheDocument()
    })
    it.each(["submit", "review", "my-submissions", "r/demo/app"])("keeps %s gated when the registry is disabled", path => {
        vi.stubEnv("VITE_ENABLE_APPSTORE", "false")
        mount(`/pearl/apps/${path}`)
        expect(screen.getByTestId("coming-soon-gate")).toBeInTheDocument()
        expect(screen.queryByText("REGISTRY_CONTENT")).not.toBeInTheDocument()
        expect(screen.queryByRole("button")).not.toBeInTheDocument()
        expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/pearl/")
    })
    it("mounts the real registry only when enabled", () => {
        vi.stubEnv("VITE_ENABLE_APPSTORE", "true")
        mount("/pearl/apps")
        expect(screen.getByText("REGISTRY_CONTENT")).toBeInTheDocument()
        expect(screen.queryByTestId("coming-soon-gate")).not.toBeInTheDocument()
    })
})
