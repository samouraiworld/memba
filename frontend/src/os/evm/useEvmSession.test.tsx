import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { EvmWalletSnapshot, WalletOutcome } from "../../lib/chain/evm/wallet"
import { useEvmSession } from "./useEvmSession"

const ME = "0xabcdef0123456789abcdef0123456789abcdef01"
const OTHER = "0x1111111111111111111111111111111111111111"

// A wallet store in the shape of lib/chain/evm/wallet.ts, driven by the test.
let snap: EvmWalletSnapshot
const listeners = new Set<() => void>()
function setWallet(next: Partial<EvmWalletSnapshot>) {
    snap = { ...snap, ...next }
    listeners.forEach((l) => l())
}
let release: () => void
const store = {
    getSnapshot: () => snap,
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l) },
    connect: vi.fn<(uid: string) => Promise<WalletOutcome>>(),
    disconnect: vi.fn(async () => setWallet({ status: "disconnected", address: "", chainId: null })),
    switchChain: vi.fn(async (): Promise<WalletOutcome> => ({ ok: true })),
    reconnect: vi.fn(() => new Promise<void>((r) => { release = r })),
}
vi.mock("../../lib/chain/evm/load", () => ({ loadEvmAdapter: async () => ({ evmWallet: store }) }))

const auth = { token: null as null | { chainId: string; userAddress: string }, isAuthenticated: false, address: "", loading: false, error: null, logout: vi.fn() }
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => auth }))
vi.mock("../shell/network", () => ({
    activeOsNetwork: () => ({ key: "base-sepolia", family: "evm", chainId: "84532", label: "Base Sepolia", isTestnet: true, rpcHost: "sepolia.base.org" }),
}))

beforeEach(() => {
    vi.clearAllMocks()
    snap = { status: "disconnected", address: "", chainId: null, wallets: [{ uid: "w1", name: "Rabby" }] }
    auth.token = null
})

async function restored() {
    const hook = renderHook(() => useEvmSession())
    await waitFor(() => expect(store.reconnect).toHaveBeenCalled())
    await act(async () => release())
    return hook
}

describe("useEvmSession", () => {
    it("resumes until the silent reconnect is done, then is a guest offering the wallets found", async () => {
        const { result } = renderHook(() => useEvmSession())
        expect(result.current.status).toBe("resuming")
        await waitFor(() => expect(store.reconnect).toHaveBeenCalled())
        await act(async () => release())
        expect(result.current.status).toBe("guest")
        expect(result.current.evm?.wallets).toEqual([{ uid: "w1", name: "Rabby" }])
    })

    it("connects the picked wallet: pick, then approve in the wallet, then the sign-in step", async () => {
        const { result } = await restored()
        act(() => result.current.openConnect())
        expect(result.current.stage).toBe("pick")
        store.connect.mockImplementation(async () => { setWallet({ status: "connected", address: ME, chainId: 84532 }); return { ok: true } })
        await act(async () => result.current.evm!.choose("w1"))
        expect(store.connect).toHaveBeenCalledWith("w1")
        expect(result.current.stage).toBe("login")
        expect(result.current.walletAddress).toBe(ME)
        expect(result.current.status).toBe("guest") // no token yet: signing in comes with SIWE
    })

    it("goes back to the wallet list when the person declines in the wallet", async () => {
        const { result } = await restored()
        act(() => result.current.openConnect())
        store.connect.mockResolvedValue({ ok: false, reason: "declined" })
        await act(async () => result.current.evm!.choose("w1"))
        expect(result.current.stage).toBe("pick")
        expect(result.current.error).toMatch(/declined/)
    })

    it("is a member only with a token for this account on this chain", async () => {
        setWallet({ status: "connected", address: ME, chainId: 84532 })
        auth.token = { chainId: "eip155:84532", userAddress: ME }
        const { result } = await restored()
        expect(result.current.status).toBe("member")
        expect(result.current.address).toBe(ME)
        expect(auth.logout).not.toHaveBeenCalled()
    })

    it("signs out when the wallet switches account", async () => {
        setWallet({ status: "connected", address: ME, chainId: 84532 })
        auth.token = { chainId: "eip155:84532", userAddress: ME }
        const { result } = await restored()
        act(() => setWallet({ address: OTHER }))
        await waitFor(() => expect(auth.logout).toHaveBeenCalled())
        expect(result.current.status).not.toBe("member")
    })

    it("drops a token minted for the same account on another chain", async () => {
        setWallet({ status: "connected", address: ME, chainId: 84532 })
        auth.token = { chainId: "eip155:8453", userAddress: ME }
        const { result } = await restored()
        expect(result.current.status).toBe("guest")
        expect(auth.logout).toHaveBeenCalled()
    })

    it("signs out on Disconnect, without waiting for the wallet to report it", async () => {
        setWallet({ status: "connected", address: ME, chainId: 84532 })
        auth.token = { chainId: "eip155:84532", userAddress: ME }
        const { result } = await restored()
        store.disconnect.mockImplementationOnce(async () => {})
        act(() => result.current.disconnect())
        expect(store.disconnect).toHaveBeenCalled()
        expect(auth.logout).toHaveBeenCalled()
        expect(result.current.stage).toBeNull()
    })

    it("leaves a gno.land token alone: it belongs to the other family's session", async () => {
        auth.token = { chainId: "gnoland-1", userAddress: "g1abc" }
        const { result } = await restored()
        expect(result.current.status).toBe("guest")
        expect(auth.logout).not.toHaveBeenCalled()
    })

    it("flags a wallet on another chain and asks it to switch to Memba's", async () => {
        setWallet({ status: "connected", address: ME, chainId: 8453 })
        const { result } = await restored()
        expect(result.current.evm?.wrongChain).toBe(true)
        expect(result.current.walletChainId).toBe("8453")
        expect(await result.current.switchWallet()).toBe(true)
        expect(store.switchChain).toHaveBeenCalledWith(84532)
    })

    it("never hands its token to the Gno pages' layout", async () => {
        setWallet({ status: "connected", address: ME, chainId: 84532 })
        auth.token = { chainId: "eip155:84532", userAddress: ME }
        const { result } = await restored()
        expect(result.current.layout.auth).toMatchObject({ token: null, isAuthenticated: false })
        expect(result.current.layout.adena.connected).toBe(false)
    })
})
