import { Code, ConnectError } from "@connectrpc/connect"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { EvmWalletSnapshot, WalletOutcome } from "../../lib/chain/evm/wallet"
import { invalidateSession } from "../../lib/authSession"
import { EVM_TOKEN_KEY, evmAuthToken } from "./evmToken"
import { useEvmSession } from "./useEvmSession"

const ME = "0xabcdef0123456789abcdef0123456789abcdef01"
const ME_EIP55 = "0xabCDeF0123456789AbcdEf0123456789aBCDEF01"
const OTHER = "0x1111111111111111111111111111111111111111"
const GNO_TOKEN_KEY = "memba_auth_token"

// A wallet store in the shape of lib/chain/evm/wallet.ts, driven by the test.
let snap: EvmWalletSnapshot
const listeners = new Set<() => void>()
function setWallet(next: Partial<EvmWalletSnapshot>) {
    snap = { ...snap, ...next }
    listeners.forEach((l) => l())
}
let release: () => void
type Signed = { ok: true; signature: string } | { ok: false; reason: "declined" | "failed" }
const store = {
    getSnapshot: () => snap,
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l) },
    connect: vi.fn<(uid: string) => Promise<WalletOutcome>>(),
    disconnect: vi.fn(async () => setWallet({ status: "disconnected", address: "", displayAddress: "", chainId: null })),
    switchChain: vi.fn(async (): Promise<WalletOutcome> => ({ ok: true })),
    reconnect: vi.fn(() => new Promise<void>((r) => { release = r })),
    signMessage: vi.fn<(message: string, account: string) => Promise<Signed>>(),
}
vi.mock("../../lib/chain/evm/load", () => ({
    loadEvmAdapter: async () => ({
        evmWallet: store,
        buildSiweMessage: (frame: { nonce: string; issuedAt: string }, address: string) => {
            if (frame.issuedAt === "not-a-date") throw new RangeError("Invalid time value")
            return `sign in ${address} ${frame.nonce}`
        },
    }),
}))

const api = vi.hoisted(() => ({ getSiweChallenge: vi.fn(), getSiweToken: vi.fn() }))
vi.mock("../../lib/api", () => ({ api }))
vi.mock("../shell/network", () => ({
    activeOsNetwork: () => ({ key: "base-sepolia", family: "evm", chainId: "84532", label: "Base Sepolia", isTestnet: true, rpcHost: "sepolia.base.org" }),
}))

const challenge = () => ({
    nonce: "0123456789abcdef0123456789abcdef", chainId: "eip155:84532", domain: window.location.host, uri: window.location.origin,
    issuedAt: "2026-10-07T12:00:00Z", expiration: "2099-01-01T00:00:00Z", statement: "Sign in to Memba.",
})
const TOKEN = { chainId: "eip155:84532", userAddress: ME, nonce: "n", expiration: "2099-01-01T00:00:00Z", serverSignature: "s" }
const storedEvmToken = () => localStorage.getItem(EVM_TOKEN_KEY)

beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    snap = { status: "disconnected", address: "", displayAddress: "", chainId: null, wallets: [{ uid: "w1", name: "Rabby" }] }
})

