/**
 * Tests for AccessibleDialog — the modal wrapper five surfaces depend on.
 *
 * It had none, and neither did useFocusTrap beneath it. Between them they carry
 * the modal semantics for ValoperEditDialog, GnoIcoAnnouncement, AIReportCard,
 * GnoloveHome and TradeModal, which moves funds. Every one of its behaviours
 * fails silently: a missing aria-modal is invisible to sighted users, a broken
 * Escape just does nothing, and a scroll lock that never unlocks leaves the page
 * frozen long after the dialog is gone.
 *
 * The focus trap itself is covered in hooks/useFocusTrap.test.tsx — jsdom does no
 * layout, so the hook's `offsetParent !== null` visibility filter makes it a
 * no-op here unless visibility is modelled explicitly, which that suite does.
 * What this file pins is everything AccessibleDialog adds on top.
 */
import { useState } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, afterEach } from "vitest"
import { AccessibleDialog } from "./AccessibleDialog"

afterEach(() => {
    // A leaked scroll lock would silently pass the next test in the file while
    // breaking the app, so never carry it across.
    document.body.style.overflow = ""
})

function Dialog({ onClose = () => {}, open = true }: { onClose?: () => void; open?: boolean }) {
    return (
        <AccessibleDialog open={open} onClose={onClose} labelledBy="dlg-title" className="overlay">
            <div role="document">
                <h2 id="dlg-title">Confirm purchase</h2>
                <button>Cancel</button>
                <button>Confirm</button>
            </div>
        </AccessibleDialog>
    )
}

describe("AccessibleDialog", () => {
    it("renders nothing when closed", () => {
        render(<Dialog open={false} />)
        expect(screen.queryByRole("dialog")).toBeNull()
    })

    it("announces itself as a modal dialog named by the referenced heading", () => {
        render(<Dialog />)
        const dialog = screen.getByRole("dialog")

        expect(dialog).toHaveAttribute("aria-modal", "true")
        expect(dialog).toHaveAttribute("aria-labelledby", "dlg-title")
        // The label must resolve to real text — a dangling id gives the dialog
        // no accessible name at all, which reads as "dialog" and nothing more.
        expect(document.getElementById("dlg-title")).toHaveTextContent("Confirm purchase")
    })

    it("keeps the caller's className so existing overlay styling still applies", () => {
        render(<Dialog />)
        expect(screen.getByRole("dialog")).toHaveClass("overlay")
    })

    it("closes on Escape", () => {
        const onClose = vi.fn()
        render(<Dialog onClose={onClose} />)

        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
        expect(onClose).toHaveBeenCalledOnce()
    })

    it("ignores other keys", () => {
        const onClose = vi.fn()
        render(<Dialog onClose={onClose} />)

        for (const key of ["Enter", "a", " ", "Tab"]) {
            fireEvent.keyDown(screen.getByRole("dialog"), { key })
        }
        expect(onClose).not.toHaveBeenCalled()
    })

    it("closes on a backdrop click but not on a click inside the panel", () => {
        const onClose = vi.fn()
        render(<Dialog onClose={onClose} />)

        // This distinction is the reason adopters can drop their own
        // stopPropagation guards; if it regressed, every click inside a dialog
        // would dismiss it mid-interaction.
        fireEvent.click(screen.getByRole("document"))
        expect(onClose).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
        expect(onClose).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole("dialog"))
        expect(onClose).toHaveBeenCalledOnce()
    })

    it("locks body scroll while open and restores the previous value on close", () => {
        document.body.style.overflow = "scroll"

        function Harness() {
            const [open, setOpen] = useState(true)
            return (
                <>
                    <button onClick={() => setOpen(false)}>close it</button>
                    <Dialog open={open} />
                </>
            )
        }
        render(<Harness />)
        expect(document.body.style.overflow).toBe("hidden")

        fireEvent.click(screen.getByRole("button", { name: "close it" }))
        // Restores what was there before, not a hardcoded "" — otherwise a page
        // that legitimately set overflow loses it every time a dialog opens.
        expect(document.body.style.overflow).toBe("scroll")
    })

    it("restores body scroll on unmount, not just on close", () => {
        // Must be a REAL overflow keyword: CSSOM silently discards an invalid
        // value, so a made-up sentinel leaves style.overflow as "" and the
        // assertion passes for the wrong reason. (It did, first time round.)
        document.body.style.overflow = "auto"
        const { unmount } = render(<Dialog />)
        expect(document.body.style.overflow).toBe("hidden")

        unmount()
        expect(document.body.style.overflow).toBe("auto")
    })
})
