/**
 * Tests for SectionErrorBoundary.
 *
 * @module components/gnolove/SectionErrorBoundary.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SectionErrorBoundary } from "./SectionErrorBoundary"

function Boom() {
    throw new Error("kaboom")
}

describe("SectionErrorBoundary", () => {
    beforeEach(() => {
        // React logs the caught error to console.error; silence the noise in tests.
        vi.spyOn(console, "error").mockImplementation(() => {})
    })

    it("renders children when no error", () => {
        render(
            <SectionErrorBoundary sectionName="Test">
                <p>child content</p>
            </SectionErrorBoundary>,
        )
        expect(screen.getByText("child content")).toBeInTheDocument()
    })

    it("renders fallback with section name when a child throws", () => {
        render(
            <SectionErrorBoundary sectionName="Skills">
                <Boom />
            </SectionErrorBoundary>,
        )
        expect(screen.getByRole("alert")).toBeInTheDocument()
        expect(screen.getByText(/Skills unavailable/)).toBeInTheDocument()
    })

    it("invokes onError with the thrown error", () => {
        const onError = vi.fn()
        render(
            <SectionErrorBoundary sectionName="Skills" onError={onError}>
                <Boom />
            </SectionErrorBoundary>,
        )
        expect(onError).toHaveBeenCalledTimes(1)
        expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
        expect((onError.mock.calls[0][0] as Error).message).toBe("kaboom")
    })

    it("recovers when Try again is clicked", () => {
        let shouldThrow = true
        function Conditional() {
            if (shouldThrow) throw new Error("once")
            return <p>recovered</p>
        }
        render(
            <SectionErrorBoundary sectionName="Skills">
                <Conditional />
            </SectionErrorBoundary>,
        )
        expect(screen.getByText(/Skills unavailable/)).toBeInTheDocument()
        shouldThrow = false
        fireEvent.click(screen.getByRole("button", { name: /Try again/ }))
        expect(screen.getByText("recovered")).toBeInTheDocument()
    })
})
