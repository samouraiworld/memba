import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Voters } from "./Voters"

const ROW = { address: "g1lyejwwmxef5tn8nx69saykmgm8rlr4xq9yeh3z", name: "mikael", choice: "Yes", weight: "1 point" }

describe("the list of votes", () => {
    it("shows each voter's name, address, choice and weight", () => {
        render(<Voters rows={[ROW, { ...ROW, address: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", name: null, choice: "No", weight: "2 points" }]} error={false} />)
        const [named, bare] = screen.getAllByRole("listitem")
        expect(named).toHaveTextContent(`mikael${ROW.address}Yes1 point`)
        expect(bare).toHaveTextContent("g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59cNo2 points")
    })

    it("says it is reading, then that it could not, rather than listing no one", () => {
        const { rerender } = render(<Voters rows={undefined} error={false} none="No one has voted yet." />)
        expect(screen.getByRole("status")).toHaveTextContent("Reading the votes…")
        rerender(<Voters rows={undefined} error none="No one has voted yet." />)
        expect(screen.getByText("Who voted couldn't be read right now.")).toBeInTheDocument()
        expect(screen.queryByText("No one has voted yet.")).toBeNull()
    })

    it("keeps the last read when a re-read fails, and says so", () => {
        render(<Voters rows={[ROW]} error />)
        expect(screen.getByRole("listitem")).toHaveTextContent("mikael")
        expect(screen.getByText("Showing the last read: the votes couldn't be read again just now.")).toBeInTheDocument()
    })

    it("says no one voted only when it was told what to say", () => {
        const { rerender } = render(<Voters rows={[]} error={false} none="No one voted." />)
        expect(screen.getByText("No one voted.")).toBeInTheDocument()
        rerender(<Voters rows={[]} error={false} />)
        expect(screen.queryByRole("listitem")).toBeNull()
        expect(screen.queryByText(/No one/)).toBeNull()
    })
})
