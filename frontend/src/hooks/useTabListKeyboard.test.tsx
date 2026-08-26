/**
 * Tests for useTabListKeyboard.
 *
 * Keyboard contracts are the easiest thing in the app to break without noticing,
 * because the mouse path keeps working perfectly. Every assertion here is a
 * behaviour the ARIA tabs pattern requires, not an implementation detail — the
 * hook could be rewritten entirely and these should still hold.
 */
import { useState } from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { useTabListKeyboard } from "./useTabListKeyboard"

const KEYS = ["one", "two", "three"] as const
type Key = (typeof KEYS)[number]

function Tabs({ onSelect, initial = "one" }: { onSelect?: (k: Key) => void; initial?: Key }) {
    const [active, setActive] = useState<Key>(initial)
    const { tabProps } = useTabListKeyboard<Key>({
        keys: KEYS,
        active,
        onSelect: (k) => {
            setActive(k)
            onSelect?.(k)
        },
    })
    return (
        <div role="tablist">
            {KEYS.map((k) => (
                <button key={k} {...tabProps(k)}>
                    {k}
                </button>
            ))}
        </div>
    )
}

const tab = (name: Key) => screen.getByRole("tab", { name })

describe("useTabListKeyboard", () => {
    it("marks only the selected tab as selected", () => {
        render(<Tabs />)
        expect(tab("one")).toHaveAttribute("aria-selected", "true")
        expect(tab("two")).toHaveAttribute("aria-selected", "false")
    })

    it("makes the tablist a single tab stop (roving tabindex)", () => {
        render(<Tabs initial="two" />)
        // Exactly one tab reachable by Tab; the rest are -1 and reached by arrows.
        expect(tab("one")).toHaveAttribute("tabindex", "-1")
        expect(tab("two")).toHaveAttribute("tabindex", "0")
        expect(tab("three")).toHaveAttribute("tabindex", "-1")
    })

    it("moves right and left", () => {
        const onSelect = vi.fn()
        render(<Tabs onSelect={onSelect} />)

        fireEvent.keyDown(tab("one"), { key: "ArrowRight" })
        expect(onSelect).toHaveBeenLastCalledWith("two")

        fireEvent.keyDown(tab("two"), { key: "ArrowLeft" })
        expect(onSelect).toHaveBeenLastCalledWith("one")
    })

    it("wraps at both ends", () => {
        const onSelect = vi.fn()
        render(<Tabs initial="three" onSelect={onSelect} />)

        fireEvent.keyDown(tab("three"), { key: "ArrowRight" })
        expect(onSelect).toHaveBeenLastCalledWith("one")

        fireEvent.keyDown(tab("one"), { key: "ArrowLeft" })
        expect(onSelect).toHaveBeenLastCalledWith("three")
    })

    it("jumps to the first and last with Home and End", () => {
        const onSelect = vi.fn()
        render(<Tabs initial="two" onSelect={onSelect} />)

        fireEvent.keyDown(tab("two"), { key: "End" })
        expect(onSelect).toHaveBeenLastCalledWith("three")

        fireEvent.keyDown(tab("three"), { key: "Home" })
        expect(onSelect).toHaveBeenLastCalledWith("one")
    })

    it("moves focus to follow the selection", async () => {
        render(<Tabs />)
        fireEvent.keyDown(tab("one"), { key: "ArrowRight" })

        // Focus lands after the re-render, so it is inherently async.
        await waitFor(() => expect(document.activeElement).toBe(tab("two")))
    })

    it("ignores keys it does not own, and does not preventDefault on them", () => {
        const onSelect = vi.fn()
        render(<Tabs onSelect={onSelect} />)

        // Tab in particular MUST pass through: swallowing it would trap the
        // user inside the tablist with no way forward.
        for (const key of ["Tab", "Enter", " ", "a", "ArrowUp", "ArrowDown"]) {
            const e = fireEvent.keyDown(tab("one"), { key })
            expect(e, `${key} should not be canceled`).toBe(true)
        }
        expect(onSelect).not.toHaveBeenCalled()
    })

    it("cancels the default action for the keys it does own", () => {
        render(<Tabs />)
        // fireEvent returns false when preventDefault was called. Arrow keys
        // scroll the page otherwise, which fights the focus move.
        expect(fireEvent.keyDown(tab("one"), { key: "ArrowRight" })).toBe(false)
    })

    it("does nothing for a key that is not in the list", () => {
        const onSelect = vi.fn()
        function Rogue() {
            const { tabProps } = useTabListKeyboard<Key>({ keys: KEYS, active: "one", onSelect })
            // A key outside `keys` — index arithmetic would otherwise land
            // somewhere arbitrary rather than doing nothing.
            const props = tabProps("nope" as Key)
            return <button {...props}>rogue</button>
        }
        render(<Rogue />)

        fireEvent.keyDown(screen.getByText("rogue"), { key: "ArrowRight" })
        expect(onSelect).not.toHaveBeenCalled()
    })

    it("honours a custom idFor so ids match whatever the page already renders", async () => {
        function Custom() {
            const [active, setActive] = useState<Key>("one")
            const { tabProps } = useTabListKeyboard<Key>({
                keys: KEYS,
                active,
                onSelect: setActive,
                idFor: (k) => `custom-${k}`,
            })
            return (
                <div role="tablist">
                    {KEYS.map((k) => <button key={k} {...tabProps(k)}>{k}</button>)}
                </div>
            )
        }
        render(<Custom />)
        expect(tab("one")).toHaveAttribute("id", "custom-one")

        // Focus must follow through the custom id too — a mismatch here is
        // exactly the silent failure the shared idFor exists to prevent.
        fireEvent.keyDown(tab("one"), { key: "ArrowRight" })
        await waitFor(() => expect(document.activeElement).toBe(tab("two")))
    })
})
