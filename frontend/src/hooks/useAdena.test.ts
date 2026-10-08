/**
 * Unit tests for useAdena — the Adena wallet / auth hook.
 *
 * useAdena is a P0 money-path: it owns wallet connection, the RPC-trust gate,
 * multisig/login signing, and the auto-reconnect ("silent connect") flow that
 * must NOT spam the Adena approval popup. These tests pin the behaviors that
 * would silently break user funds/auth if regressed.
 *
 * Boundary mocked: ONLY `window.adena` (the injected wallet provider). All hook
 * logic — state transitions, the reconnecting guard, RPC-trust derivation,
 * the changedNetwork handler — runs for real. Assertions are on the hook's
 * observable output (result.current.*) and on call-counts of the injected
 * provider, never on the mock asserting its own behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { StrictMode } from "react"

const SESSION_KEY = "memba_adena_connected"

const TRUSTED_RPC = "https://rpc.test13.testnets.gno.land:443" // real *.gno.land → trusted
const UNTRUSTED_RPC = "https://rpc.evil.example:443"           // not on the allowlist

const ADDR = "g1trusted000000000000000000000000000000000"
const ADDR2 = "g1changed00000000000000000000000000000000"

/** A successful Adena GetAccount() response. */
function okAccount(overrides?: Partial<{ address: string; chainId: string; pubKeyValue: string | null }>) {
    const { address = ADDR, chainId = "test13", pubKeyValue = "Awxxx==" } = overrides ?? {}
    return {
        status: "success",
        data: {
            address,
            coins: "0ugnot",
            publicKey: pubKeyValue == null ? null : { "@type": "/tm.PubKeySecp256k1", value: pubKeyValue },
            accountNumber: "1",
            sequence: "0",
            chainId,
        },
    }
}

/**
 * Build a fake `window.adena` provider. Every method is a vi.fn so tests can
 * assert call counts and reconfigure per-test. Defaults model a wallet that has
 * already whitelisted Memba (silent GetAccount succeeds) on a trusted network.
 */
function makeAdena(overrides?: Record<string, unknown>) {
    return {
        GetAccount: vi.fn().mockResolvedValue(okAccount()),
        AddEstablish: vi.fn().mockResolvedValue({ status: "success" }),
        GetNetwork: vi.fn().mockResolvedValue({ status: "success", data: { rpcUrl: TRUSTED_RPC } }),
        On: vi.fn().mockReturnValue(true),
        SignMultisigTransaction: vi.fn(),
        AddNetwork: vi.fn(),
        SwitchNetwork: vi.fn(),
        ...overrides,
    }
}

function setAdena(provider: unknown) {
    ;(window as unknown as Record<string, unknown>).adena = provider
}
function clearAdena() {
    delete (window as unknown as Record<string, unknown>).adena
}

// Import the hook AFTER the module graph is set up. trackEvent (analytics) is a
// no-op without window.plausible; setWalletRpcContext / isTrustedRpcDomain run
// for real — RPC-trust is part of the hook's observable security output.
import { __resetWalletStoreForTests, onAdenaAccountChanged, useAdena } from "./useAdena"
import { doContractBroadcast, setWalletRpcContext } from "../lib/grc20"
import { GNO_CHAIN_ID } from "../lib/config"
import { isWalletRequestPending } from "../lib/walletActivity"

beforeEach(() => {
    sessionStorage.clear() // setup.ts only clears localStorage; the hook uses sessionStorage
    clearAdena()
    vi.restoreAllMocks()
    // One wallet store per page: every test is a fresh page.
    __resetWalletStoreForTests()
})

afterEach(() => {
    clearAdena()
})

describe("useAdena — connect success", () => {
    it("transitions to connected and exposes the returned address (woken wallet: reads only, no AddEstablish)", async () => {
        const adena = makeAdena()
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        expect(result.current.connected).toBe(false)

        let returned: boolean | undefined
        await act(async () => {
            await result.current.wake()
            returned = await result.current.connect()
        })

        expect(returned).toBe(true)
        expect(result.current.connected).toBe(true)
        expect(result.current.address).toBe(ADDR)
        expect(result.current.loading).toBe(false)
        expect(result.current.error).toBeNull()
        // Already-whitelisted wallet must NOT trigger the approval popup: AddEstablish closes every Adena window.
        expect(adena.AddEstablish).not.toHaveBeenCalled()
    })

    it("falls back to the AddEstablish popup flow when the wake says the site is not connected", async () => {
        const adena = makeAdena({
            GetNetwork: vi
                .fn()
                .mockResolvedValueOnce({ status: "failure", type: "NOT_CONNECTED" }) // the wake
                .mockResolvedValue({ status: "success", data: { rpcUrl: TRUSTED_RPC } }),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await result.current.wake()
            await result.current.connect()
        })

        expect(adena.AddEstablish).toHaveBeenCalledTimes(1)
        expect(adena.AddEstablish).toHaveBeenCalledWith("Memba")
        expect(result.current.connected).toBe(true)
        expect(result.current.address).toBe(ADDR)
    })
})

