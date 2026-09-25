import { act, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { subscribeTheme } from "../lib/themeStore"
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

    it("paints the classic pages in the OS theme and restores the page theme on unmount", () => {
        document.documentElement.setAttribute("data-theme", "dark")
        mockSystemDark(false)
        const { unmount } = renderOs()
        expect(document.documentElement).toHaveAttribute("data-theme", "light")
        unmount()
        expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    })

    it("keeps the OS theme when a classic control changes the page theme", () => {
        mockSystemDark(false)
        renderOs()
        act(() => {
            document.documentElement.setAttribute("data-theme", "dark")
            window.dispatchEvent(new Event("memba:theme-change"))
        })
        expect(document.documentElement).toHaveAttribute("data-theme", "light")
    })

    it("notifies a themeStore subscriber when the OS overrides the theme, and again on unmount", () => {
        document.documentElement.setAttribute("data-theme", "dark")
        mockSystemDark(false)
        const listener = vi.fn()
        const unsubscribe = subscribeTheme(listener)
        const { unmount } = renderOs()
        expect(listener).toHaveBeenCalledTimes(1)
        expect(document.documentElement).toHaveAttribute("data-theme", "light")

        unmount()
        expect(listener).toHaveBeenCalledTimes(2)
        expect(document.documentElement).toHaveAttribute("data-theme", "dark")
        unsubscribe()
    })

    it("removes data-theme on unmount when there was none before mount", () => {
        document.documentElement.removeAttribute("data-theme")
        mockSystemDark(false)
        const { unmount } = renderOs()
        expect(document.documentElement).toHaveAttribute("data-theme", "light")

        unmount()
        expect(document.documentElement).not.toHaveAttribute("data-theme")
    })

    it("keeps html[data-theme] equal to the OS theme across a re-render, and still restores the page theme on unmount", () => {
        document.documentElement.setAttribute("data-theme", "sepia")
        mockSystemDark(false)
        const { rerender, unmount } = renderOs()
        expect(document.documentElement).toHaveAttribute("data-theme", "light")

        localStorage.setItem(OS_THEME_KEY, "dark")
        rerender(<MemoryRouter initialEntries={["/os"]}><OsRoot /></MemoryRouter>)
        expect(document.documentElement).toHaveAttribute("data-theme", "dark")

        unmount()
        expect(document.documentElement).toHaveAttribute("data-theme", "sepia")
    })
})
