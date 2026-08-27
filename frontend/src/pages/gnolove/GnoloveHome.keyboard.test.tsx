/**
 * GnoloveHome — time-filter tablist keyboard wiring.
 *
 * First test file for this page; scoped to the tablist adoption. The APG
 * keyboard contract itself is covered in hooks/useTabListKeyboard.test.tsx —
 * these pin that the page is wired through the hook (roving tabindex, and
 * arrow-selection reaching the URL state). Notably, this tablist's comment
 * always claimed keyboard consistency across /gnolove; the hook is what makes
 * that true.
 *
 * useHomeUrlState stays REAL — arrow-selection writing ?time= is the wiring
 * under test. Only the data hooks are stubbed.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

vi.mock("../../hooks/gnolove", async () => {
    const actual = await vi.importActual<typeof import("../../hooks/gnolove")>("../../hooks/gnolove")
    const empty = { data: undefined, isLoading: false, isError: false, refetch: () => {} }
    return {
        ...actual,
        useGnoloveContributors: vi.fn(() => empty),
        useGnoloveIssues: vi.fn(() => empty),
        useGnoloveFreshlyMerged: vi.fn(() => empty),
        useGnoloveRepositories: vi.fn(() => empty),
        useGnoloveMilestone: vi.fn(() => empty),
        useGnoloveScoreFactors: vi.fn(() => empty),
    }
})

vi.mock("../../hooks/useNetworkNav", () => ({
    useNetworkKey: () => "test12",
    useNetworkNav: () => () => {},
    useNetworkPath: () => (p: string) => `/test12/${p}`,
}))

import GnoloveHome from "./GnoloveHome"

function renderHome() {
    return render(
        <MemoryRouter initialEntries={["/test12/gnolove"]}>
            <GnoloveHome />
        </MemoryRouter>,
    )
}

describe("GnoloveHome — time tablist keyboard (APG)", () => {
    it("gives the time filters a roving tabindex (single tab stop)", () => {
        renderHome()
        const tablist = screen.getByRole("tablist", { name: "Time period" })
        const tabs = within(tablist).getAllByRole("tab")
        expect(tabs.filter(t => t.getAttribute("tabindex") === "0")).toHaveLength(1)
        // DEFAULT_HOME_STATE.time is MONTHLY, so the tab stop starts there.
        expect(within(tablist).getByRole("tab", { name: "This Month" })).toHaveAttribute("tabindex", "0")
    })

    it("ArrowRight moves selection This Month → This Week", () => {
        renderHome()
        const tablist = screen.getByRole("tablist", { name: "Time period" })
        fireEvent.keyDown(within(tablist).getByRole("tab", { name: "This Month" }), { key: "ArrowRight" })
        const week = within(tablist).getByRole("tab", { name: "This Week" })
        expect(week).toHaveAttribute("aria-selected", "true")
        expect(week).toHaveAttribute("tabindex", "0")
    })
})