describe("useAdena — connect ordering (latency)", () => {
    afterEach(() => { vi.useRealTimers() })

    it("without a fresh wake, sends AddEstablish first (Adena answers ALREADY_CONNECTED at once), then reads", async () => {
        const order: string[] = []
        const adena = makeAdena({
            AddEstablish: vi.fn(async () => { order.push("establish"); return { status: "failure", type: "ALREADY_CONNECTED" } }),
            GetAccount: vi.fn(async () => { order.push("account"); return okAccount() }),
            GetNetwork: vi.fn(async () => { order.push("network"); return { status: "success", data: { rpcUrl: TRUSTED_RPC } } }),
        })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        let ok: boolean | undefined
        await act(async () => { ok = await result.current.connect() })
        expect(ok).toBe(true)
        expect(order[0]).toBe("establish")
        expect(order.slice(1).sort()).toEqual(["account", "network"])
        expect(adena.GetAccount).toHaveBeenCalledOnce()
    })

    it("a wake older than 10 s no longer counts: AddEstablish goes first again", async () => {
        const adena = makeAdena()
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        const now = Date.now()
        const clock = vi.spyOn(Date, "now").mockReturnValue(now)
        await act(async () => { await result.current.wake() })
        clock.mockReturnValue(now + 10_001)
        await act(async () => { await result.current.connect() })
        expect(adena.AddEstablish).toHaveBeenCalledOnce()
    })

    it("with a fresh wake but an account Adena no longer connects, asks AddEstablish then reads again", async () => {
        const adena = makeAdena({
            GetAccount: vi.fn().mockResolvedValueOnce({ status: "failure", type: "NOT_CONNECTED" }).mockResolvedValue(okAccount()),
        })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        let ok: boolean | undefined
        await act(async () => {
            await result.current.wake()
            ok = await result.current.connect()
        })
        expect(ok).toBe(true)
        expect(adena.AddEstablish).toHaveBeenCalledOnce()
        expect(adena.GetAccount).toHaveBeenCalledTimes(2)
    })

    it("reads the account and the network side by side", async () => {
        let releaseAcct!: (v: unknown) => void
        const adena = makeAdena({ GetAccount: vi.fn().mockReturnValue(new Promise((r) => { releaseAcct = r })) })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        let pending!: Promise<boolean>
        await act(async () => { await result.current.wake() })
        adena.GetNetwork.mockClear()
        act(() => { pending = result.current.connect() })
        // GetNetwork is asked while GetAccount is still unanswered.
        await waitFor(() => expect(adena.GetNetwork).toHaveBeenCalledOnce())
        expect(adena.GetAccount).toHaveBeenCalledOnce()
        await act(async () => { releaseAcct(okAccount()); await pending })
        expect(result.current.connected).toBe(true)
        expect(result.current.rpcTrusted).toBe(true)
    })

    it("does not wake Adena again while its last answer is fresh", async () => {
        const adena = makeAdena()
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await Promise.all([result.current.wake(), result.current.wake()])
            await result.current.wake()
        })
        expect(adena.GetNetwork).toHaveBeenCalledOnce()
    })

    it("wakes Adena again once its last answer is older than 10 s, so a connect 10-20 s after a wake still skips AddEstablish", async () => {
        const adena = makeAdena()
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        const now = Date.now()
        const clock = vi.spyOn(Date, "now").mockReturnValue(now)
        await act(async () => { await result.current.wake() })
        clock.mockReturnValue(now + 15_000)
        let ok: boolean | undefined
        await act(async () => {
            await result.current.wake()
            ok = await result.current.connect()
        })
        expect(ok).toBe(true)
        // Two wakes, then the connect's own read.
        expect(adena.GetNetwork).toHaveBeenCalledTimes(3)
        expect(adena.AddEstablish).not.toHaveBeenCalled()
    })

    it("a wake that gets no answer gives up after 4 s, and connect then goes the AddEstablish way", async () => {
        vi.useFakeTimers()
        const adena = makeAdena({ GetNetwork: vi.fn().mockReturnValueOnce(new Promise(() => {})).mockResolvedValue({ status: "success", data: { rpcUrl: TRUSTED_RPC } }) })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        let woke: boolean | undefined
        await act(async () => {
            const w = result.current.wake().then((v) => { woke = v })
            await vi.advanceTimersByTimeAsync(4_000)
            await w
        })
        expect(woke).toBe(false)
        await act(async () => { await result.current.connect() })
        expect(adena.AddEstablish).toHaveBeenCalledOnce()
        expect(result.current.connected).toBe(true)
    })

    it("says Adena didn't answer when a read never settles (a tab older than an Adena update)", async () => {
        vi.useFakeTimers()
        const adena = makeAdena({ GetAccount: vi.fn().mockReturnValue(new Promise(() => {})) })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        const onFailure = vi.fn()
        let ok: boolean | undefined
        await act(async () => {
            const c = result.current.connect({ watch: { onFailure } }).then((v) => { ok = v })
            await vi.advanceTimersByTimeAsync(15_000)
            await c
        })
        expect(ok).toBe(false)
        expect(result.current.error).toBe("Adena didn't answer — reload this tab (needed after Adena updates).")
        expect(onFailure).toHaveBeenCalledWith("no-answer", result.current.error)
        expect(result.current.loading).toBe(false)
    })

    it("a silent reconnect gives up after 8 s without an answer, and never opens a window", async () => {
        vi.useFakeTimers()
        const adena = makeAdena({ GetAccount: vi.fn().mockReturnValue(new Promise(() => {})) })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        let ok: boolean | undefined
        await act(async () => {
            const c = result.current.connect({ silent: true }).then((v) => { ok = v })
            await vi.advanceTimersByTimeAsync(7_999)
            expect(ok).toBeUndefined()
            await vi.advanceTimersByTimeAsync(1)
            await c
        })
        expect(ok).toBe(false)
        expect(adena.AddEstablish).not.toHaveBeenCalled()
        expect(result.current.error).toBeNull()
    })

    it("an interactive connect waits for a running silent one and adds no window when it succeeds", async () => {
        let releaseAcct!: (v: unknown) => void
        const adena = makeAdena({ GetAccount: vi.fn().mockReturnValueOnce(new Promise((r) => { releaseAcct = r })).mockResolvedValue(okAccount()) })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        let silent!: Promise<boolean>
        let interactive!: Promise<boolean>
        act(() => { silent = result.current.connect({ silent: true }) })
        act(() => { interactive = result.current.connect() })
        await act(async () => { await Promise.resolve() })
        expect(adena.AddEstablish).not.toHaveBeenCalled()
        let ok: boolean | undefined
        await act(async () => {
            releaseAcct(okAccount())
            await silent
            ok = await interactive
        })
        expect(ok).toBe(true)
        expect(adena.AddEstablish).not.toHaveBeenCalled()
        expect(adena.GetAccount).toHaveBeenCalledOnce()
    })

    it("an interactive connect goes on with AddEstablish when the silent one it waited for failed", async () => {
        let releaseAcct!: (v: unknown) => void
        const adena = makeAdena({ GetAccount: vi.fn().mockReturnValueOnce(new Promise((r) => { releaseAcct = r })).mockResolvedValue(okAccount()) })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        let interactive!: Promise<boolean>
        act(() => { void result.current.connect({ silent: true }) })
        act(() => { interactive = result.current.connect() })
        let ok: boolean | undefined
        await act(async () => {
            releaseAcct({ status: "failure", type: "WALLET_LOCKED" })
            ok = await interactive
        })
        expect(ok).toBe(true)
        expect(adena.AddEstablish).toHaveBeenCalledOnce()
    })

    it("says Adena closed its window or hit an error when Adena answers UNEXPECTED_ERROR", async () => {
        const adena = makeAdena({ AddEstablish: vi.fn().mockResolvedValue({ status: "failure", type: "UNEXPECTED_ERROR" }) })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        const onFailure = vi.fn()
        let ok: boolean | undefined
        await act(async () => { ok = await result.current.connect({ watch: { onFailure } }) })
        expect(ok).toBe(false)
        expect(result.current.error).toBe("Adena closed its window or hit an error (another tab may have asked it something). Try again.")
        expect(onFailure).toHaveBeenCalledWith("closed", result.current.error)
    })

    it("tells the caller when AddEstablish is sent, when it is slow, and when its window never seemed to open", async () => {
        vi.useFakeTimers()
        let answer!: (v: unknown) => void
        const adena = makeAdena({ AddEstablish: vi.fn().mockReturnValue(new Promise((r) => { answer = r })) })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        const onSent = vi.fn()
        const onSlow = vi.fn()
        const onNoPopup = vi.fn()
        let ok: boolean | undefined
        await act(async () => {
            const c = result.current.connect({ watch: { onSent, onSlow, onNoPopup } }).then((v) => { ok = v })
            await vi.advanceTimersByTimeAsync(0)
            expect(onSent).toHaveBeenCalledOnce()
            await vi.advanceTimersByTimeAsync(3_000)
            expect(onSlow).toHaveBeenCalledOnce()
            expect(onNoPopup).not.toHaveBeenCalled()
            await vi.advanceTimersByTimeAsync(5_000)
            expect(onNoPopup).toHaveBeenCalledOnce()
            // A hint only: the person can still answer, and the connect completes.
            answer({ status: "success" })
            await c
        })
        expect(ok).toBe(true)
    })
})

