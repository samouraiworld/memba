import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import OsRoot from "./OsRoot"
import { OS_THEME_KEY } from "./theme"

function mockSystemDark(dark: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: dark && query.includes("dark"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
    }))
}

const renderOs = () => render(<MemoryRouter initialEntries={["/os"]}><OsRoot /></MemoryRouter>)

afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
})

describe("OsRoot", () => {
    it("renders the empty desktop in light when the system is light", () => {
        mockSystemDark(false)
        renderOs()
        expect(screen.getByTestId("memba-os")).toHaveAttribute("data-os-theme", "light")
        expect(screen.getByRole("banner", { name: "Menu bar" })).toBeInTheDocument()
        expect(screen.getByRole("main", { name: "Desktop" })).toBeInTheDocument()
    })

    it("renders dark when the system is dark", () => {
        mockSystemDark(true)
        renderOs()
        expect(screen.getByTestId("memba-os")).toHaveAttribute("data-os-theme", "dark")
    })

    it("lets the stored per-device choice win over the system", () => {
        mockSystemDark(true)
        localStorage.setItem(OS_THEME_KEY, "light")
        renderOs()
        expect(screen.getByTestId("memba-os")).toHaveAttribute("data-os-theme", "light")
    })
})
