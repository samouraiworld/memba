import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { DAOCard } from "./DAOCard"
import { SourceCodeView } from "./SourceCodeView"
import { TokenDetailDrawer } from "./TokenDetailDrawer"

vi.mock("../../hooks/useNetworkNav", () => ({ useNetworkNav: () => vi.fn() }))
vi.mock("../../hooks/useNetwork", () => ({ useNetwork: () => ({ networkKey: "mainnet" }) }))

let originalOffsetParent: PropertyDescriptor | undefined

beforeAll(() => {
    originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent")
    // jsdom does not calculate layout; model visible elements for the focus trap.
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
        configurable: true,
        get(this: HTMLElement) { return this.parentElement ?? document.body },
    })
})

afterAll(() => {
    if (originalOffsetParent) Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetParent
})

describe("Directory keyboard and dialog access", () => {
    it("leaves the DAO Save button's Enter key to the button", () => {
        const onOpen = vi.fn()
        const onSave = vi.fn()
        render(<DAOCard name="Example" path="gno.land/r/example/dao" isSaved={false} onClick={onOpen} onSave={onSave} />)

        const save = screen.getByRole("button", { name: "Save Example to Memba" })
        save.focus()
        fireEvent.keyDown(save, { key: "Enter" })
        expect(onOpen).not.toHaveBeenCalled()
        fireEvent.click(save)
        expect(onSave).toHaveBeenCalledOnce()
        expect(onOpen).not.toHaveBeenCalled()
    })

    it("moves focus into the token dialog and restores it on close", () => {
        const trigger = document.createElement("button")
        document.body.appendChild(trigger)
        trigger.focus()

        const { unmount } = render(<TokenDetailDrawer token={{ slug: "foo", name: "Foo", symbol: "FOO", path: "gno.land/r/example/foo" }} onClose={vi.fn()} />)
        const close = screen.getByRole("button", { name: "Close" })
        expect(document.activeElement).toBe(close)

        const dialog = screen.getByRole("dialog")
        screen.getByRole("link", { name: /Open in gnoweb/ }).focus()
        fireEvent.keyDown(dialog, { key: "Tab" })
        expect(document.activeElement).toBe(close)

        unmount()
        expect(document.activeElement).toBe(trigger)
        trigger.remove()
    })

    it("announces which source file is selected", () => {
        render(<SourceCodeView files={[
            { name: "a.gno", content: "package a", lines: 1 },
            { name: "b.gno", content: "package b", lines: 1 },
        ]} />)
        const a = screen.getByRole("button", { name: /a.gno/ })
        const b = screen.getByRole("button", { name: /b.gno/ })
        expect(a).toHaveAttribute("aria-pressed", "true")
        expect(b).toHaveAttribute("aria-pressed", "false")
        fireEvent.click(b)
        expect(b).toHaveAttribute("aria-pressed", "true")
        expect(a).toHaveAttribute("aria-pressed", "false")
    })
})