describe("useAdena — a cancelled connect", () => {
    it("cancelled while the wake runs: sends no AddEstablish and records no session", async () => {
        let releaseWake!: (v: unknown) => void
        const adena = makeAdena({
            GetNetwork: vi.fn().mockReturnValueOnce(new Promise((r) => { releaseWake = r })).mockResolvedValue({ status: "success", data: { rpcUrl: TRUSTED_RPC } }),
        })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        const stop = new AbortController()
        let pending!: Promise<boolean>
        act(() => {
            void result.current.wake()
            pending = result.current.connect({ signal: stop.signal })
        })
        stop.abort()
        let ok: boolean | undefined
        await act(async () => {
            releaseWake({ status: "failure", type: "NOT_CONNECTED" })
            ok = await pending
        })
        expect(ok).toBe(false)
        expect(adena.AddEstablish).not.toHaveBeenCalled()
        expect(localStorage.getItem(SESSION_KEY)).toBeNull()
        expect(result.current.connected).toBe(false)
        expect(result.current.loading).toBe(false)
        expect(result.current.error).toBeNull()
    })

    it("cancelled while a silent resume runs: sends no AddEstablish once the resume fails", async () => {
        let releaseAcct!: (v: unknown) => void
        const adena = makeAdena({ GetAccount: vi.fn().mockReturnValueOnce(new Promise((r) => { releaseAcct = r })).mockResolvedValue(okAccount()) })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        const stop = new AbortController()
        let interactive!: Promise<boolean>
        act(() => { void result.current.connect({ silent: true }) })
        act(() => { interactive = result.current.connect({ signal: stop.signal }) })
        stop.abort()
        let ok: boolean | undefined
        await act(async () => {
            releaseAcct({ status: "failure", type: "WALLET_LOCKED" })
            ok = await interactive
        })
        expect(ok).toBe(false)
        expect(adena.AddEstablish).not.toHaveBeenCalled()
        expect(localStorage.getItem(SESSION_KEY)).toBeNull()
        expect(result.current.connected).toBe(false)
    })

    it("cancelled while Adena's window is open: records no session when Adena answers later", async () => {
        let releaseEstablish!: (v: unknown) => void
        const adena = makeAdena({ AddEstablish: vi.fn().mockReturnValue(new Promise((r) => { releaseEstablish = r })) })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        const stop = new AbortController()
        let pending!: Promise<boolean>
        act(() => { pending = result.current.connect({ signal: stop.signal }) })
        await waitFor(() => expect(adena.AddEstablish).toHaveBeenCalledOnce())
        stop.abort()
        let ok: boolean | undefined
        await act(async () => {
            releaseEstablish({ status: "success" })
            ok = await pending
        })
        expect(ok).toBe(false)
        expect(localStorage.getItem(SESSION_KEY)).toBeNull()
        expect(result.current.connected).toBe(false)
        expect(result.current.loading).toBe(false)
    })
})

describe("useAdena — RPC trust gate (observable security output)", () => {
    it("marks the wallet RPC trusted when GetNetwork returns an allowlisted domain", async () => {
        const adena = makeAdena() // GetNetwork → TRUSTED_RPC
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await result.current.connect()
        })

        expect(result.current.rpcUrl).toBe(TRUSTED_RPC)
        expect(result.current.rpcTrusted).toBe(true)
    })

    it("marks the wallet RPC UNtrusted when GetNetwork returns a non-allowlisted domain", async () => {
        const adena = makeAdena({
            GetNetwork: vi.fn().mockResolvedValue({ status: "success", data: { rpcUrl: UNTRUSTED_RPC } }),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await result.current.connect()
        })

        expect(result.current.connected).toBe(true)
        expect(result.current.rpcUrl).toBe(UNTRUSTED_RPC)
        expect(result.current.rpcTrusted).toBe(false)
    })
})

describe("useAdena — Adena not installed", () => {
    it("does not throw, stays disconnected, and surfaces an installed=false / error", async () => {
        clearAdena() // window.adena is undefined

        const { result } = renderHook(() => useAdena())
        expect(result.current.installed).toBe(false)

        let returned: boolean | undefined
        await act(async () => {
            returned = await result.current.connect() // must not throw
        })

        expect(returned).toBe(false)
        expect(result.current.connected).toBe(false)
        expect(result.current.address).toBe("")
        expect(result.current.error).toBe("Adena wallet not installed")
    })
})

