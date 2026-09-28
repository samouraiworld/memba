import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { AIReportCard } from "./AIReportCard"

vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => false }))

const project = {
    project_name: "Same Repo",
    summary: "Short summary",
    summary_long: "Detailed summary",
}

beforeEach(() => {
    window.history.replaceState({}, "", "/mainnet/gnolove/reports?aiReport=older#same-repo")
    Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
    window.history.replaceState({}, "", "/")
})

it("scopes legacy project hashes and DOM ids to their report", () => {
    const { container } = render(<>
        <AIReportCard report={{ id: "newer", createdAt: "2026-09-27T12:00:00Z", data: { projects: [project] } }} />
        <AIReportCard report={{ id: "older", createdAt: "2026-09-20T12:00:00Z", data: { projects: [project] } }} />
    </>)
    const rows = [...container.querySelectorAll<HTMLElement>(".gl-aircard-project")]
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(row => row.id)).size).toBe(2)

    const newer = container.querySelector<HTMLElement>('[data-report-id="newer"]')!
    const older = container.querySelector<HTMLElement>('[data-report-id="older"]')!
    expect(within(newer).getByRole("button", { name: "Read Detailed Report" })).toHaveAttribute("aria-expanded", "false")
    expect(within(older).getByRole("button", { name: "Show short summary" })).toHaveAttribute("aria-expanded", "true")
    expect(within(older).getByText("Detailed summary")).toBeInTheDocument()
    expect(screen.getAllByText("Same Repo")).toHaveLength(2)
})
