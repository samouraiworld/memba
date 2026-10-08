import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ME = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const wallet = { connected: true, address: ME, pubkeyJSON: "", chainId: "gnoland-1", installed: true, reconnecting: false, disconnect: vi.fn() }
const auth = { isAuthenticated: false, address: "", token: null, loading: false, error: null, logout: vi.fn() }

vi.mock("../../hooks/useAdena", () => ({ useAdena: () => wallet, onAdenaAccountChanged: () => () => {} }))
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => auth }))
vi.mock("../../hooks/useBalance", () => ({ useBalance: () => ({ rawUgnot: 10_000_000n, loading: false, balance: "10 GNOT", error: null, refetch: vi.fn() }) }))
vi.mock("../../lib/grc20", async (orig) => ({ ...(await orig<typeof import("../../lib/grc20")>()), networkGasPriceFresh: vi.fn(async () => ({ gas: 1000, ugnot: 1 })) }))
vi.mock("../sign/signer", () => ({ executeSignature: vi.fn(async () => ({ outcome: "sent", hash: "H" })) }))
vi.mock("./walletLogin", () => ({ signInWithWallet: vi.fn(async () => { throw new Error("Activate your address first (AUTH-ACTIVATE-01)") }) }))
vi.mock("../../lib/activation", async (orig) => ({ ...(await orig<typeof import("../../lib/activation")>()), activationOnChain: vi.fn() }))
vi.mock("../../lib/account", async (orig) => ({ ...(await orig<typeof import("../../lib/account")>()), chainPublicKey: vi.fn(async () => null) }))

import { chainPublicKey } from "../../lib/account"
import { activationOnChain } from "../../lib/activation"
import { executeSignature } from "../sign/signer"
import { useOsSession } from "./useOsSession"

/** The chain's answer, held until the test gives it. */
function holdKey() {
    let show!: (seen: boolean) => void
    vi.mocked(activationOnChain).mockImplementationOnce(() => new Promise<boolean>((resolve) => { show = resolve }))
    return (seen: boolean) => show(seen)
}

async function priced(result: { current: ReturnType<typeof useOsSession> }) {
    await waitFor(() => expect(result.current.activationCost).not.toBeNull())
}

beforeEach(() => {
    Object.assign(auth, { isAuthenticated: false, address: "" })
})
afterEach(() => { vi.clearAllMocks() })

describe("useOsSession activation", () => {
    it("opens the login step only once the chain shows the key Adena just sent", async () => {
        const show = holdKey()
        const { result } = renderHook(() => useOsSession())
        act(() => result.current.openConnect())
        await act(() => result.current.signIn())
        expect(result.current.stage).toBe("activate")
        await priced(result)

        let done!: Promise<void>
        act(() => { done = result.current.activate() })
        await waitFor(() => expect(result.current.stage).toBe("activatesent"))
        expect(activationOnChain).toHaveBeenCalledWith(ME, expect.any(AbortSignal))
        await act(async () => { show(true); await done })
        expect(result.current.stage).toBe("login")
        expect(result.current.note).toBe("Your address is active. Sign the login message to finish.")
    })

    it("says so when the chain does not show the key in time", async () => {
        vi.mocked(activationOnChain).mockResolvedValueOnce(false)
        const { result } = renderHook(() => useOsSession())
        act(() => result.current.openConnect())
        await act(() => result.current.signIn())
        await priced(result)
        await act(() => result.current.activate())
        expect(result.current.stage).toBe("login")
        expect(result.current.error).toBe("Your activation was sent, but the network doesn't show it yet. Wait a few seconds, then sign in.")
    })

    it("ends a forced activation in place, without reloading, once the chain shows the key", async () => {
        Object.assign(auth, { isAuthenticated: true, address: ME })
        const show = holdKey()
        const { result } = renderHook(() => useOsSession())
        expect(result.current.activationForced).toBe(true)
        expect(result.current.stage).toBe("activate")
        await priced(result)

        let done!: Promise<void>
        act(() => { done = result.current.activate() })
        await waitFor(() => expect(result.current.stage).toBe("activatesent"))
        await act(async () => { show(true); await done })
        expect(executeSignature).toHaveBeenCalledOnce()
        expect(result.current.activationForced).toBe(false)
        expect(result.current.stage).toBeNull()
    })

    it("keeps a forced activation open, with what to check, when the key does not show", async () => {
        Object.assign(auth, { isAuthenticated: true, address: ME })
        vi.mocked(activationOnChain).mockResolvedValueOnce(false)
        const { result } = renderHook(() => useOsSession())
        await priced(result)
        await act(() => result.current.activate())
        expect(result.current.activationForced).toBe(true)
        expect(result.current.stage).toBe("activate")
        expect(result.current.error).toBe("Your activation was sent, but the network doesn't show it yet. Select Activate in Adena again in a few seconds: Memba checks the network first, and sends nothing if it already shows your address as active.")
    })

    it("still sends the activation when the chain's key cannot be read", async () => {
        vi.mocked(chainPublicKey).mockRejectedValueOnce(new Error("fetch failed"))
        vi.mocked(activationOnChain).mockResolvedValueOnce(true)
        const { result } = renderHook(() => useOsSession())
        act(() => result.current.openConnect())
        await act(() => result.current.signIn())
        await priced(result)
        await act(() => result.current.activate())
        expect(chainPublicKey).toHaveBeenCalledWith(ME)
        expect(executeSignature).toHaveBeenCalledOnce()
        expect(result.current.stage).toBe("login")
    })

    it("sends nothing for an address the chain already shows a key for, and finishes as activated", async () => {
        vi.mocked(chainPublicKey).mockResolvedValue({ "@type": "/tm.PubKeySecp256k1", value: "A0key" })
        try {
            const { result } = renderHook(() => useOsSession())
            act(() => result.current.openConnect())
            await act(() => result.current.signIn())
            await priced(result)
            await act(() => result.current.activate())
            expect(chainPublicKey).toHaveBeenCalledWith(ME)
            expect(executeSignature).not.toHaveBeenCalled()
            expect(result.current.stage).toBe("login")
            expect(result.current.note).toBe("Your address is active. Sign the login message to finish.")

            Object.assign(auth, { isAuthenticated: true, address: ME })
            const forced = renderHook(() => useOsSession()).result
            expect(forced.current.activationForced).toBe(true)
            await priced(forced)
            await act(() => forced.current.activate())
            expect(executeSignature).not.toHaveBeenCalled()
            expect(forced.current.activationForced).toBe(false)
            expect(forced.current.stage).toBeNull()
        } finally { vi.mocked(chainPublicKey).mockResolvedValue(null) }
    })

    it("stops waiting for the chain on disconnect", async () => {
        holdKey()
        const { result } = renderHook(() => useOsSession())
        act(() => result.current.openConnect())
        await act(() => result.current.signIn())
        await priced(result)
        act(() => { void result.current.activate() })
        await waitFor(() => expect(result.current.stage).toBe("activatesent"))
        const signal = vi.mocked(activationOnChain).mock.calls[0][1]!
        act(() => result.current.disconnect())
        expect(signal.aborted).toBe(true)
        expect(result.current.stage).toBeNull()
    })
})
