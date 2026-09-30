import { fireEvent, render, screen } from "@testing-library/react"
import { useRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { useDialogKeys } from "./useDialogKeys"

/** A dialog with two controls, and (optionally) a control Memba keeps reachable above any dialog. */
function Fixture({ open = true, over = true, empty = false, onEscape }: { open?: boolean; over?: boolean; empty?: boolean; onEscape?: () => void }) {
    const dialog = useRef<HTMLDivElement>(null)
    useDialogKeys(dialog, open, "button:not(:disabled)", onEscape)
    return (
        <div className="memba-os">
            {over && <button type="button" data-os-over-dialog="">Leave</button>}
            <div className="os-desk" inert><button type="button" data-os-over-dialog="">Hidden with the desk</button></div>
            <div ref={dialog} role="dialog" aria-label="Dialog" tabIndex={-1}>
                {!empty && <><button type="button">First</button><button type="button">Last</button></>}
            </div>
        </div>
    )
}

const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey })
const named = (name: string) => screen.getByRole("button", { name })

describe("useDialogKeys", () => {
    it("cycles the dialog's controls and the control above it, both ways", () => {
        render(<Fixture />)
        named("Last").focus()
        tab()
        expect(named("Leave")).toHaveFocus()
        tab()
        expect(named("First")).toHaveFocus()
        tab(true)
        expect(named("Leave")).toHaveFocus()
        tab(true)
        expect(named("Last")).toHaveFocus()
    })

    it("leaves Tab to the browser between the dialog's own controls", () => {
        render(<Fixture />)
        named("First").focus()
        expect(tab()).toBe(true) // not prevented
        named("Last").focus()
        expect(tab(true)).toBe(true)
    })

    it("wraps inside the dialog when nothing is kept above it, and ignores controls under an inert surface", () => {
        render(<Fixture over={false} />)
        named("Last").focus()
        tab()
        expect(named("First")).toHaveFocus()
        tab(true)
        expect(named("Last")).toHaveFocus()
    })

    it("from the dialog itself, Shift+Tab goes to the end and Tab is left to the browser", () => {
        render(<Fixture />)
        const dialog = screen.getByRole("dialog")
        dialog.focus()
        expect(tab()).toBe(true)
        tab(true)
        expect(named("Leave")).toHaveFocus()
    })

    it("keeps focus on a dialog that has no control, or moves it to the control above", () => {
        const view = render(<Fixture empty over={false} />)
        const dialog = screen.getByRole("dialog")
        dialog.focus()
        expect(tab()).toBe(false)
        expect(dialog).toHaveFocus()
        view.rerender(<Fixture empty />)
        tab()
        expect(named("Leave")).toHaveFocus()
        tab()
        expect(dialog).toHaveFocus()
    })

    it("closes the dialog on Escape pressed on the control above it; inside, the dialog's own handler decides", () => {
        const onEscape = vi.fn()
        render(<Fixture onEscape={onEscape} />)
        named("First").focus()
        fireEvent.keyDown(named("First"), { key: "Escape" })
        expect(onEscape).not.toHaveBeenCalled()
        named("Leave").focus()
        fireEvent.keyDown(named("Leave"), { key: "Escape" })
        expect(onEscape).toHaveBeenCalledTimes(1)
    })

    it("does nothing while the dialog is closed, or when focus is elsewhere", () => {
        const view = render(<><Fixture open={false} /><button type="button">Outside</button></>)
        named("Last").focus()
        expect(tab()).toBe(true)
        view.rerender(<><Fixture /><button type="button">Outside</button></>)
        named("Outside").focus()
        expect(tab()).toBe(true)
        expect(named("Outside")).toHaveFocus()
    })
})
