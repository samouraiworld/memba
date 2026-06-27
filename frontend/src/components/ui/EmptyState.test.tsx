import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { EmptyState } from "./EmptyState"

describe("EmptyState", () => {
    it("renders the title and body", () => {
        render(<EmptyState title="No collections yet" body="Be the first to launch one." />)
        expect(screen.getByText("No collections yet")).toBeInTheDocument()
        expect(screen.getByText("Be the first to launch one.")).toBeInTheDocument()
    })

    it("renders a CTA button that fires its action", () => {
        const onClick = vi.fn()
        render(<EmptyState title="t" body="b" action={{ label: "Launch a collection", onClick }} />)
        fireEvent.click(screen.getByRole("button", { name: /launch a collection/i }))
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it("renders no CTA when no action is given (a plain empty message)", () => {
        render(<EmptyState title="t" body="b" />)
        expect(screen.queryByRole("button")).not.toBeInTheDocument()
    })
})
