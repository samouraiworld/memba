import { Code, ConnectError } from "@connectrpc/connect"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { EvmWalletSnapshot, WalletOutcome } from "../../lib/chain/evm/wallet"
import { useEvmSession } from "./useEvmSession"

const ME = "0xabcdef0123456789abcdef0123456789abcdef01"
const ME_EIP55 = "0xabCDeF0123456789AbcdEf0123456789aBCDEF01"
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
    signMessage: vi.fn<(message: string) => Promise<{ ok: true; signature: string } | { ok: false; reason: "declined" | "failed" }>>(),
}
vi.mock("../../lib/chain/evm/load", () => ({
    loadEvmAdapter: async () => ({ evmWallet: store, buildSiweMessage: (frame: { nonce: string }, address: string) => `sign in ${address} ${frame.nonce}` }),
}))

const CHALLENGE = { nonce: "0123456789abcdef0123456789abcdef", chainId: "eip155:84532", domain: "x.test", uri: "https://x.test", issuedAt: "", expiration: "", statement: "" }
const TOKEN = { chainId: "eip155:84532", userAddress: ME, nonce: "n", expiration: "2099-01-01T00:00:00Z", serverSignature: "s" }
const api = vi.hoisted(() => ({ getSiweChallenge: vi.fn(), getSiweToken: vi.fn() }))
vi.mock("../../lib/api", () => ({ api }))

const auth = { token: null as null | { chainId: string; userAddress: string }, isAuthenticated: false, address: "", loading: false, error: null, logout: vi.fn(), adoptToken: vi.fn() }
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => auth }))
vi.mock("../shell/network", () => ({
    activeOsNetwork: () => ({ key: "base-sepolia", family: "evm", chainId: "84532", label: "Base Sepolia", isTestnet: true, rpcHost: "sepolia.base.org" }),
}))

