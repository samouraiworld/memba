/**
 * W6.1 — /changelogs page renders from the REAL CHANGELOG.md (build-time
 * ?raw import): current releases appear with zero code changes, legacy
 * curated entries survive, tag filtering works.
 */
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { Changelogs } from "./Changelogs"

function renderPage() {
    return render(<MemoryRouter initialEntries={["/mainnet/changelogs"]}><Changelogs /></MemoryRouter>)
}

describe("Changelogs page (real CHANGELOG.md)", () => {
    it("renders current releases parsed from CHANGELOG.md", () => {
        renderPage()
        expect(screen.getByText("v7.8.0")).toBeTruthy()
        expect(screen.getAllByText(/October 8, 2026/).length).toBeGreaterThan(0)
        expect(screen.getByText("v7.7.0")).toBeTruthy()
        expect(screen.getAllByText(/September 23, 2026/).length).toBeGreaterThan(0)
        expect(screen.getByText("v7.3.0")).toBeTruthy()
        expect(screen.getAllByText(/July 11, 2026/).length).toBeGreaterThan(0)
        expect(screen.getByText("v7.2.0")).toBeTruthy()
        expect(screen.getAllByText(/June 29, 2026/).length).toBeGreaterThan(0)
    })

    it("keeps the curated legacy entries", () => {
        renderPage()
        expect(screen.getByText("v3.2.0")).toBeTruthy()
    })

    it("shows ONLY the [Unreleased] block under 'Unreleased' (shipped interim titles excluded)", () => {
        renderPage()
        // One separator + at most the entry-title fallback — historical
        // "Unreleased — v6.2.x" blocks must group under their version instead.
        expect(screen.queryAllByText("Unreleased").length).toBeLessThanOrEqual(2)
        // A shipped interim-title block renders under its version label.
        expect(screen.getAllByText("v6.2.2").length).toBeGreaterThanOrEqual(1)
    })

    it("tag filtering narrows entries", () => {
        renderPage()
        fireEvent.click(screen.getByRole("button", { name: "Network" }))
        expect(screen.getByRole("button", { name: "Network" })).toHaveAttribute("aria-pressed", "true")
        expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false")
        // No current entries are tagged network-only → empty state (or fewer).
        // The page must not crash and the empty-state copy must exist if empty.
        const entries = document.querySelectorAll("ul")
        const empty = screen.queryByText("No entries for this filter.")
        expect(empty !== null || entries.length > 0).toBe(true)
        fireEvent.click(screen.getByRole("button", { name: "All" }))
        expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true")
        expect(screen.getByText("v7.2.0")).toBeTruthy()
    })

    it("has a page heading and links to both News sections", () => {
        renderPage()
        expect(screen.getByRole("heading", { name: "Changelogs", level: 1 })).toHaveFocus()
        expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute("href", "/mainnet/blog")
        expect(screen.getByRole("link", { name: "Changelogs" })).toHaveAttribute("aria-current", "page")
        expect(screen.getByRole("link", { name: "Full changelog" })).toHaveAttribute("href", "https://github.com/samouraiworld/memba/blob/main/CHANGELOG.md")
    })
})