describe("useAdena — connect rejection / user-declined", () => {
    it("stays disconnected, surfaces an error, and does NOT get stuck in loading", async () => {
        // No silent session → establish flow runs → user rejects the popup.
        const adena = makeAdena({
            GetAccount: vi.fn().mockResolvedValue({ status: "failure", data: null }),
            AddEstablish: vi.fn().mockResolvedValue({ status: "failure", type: "USER_REJECTED" }),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        let returned: boolean | undefined
        await act(async () => {
            returned = await result.current.connect()
        })

        expect(returned).toBe(false)
        expect(result.current.connected).toBe(false)
        expect(result.current.error).toBe("Connection rejected")
        // Critical: loading must be reset so the connect button isn't stuck spinning.
        expect(result.current.loading).toBe(false)
    })

    it("recovers (no stuck loading, error surfaced) when the provider throws mid-connect", async () => {
        const adena = makeAdena({
            GetAccount: vi.fn().mockResolvedValue({ status: "failure", data: null }),
            AddEstablish: vi.fn().mockRejectedValue(new Error("network blip")),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await result.current.connect()
        })

        expect(result.current.connected).toBe(false)
        expect(result.current.loading).toBe(false)
        expect(result.current.error).toBe("network blip")
    })
})

describe("useAdena — silent mode", () => {
    it("gives up without showing the popup when silent and no session exists", async () => {
        const adena = makeAdena({
            GetAccount: vi.fn().mockResolvedValue({ status: "failure", data: null }),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        let returned: boolean | undefined
        await act(async () => {
            returned = await result.current.connect({ silent: true })
        })

        expect(returned).toBe(false)
        expect(result.current.connected).toBe(false)
        // The whole point of silent mode: never invoke the interactive approval popup.
        expect(adena.AddEstablish).not.toHaveBeenCalled()
        expect(result.current.loading).toBe(false)
        expect(result.current.reconnecting).toBe(false)
    })
})

describe("useAdena — auto-reconnect guard (silent connect, no popup spam)", () => {
    it("runs the silent reconnect exactly ONCE under StrictMode double-invoke (guard, no popup spam)", async () => {
        // sessionStorage flag set → hook auto-reconnects silently on mount.
        // StrictMode double-invokes effects in dev; the autoReconnectAttempted
        // ref must collapse that to a SINGLE silent GetAccount probe. Without the
        // guard, the effect fires twice → the wallet is probed twice (and in the
        // interactive path that is exactly the duplicate-popup bug).
        sessionStorage.setItem(SESSION_KEY, "true")
        const adena = makeAdena() // silent GetAccount succeeds
        setAdena(adena)

        const { result } = renderHook(() => useAdena(), { wrapper: StrictMode })

        await waitFor(() => expect(result.current.connected).toBe(true))

        // The auto-reconnect ran via the silent path → no approval popup, and the
        // guard collapsed StrictMode's double-invoke to a single wallet probe.
        expect(adena.GetAccount).toHaveBeenCalledTimes(1)
        expect(adena.AddEstablish).not.toHaveBeenCalled()
        expect(result.current.reconnecting).toBe(false)
    })

    it("does not re-issue a silent reconnect on plain re-renders (guard stays latched)", async () => {
        sessionStorage.setItem(SESSION_KEY, "true")
        const adena = makeAdena()
        setAdena(adena)

        const { result, rerender } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.connected).toBe(true))
        const callsAfterMount = adena.GetAccount.mock.calls.length

        rerender()
        rerender()
        await act(async () => {
            await Promise.resolve()
        })

        expect(adena.GetAccount.mock.calls.length).toBe(callsAfterMount)
        expect(adena.AddEstablish).not.toHaveBeenCalled()
    })

    it("does not auto-reconnect when there is no prior session flag", async () => {
        // No sessionStorage flag → reconnecting must settle to false and the
        // wallet must not be probed automatically on mount.
        const adena = makeAdena()
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.reconnecting).toBe(false))

        expect(adena.GetAccount).not.toHaveBeenCalled()
        expect(result.current.connected).toBe(false)
    })
})

describe("useAdena — disconnect", () => {
    it("clears connected and address state", async () => {
        sessionStorage.setItem(SESSION_KEY, "true")
        const adena = makeAdena()
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await result.current.connect()
        })
        expect(result.current.connected).toBe(true)
        expect(result.current.address).toBe(ADDR)

        act(() => {
            result.current.disconnect()
        })

        expect(result.current.connected).toBe(false)
        expect(result.current.address).toBe("")
        expect(result.current.rpcTrusted).toBe(false)
        // Session flag cleared so a later mount won't silently auto-reconnect.
        expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
    })
})

describe("useAdena — changedNetwork subscription", () => {
    it("subscribes once connected and updates address + RPC trust on a network change", async () => {
        // Capture the handler Adena would invoke on a wallet network switch.
        let changedHandler: (() => void | Promise<void>) | undefined
        const adena = makeAdena({
            On: vi.fn((event: string, cb: () => void | Promise<void>) => {
                if (event === "changedNetwork") changedHandler = cb
                return true
            }),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await result.current.connect()
        })
        expect(result.current.rpcTrusted).toBe(true)
        expect(adena.On).toHaveBeenCalledWith("changedNetwork", expect.any(Function))
        expect(changedHandler).toBeTypeOf("function")

        // Simulate the user switching the wallet to an UNtrusted RPC + new address.
        adena.GetNetwork.mockResolvedValue({ status: "success", data: { rpcUrl: UNTRUSTED_RPC } })
        adena.GetAccount.mockResolvedValue(okAccount({ address: ADDR2, chainId: "othernet" }))

        await act(async () => {
            await changedHandler!()
        })

        expect(result.current.rpcUrl).toBe(UNTRUSTED_RPC)
        expect(result.current.rpcTrusted).toBe(false)
        expect(result.current.address).toBe(ADDR2)
        expect(result.current.chainId).toBe("othernet")
    })

    it("re-reads the account's key on a network change: Adena's key is per network", async () => {
        let changedHandler: (() => void | Promise<void>) | undefined
        const adena = makeAdena({ On: vi.fn((event: string, cb: () => void) => { if (event === "changedNetwork") changedHandler = cb; return true }) })
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: "onyx-1", pubKeyValue: null }))
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        await act(async () => { await result.current.connect() })
        expect(result.current.pubkeyJSON).toBe("")
        // On the new network the account has transacted: its key is known there.
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: "gnoland-1", pubKeyValue: "Akey==" }))
        await act(async () => { await changedHandler!() })
        expect(result.current.pubkeyJSON).toBe('{"type":"tendermint/PubKeySecp256k1","value":"Akey=="}')
        // And back to a network where it never transacted: no key, so login asks by address.
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: "onyx-1", pubKeyValue: null }))
        await act(async () => { await changedHandler!() })
        expect(result.current.pubkeyJSON).toBe("")
    })

    it("ignores changedNetwork while disconnected: no wallet read", async () => {
        let changedHandler: (() => void) | undefined
        const adena = makeAdena({ On: vi.fn((event: string, cb: () => void) => { if (event === "changedNetwork") changedHandler = cb; return true }) })
        setAdena(adena)

        renderHook(() => useAdena()) // never connect
        await act(async () => { changedHandler!() })
        expect(adena.GetNetwork).not.toHaveBeenCalled()
        expect(adena.GetAccount).not.toHaveBeenCalled()
    })

    // R2-CHN-E (W2.1): the OLD handler called setWalletRpcContext with 2 args,
    // resetting grc20's _walletChainId to null and silently DISABLING the
    // wrong-chain broadcast guard right after a network switch. These tests run
    // the REAL grc20 module (only window.adena is mocked) and assert the guard
    // end-to-end: post-switch wrong-chain sign is blocked.
    it("blocks signing after a network switch to another chain (guard resyncs)", async () => {
        let changedHandler: (() => void | Promise<void>) | undefined
        const adena = makeAdena({
            GetAccount: vi.fn().mockResolvedValue(okAccount({ chainId: GNO_CHAIN_ID })),
            On: vi.fn((event: string, cb: () => void | Promise<void>) => {
                if (event === "changedNetwork") changedHandler = cb
                return true
            }),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await result.current.connect()
        })

        // Pre-switch: trusted RPC + matching chain → both guards pass, so the
        // broadcast only fails at the (absent) DoContract — proving the chain
        // guard is NOT what's blocking.
        await expect(doContractBroadcast([], "pre-switch")).rejects.toThrow(/Adena wallet not available/)

        // Switch to a TRUSTED RPC on the WRONG chain: the trust guard passes,
        // so only a correctly-resynced chainId can block the sign.
        adena.GetNetwork.mockResolvedValue({ status: "success", data: { rpcUrl: TRUSTED_RPC } })
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: "othernet" }))
        await act(async () => {
            await changedHandler!()
        })

        await expect(doContractBroadcast([], "post-switch")).rejects.toThrow(/othernet/)

        setWalletRpcContext(null, false, null) // don't leak module state
    })

    it("fails CLOSED when the account read fails right after a switch", async () => {
        let changedHandler: (() => void | Promise<void>) | undefined
        const adena = makeAdena({
            GetAccount: vi.fn().mockResolvedValue(okAccount({ chainId: GNO_CHAIN_ID })),
            On: vi.fn((event: string, cb: () => void | Promise<void>) => {
                if (event === "changedNetwork") changedHandler = cb
                return true
            }),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await result.current.connect()
        })

        // The switch lands on a trusted RPC but the account read dies: the
        // new chain is UNKNOWN, so signing must stay blocked (sentinel), not
        // silently re-enabled (the old null-reset bug).
        adena.GetNetwork.mockResolvedValue({ status: "success", data: { rpcUrl: TRUSTED_RPC } })
        adena.GetAccount.mockRejectedValue(new Error("wallet locked"))
        await act(async () => {
            await changedHandler!()
        })

        await expect(doContractBroadcast([], "post-switch")).rejects.toThrow(/could not be verified/)

        setWalletRpcContext(null, false, null) // don't leak module state
    })

    it("fails CLOSED synchronously for the whole re-validation window (review finding #2)", async () => {
        let changedHandler: (() => void | Promise<void>) | undefined
        const adena = makeAdena({
            GetAccount: vi.fn().mockResolvedValue(okAccount({ chainId: GNO_CHAIN_ID })),
            On: vi.fn((event: string, cb: () => void | Promise<void>) => {
                if (event === "changedNetwork") changedHandler = cb
                return true
            }),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await result.current.connect()
        })

        // Fire the switch but do NOT await the handler: a broadcast racing the
        // GetNetwork/GetAccount round-trip must already be blocked — the old
        // code left the stale pre-switch values live for that window.
        let pending!: Promise<void>
        act(() => {
            pending = Promise.resolve(changedHandler!())
        })
        await expect(doContractBroadcast([], "mid-switch")).rejects.toThrow(/Transaction blocked/)

        // After the handler resolves (same trusted RPC + same chain), signing
        // works again — the fail-closed window is temporary, not a brick.
        await act(async () => {
            await pending
        })
        await expect(doContractBroadcast([], "post-resync")).rejects.toThrow(/Adena wallet not available/)

        setWalletRpcContext(null, false, null) // don't leak module state
    })
})

