import { describe, it, expect, vi, afterEach } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../test/test-utils"
import * as config from "../../lib/config"
import * as points from "../../lib/points"
import { PointsPanel } from "./PointsPanel"

const A = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"

afterEach(() => vi.restoreAllMocks())

describe("PointsPanel", () => {
    it("renders nothing when the feature flag is off", () => {
        vi.spyOn(config, "isPointsEnabled").mockReturnValue(false)
        renderWithProviders(<PointsPanel address={A} />)
        expect(screen.queryByTestId("points-panel")).toBeNull()
    })

    it("renders the member rank + leaderboard when enabled", async () => {
        vi.spyOn(config, "isPointsEnabled").mockReturnValue(true)
        vi.spyOn(points, "getProfile").mockResolvedValue({
            addr: A, points: 500, tier: "Gold", rank: 1, holders: 3,
        })
        vi.spyOn(points, "getTopNPage").mockResolvedValue([
            { rank: 1, addr: A, points: 500, tier: "Gold" },
            { rank: 2, addr: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", points: 200, tier: "Silver" },
        ])
        renderWithProviders(<PointsPanel address={A} />)
        expect(screen.getByTestId("points-panel")).toBeInTheDocument()
        expect(await screen.findByTestId("personal-rank")).toBeInTheDocument()
        expect(await screen.findByTestId("points-leaderboard")).toBeInTheDocument()
    })
})
