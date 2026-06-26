import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ValidatorHoverCard } from "./ValidatorHoverCard"

describe("ValidatorHoverCard", () => {
    it("shows the preview on hover and hides on leave; trigger keeps its click", () => {
        let clicked = false
        render(
            <ValidatorHoverCard content={<span>PREVIEW</span>}>
                <button onClick={() => { clicked = true }}>row</button>
            </ValidatorHoverCard>,
        )
        const trigger = screen.getByRole("button", { name: "row" })

        expect(screen.queryByTestId("validator-hovercard")).toBeNull()
        fireEvent.mouseEnter(trigger)
        expect(screen.getByTestId("validator-hovercard")).toHaveTextContent("PREVIEW")
        fireEvent.mouseLeave(trigger)
        expect(screen.queryByTestId("validator-hovercard")).toBeNull()

        // The trigger's own click still fires.
        fireEvent.click(trigger)
        expect(clicked).toBe(true)
    })

    it("also shows on keyboard focus (a11y) and hides on blur", () => {
        render(
            <ValidatorHoverCard content={<span>PREVIEW</span>}>
                <button>row</button>
            </ValidatorHoverCard>,
        )
        const trigger = screen.getByRole("button")
        fireEvent.focus(trigger)
        expect(screen.getByTestId("validator-hovercard")).toBeInTheDocument()
        fireEvent.blur(trigger)
        expect(screen.queryByTestId("validator-hovercard")).toBeNull()
    })
})