// ── W5.1: persistence upgrade + visibility-retry ─────────────

describe("useAdena — W5.1 session persistence (localStorage)", () => {
    it("persists the connection flag in localStorage (survives new tabs/restarts)", async () => {
        const adena = makeAdena()
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        await act(async () => { await result.current.connect() })

        expect(localStorage.getItem("memba_adena_connected")).toBe("true")
    })

    it("auto-reconnects from a localStorage flag alone (the new-tab case)", async () => {
        localStorage.setItem("memba_adena_connected", "true")
        // sessionStorage deliberately empty — the old per-tab flag is gone in a new tab.
        const adena = makeAdena()
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.connected).toBe(true))
        expect(adena.AddEstablish).not.toHaveBeenCalled() // silent path only
    })

    it("migrates a legacy sessionStorage flag to localStorage", async () => {
        sessionStorage.setItem("memba_adena_connected", "true")
        const adena = makeAdena()
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.connected).toBe(true))
        expect(localStorage.getItem("memba_adena_connected")).toBe("true")
    })

    it("disconnect clears both storages so no later mount silently reconnects", async () => {
        sessionStorage.setItem("memba_adena_connected", "true")
        const adena = makeAdena()
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.connected).toBe(true))
        act(() => { result.current.disconnect() })

        expect(localStorage.getItem("memba_adena_connected")).toBeNull()
        expect(sessionStorage.getItem("memba_adena_connected")).toBeNull()
    })
})

describe("useAdena — W5.1 visibility-driven reconnect retry", () => {
    function fireVisibility() {
        act(() => { document.dispatchEvent(new Event("visibilitychange")) })
    }

    it("retries the silent reconnect on tab-visible after a locked-wallet mount", async () => {
        localStorage.setItem("memba_adena_connected", "true")
        // Wallet locked at mount: silent GetAccount fails.
        const adena = makeAdena({
            GetAccount: vi.fn().mockResolvedValue({ status: "failure" }),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.reconnecting).toBe(false))
        expect(result.current.connected).toBe(false)

        // User unlocks Adena, then returns to the tab.
        adena.GetAccount.mockResolvedValue(okAccount())
        fireVisibility()
        await waitFor(() => expect(result.current.connected).toBe(true))
        expect(adena.AddEstablish).not.toHaveBeenCalled() // still no popup
    })

    it("throttles visibility retries (no reconnect storm on rapid tab switches)", async () => {
        localStorage.setItem("memba_adena_connected", "true")
        const adena = makeAdena({
            GetAccount: vi.fn().mockResolvedValue({ status: "failure" }),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.reconnecting).toBe(false))
        const callsAfterMount = adena.GetAccount.mock.calls.length

        fireVisibility() // first retry — allowed
        await act(async () => { await Promise.resolve() })
        const callsAfterFirstRetry = adena.GetAccount.mock.calls.length
        expect(callsAfterFirstRetry).toBeGreaterThan(callsAfterMount)

        fireVisibility() // within the 15s throttle window — suppressed
        fireVisibility()
        await act(async () => { await Promise.resolve() })
        expect(adena.GetAccount.mock.calls.length).toBe(callsAfterFirstRetry)
    })

    it("releases the throttle after 15s (retry fires again once the window passes)", async () => {
        localStorage.setItem("memba_adena_connected", "true")
        const adena = makeAdena({
            GetAccount: vi.fn().mockResolvedValue({ status: "failure" }),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.reconnecting).toBe(false))

        const nowSpy = vi.spyOn(Date, "now")
        try {
            const t0 = Date.now()
            nowSpy.mockReturnValue(t0)
            fireVisibility() // first retry — allowed
            await act(async () => { await Promise.resolve() })
            const afterFirst = adena.GetAccount.mock.calls.length

            nowSpy.mockReturnValue(t0 + 5_000) // inside the window — suppressed
            fireVisibility()
            await act(async () => { await Promise.resolve() })
            expect(adena.GetAccount.mock.calls.length).toBe(afterFirst)

            nowSpy.mockReturnValue(t0 + 15_001) // window passed — fires again
            fireVisibility()
            await act(async () => { await Promise.resolve() })
            expect(adena.GetAccount.mock.calls.length).toBeGreaterThan(afterFirst)
        } finally {
            nowSpy.mockRestore()
        }
    })

    it("does not retry when the user never had a session", async () => {
        const adena = makeAdena()
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.reconnecting).toBe(false))

        fireVisibility()
        await act(async () => { await Promise.resolve() })
        expect(adena.GetAccount).not.toHaveBeenCalled()
    })
})

