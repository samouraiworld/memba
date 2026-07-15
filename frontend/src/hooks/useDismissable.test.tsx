import { describe, it, expect, vi } from "vitest"
import { useRef } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { useDismissable } from "./useDismissable"

function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
    const ref = useRef<HTMLDivElement | null>(null)
    useDismissable(ref, open, onClose)
    return (
        <div>
            <div ref={ref} data-testid="inside">
                menu
            </div>
            <button data-testid="outside">outside</button>
        </div>
    )
}

describe("useDismissable", () => {
    it("calls onClose on Escape when open", () => {
        const onClose = vi.fn()
        render(<Harness open onClose={onClose} />)
        fireEvent.keyDown(document, { key: "Escape" })
        expect(onClose).toHaveBeenCalledOnce()
    })

    it("calls onClose on a pointer-down OUTSIDE the ref when open", () => {
        const onClose = vi.fn()
        render(<Harness open onClose={onClose} />)
        fireEvent.pointerDown(screen.getByTestId("outside"))
        expect(onClose).toHaveBeenCalledOnce()
    })

    it("does NOT call onClose on a pointer-down inside the ref", () => {
        const onClose = vi.fn()
        render(<Harness open onClose={onClose} />)
        fireEvent.pointerDown(screen.getByTestId("inside"))
        expect(onClose).not.toHaveBeenCalled()
    })

    it("is inert when closed", () => {
        const onClose = vi.fn()
        render(<Harness open={false} onClose={onClose} />)
        fireEvent.keyDown(document, { key: "Escape" })
        fireEvent.pointerDown(screen.getByTestId("outside"))
        expect(onClose).not.toHaveBeenCalled()
    })
})
