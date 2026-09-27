import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => vi.fn() }))
vi.mock("../hooks/useNetwork", () => ({ useNetwork: () => ({ networkKey: "gnoland1", switchNetwork: vi.fn() }) }))
vi.mock("../components/ui/ThemeSelect", () => ({ ThemeSelect: () => null }))

import { Settings } from "./Settings"

const savedGas = () => JSON.parse(localStorage.getItem("memba_settings") ?? "null") as { gasWanted: number; gasFee: number }

beforeEach(() => localStorage.clear())
afterEach(cleanup)

function openGasDefaults() {
    render(<Settings />)
    fireEvent.click(screen.getByRole("button", { name: /Gas Defaults/ }))
}

function updateFromAnotherTab(gasWanted: number, gasFee: number, dispatch = true) {
    const next = JSON.stringify({ gasWanted, gasFee })
    localStorage.setItem("memba_settings", next)
    if (dispatch) act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "memba_settings", newValue: next })) })
}

describe("Settings gas defaults", () => {
    it("shows safe defaults without rewriting unsafe storage on mount", () => {
        localStorage.setItem("memba_settings", JSON.stringify({ gasWanted: 100_000_001, gasFee: 10_000_001 }))
        openGasDefaults()
        expect(screen.getByLabelText("Gas Wanted")).toHaveValue("10000000")
        expect(screen.getByLabelText("Gas Fee (ugnot)")).toHaveValue("1000000")
        expect(savedGas()).toEqual({ gasWanted: 100_000_001, gasFee: 10_000_001 })
    })

    it("keeps partial and invalid edits out of storage", () => {
        openGasDefaults()
        const wanted = screen.getByLabelText("Gas Wanted")
        fireEvent.change(wanted, { target: { value: "" } })
        expect(localStorage.getItem("memba_settings")).toBeNull()
        fireEvent.change(wanted, { target: { value: "100000001" } })
        fireEvent.blur(wanted)
        expect(wanted).toHaveAttribute("aria-invalid", "true")
        expect(localStorage.getItem("memba_settings")).toBeNull()

        const fee = screen.getByLabelText("Gas Fee (ugnot)")
        fireEvent.change(fee, { target: { value: "1e3" } })
        fireEvent.blur(fee)
        expect(fee).toHaveAttribute("aria-invalid", "true")
        expect(localStorage.getItem("memba_settings")).toBeNull()
    })

    it("persists whole values at the supported limits only after blur", async () => {
        openGasDefaults()
        const wanted = screen.getByLabelText("Gas Wanted")
        fireEvent.change(wanted, { target: { value: "100000000" } })
        expect(localStorage.getItem("memba_settings")).toBeNull()
        fireEvent.blur(wanted)
        await waitFor(() => expect(savedGas().gasWanted).toBe(100_000_000))

        const fee = screen.getByLabelText("Gas Fee (ugnot)")
        fireEvent.change(fee, { target: { value: "10000000" } })
        expect(savedGas().gasFee).toBe(1_000_000)
        fireEvent.blur(fee)
        await waitFor(() => expect(savedGas().gasFee).toBe(10_000_000))
        expect(screen.getByText("✓ Settings saved")).toBeInTheDocument()
    })

    it("refreshes clean fields when another tab changes the settings", () => {
        openGasDefaults()
        updateFromAnotherTab(25_000_000, 3_000_000)
        expect(screen.getByLabelText("Gas Wanted")).toHaveValue("25000000")
        expect(screen.getByLabelText("Gas Fee (ugnot)")).toHaveValue("3000000")
    })

    it("preserves the other tab's fee when committing a local gas limit", () => {
        openGasDefaults()
        const wanted = screen.getByLabelText("Gas Wanted")
        fireEvent.change(wanted, { target: { value: "25000000" } })
        updateFromAnotherTab(10_000_000, 3_000_000)
        fireEvent.blur(wanted)
        expect(savedGas()).toEqual({ gasWanted: 25_000_000, gasFee: 3_000_000 })
        expect(screen.getByLabelText("Gas Fee (ugnot)")).toHaveValue("3000000")
    })

    it("blocks a stale same-field save until the user explicitly resolves the conflict", () => {
        openGasDefaults()
        const wanted = screen.getByLabelText("Gas Wanted")
        fireEvent.change(wanted, { target: { value: "25000000" } })
        updateFromAnotherTab(30_000_000, 3_000_000)
        fireEvent.blur(wanted)
        expect(savedGas()).toEqual({ gasWanted: 30_000_000, gasFee: 3_000_000 })
        expect(screen.getByText(/Gas Wanted changed in another tab/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Save my value" }))
        expect(savedGas()).toEqual({ gasWanted: 25_000_000, gasFee: 3_000_000 })
    })

    it("detects a same-field change even when its storage event has not arrived", () => {
        openGasDefaults()
        const fee = screen.getByLabelText("Gas Fee (ugnot)")
        fireEvent.change(fee, { target: { value: "2000000" } })
        updateFromAnotherTab(20_000_000, 3_000_000, false)
        fireEvent.blur(fee)
        expect(savedGas()).toEqual({ gasWanted: 20_000_000, gasFee: 3_000_000 })
        fireEvent.click(screen.getByRole("button", { name: "Use latest value" }))
        expect(fee).toHaveValue("3000000")
    })

    it("refreshes an untouched field on blur when its storage event has not arrived", () => {
        openGasDefaults()
        const wanted = screen.getByLabelText("Gas Wanted")
        updateFromAnotherTab(30_000_000, 3_000_000, false)
        fireEvent.blur(wanted)
        expect(savedGas()).toEqual({ gasWanted: 30_000_000, gasFee: 3_000_000 })
        expect(wanted).toHaveValue("30000000")
        expect(screen.getByLabelText("Gas Fee (ugnot)")).toHaveValue("3000000")
        expect(screen.queryByText("✓ Settings saved")).not.toBeInTheDocument()
    })
})