describe("useAdena — disconnect racing an in-flight connect (F-24)", () => {
    // The live race: connect()'s awaits (GetAccount / GetNetwork) leave a window
    // in which a disconnect — this tab's button or another tab clearing the
    // session flag — can land. Completing the connect afterwards silently undoes
    // the user's disconnect. Storage is the current truth (same rule as the
    // changedNetwork publish guard): a connect that finds the flag gone after
    // its awaits must abort, and a SILENT connect must never (re)write the flag
    // it merely acted on.

    it("aborts when a disconnect lands during the GetNetwork await", async () => {
        let releaseNet!: (v: unknown) => void
        const netGate = new Promise((r) => { releaseNet = r })
        const adena = makeAdena({ GetNetwork: vi.fn().mockReturnValue(netGate) })
        setAdena(adena)

        // Render with no session flag so the mount auto-reconnect stays inert,
        // then establish the flag as a prior session would have.
        const { result } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.reconnecting).toBe(false))
        localStorage.setItem(SESSION_KEY, "true")

        let connectPromise!: Promise<boolean>
        act(() => { connectPromise = result.current.connect({ silent: true }) })
        await waitFor(() => expect(adena.GetNetwork).toHaveBeenCalled())

        // The user's disconnect lands while GetNetwork is still in flight.
        act(() => { result.current.disconnect() })

        let returned: boolean | undefined
        await act(async () => {
            releaseNet({ status: "success", data: { rpcUrl: TRUSTED_RPC } })
            returned = await connectPromise
        })

        expect(returned).toBe(false)
        expect(result.current.connected).toBe(false)
        expect(result.current.address).toBe("")
        // The aborted connect must not have republished the RPC context — a
        // follow-up broadcast must die on the NULL-context message specifically
        // (a republish would flip it to trusted and fail some other way, e.g.
        // the chain gate's own "Transaction blocked" or missing DoContract, so
        // only this exact message discriminates) — and must not have
        // resurrected the RPC cache the disconnect cleared.
        await expect(doContractBroadcast([], "post-abort"))
            .rejects.toThrow(/Unable to verify your wallet's RPC URL/)
        expect(sessionStorage.length).toBe(0)
    })

    it("aborts when ANOTHER tab clears the session flag mid-await (no local disconnect)", async () => {
        // The cross-tab half of the guard: no epoch bump here — only the flag
        // comparison can catch it. This spec is what keeps the
        // `hadFlag && !wasConnected()` clause from being deleted.
        let releaseNet!: (v: unknown) => void
        const netGate = new Promise((r) => { releaseNet = r })
        const adena = makeAdena({ GetNetwork: vi.fn().mockReturnValue(netGate) })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.reconnecting).toBe(false))
        localStorage.setItem(SESSION_KEY, "true")

        let connectPromise!: Promise<boolean>
        act(() => { connectPromise = result.current.connect({ silent: true }) })
        await waitFor(() => expect(adena.GetNetwork).toHaveBeenCalled())

        // The other tab, verbatim: storage clears with no local disconnect().
        act(() => { localStorage.removeItem(SESSION_KEY) })

        let returned: boolean | undefined
        await act(async () => {
            releaseNet({ status: "success", data: { rpcUrl: TRUSTED_RPC } })
            returned = await connectPromise
        })

        expect(returned).toBe(false)
        expect(result.current.connected).toBe(false)
    })

    it("a silent connect never re-writes the session flag a disconnect cleared during GetAccount", async () => {
        let releaseAcct!: (v: unknown) => void
        const acctGate = new Promise((r) => { releaseAcct = r })
        const adena = makeAdena({ GetAccount: vi.fn().mockReturnValue(acctGate) })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.reconnecting).toBe(false))
        localStorage.setItem(SESSION_KEY, "true")

        let connectPromise!: Promise<boolean>
        act(() => { connectPromise = result.current.connect({ silent: true }) })
        await waitFor(() => expect(adena.GetAccount).toHaveBeenCalled())

        // Disconnect lands while the silent GetAccount is still in flight —
        // BEFORE the point where connect() historically marked the session.
        act(() => { result.current.disconnect() })

        let returned: boolean | undefined
        await act(async () => {
            releaseAcct(okAccount())
            returned = await connectPromise
        })

        expect(returned).toBe(false)
        expect(result.current.connected).toBe(false)
        // The regression this pins: saveConnected() used to run here and
        // resurrect the flag the disconnect had just cleared.
        expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    })

    it("an interactive connect still persists the session flag", async () => {
        const adena = makeAdena()
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await result.current.connect() // interactive: explicit user intent
        })

        expect(result.current.connected).toBe(true)
        expect(localStorage.getItem(SESSION_KEY)).toBe("true")
    })

    it("aborts an INTERACTIVE connect when the disconnect lands during AddEstablish (the longest window)", async () => {
        // The human-paced window: the Adena approval popup is open for seconds.
        // A disconnect here (Layout also calls disconnect() programmatically on
        // changedAccount) must not be erased by the connect completing with the
        // pre-disconnect account.
        let releaseEstablish!: (v: unknown) => void
        const establishGate = new Promise((r) => { releaseEstablish = r })
        const adena = makeAdena({
            // No fresh wake → AddEstablish goes first; the reads after it succeed, so only the abort guard can stop it.
            GetAccount: vi.fn().mockResolvedValue(okAccount()),
            AddEstablish: vi.fn().mockReturnValue(establishGate),
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await waitFor(() => expect(result.current.reconnecting).toBe(false))

        let connectPromise!: Promise<boolean>
        act(() => { connectPromise = result.current.connect() }) // interactive
        await waitFor(() => expect(adena.AddEstablish).toHaveBeenCalled())
        expect(isWalletRequestPending()).toBe(true)

        act(() => { result.current.disconnect() })

        let returned: boolean | undefined
        await act(async () => {
            releaseEstablish({ status: "success" })
            returned = await connectPromise
        })

        expect(returned).toBe(false)
        expect(isWalletRequestPending()).toBe(false)
        expect(result.current.connected).toBe(false)
        // The disconnect's clear must stand: the connect may not re-assert the
        // session flag it snapshotted before the popup.
        expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    })

    /** Replace window.localStorage with a throwing stand-in (Safari "Block all
     *  cookies" / quota-exceeded shape). Storage.prototype spies do NOT
     *  intercept jsdom's localStorage — the object must be swapped. Returns a
     *  restore function. */
    function blockLocalStorage(): () => void {
        const real = window.localStorage
        Object.defineProperty(window, "localStorage", {
            value: {
                getItem: () => { throw new DOMException("SecurityError") },
                setItem: () => { throw new DOMException("QuotaExceededError") },
                removeItem: () => { throw new DOMException("SecurityError") },
                clear: () => { throw new DOMException("SecurityError") },
                key: () => null,
                length: 0,
            },
            configurable: true,
            writable: true,
        })
        return () => {
            Object.defineProperty(window, "localStorage", {
                value: real, configurable: true, writable: true,
            })
        }
    }

    it("still connects when localStorage is unusable (privacy-hardened browser)", async () => {
        // wasConnected() returns false when storage throws; the abort guard
        // must treat that as "no cross-tab signal", not as "user disconnected",
        // or every connect in a storage-blocked browser dies silently.
        const restore = blockLocalStorage()
        try {
            const adena = makeAdena()
            setAdena(adena)

            const { result } = renderHook(() => useAdena())

            let returned: boolean | undefined
            await act(async () => {
                returned = await result.current.connect() // interactive
            })

            expect(returned).toBe(true)
            expect(result.current.connected).toBe(true)
            expect(result.current.address).toBe(ADDR)
        } finally {
            restore()
        }
    })

    it("re-derives RPC trust from the allowlist on cache read — a stored verdict is never replayed", async () => {
        // The cache stores only the URL; trust is recomputed on read. A legacy
        // (or tampered) entry claiming trusted:true for a non-allowlisted URL
        // must come back UNtrusted when GetNetwork is unavailable.
        const rpcCacheKey = `memba_adena_rpc::${GNO_CHAIN_ID}`
        sessionStorage.setItem(rpcCacheKey, JSON.stringify({ url: UNTRUSTED_RPC, trusted: true }))
        const adena = makeAdena({ GetNetwork: undefined }) // force the cached path
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await result.current.connect()
        })

        expect(result.current.connected).toBe(true)
        expect(result.current.rpcUrl).toBe(UNTRUSTED_RPC)
        expect(result.current.rpcTrusted).toBe(false) // re-judged, not replayed
    })

    it("storage-blocked AND a mid-connect disconnect: the epoch still aborts it", async () => {
        // The property that stops storage tolerance from re-opening F-24: with
        // the flag clause inert (storage unusable), the epoch alone must carry
        // the abort.
        const restore = blockLocalStorage()
        try {
            let releaseNet!: (v: unknown) => void
            const netGate = new Promise((r) => { releaseNet = r })
            const adena = makeAdena({ GetNetwork: vi.fn().mockReturnValue(netGate) })
            setAdena(adena)

            const { result } = renderHook(() => useAdena())

            let connectPromise!: Promise<boolean>
            act(() => { connectPromise = result.current.connect() }) // interactive
            await waitFor(() => expect(adena.GetNetwork).toHaveBeenCalled())

            act(() => { result.current.disconnect() })

            let returned: boolean | undefined
            await act(async () => {
                releaseNet({ status: "success", data: { rpcUrl: TRUSTED_RPC } })
                returned = await connectPromise
            })

            expect(returned).toBe(false)
            expect(result.current.connected).toBe(false)
        } finally {
            restore()
        }
    })
})

