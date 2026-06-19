/**
 * WithdrawSection — unit tests (Task 10)
 *
 * 1. Denom input defaults to "ugnot".
 * 2. Clicking "Withdraw proceeds" calls run once with a msg whose
 *    value.args equals [id, "ugnot"].
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { WithdrawSection } from "./WithdrawSection"

// ── Constants ──────────────────────────────────────────────────────────

const CALLER = "g1samourai000000000000000000000000001"
const ID = "g1samourai000000000000000000000000001/my-collection"

// ── Tests ──────────────────────────────────────────────────────────────

describe("WithdrawSection", () => {
    it("defaults denom to ugnot", () => {
        render(<WithdrawSection id={ID} caller={CALLER} run={vi.fn()} />)
        const input = screen.getByLabelText(/denom/i) as HTMLInputElement
        expect(input.value).toBe("ugnot")
    })

    it("calls run once with args=[id, 'ugnot'] on click", () => {
        const run = vi.fn().mockResolvedValue(undefined)
        render(<WithdrawSection id={ID} caller={CALLER} run={run} />)

        fireEvent.click(screen.getByRole("button", { name: /withdraw proceeds/i }))

        expect(run).toHaveBeenCalledTimes(1)
        const msg = run.mock.calls[0][0]
        expect(msg.value.args).toStrictEqual([ID, "ugnot"])
    })
})
