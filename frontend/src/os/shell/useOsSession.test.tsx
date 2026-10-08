import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ConnectOptions } from "../../hooks/useAdena"
import { ADENA_NO_ANSWER_MESSAGE, type PromptWatch } from "../../lib/adenaCall"

const ADDR = "g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l"

// The wallet and auth hooks are the boundary: the session's stages run for real on top of them.
const wallet = {
    connected: false, address: "", pubkeyJSON: "", chainId: "", installed: true, loading: false, reconnecting: false, error: null as string | null,
    rpcUrl: "", rpcTrusted: false,
    connect: vi.fn<(opts?: ConnectOptions) => Promise<boolean>>(),
    wake: vi.fn(async () => true),
    disconnect: vi.fn(), signArbitrary: vi.fn(), signLoginChallenge: vi.fn(), addNetwork: vi.fn(), switchWalletNetwork: vi.fn(),
}
const auth = {
    token: null as unknown, isAuthenticated: false, address: "", loading: false, error: null,
    logout: vi.fn(), getChallenge: vi.fn(), getToken: vi.fn(),
}
vi.mock("../../hooks/useAdena", () => ({ useAdena: () => wallet }))
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => auth }))
vi.mock("../../hooks/useBalance", () => ({ useBalance: () => ({ rawUgnot: undefined, loading: false, balance: "0 GNOT", error: null, refetch: vi.fn() }) }))
vi.mock("../../lib/quests", () => ({ completeQuest: vi.fn(), setQuestWalletAddress: vi.fn(), syncQuestsToBackend: vi.fn(async () => {}) }))
const signInWithWallet = vi.fn()
vi.mock("./walletLogin", () => ({ signInWithWallet: (...a: unknown[]) => signInWithWallet(...a) }))

import { useOsSession } from "./useOsSession"

function pending<T>() {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((r) => { resolve = r })
    return { promise, resolve }
}

beforeEach(() => {
    Object.assign(wallet, { connected: false, address: "", pubkeyJSON: "", reconnecting: false, installed: true })
    Object.assign(auth, { isAuthenticated: false, address: "", token: null })
    wallet.connect.mockReset()
    wallet.wake.mockClear()
    signInWithWallet.mockReset()
    ;(window as unknown as { adena?: unknown }).adena = { On: () => true }
})
afterEach(() => {
    delete (window as unknown as { adena?: unknown }).adena
})