describe("useAdena — switching networks and signing the login message", () => {
    it("takes a switch to the network Adena is already on as done, and re-reads the account Memba holds", async () => {
        const adena = makeAdena({ SwitchNetwork: vi.fn().mockResolvedValue({ status: "failure", type: "REDUNDANT_CHANGE_REQUEST" }) })
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: "onyx-1" }))
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        await act(async () => { await result.current.connect() })
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: "gnoland-1" }))
        let switched = false
        await act(async () => { switched = await result.current.switchWalletNetwork("gnoland-1") })
        expect(switched).toBe(true)
        expect(result.current.chainId).toBe("gnoland-1")
        adena.SwitchNetwork.mockResolvedValue({ status: "failure", type: "SWITCH_NETWORK_REJECTED" })
        await act(async () => { switched = await result.current.switchWalletNetwork("gnoland-1") })
        expect(switched).toBe(false)
    })

    it("re-reads the wallet right after a switch Adena accepted, without waiting for its event", async () => {
        const adena = makeAdena({ SwitchNetwork: vi.fn().mockResolvedValue({ status: "success" }) })
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: "onyx-1" }))
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        await act(async () => { await result.current.connect() })
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: "gnoland-1", pubKeyValue: null }))
        adena.GetNetwork.mockResolvedValue({ status: "success", data: { rpcUrl: UNTRUSTED_RPC } })
        let switched = false
        await act(async () => { switched = await result.current.switchWalletNetwork("gnoland-1") })
        expect(switched).toBe(true)
        expect(result.current.chainId).toBe("gnoland-1")
        expect(result.current.pubkeyJSON).toBe("")
        expect(result.current.rpcTrusted).toBe(false)
    })

    it("re-reads after a switch that needed the network added first", async () => {
        const adena = makeAdena({
            SwitchNetwork: vi.fn().mockResolvedValueOnce({ status: "failure", type: "UNADDED_NETWORK" }).mockResolvedValueOnce({ status: "success" }),
            AddNetwork: vi.fn().mockResolvedValue({ status: "success" }),
        })
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: "onyx-1" }))
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        await act(async () => { await result.current.connect() })
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: "gnoland-1" }))
        await act(async () => { await result.current.switchWalletNetwork("gnoland-1", "gno.land", "https://rpc.gno.land:443") })
        expect(adena.AddNetwork).toHaveBeenCalledTimes(1)
        expect(result.current.chainId).toBe("gnoland-1")
    })

    it("says why Adena returned no login signature", async () => {
        const adena = makeAdena()
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        await act(async () => { await result.current.connect() })
        const reply = async (res: unknown) => { adena.SignMultisigTransaction.mockResolvedValueOnce(res); return result.current.signLoginChallenge("gnoland-1", "AQID") }
        expect(await reply({ status: "failure", type: "SIGN_REJECTED" })).toBe("declined")
        expect(await reply({ status: "failure", type: "UNSUPPORTED_TYPE" })).toBe("session-account")
        expect(await reply({ status: "failure", type: "SIGN_MULTISIG_TRANSACTION_FAILED", data: { error: { message: "Public key not found. This account has not sent any transactions yet." } } })).toBe("no-key")
        expect(await reply({ status: "failure", type: "SIGN_MULTISIG_TRANSACTION_FAILED", data: { error: { message: "boom" } } })).toBe("failed")
        expect(await reply({ status: "failure", type: "UNEXPECTED_ERROR" })).toBe("closed")
        expect(await reply({ status: "success", data: { signature: { signature: "c2ln", pub_key: { value: "Akey==" } } } })).toEqual({ signature: "c2ln", pubKey: '{"type":"tendermint/PubKeySecp256k1","value":"Akey=="}' })
        setAdena({ ...adena, SignMultisigTransaction: undefined })
        expect(await result.current.signLoginChallenge("gnoland-1", "AQID")).toBe("unsupported")
    })
})

