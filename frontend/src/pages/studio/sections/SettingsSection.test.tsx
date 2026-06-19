/**
 * SettingsSection — unit tests (Task 6)
 *
 * Covers the three price validation cases:
 *  1. Sub-minimum input (0.0001 GNOT) → inline error shown, Save disabled, run never called
 *  2. Valid positive price (1.5 GNOT) → Save enabled, run called once with args[1] === "1500000"
 *  3. Free mint (0 GNOT) → valid, run called once with args[1] === "0"
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SettingsSection } from "./SettingsSection"

// ── Constants ──────────────────────────────────────────────────────────

const CALLER = "g1samourai000000000000000000000000001"
const ID = "g1samourai000000000000000000000000001/my-collection"

// ── Helpers ────────────────────────────────────────────────────────────

function renderSettings(run = vi.fn()) {
    return {
        run,
        ...render(<SettingsSection id={ID} caller={CALLER} run={run} />),
    }
}

function setPriceInput(value: string) {
    const input = screen.getByLabelText(/mint price/i)
    fireEvent.change(input, { target: { value } })
}

function clickSave() {
    const btn = screen.getByRole("button", { name: /save/i })
    fireEvent.click(btn)
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("SettingsSection — sub-minimum price (0.0001 GNOT)", () => {
    it("shows the inline error message", () => {
        renderSettings()
        setPriceInput("0.0001")
        expect(screen.getByText(/minimum paid price is 0\.001 gnot/i)).toBeInTheDocument()
    })

    it("disables the Save button", () => {
        renderSettings()
        setPriceInput("0.0001")
        const btn = screen.getByRole("button", { name: /save/i })
        expect(btn).toBeDisabled()
    })

    it("does not call run when Save is clicked", () => {
        const run = vi.fn()
        renderSettings(run)
        setPriceInput("0.0001")
        clickSave()
        expect(run).not.toHaveBeenCalled()
    })
})

describe("SettingsSection — valid paid price (1.5 GNOT)", () => {
    it("enables the Save button", () => {
        renderSettings()
        setPriceInput("1.5")
        const btn = screen.getByRole("button", { name: /save/i })
        expect(btn).not.toBeDisabled()
    })

    it("calls run once with args[1] === '1500000'", async () => {
        const run = vi.fn().mockResolvedValue(undefined)
        renderSettings(run)
        setPriceInput("1.5")
        clickSave()
        expect(run).toHaveBeenCalledTimes(1)
        const msg = run.mock.calls[0][0]
        expect(msg.value.args[1]).toBe("1500000")
    })
})

describe("SettingsSection — free mint (0 GNOT)", () => {
    it("enables the Save button for a 0 price", () => {
        renderSettings()
        setPriceInput("0")
        const btn = screen.getByRole("button", { name: /save/i })
        expect(btn).not.toBeDisabled()
    })

    it("calls run once with args[1] === '0'", async () => {
        const run = vi.fn().mockResolvedValue(undefined)
        renderSettings(run)
        setPriceInput("0")
        clickSave()
        expect(run).toHaveBeenCalledTimes(1)
        const msg = run.mock.calls[0][0]
        expect(msg.value.args[1]).toBe("0")
    })
})
