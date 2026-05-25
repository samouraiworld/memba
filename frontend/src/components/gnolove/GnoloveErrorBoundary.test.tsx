import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { GnoloveErrorBoundary } from "./GnoloveErrorBoundary"

function Boom() {
    throw new Error("kaboom")
}

describe("GnoloveErrorBoundary", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {})
    })

    it("renders children when no error", () => {
        render(
            <GnoloveErrorBoundary name="Test">
                <p>child content</p>
            </GnoloveErrorBoundary>,
        )
        expect(screen.getByText("child content")).toBeInTheDocument()
    })

    describe('variant="section" (default)', () => {
        it("renders section fallback with name when a child throws", () => {
            render(
                <GnoloveErrorBoundary name="Skills">
                    <Boom />
                </GnoloveErrorBoundary>,
            )
            expect(screen.getByRole("alert")).toBeInTheDocument()
            expect(screen.getByText(/Skills unavailable/)).toBeInTheDocument()
        })

        it("invokes onError with the thrown error", () => {
            const onError = vi.fn()
            render(
                <GnoloveErrorBoundary name="Skills" onError={onError}>
                    <Boom />
                </GnoloveErrorBoundary>,
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
                <GnoloveErrorBoundary name="Skills">
                    <Conditional />
                </GnoloveErrorBoundary>,
            )
            expect(screen.getByText(/Skills unavailable/)).toBeInTheDocument()
            shouldThrow = false
            fireEvent.click(screen.getByRole("button", { name: /Try again/ }))
            expect(screen.getByText("recovered")).toBeInTheDocument()
        })
    })

    describe('variant="card"', () => {
        it("renders card fallback with name when a child throws", () => {
            render(
                <GnoloveErrorBoundary name="Active repositories" variant="card">
                    <Boom />
                </GnoloveErrorBoundary>,
            )
            expect(screen.getByRole("alert")).toBeInTheDocument()
            expect(screen.getByText("Active repositories")).toBeInTheDocument()
            expect(screen.getByText(/Couldn't load this card/)).toBeInTheDocument()
        })

        it("calls onRetry + resets on Retry click", () => {
            const onRetry = vi.fn()
            let shouldThrow = true
            function Conditional() {
                if (shouldThrow) throw new Error("once")
                return <p>card recovered</p>
            }
            render(
                <GnoloveErrorBoundary name="Metrics" variant="card" onRetry={onRetry}>
                    <Conditional />
                </GnoloveErrorBoundary>,
            )
            expect(screen.getByText(/Couldn't load this card/)).toBeInTheDocument()
            shouldThrow = false
            fireEvent.click(screen.getByRole("button", { name: /Retry/ }))
            expect(onRetry).toHaveBeenCalledTimes(1)
            expect(screen.getByText("card recovered")).toBeInTheDocument()
        })

        it("uses custom fallback when provided", () => {
            render(
                <GnoloveErrorBoundary
                    name="AI weekly report"
                    variant="card"
                    fallback={(err, name) => <div>Custom: {name} failed with {err.message}</div>}
                >
                    <Boom />
                </GnoloveErrorBoundary>,
            )
            expect(screen.getByText("Custom: AI weekly report failed with kaboom")).toBeInTheDocument()
        })
    })
})
