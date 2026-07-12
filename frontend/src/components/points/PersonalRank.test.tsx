import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PersonalRank } from "./PersonalRank"

const A = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"

describe("PersonalRank", () => {
    it("shows rank, holders, tier and points when ranked", () => {
        render(<PersonalRank profile={{ addr: A, points: 500, tier: "Gold", rank: 47, holders: 1203 }} />)
        const el = screen.getByTestId("personal-rank")
        expect(el).toHaveTextContent("47")
        expect(el).toHaveTextContent("1,203")
        expect(el).toHaveTextContent("500 MP")
        expect(screen.getByTestId("tier-badge")).toHaveTextContent("Gold")
    })

    it("shows Unranked when the member holds no points", () => {
        render(<PersonalRank profile={{ addr: A, points: 0, tier: "Bronze", rank: 0, holders: 1203 }} />)
        expect(screen.getByText("Unranked")).toBeInTheDocument()
    })
})
