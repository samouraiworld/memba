import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PointsLeaderboard } from "./PointsLeaderboard"
import type { LeaderRow } from "../../lib/points"

const rows: LeaderRow[] = [
    { rank: 1, addr: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0", points: 500, tier: "Gold" },
    { rank: 2, addr: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", points: 200, tier: "Silver" },
]

describe("PointsLeaderboard", () => {
    it("renders rows with rank, points and tier", () => {
        render(<PointsLeaderboard rows={rows} />)
        expect(screen.getByTestId("points-leaderboard")).toBeInTheDocument()
        expect(screen.getByText("#1")).toBeInTheDocument()
        expect(screen.getByText("500 MP")).toBeInTheDocument()
        expect(screen.getAllByTestId("tier-badge")).toHaveLength(2)
    })

    it("shows the empty state with no rows", () => {
        render(<PointsLeaderboard rows={[]} />)
        expect(screen.getByTestId("leaderboard-empty")).toBeInTheDocument()
    })

    it("shows a loading state", () => {
        render(<PointsLeaderboard rows={[]} loading />)
        expect(screen.getByTestId("leaderboard-loading")).toBeInTheDocument()
    })

    it("pages via the callback and disables Prev on page 0", () => {
        const onPageChange = vi.fn()
        render(<PointsLeaderboard rows={rows} page={0} hasMore onPageChange={onPageChange} />)
        expect(screen.getByLabelText("Previous page")).toBeDisabled()
        fireEvent.click(screen.getByLabelText("Next page"))
        expect(onPageChange).toHaveBeenCalledWith(1)
    })

    it("highlights the connected member's row", () => {
        const { container } = render(<PointsLeaderboard rows={rows} highlightAddr={rows[0].addr} />)
        expect(container.querySelector(".points-leaderboard__row.is-me")).not.toBeNull()
    })
})
