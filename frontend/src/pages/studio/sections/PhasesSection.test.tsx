/**
 * PhasesSection — unit tests (Task 8)
 *
 * Covers the phase selector:
 *  1. Selecting "Public" and clicking Save calls run once with
 *     value.args === [id, "2", ""]
 *  2. A phase description is rendered on screen.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PhasesSection } from "./PhasesSection"
import type { CollectionDetail as CollectionInfo } from "../../../lib/launchpad"

// ── Constants ──────────────────────────────────────────────────────────

const CALLER = "g1samourai000000000000000000000000001"
const ID = "g1samourai000000000000000000000000001/my-collection"

const BASE_COL: CollectionInfo = {
    name: "My Collection",
    symbol: "MYC",
    id: ID,
    creator: CALLER,
    admin: CALLER,
    royaltyBps: 500,
    royaltyRecip: CALLER,
    phase: 0,
    mintPrice: 0,
    payDenom: "ugnot",
    minted: 0,
    maxSupply: 0,
    paused: false,
}

// ── Helpers ────────────────────────────────────────────────────────────

function renderPhases(col = BASE_COL, run = vi.fn()) {
    return {
        run,
        ...render(<PhasesSection id={ID} caller={CALLER} col={col} run={run} />),
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("PhasesSection", () => {
    it("renders a phase description", () => {
        renderPhases()
        // At least one description is visible (Draft is the default for phase=0)
        expect(screen.getByText(/Hidden; only you can admin-mint\./i)).toBeInTheDocument()
    })

    it("selecting Public and saving calls run with args [id, '2', '']", async () => {
        const run = vi.fn().mockResolvedValue(undefined)
        renderPhases(BASE_COL, run)

        // Select "Public" option
        const select = screen.getByRole("combobox")
        fireEvent.change(select, { target: { value: "2" } })

        // The Public description should now be visible
        expect(screen.getByText(/Anyone can mint at the configured price\./i)).toBeInTheDocument()

        // Click Save
        const saveBtn = screen.getByRole("button", { name: /save/i })
        fireEvent.click(saveBtn)

        expect(run).toHaveBeenCalledTimes(1)
        const [msg] = run.mock.calls[0]
        expect(msg.value.func).toBe("SetMintPhase")
        expect(msg.value.args).toStrictEqual([ID, "2", ""])
    })
})