describe("useOsSession · connect", () => {
    it("wakes Adena as soon as the connect flow opens, and again when Adena is picked", async () => {
        wallet.connect.mockReturnValue(new Promise(() => {}))
        const { result } = renderHook(() => useOsSession())
        act(() => result.current.openConnect())
        expect(result.current.stage).toBe("pick")
        expect(wallet.wake).toHaveBeenCalledTimes(1)
        act(() => result.current.chooseAdena())
        expect(wallet.wake).toHaveBeenCalledTimes(2)
        expect(result.current.stage).toBe("waking")
    })

    it("says Approve in Adena only once the request was sent, then hints when Adena is slow or silent", async () => {
        const answer = pending<boolean>()
        let watch: ConnectOptions["watch"]
        wallet.connect.mockImplementation((opts) => { watch = opts?.watch; return answer.promise })
        const { result } = renderHook(() => useOsSession())
        act(() => result.current.openConnect())
        act(() => result.current.chooseAdena())
        expect(result.current.stage).toBe("waking")
        act(() => watch?.onSent?.())
        expect(result.current.stage).toBe("approve")
        expect(result.current.slow).toBe(false)
        act(() => watch?.onSlow?.())
        expect(result.current.slow).toBe(true)
        act(() => watch?.onNoPopup?.())
        expect(result.current.noPopup).toBe(true)
        await act(async () => { answer.resolve(true); await answer.promise })
        expect(result.current.stage).toBe("login")
        expect(result.current.slow).toBe(false)
        expect(result.current.noPopup).toBe(false)
    })

    it("offers a reload when Adena never answered", async () => {
        wallet.connect.mockImplementation(async (opts) => { opts?.watch?.onFailure?.("no-answer", ADENA_NO_ANSWER_MESSAGE); return false })
        const { result } = renderHook(() => useOsSession())
        act(() => result.current.openConnect())
        await act(async () => { result.current.chooseAdena() })
        expect(result.current.stage).toBe("pick")
        expect(result.current.error).toBe(ADENA_NO_ANSWER_MESSAGE)
        expect(result.current.errorKind).toBe("no-answer")
    })

    it("keeps today's message for a refusal", async () => {
        wallet.connect.mockImplementation(async (opts) => { opts?.watch?.onFailure?.("rejected", "Connection rejected"); return false })
        const { result } = renderHook(() => useOsSession())
        act(() => result.current.openConnect())
        await act(async () => { result.current.chooseAdena() })
        expect(result.current.error).toBe("Adena didn't connect. Approve Memba in the Adena window, then try again.")
        expect(result.current.errorKind).toBeNull()
    })

    it("hints from a cancelled connect are ignored", async () => {
        let watch: ConnectOptions["watch"]
        wallet.connect.mockImplementation((opts) => { watch = opts?.watch; return new Promise(() => {}) })
        const { result } = renderHook(() => useOsSession())
        act(() => result.current.openConnect())
        act(() => result.current.chooseAdena())
        act(() => result.current.cancel())
        act(() => { watch?.onSent?.(); watch?.onNoPopup?.() })
        expect(result.current.stage).toBeNull()
        expect(result.current.noPopup).toBe(false)
    })

    it("Cancel aborts the connect still waiting on Adena", () => {
        let signal: AbortSignal | undefined
        wallet.connect.mockImplementation((opts) => { signal = opts?.signal; return new Promise(() => {}) })
        const { result } = renderHook(() => useOsSession())
        act(() => result.current.openConnect())
        act(() => result.current.chooseAdena())
        expect(signal?.aborted).toBe(false)
        act(() => result.current.cancel())
        expect(signal?.aborted).toBe(true)
    })

    it("goes on to sign in when the silent reconnect lands during the connect", () => {
        wallet.connect.mockReturnValue(new Promise(() => {}))
        const { result, rerender } = renderHook(() => useOsSession())
        act(() => result.current.openConnect())
        act(() => result.current.chooseAdena())
        Object.assign(wallet, { connected: true, address: ADDR })
        rerender()
        expect(result.current.stage).toBe("login")
    })

    it("closes the flow and signs the member in when the resumed session is already theirs", () => {
        Object.assign(wallet, { reconnecting: true })
        Object.assign(auth, { isAuthenticated: true, address: ADDR })
        const onSignedIn = vi.fn()
        const { result, rerender } = renderHook(() => useOsSession({ onSignedIn }))
        expect(result.current.status).toBe("resuming")
        // Connect stays usable while the wallet resumes.
        act(() => result.current.openConnect())
        expect(result.current.stage).toBe("pick")
        Object.assign(wallet, { connected: true, address: ADDR, pubkeyJSON: '{"type":"tendermint/PubKeySecp256k1","value":"k"}', reconnecting: false })
        rerender()
        expect(result.current.status).toBe("member")
        expect(result.current.stage).toBeNull()
        expect(onSignedIn).toHaveBeenCalledWith(ADDR)
    })

    it("wakes only a wallet that is there and not connected", () => {
        const { result, rerender } = renderHook(() => useOsSession())
        act(() => result.current.wake())
        expect(wallet.wake).toHaveBeenCalledOnce()
        Object.assign(wallet, { connected: true, address: ADDR })
        rerender()
        act(() => result.current.wake())
        expect(wallet.wake).toHaveBeenCalledOnce()
    })
})

describe("useOsSession · sign-in", () => {
    beforeEach(() => { Object.assign(wallet, { connected: true, address: ADDR }) })

    it("passes Adena's window progress to the step and offers a reload when Adena never answered", async () => {
        let watch: PromptWatch | undefined
        let refuse!: (e: Error) => void
        signInWithWallet.mockImplementation((_w, _a, _c, opts: { watch?: PromptWatch }) => {
            watch = opts?.watch
            return new Promise((_, reject) => { refuse = reject })
        })
        const { result } = renderHook(() => useOsSession())
        act(() => result.current.openConnect())
        expect(result.current.stage).toBe("login")
        let signing!: Promise<void>
        act(() => { signing = result.current.signIn() })
        expect(result.current.stage).toBe("loginwait")
        act(() => watch?.onSlow?.())
        expect(result.current.slow).toBe(true)
        await act(async () => { refuse(new Error(ADENA_NO_ANSWER_MESSAGE)); await signing })
        expect(result.current.stage).toBe("login")
        expect(result.current.error).toBe(ADENA_NO_ANSWER_MESSAGE)
        expect(result.current.errorKind).toBe("no-answer")
        expect(result.current.slow).toBe(false)
    })
})
