/**
 * AllowlistSection — unit tests (Task 9)
 *
 * Covers the allowlist builder:
 *  1. Pasting two g1 address lines and clicking "Compute root" shows entry
 *     count (2) and a non-empty root.
 *  2. Clicking "Set allowlist phase" calls run once with a msg where
 *     value.func === "SetMintPhase" and value.args === [id, "1", <root>].
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, findByText, waitFor } from "@testing-library/react"
import { AllowlistSection } from "./AllowlistSection"

// ── Constants ──────────────────────────────────────────────────────────

const CALLER = "g1samourai000000000000000000000000001"
const ID = "g1samourai000000000000000000000000001/my-collection"

// Two real g1 addresses in the address,qty format parseAllowlistText accepts
const ALLOWLIST_TEXT = [
    "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5,1",
    "g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj,2",
].join("\n")

// ── Helpers ────────────────────────────────────────────────────────────

function renderAllowlist(run = vi.fn()) {
    return {
        run,
        ...render(<AllowlistSection id={ID} caller={CALLER} run={run} />),
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("AllowlistSection", () => {
    it("compute root shows entry count and a non-empty root", async () => {
        renderAllowlist()

        const textarea = screen.getByRole("textbox")
        fireEvent.change(textarea, { target: { value: ALLOWLIST_TEXT } })

        fireEvent.click(screen.getByRole("button", { name: /compute root/i }))

        // computeAllowlistRoot is async — wait for results to appear
        await waitFor(() => {
            expect(screen.getByText(/2 entries/i)).toBeInTheDocument()
        })

        // Root summary hint is visible: "2 entries · root <truncated>…"
        expect(screen.getByText(/entries · root/i)).toBeInTheDocument()
    })

    it("Set allowlist phase calls run with args [id, '1', root]", async () => {
        const run = vi.fn().mockResolvedValue(undefined)
        renderAllowlist(run)

        const textarea = screen.getByRole("textbox")
        fireEvent.change(textarea, { target: { value: ALLOWLIST_TEXT } })

        fireEvent.click(screen.getByRole("button", { name: /compute root/i }))

        // Wait for the "Set allowlist phase" button to appear (root computed)
        const setPhaseBtn = await screen.findByRole("button", { name: /set allowlist phase/i })
        fireEvent.click(setPhaseBtn)

        expect(run).toHaveBeenCalledTimes(1)
        const [msg] = run.mock.calls[0]
        expect(msg.value.func).toBe("SetMintPhase")
        // Phase.Allowlist === 1; root is the computed Merkle root (non-empty)
        expect(msg.value.args[0]).toBe(ID)
        expect(msg.value.args[1]).toBe("1")
        expect(msg.value.args[2]).toBeTruthy()
        expect(msg.value.args[2].length).toBeGreaterThan(0)
    })
})
