import { describe, expect, it } from "vitest"
import { walletErrorText } from "./walletErrorText"

const FALLBACK = "Could not post. Please try again."

describe("walletErrorText", () => {
    it("stays silent on the person's own cancel, in the wallet or in Memba's review", () => {
        expect(walletErrorText(new Error("The transaction has been rejected by the user."), FALLBACK)).toBe("")
        expect(walletErrorText(new Error("Transaction cancelled by user"), FALLBACK)).toBe("")
    })

    it("shows what failed: a guard's refusal, word for word", () => {
        const untrusted = "🛡️ Transaction blocked — Your wallet is using an untrusted RPC: https://rpc.example:443"
        expect(walletErrorText(new Error(untrusted), FALLBACK)).toBe(untrusted)
        expect(walletErrorText(new Error("Your Memba session ended. Connect again before signing."), FALLBACK)).toBe("Your Memba session ended. Connect again before signing.")
    })

    it("strips the panic prefix and prefers the node's own reason", () => {
        expect(walletErrorText(new Error("VM call failed: panic: posting too fast"), FALLBACK)).toBe("posting too fast")
        const rejected = Object.assign(new Error("invalid tx · Data: vm.VMError · panic: body too long"), { name: "ChainRejectedError", reason: "panic: body too long" })
        expect(walletErrorText(rejected, FALLBACK)).toBe("body too long")
        const bare = Object.assign(new Error("The network refused the transaction"), { name: "ChainRejectedError", reason: "no reason given" })
        expect(walletErrorText(bare, FALLBACK)).toBe("The network refused the transaction")
    })

    it("caps a long message", () => {
        const line = walletErrorText(new Error("x".repeat(500)), FALLBACK)
        expect(line).toHaveLength(200)
        expect(line.endsWith("…")).toBe(true)
    })

    it("falls back only when the error says nothing", () => {
        expect(walletErrorText(new Error(""), FALLBACK)).toBe(FALLBACK)
        expect(walletErrorText(new Error("panic: "), FALLBACK)).toBe(FALLBACK)
        expect(walletErrorText(undefined, FALLBACK)).toBe(FALLBACK)
        expect(walletErrorText("Adena wallet not available — please install or refresh the page", FALLBACK)).toBe("Adena wallet not available — please install or refresh the page")
    })
})
