import { describe, it, expect } from "vitest"
import { mapError } from "./errorMap"

describe("mapError", () => {
    it("maps a 'connect your wallet' gate to a Connect-wallet prompt, not a generic Wallet error", () => {
        const m = mapError("Please connect your wallet first.")
        expect(m.title).toMatch(/connect/i)
        // The generic /wallet/ pattern would wrongly say the tx was "rejected or
        // the wallet is unavailable" — that must NOT be what a not-connected gate shows.
        expect(m.message).not.toMatch(/rejected/i)
    })

    it("still maps a genuine wallet rejection to the Wallet error", () => {
        const m = mapError("adena: user rejected the request")
        expect(m.title).toMatch(/wallet/i)
    })

    it("falls back gracefully for unknown messages", () => {
        const m = mapError("some totally novel failure")
        expect(m.title).toBe("Something went wrong")
    })
})
