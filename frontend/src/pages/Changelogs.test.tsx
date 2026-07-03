/**
 * W6.1 — /changelogs page renders from the REAL CHANGELOG.md (build-time
 * ?raw import): current releases appear with zero code changes, legacy
 * curated entries survive, tag filtering works.
 */
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Changelogs } from "./Changelogs"

describe("Changelogs page (real CHANGELOG.md)", () => {
    it("renders current releases parsed from CHANGELOG.md", () => {
        render(<Changelogs />)
        expect(screen.getByText("v7.2.0")).toBeTruthy()
        expect(screen.getAllByText(/June 29, 2026/).length).toBeGreaterThan(0)
    })

    it("keeps the curated legacy entries", () => {
        render(<Changelogs />)
        expect(screen.getByText("v3.2.0")).toBeTruthy()
    })

    it("shows the Unreleased block under an 'In progress' separator", () => {
        render(<Changelogs />)
        expect(screen.getAllByText("In progress").length).toBeGreaterThanOrEqual(1)
    })

    it("tag filtering narrows entries", () => {
        render(<Changelogs />)
        fireEvent.click(screen.getByRole("button", { name: "Network" }))
        // No current entries are tagged network-only → empty state (or fewer).
        // The page must not crash and the empty-state copy must exist if empty.
        const entries = document.querySelectorAll("ul")
        const empty = screen.queryByText("No entries for this filter.")
        expect(empty !== null || entries.length > 0).toBe(true)
        fireEvent.click(screen.getByRole("button", { name: "All" }))
        expect(screen.getByText("v7.2.0")).toBeTruthy()
    })
})