beforeEach(() => {
    vi.clearAllMocks()
    snap = { status: "disconnected", address: "", displayAddress: "", chainId: null, wallets: [{ uid: "w1", name: "Rabby" }] }
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
        store.connect.mockImplementation(async () => { setWallet({ status: "connected", address: ME, displayAddress: ME_EIP55, chainId: 84532 }); return { ok: true } })
        await act(async () => result.current.evm!.choose("w1"))
        expect(store.connect).toHaveBeenCalledWith("w1")
        expect(result.current.stage).toBe("login")
        expect(result.current.walletAddress).toBe(ME)
        expect(result.current.status).toBe("guest") // connected, not signed in yet
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
        setWallet({ status: "connected", address: ME, displayAddress: ME_EIP55, chainId: 84532 })
        auth.token = { chainId: "eip155:84532", userAddress: ME }
        const { result } = await restored()
        expect(result.current.status).toBe("member")
        expect(result.current.address).toBe(ME)
        expect(auth.logout).not.toHaveBeenCalled()
    })

    it("signs out when the wallet switches account", async () => {
        setWallet({ status: "connected", address: ME, displayAddress: ME_EIP55, chainId: 84532 })
        auth.token = { chainId: "eip155:84532", userAddress: ME }
        const { result } = await restored()
        act(() => setWallet({ address: OTHER }))
        await waitFor(() => expect(auth.logout).toHaveBeenCalled())
        expect(result.current.status).not.toBe("member")
    })

    it("drops a token minted for the same account on another chain", async () => {
        setWallet({ status: "connected", address: ME, displayAddress: ME_EIP55, chainId: 84532 })
        auth.token = { chainId: "eip155:8453", userAddress: ME }
        const { result } = await restored()
        expect(result.current.status).toBe("guest")
        expect(auth.logout).toHaveBeenCalled()
    })

    it("signs out on Disconnect, without waiting for the wallet to report it", async () => {
        setWallet({ status: "connected", address: ME, displayAddress: ME_EIP55, chainId: 84532 })
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
        setWallet({ status: "connected", address: ME, displayAddress: ME_EIP55, chainId: 8453 })
        const { result } = await restored()
        expect(result.current.evm?.wrongChain).toBe(true)
        expect(result.current.walletChainId).toBe("8453")
        expect(await result.current.switchWallet()).toBe(true)
        expect(store.switchChain).toHaveBeenCalledWith(84532)
    })

    it("never hands its token to the Gno pages' layout", async () => {
        setWallet({ status: "connected", address: ME, displayAddress: ME_EIP55, chainId: 84532 })
        auth.token = { chainId: "eip155:84532", userAddress: ME }
        const { result } = await restored()
        expect(result.current.layout.auth).toMatchObject({ token: null, isAuthenticated: false })
        expect(result.current.layout.adena.connected).toBe(false)
    })

    describe("signing in (SIWE)", () => {
        async function connectedGuest(onSignedIn = vi.fn()) {
            setWallet({ status: "connected", address: ME, displayAddress: ME_EIP55, chainId: 84532 })
            const hook = renderHook(() => useEvmSession({ onSignedIn }))
            await waitFor(() => expect(store.reconnect).toHaveBeenCalled())
            await act(async () => release())
            return hook
        }

        it("asks this chain's challenge, has the wallet sign its message, and keeps the token minted for it", async () => {
            api.getSiweChallenge.mockResolvedValue({ challenge: CHALLENGE })
            store.signMessage.mockResolvedValue({ ok: true, signature: "0xwallet-signature-as-returned" })
            api.getSiweToken.mockResolvedValue({ authToken: TOKEN })
            const onSignedIn = vi.fn()
            const { result } = await connectedGuest(onSignedIn)
            await act(async () => { await result.current.signIn() })
            expect(api.getSiweChallenge).toHaveBeenCalledWith({ chainId: "eip155:84532" })
            const message = `sign in ${ME_EIP55} ${CHALLENGE.nonce}`
            expect(store.signMessage).toHaveBeenCalledWith(message)
            expect(api.getSiweToken).toHaveBeenCalledWith({ challenge: CHALLENGE, message, signature: "0xwallet-signature-as-returned" })
            expect(auth.adoptToken).toHaveBeenCalledWith(TOKEN)
            expect(onSignedIn).toHaveBeenCalledWith(ME_EIP55)
            expect(result.current.stage).toBeNull()
        })

        it("stops at a declined signature, without asking for a token", async () => {
            api.getSiweChallenge.mockResolvedValue({ challenge: CHALLENGE })
            store.signMessage.mockResolvedValue({ ok: false, reason: "declined" })
            const { result } = await connectedGuest()
            await act(async () => { await result.current.signIn() })
            expect(api.getSiweToken).not.toHaveBeenCalled()
            expect(result.current.stage).toBe("login")
            expect(result.current.error).toMatch(/declined the sign-in message/)
        })

        it("says plainly when the server does not offer EVM sign-in, or refuses this one", async () => {
            api.getSiweChallenge.mockRejectedValueOnce(new ConnectError("", Code.Unimplemented))
            const { result } = await connectedGuest()
            await act(async () => { await result.current.signIn() })
            expect(result.current.error).toBe("This Memba server doesn't offer EVM sign-in yet.")
            api.getSiweChallenge.mockResolvedValue({ challenge: CHALLENGE })
            store.signMessage.mockResolvedValue({ ok: true, signature: "0xsig" })
            api.getSiweToken.mockRejectedValueOnce(new ConnectError("", Code.PermissionDenied))
            await act(async () => { await result.current.signIn() })
            expect(result.current.error).toBe("Memba couldn't verify this sign-in. Sign in again.")
            expect(auth.adoptToken).not.toHaveBeenCalled()
        })

        it("counts a contract account's token, named with its chain", async () => {
            auth.token = { chainId: "eip155:84532", userAddress: `eip155:84532:${ME}` }
            const { result } = await connectedGuest()
            expect(result.current.status).toBe("member")
            expect(auth.logout).not.toHaveBeenCalled()
        })
    })
})
