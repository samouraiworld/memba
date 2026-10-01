import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ProgressBar } from "./ProgressBar"

describe("ProgressBar outcome", () => {
    it("shows a recorded outcome in its own colour, never the ready one", () => {
        const { rerender } = render(<ProgressBar current={2} verified={2} threshold={2} total={3} />)
        const ready = screen.getByText("Ready to broadcast").style.color
        rerender(<ProgressBar current={2} verified={2} threshold={2} total={3} outcome="failed" />)
        expect(screen.queryByText("Ready to broadcast")).not.toBeInTheDocument()
        expect(screen.getByText("Failed on chain").style.color).not.toBe(ready)
        expect(screen.getByText("Failed on chain").style.color).toContain("--color-danger")
        rerender(<ProgressBar current={2} verified={2} threshold={2} total={3} outcome="executed" />)
        expect(screen.getByText("Executed on chain").style.color).toBe(ready)
    })
})
