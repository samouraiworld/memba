import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { StatStrip } from "./StatStrip"

describe("StatStrip", () => {
    it("renders each stat's label and value", () => {
        render(<StatStrip stats={[{ label: "Floor", value: "1.20" }, { label: "Items", value: 120 }]} />)
        expect(screen.getByText("Floor")).toBeInTheDocument()
        expect(screen.getByText("1.20")).toBeInTheDocument()
        expect(screen.getByText("Items")).toBeInTheDocument()
        expect(screen.getByText("120")).toBeInTheDocument()
    })

    it("renders skeletons instead of values while loading (never bare dashes)", () => {
        render(<StatStrip loading stats={[{ label: "Floor", value: "1.20" }, { label: "Volume", value: "48" }]} />)
        expect(screen.queryByText("1.20")).not.toBeInTheDocument()
        expect(screen.queryByText("48")).not.toBeInTheDocument()
        expect(screen.getAllByTestId("statstrip-skeleton").length).toBe(2)
        // labels still render so the strip keeps its shape
        expect(screen.getByText("Floor")).toBeInTheDocument()
    })

    it("renders a zero value as '0' (zero is real, not missing)", () => {
        render(<StatStrip stats={[{ label: "Listed", value: 0 }]} />)
        expect(screen.getByText("0")).toBeInTheDocument()
    })

    it("shows an accessible 'unavailable' marker for a null value, not a broken-looking dash", () => {
        render(<StatStrip stats={[{ label: "Volume", value: null }]} />)
        expect(screen.getByLabelText(/unavailable/i)).toBeInTheDocument()
    })
})
