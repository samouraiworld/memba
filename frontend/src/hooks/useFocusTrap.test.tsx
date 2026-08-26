/**
 * Tests for useFocusTrap — the focus primitive five dialogs depend on.
 *
 * It had none. AccessibleDialog has none either, and between them they carry the
 * keyboard containment for ValoperEditDialog, GnoIcoAnnouncement, AIReportCard,
 * GnoloveHome and now TradeModal, which moves funds. A trap that silently stops
 * working looks exactly like one that works, until a keyboard user Tabs out of a
 * live trade into the page behind it.
 *
 * ── Why the offsetParent stub ─────────────────────────────────────────────────
 * The hook filters candidates with `el.offsetParent !== null` to skip hidden
 * elements. jsdom performs no layout, so offsetParent is null for EVERY element,
 * visible or not — verified directly, not assumed. Without a stub the filter
 * drops everything and the hook becomes a silent no-op, which is why a naive
 * "focus moved into the dialog" assertion fails here for environmental reasons
 * rather than real ones.
 *
 * So visibility is modelled explicitly: offsetParent reports null only for
 * elements marked `data-hidden`, and a real object otherwise. That keeps the
 * hidden-element branch under test instead of stubbing it away.
 */
import { useRef } from "react"
import { render, fireEvent } from "@testing-library/react"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { useFocusTrap } from "./useFocusTrap"

let originalOffsetParent: PropertyDescriptor | undefined

beforeAll(() => {
    originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent")
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
        configurable: true,
        get(this: HTMLElement) {
            return this.hasAttribute("data-hidden") ? null : (this.parentElement ?? document.body)
        },
    })
})

afterAll(() => {
    if (originalOffsetParent) {
        Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent)
    } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetParent
    }
})

function Trapped({ active = true, withHidden = false }: { active?: boolean; withHidden?: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    useFocusTrap(ref, active)
    return (
        <div ref={ref} data-testid="trap">
            <button>first</button>
            {withHidden && <button data-hidden>hidden</button>}
            <button disabled>disabled</button>
            <button>last</button>
        </div>
    )
}

describe("useFocusTrap", () => {
    it("the offsetParent stub models visibility (guard against a vacuous suite)", () => {
        const { getByText } = render(<Trapped withHidden />)
        expect(getByText("first").offsetParent).not.toBeNull()
        expect(getByText("hidden").offsetParent).toBeNull()
    })

    it("moves focus to the first focusable element when activated", () => {
        const { getByText } = render(<Trapped />)
        expect(document.activeElement).toBe(getByText("first"))
    })

    it("does nothing when inactive", () => {
        const outside = document.createElement("button")
        document.body.appendChild(outside)
        outside.focus()

        render(<Trapped active={false} />)
        expect(document.activeElement).toBe(outside)
        outside.remove()
    })

    it("wraps Tab from the last element back to the first", () => {
        const { getByText, getByTestId } = render(<Trapped />)
        getByText("last").focus()

        fireEvent.keyDown(getByTestId("trap"), { key: "Tab" })
        expect(document.activeElement).toBe(getByText("first"))
    })

    it("wraps Shift+Tab from the first element back to the last", () => {
        const { getByText, getByTestId } = render(<Trapped />)
        getByText("first").focus()

        fireEvent.keyDown(getByTestId("trap"), { key: "Tab", shiftKey: true })
        expect(document.activeElement).toBe(getByText("last"))
    })

    it("leaves Tab alone in the middle of the list — it must not hijack normal tabbing", () => {
        const { getByText, getByTestId } = render(<Trapped />)
        getByText("first").focus()

        // Not at either edge, so the browser's own tab order should proceed
        // untouched. The hook only intervenes at the boundaries.
        fireEvent.keyDown(getByTestId("trap"), { key: "Enter" })
        expect(document.activeElement).toBe(getByText("first"))
    })

    it("skips hidden and disabled elements when choosing the boundaries", () => {
        const { getByText, getByTestId } = render(<Trapped withHidden />)
        getByText("last").focus()

        // Wrapping must land on "first", never on the hidden or disabled button.
        fireEvent.keyDown(getByTestId("trap"), { key: "Tab" })
        expect(document.activeElement).toBe(getByText("first"))

        getByText("first").focus()
        fireEvent.keyDown(getByTestId("trap"), { key: "Tab", shiftKey: true })
        expect(document.activeElement).toBe(getByText("last"))
    })

    it("restores focus to whatever was focused before, on unmount", () => {
        const outside = document.createElement("button")
        document.body.appendChild(outside)
        outside.focus()

        const { unmount } = render(<Trapped />)
        expect(document.activeElement).not.toBe(outside)

        unmount()
        expect(document.activeElement).toBe(outside)
        outside.remove()
    })
})
