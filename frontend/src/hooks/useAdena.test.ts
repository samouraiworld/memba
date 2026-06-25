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
import { useAdena } from "./useAdena"

beforeEach(() => {
    sessionStorage.clear() // setup.ts only clears localStorage; the hook uses sessionStorage
    clearAdena()
    vi.restoreAllMocks()
})

afterEach(() => {
    clearAdena()
})

describe("useAdena — connect success", () => {
    it("transitions to connected and exposes the returned address (silent GetAccount path)", async () => {
        const adena = makeAdena()
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        expect(result.current.connected).toBe(false)

        let returned: boolean | undefined
        await act(async () => {
            returned = await result.current.connect()
        })

        expect(returned).toBe(true)
        expect(result.current.connected).toBe(true)
        expect(result.current.address).toBe(ADDR)
        expect(result.current.loading).toBe(false)
        expect(result.current.error).toBeNull()
        // Already-whitelisted wallet must NOT trigger the approval popup.
        expect(adena.AddEstablish).not.toHaveBeenCalled()
    })

    it("falls back to the AddEstablish popup flow when no silent session exists", async () => {
        // Silent GetAccount reports failure → hook must run the interactive establish flow.
        const adena = makeAdena({
            GetAccount: vi
                .fn()
                .mockResolvedValueOnce({ status: "failure", data: null }) // silent probe fails
                .mockResolvedValueOnce(okAccount()), // post-establish fetch succeeds
        })
        setAdena(adena)

        const { result } = renderHook(() => useAdena())
        await act(async () => {
            await result.current.connect()
        })

        expect(adena.AddEstablish).toHaveBeenCalledTimes(1)
        expect(adena.AddEstablish).toHaveBeenCalledWith("Memba")
        expect(result.current.connected).toBe(true)
        expect(result.current.address).toBe(ADDR)
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

    it("does not subscribe to changedNetwork while disconnected", () => {
        const adena = makeAdena()
        setAdena(adena)

        renderHook(() => useAdena()) // never connect
        expect(adena.On).not.toHaveBeenCalled()
    })
})
