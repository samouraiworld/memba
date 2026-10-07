import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { AwaitingSignatures } from "./AwaitingSignatures"

describe("the bell's waiting-signature entry", () => {
    it("names joined accounts' proposals and counts shared ones neutrally, and opens Multisig", () => {
        const onOpen = vi.fn()
        render(<AwaitingSignatures awaiting={{ counts: new Map(), mine: 1, shared: 2 }} onOpen={onOpen} />)
        expect(screen.getByText("1 proposal waits for your signature")).toBeInTheDocument()
        expect(screen.getByText("2 proposals wait in a multisig shared with you")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button"))
        expect(onOpen).toHaveBeenCalledOnce()
    })
    it("shows a shared-only count without the joined line, and nothing when nothing waits", () => {
        const { container, rerender } = render(<AwaitingSignatures awaiting={{ counts: new Map(), mine: 0, shared: 1 }} onOpen={vi.fn()} />)
        expect(screen.getByText("1 proposal waits in a multisig shared with you")).toBeInTheDocument()
        expect(screen.queryByText(/for your signature/)).toBeNull()
        rerender(<AwaitingSignatures awaiting={{ counts: new Map(), mine: 0, shared: 0 }} onOpen={vi.fn()} />)
        expect(container).toBeEmptyDOMElement()
    })
})
