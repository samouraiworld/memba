import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { Code, ConnectError } from "@connectrpc/connect"

vi.mock("../lib/api", () => ({ api: { getToken: vi.fn(), getChallenge: vi.fn() } }))
const { api } = await import("../lib/api")
const { useAuth } = await import("./useAuth")

describe("useAuth.getToken", () => {
    const attempt = async (err: unknown) => {
        vi.mocked(api.getToken).mockRejectedValueOnce(err)
        const { result } = renderHook(() => useAuth())
        let outcome: unknown
        await act(async () => { outcome = await result.current.getToken("{}", "sig").catch((e: Error) => e.message) })
        return outcome
    }

    it("returns null only for an uncoded refusal of the login", async () => {
        expect(await attempt(new ConnectError("", Code.PermissionDenied))).toBeNull()
    })

    it("says the server failed, not the login, when it could not answer", async () => {
        expect(await attempt(new ConnectError("fetch failed", Code.Unavailable))).toBe("Memba's server didn't complete the sign-in. Try again in a moment.")
        expect(await attempt(new TypeError("Failed to fetch"))).toBe("Memba's server didn't complete the sign-in. Try again in a moment.")
        expect(await attempt(new ConnectError("", Code.Internal))).toBe("Memba's server didn't complete the sign-in. Try again in a moment.")
        expect(await attempt(new ConnectError("slow down", Code.ResourceExhausted))).toBe("Too many sign-in attempts. Wait a minute, then sign in again.")
    })
})
