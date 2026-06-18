/**
 * MintSection — unit tests (Task 7)
 *
 * Covers the admin-mint path:
 *  1. The promoted admin-mint copy is visible ("Mint straight to a wallet…")
 *  2. Clicking "Mint to recipient" calls run once with a msg where
 *     value.func === "Mint" and value.args deep-equals [id, to, uri]
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MintSection } from "./MintSection"
import type { CollectionDetail as CollectionInfo } from "../../../lib/launchpad"

// ── Constants ──────────────────────────────────────────────────────────

const CALLER = "g1samourai000000000000000000000000001"
const ID = "g1samourai000000000000000000000000001/my-collection"
const TO = "g1recipient000000000000000000000000002"
const URI = "ipfs://Qm123"

const BASE_COL: CollectionInfo = {
    name: "My Collection",
    symbol: "MYC",
    id: ID,
    creator: CALLER,
    admin: CALLER,
    royaltyBps: 500,
    royaltyRecip: CALLER,
    phase: 2,
    mintPrice: 0,
    payDenom: "ugnot",
    minted: 0,
    maxSupply: 0,
    paused: false,
}

// ── Helpers ────────────────────────────────────────────────────────────

function renderMint(col = BASE_COL, run = vi.fn()) {
    return {
        run,
        ...render(<MintSection id={ID} caller={CALLER} col={col} run={run} />),
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("MintSection — admin-mint (promoted)", () => {
    it("shows the promoted admin-mint copy", () => {
        renderMint()
        expect(
            screen.getByText(/Mint straight to a wallet — no payment, works in any phase\./i),
        ).toBeInTheDocument()
    })

    it("calls run once with func='Mint' and args=[id, to, uri]", async () => {
        const run = vi.fn().mockResolvedValue(undefined)
        renderMint(BASE_COL, run)

        // Fill in recipient and URI fields in the admin-mint card
        const recipientInput = screen.getByPlaceholderText(/g1.*defaults to your connected wallet/i)
        fireEvent.change(recipientInput, { target: { value: TO } })

        const uriInput = screen.getByPlaceholderText(/ipfs.*leave blank for default/i)
        fireEvent.change(uriInput, { target: { value: URI } })

        // Click the admin-mint button
        const mintBtn = screen.getByRole("button", { name: /mint to recipient/i })
        fireEvent.click(mintBtn)

        expect(run).toHaveBeenCalledTimes(1)
        const msg = run.mock.calls[0][0]
        expect(msg.value.func).toBe("Mint")
        expect(msg.value.args).toStrictEqual([ID, TO, URI])
    })
})