describe("useAdena — the login signature waits for a person, not forever", () => {
    afterEach(() => { vi.useRealTimers() })

    it("gives the window the unlock budget (300 s), then says Adena didn't answer", async () => {
        const adena = makeAdena()
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        await act(async () => { await result.current.connect() })
        vi.useFakeTimers()
        adena.SignMultisigTransaction.mockReturnValue(new Promise(() => {}))
        let refusal: unknown
        await act(async () => {
            const signing = result.current.signLoginChallenge("gnoland-1", "AQID").then((r) => { refusal = r })
            await vi.advanceTimersByTimeAsync(299_999)
            expect(refusal).toBeUndefined()
            expect(isWalletRequestPending()).toBe(true)
            await vi.advanceTimersByTimeAsync(1)
            await signing
        })
        expect(refusal).toBe("no-answer")
        expect(isWalletRequestPending()).toBe(false)
    })
})

describe("useAdena — one wallet per page", () => {
    it("every component sees one state, from one silent reconnect", async () => {
        sessionStorage.setItem(SESSION_KEY, "true")
        const adena = makeAdena()
        setAdena(adena)
        const a = renderHook(() => useAdena())
        const b = renderHook(() => useAdena())
        await waitFor(() => expect(a.result.current.connected).toBe(true))
        expect(b.result.current.connected).toBe(true)
        expect(b.result.current.address).toBe(ADDR)
        // One reconnect for the page: each Adena read costs it a wallet decrypt.
        expect(adena.GetAccount).toHaveBeenCalledTimes(1)
        // A component mounted later reads the same state and asks Adena nothing.
        const c = renderHook(() => useAdena())
        expect(c.result.current.connected).toBe(true)
        expect(adena.GetAccount).toHaveBeenCalledTimes(1)
        act(() => { c.result.current.disconnect() })
        expect(a.result.current.connected).toBe(false)
    })

    it("registers Adena's events once, and a network change reaches every component", async () => {
        let changedHandler: (() => void | Promise<void>) | undefined
        const adena = makeAdena({ On: vi.fn((event: string, cb: () => void) => { if (event === "changedNetwork") changedHandler = cb; return true }) })
        setAdena(adena)
        const a = renderHook(() => useAdena())
        const b = renderHook(() => useAdena())
        await act(async () => { await a.result.current.connect() })
        expect(adena.On.mock.calls.filter(([event]) => event === "changedNetwork")).toHaveLength(1)
        expect(adena.On.mock.calls.filter(([event]) => event === "changedAccount")).toHaveLength(1)
        adena.GetAccount.mockResolvedValue(okAccount({ address: ADDR2 }))
        await act(async () => { await changedHandler!() })
        expect(b.result.current.address).toBe(ADDR2)
    })

    it("hands Adena's account change to every subscriber, and stops after unsubscribe", () => {
        let accountHandler: (() => void) | undefined
        setAdena(makeAdena({ On: vi.fn((event: string, cb: () => void) => { if (event === "changedAccount") accountHandler = cb; return true }) }))
        const first = vi.fn(), second = vi.fn()
        const offFirst = onAdenaAccountChanged(first)
        onAdenaAccountChanged(second)
        accountHandler!()
        expect(first).toHaveBeenCalledTimes(1)
        expect(second).toHaveBeenCalledTimes(1)
        offFirst()
        accountHandler!()
        expect(first).toHaveBeenCalledTimes(1)
        expect(second).toHaveBeenCalledTimes(2)
    })

    it("a re-read that answers after a disconnect writes nothing: signing stays blocked", async () => {
        const adena = makeAdena({ SwitchNetwork: vi.fn().mockResolvedValue({ status: "success" }) })
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: GNO_CHAIN_ID }))
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        await act(async () => { await result.current.connect() })
        let answer!: () => void
        adena.GetNetwork.mockReturnValue(new Promise((resolve) => { answer = () => resolve({ status: "success", data: { rpcUrl: TRUSTED_RPC } }) }))
        let switching!: Promise<boolean>
        act(() => { switching = result.current.switchWalletNetwork(GNO_CHAIN_ID) })
        await waitFor(() => expect(adena.GetNetwork).toHaveBeenCalledTimes(2))
        act(() => { result.current.disconnect() })
        await act(async () => { answer(); await switching })
        expect(result.current.connected).toBe(false)
        expect(result.current.address).toBe("")
        expect(result.current.rpcTrusted).toBe(false)
        await expect(doContractBroadcast([], "after disconnect")).rejects.not.toThrow(/Adena wallet not available/)
        setWalletRpcContext(null, false, null)
    })

    it("a switch while disconnected reads and writes nothing", async () => {
        const adena = makeAdena({ SwitchNetwork: vi.fn().mockResolvedValue({ status: "success" }) })
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        await act(async () => { await result.current.switchWalletNetwork(GNO_CHAIN_ID) })
        expect(adena.GetAccount).not.toHaveBeenCalled()
        expect(adena.GetNetwork).not.toHaveBeenCalled()
        expect(result.current.rpcTrusted).toBe(false)
        expect(result.current.chainId).toBe("")
    })

    it("an older re-read that answers last does not bring the old network back", async () => {
        let changedHandler: (() => void | Promise<void>) | undefined
        const adena = makeAdena({
            SwitchNetwork: vi.fn().mockResolvedValue({ status: "success" }),
            On: vi.fn((event: string, cb: () => void) => { if (event === "changedNetwork") changedHandler = cb; return true }),
        })
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: "onyx-1" }))
        setAdena(adena)
        const { result } = renderHook(() => useAdena())
        await act(async () => { await result.current.connect() })
        // The first re-read is slow and still sees the old network; the second answers first with the new one.
        let answerOld!: () => void
        adena.GetAccount.mockReturnValueOnce(new Promise((resolve) => { answerOld = () => resolve(okAccount({ chainId: "onyx-1" })) }))
        let switching!: Promise<boolean>
        act(() => { switching = result.current.switchWalletNetwork(GNO_CHAIN_ID) })
        adena.GetAccount.mockResolvedValue(okAccount({ chainId: GNO_CHAIN_ID }))
        await act(async () => { await changedHandler!() })
        expect(result.current.chainId).toBe(GNO_CHAIN_ID)
        await act(async () => { answerOld(); await switching })
        expect(result.current.chainId).toBe(GNO_CHAIN_ID)
        setWalletRpcContext(null, false, null)
    })

    it("listens again when Adena injects a new provider (an extension update)", async () => {
        const first = makeAdena()
        setAdena(first)
        const { result } = renderHook(() => useAdena())
        await act(async () => { await result.current.connect() })
        const second = makeAdena()
        setAdena(second)
        await act(async () => { await result.current.connect() })
        expect(second.On).toHaveBeenCalledWith("changedAccount", expect.any(Function))
        expect(second.On).toHaveBeenCalledWith("changedNetwork", expect.any(Function))
    })
})