async function restored(onSignedIn = vi.fn()) {
    const hook = renderHook(() => useEvmSession({ onSignedIn }))
    await waitFor(() => expect(store.reconnect).toHaveBeenCalled())
    await act(async () => release())
    return hook
}
const connectedHere = () => setWallet({ status: "connected", address: ME, displayAddress: ME_EIP55, chainId: 84532 })

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
        store.connect.mockImplementation(async () => { connectedHere(); return { ok: true } })
        await act(async () => result.current.evm!.choose("w1"))
        expect(result.current.stage).toBe("login")
        expect(result.current.walletAddress).toBe(ME)
        expect(result.current.status).toBe("guest")
    })

    it("goes back to the wallet list when the person declines in the wallet", async () => {
        const { result } = await restored()
        act(() => result.current.openConnect())
        store.connect.mockResolvedValue({ ok: false, reason: "declined" })
        await act(async () => result.current.evm!.choose("w1"))
        expect(result.current.stage).toBe("pick")
        expect(result.current.error).toMatch(/declined/)
    })

    describe("its token, under its own key", () => {
        it("is a member only with a token for this account on this chain, and hands it to EVM apps", async () => {
            connectedHere()
            localStorage.setItem(EVM_TOKEN_KEY, JSON.stringify(TOKEN))
            const { result } = await restored()
            expect(result.current.status).toBe("member")
            expect(result.current.address).toBe(ME)
            expect(result.current.evm?.token).toMatchObject({ userAddress: ME })
        })

        it("counts a contract account's token, named with its chain", async () => {
            connectedHere()
            localStorage.setItem(EVM_TOKEN_KEY, JSON.stringify({ ...TOKEN, userAddress: `eip155:84532:${ME}` }))
            expect((await restored()).result.current.status).toBe("member")
        })

        it("refuses a contract account's token whose address names another chain than the token", async () => {
            connectedHere()
            localStorage.setItem(EVM_TOKEN_KEY, JSON.stringify({ ...TOKEN, userAddress: `eip155:8453:${ME}` }))
            const { result } = await restored()
            expect(result.current.status).toBe("guest")
            await waitFor(() => expect(storedEvmToken()).toBeNull())
        })

        it("signs out even when its token was never stored (storage refused the write)", async () => {
            connectedHere()
            localStorage.setItem(EVM_TOKEN_KEY, JSON.stringify(TOKEN))
            const { result } = await restored()
            localStorage.removeItem(EVM_TOKEN_KEY) // only the in-memory session is left
            act(() => invalidateSession("rejected", "evm"))
            expect(result.current.status).toBe("guest")
        })

        it("hands its token only for handlers that accept an EVM account", async () => {
            connectedHere()
            localStorage.setItem(EVM_TOKEN_KEY, JSON.stringify(TOKEN))
            const { result } = await restored()
            expect(evmAuthToken("UpdateProfile", result.current)).toMatchObject({ userAddress: ME })
            // @ts-expect-error a gno.land-only handler would answer 401 and sign the EVM session out
            evmAuthToken("CreateTransaction", result.current)
        })

        it("drops it when the wallet switches account", async () => {
            connectedHere()
            localStorage.setItem(EVM_TOKEN_KEY, JSON.stringify(TOKEN))
            const { result } = await restored()
            act(() => setWallet({ address: OTHER }))
            await waitFor(() => expect(storedEvmToken()).toBeNull())
            expect(result.current.status).not.toBe("member")
        })

        it("drops a token minted for the same account on another chain", async () => {
            connectedHere()
            localStorage.setItem(EVM_TOKEN_KEY, JSON.stringify({ ...TOKEN, chainId: "eip155:8453" }))
            const { result } = await restored()
            await waitFor(() => expect(storedEvmToken()).toBeNull())
            expect(result.current.status).toBe("guest")
        })

        it("signs out when the server rejects its token, leaving the gno.land session alone", async () => {
            const gno = JSON.stringify({ chainId: "gnoland-1", userAddress: "g1abc" })
            localStorage.setItem(GNO_TOKEN_KEY, gno)
            connectedHere()
            localStorage.setItem(EVM_TOKEN_KEY, JSON.stringify(TOKEN))
            const { result } = await restored()
            expect(result.current.status).toBe("member")
            act(() => invalidateSession("rejected", "evm"))
            expect(result.current.status).toBe("guest")
            expect(localStorage.getItem(GNO_TOKEN_KEY)).toBe(gno)
        })

        it("drops it on Disconnect at once", async () => {
            connectedHere()
            localStorage.setItem(EVM_TOKEN_KEY, JSON.stringify(TOKEN))
            const { result } = await restored()
            store.disconnect.mockImplementationOnce(async () => {})
            act(() => result.current.disconnect())
            expect(store.disconnect).toHaveBeenCalled()
            expect(storedEvmToken()).toBeNull()
            expect(result.current.stage).toBeNull()
        })

        it("never touches, nor reads, the gno.land session", async () => {
            const gno = JSON.stringify({ chainId: "gnoland-1", userAddress: "g1abc", nonce: "n", expiration: "2099-01-01T00:00:00Z", serverSignature: "s" })
            localStorage.setItem(GNO_TOKEN_KEY, gno)
            connectedHere()
            api.getSiweChallenge.mockResolvedValue({ challenge: challenge() })
            store.signMessage.mockResolvedValue({ ok: true, signature: "0xsig" })
            api.getSiweToken.mockResolvedValue({ authToken: TOKEN })
            const { result } = await restored()
            expect(result.current.status).toBe("guest")
            await act(async () => { await result.current.signIn() })
            expect(result.current.status).toBe("member")
            expect(localStorage.getItem(GNO_TOKEN_KEY)).toBe(gno)
            expect(JSON.parse(storedEvmToken()!)).toMatchObject({ userAddress: ME, chainId: "eip155:84532" })
            expect(result.current.layout.auth).toMatchObject({ token: null, isAuthenticated: false })
        })
    })

    it("flags a wallet on another chain and asks it to switch to Memba's", async () => {
        setWallet({ status: "connected", address: ME, displayAddress: ME_EIP55, chainId: 8453 })
        const { result } = await restored()
        expect(result.current.evm?.wrongChain).toBe(true)
        expect(await result.current.switchWallet()).toBe(true)
        expect(store.switchChain).toHaveBeenCalledWith(84532)
    })

    describe("signing in (SIWE)", () => {
        beforeEach(() => {
            connectedHere()
            api.getSiweChallenge.mockResolvedValue({ challenge: challenge() })
            store.signMessage.mockResolvedValue({ ok: true, signature: "0xwallet-signature-as-returned" })
            api.getSiweToken.mockResolvedValue({ authToken: TOKEN })
        })

        it("asks this chain's challenge, has this account sign its message, and keeps the token minted for it", async () => {
            const onSignedIn = vi.fn()
            const { result } = await restored(onSignedIn)
            await act(async () => { await result.current.signIn() })
            expect(api.getSiweChallenge).toHaveBeenCalledWith({ chainId: "eip155:84532" })
            const message = `sign in ${ME_EIP55} ${challenge().nonce}`
            expect(store.signMessage).toHaveBeenCalledWith(message, ME_EIP55)
            expect(api.getSiweToken).toHaveBeenCalledWith({ challenge: challenge(), message, signature: "0xwallet-signature-as-returned" })
            expect(onSignedIn).toHaveBeenCalledWith(ME_EIP55)
            expect(result.current.stage).toBeNull()
            expect(result.current.status).toBe("member")
        })

        it("passes a long smart-wallet (ERC-6492) signature through unchanged", async () => {
            const long = `0x${"64".repeat(300)}6492649264926492649264926492649264926492649264926492649264926492`
            store.signMessage.mockResolvedValue({ ok: true, signature: long })
            const { result } = await restored()
            await act(async () => { await result.current.signIn() })
            expect(api.getSiweToken.mock.calls[0][0].signature).toBe(long)
        })

        it("asks a wallet on another chain to switch first, without asking the server", async () => {
            setWallet({ chainId: 8453 })
            const { result } = await restored()
            await act(async () => { await result.current.signIn() })
            expect(api.getSiweChallenge).not.toHaveBeenCalled()
            expect(result.current.error).toBe("Switch your wallet to Base Sepolia first.")
        })

        it("signs nothing for a challenge that names another site or chain", async () => {
            for (const bad of [{ domain: "evil.example" }, { uri: "https://evil.example" }, { chainId: "eip155:8453" }]) {
                api.getSiweChallenge.mockResolvedValue({ challenge: { ...challenge(), ...bad } })
                const { result, unmount } = await restored()
                await act(async () => { await result.current.signIn() })
                expect(result.current.error).toBe("The server's sign-in request doesn't match this site. Nothing was signed.")
                unmount()
            }
            expect(store.signMessage).not.toHaveBeenCalled()
        })

        it("signs nothing for a malformed challenge", async () => {
            api.getSiweChallenge.mockResolvedValue({ challenge: { ...challenge(), issuedAt: "not-a-date" } })
            const { result } = await restored()
            await act(async () => { await result.current.signIn() })
            expect(result.current.error).toBe("The server's sign-in request is malformed. Nothing was signed.")
            expect(store.signMessage).not.toHaveBeenCalled()
        })

        it("stops at a declined signature, without asking for a token", async () => {
            store.signMessage.mockResolvedValue({ ok: false, reason: "declined" })
            const { result } = await restored()
            await act(async () => { await result.current.signIn() })
            expect(api.getSiweToken).not.toHaveBeenCalled()
            expect(result.current.error).toMatch(/declined the sign-in message/)
        })

        it("stands down when cancelled, or when the account changes, while the challenge is in flight: the wallet is never asked", async () => {
            for (const interrupt of ["cancel", "account"] as const) {
                vi.clearAllMocks()
                connectedHere()
                let issue!: (v: unknown) => void
                api.getSiweChallenge.mockReturnValue(new Promise((r) => { issue = r }))
                const { result, unmount } = await restored()
                let attempt!: Promise<void>
                await act(async () => { attempt = result.current.signIn(); await Promise.resolve() })
                await waitFor(() => expect(api.getSiweChallenge).toHaveBeenCalled())
                act(() => { if (interrupt === "cancel") result.current.cancel(); else setWallet({ address: OTHER }) })
                await act(async () => { issue({ challenge: challenge() }); await attempt })
                expect(store.signMessage).not.toHaveBeenCalled()
                unmount()
            }
        })

        it("stands down when the wallet switches chain during the sign-in", async () => {
            store.signMessage.mockImplementation(async () => { setWallet({ chainId: 8453 }); return { ok: true, signature: "0xsig" } })
            const { result } = await restored()
            await act(async () => { await result.current.signIn() })
            expect(api.getSiweToken).not.toHaveBeenCalled()
            expect(result.current.error).toBe("Your wallet changed account or chain during the sign-in. Sign in again.")
        })

        it("stands down when cancelled while the wallet is open: no token is asked for", async () => {
            let sign!: (s: Signed) => void
            store.signMessage.mockReturnValue(new Promise((r) => { sign = r }))
            const { result } = await restored()
            let attempt!: Promise<void>
            await act(async () => { attempt = result.current.signIn(); await Promise.resolve() })
            await waitFor(() => expect(store.signMessage).toHaveBeenCalled())
            act(() => result.current.cancel())
            await act(async () => { sign({ ok: true, signature: "0xsig" }); await attempt })
            expect(api.getSiweToken).not.toHaveBeenCalled()
            expect(result.current.stage).toBeNull()
        })

        it("stands down when cancelled while the server mints the token: it is not kept", async () => {
            let mint!: (v: unknown) => void
            api.getSiweToken.mockReturnValue(new Promise((r) => { mint = r }))
            const { result } = await restored()
            let attempt!: Promise<void>
            await act(async () => { attempt = result.current.signIn(); await Promise.resolve() })
            await waitFor(() => expect(api.getSiweToken).toHaveBeenCalled())
            act(() => result.current.cancel())
            await act(async () => { mint({ authToken: TOKEN }); await attempt })
            expect(storedEvmToken()).toBeNull()
            expect(result.current.status).toBe("guest")
        })

        it("stands down when the wallet switches account during the sign-in, and says why", async () => {
            store.signMessage.mockImplementation(async () => { setWallet({ address: OTHER }); return { ok: true, signature: "0xsig" } })
            const { result } = await restored()
            await act(async () => { await result.current.signIn() })
            expect(api.getSiweToken).not.toHaveBeenCalled()
            expect(result.current.error).toBe("Your wallet changed account or chain during the sign-in. Sign in again.")
        })

        it("keeps no token that names another account", async () => {
            api.getSiweToken.mockResolvedValue({ authToken: { ...TOKEN, userAddress: OTHER } })
            const onSignedIn = vi.fn()
            const { result } = await restored(onSignedIn)
            await act(async () => { await result.current.signIn() })
            expect(storedEvmToken()).toBeNull()
            expect(onSignedIn).not.toHaveBeenCalled()
            expect(result.current.error).toBe("Memba's sign-in didn't match your wallet's account. Sign in again.")
        })

        describe("names each refusal for the step it came from", () => {
            async function failsWith(step: "challenge" | "token", err: ConnectError, signature = "0xsig") {
                store.signMessage.mockResolvedValue({ ok: true, signature })
                if (step === "challenge") api.getSiweChallenge.mockRejectedValue(err)
                else api.getSiweToken.mockRejectedValue(err)
                const { result } = await restored()
                await act(async () => { await result.current.signIn() })
                return result.current.error
            }

            it("at the challenge", async () => {
                expect(await failsWith("challenge", new ConnectError("not implemented", Code.Unimplemented))).toBe("This Memba server doesn't offer EVM sign-in yet.")
                expect(await failsWith("challenge", new ConnectError("HTTP 404", Code.Unimplemented))).toBe("Memba couldn't reach its sign-in service. Try again in a moment.")
                expect(await failsWith("challenge", new ConnectError("AUTH-CHAINID-MISMATCH-01", Code.PermissionDenied))).toBe("This Memba server doesn't accept Base Sepolia sign-ins yet.")
                expect(await failsWith("challenge", new ConnectError("", Code.PermissionDenied))).toBe("This site can't sign in to this Memba server.")
                expect(await failsWith("challenge", new ConnectError("HTTP 429", Code.Unavailable))).toBe("Too many sign-in attempts, or the server is busy. Wait a moment, then sign in again.")
            })

            it("at the token", async () => {
                expect(await failsWith("token", new ConnectError("", Code.PermissionDenied))).toBe("Memba couldn't verify this sign-in. Sign in again.")
                // Exactly 65 bytes is an account key's signature, not a smart wallet's.
                expect(await failsWith("token", new ConnectError("", Code.PermissionDenied), `0x${"ab".repeat(65)}`)).toBe("Memba couldn't verify this sign-in. Sign in again.")
                expect(await failsWith("token", new ConnectError("", Code.PermissionDenied), `0x${"ab".repeat(66)}`)).toBe("Memba couldn't verify this smart-wallet signature, or this server doesn't accept smart-wallet sign-in yet.")
                expect(await failsWith("token", new ConnectError("HTTP 429", Code.Unavailable))).toBe("Too many sign-in attempts, or the server is busy. Wait a moment, then sign in again.")
                // The backend sends the chain refusal as PermissionDenied, with its code as the message.
                expect(await failsWith("token", new ConnectError("AUTH-CHAINID-MISMATCH-01", Code.PermissionDenied), `0x${"ab".repeat(66)}`)).toBe("This Memba server doesn't accept Base Sepolia sign-ins yet.")
            })
        })
    })

    it("never hands a token to the Gno pages' layout", async () => {
        connectedHere()
        localStorage.setItem(EVM_TOKEN_KEY, JSON.stringify(TOKEN))
        const { result } = await restored()
        expect(result.current.layout.auth).toMatchObject({ token: null, isAuthenticated: false })
        expect(result.current.layout.adena.connected).toBe(false)
    })
})
