import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Token } from "../../gen/memba/v1/memba_pb"
import { SESSION_ACCOUNT_LOGIN_MSG } from "../../lib/loginErrors"
import { assertLiveWalletNetwork, WalletNetworkError } from "../../lib/walletNetworkGuard"
import { signInWithWallet, walletOnOtherChain, type LoginAuth, type LoginWallet } from "./walletLogin"

vi.mock("../../lib/walletNetworkGuard", async (original) => ({ ...(await original<typeof import("../../lib/walletNetworkGuard")>()), assertLiveWalletNetwork: vi.fn() }))

const ADDR = "g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l"
const CHAIN_PUBKEY = '{"type":"tendermint/PubKeySecp256k1","value":"chain"}'
const TOKEN = { userAddress: ADDR } as unknown as Token

function wallet(over: Partial<LoginWallet> = {}): LoginWallet {
    return {
        connected: true,
        address: ADDR,
        pubkeyJSON: CHAIN_PUBKEY,
        signLoginChallenge: vi.fn<LoginWallet["signLoginChallenge"]>(async () => ({ signature: "sig", pubKey: '{"from":"adena"}' })),
        ...over,
    }
}

function auth(over: Partial<LoginAuth> = {}) {
    return {
        getChallenge: vi.fn(async () => ({
            nonce: new Uint8Array([1, 2, 3]),
            expiration: "2099-01-01T00:00:00Z",
            serverSignature: new Uint8Array([9]),
            boundPubkeyHash: "",
            chainId: "gnoland-1",
        })),
        getToken: vi.fn(async () => TOKEN),
        ...over,
    }
}

const infoOf = (a: ReturnType<typeof auth>) => JSON.parse(a.getToken.mock.calls[0][0] as string)

beforeEach(() => {
    vi.mocked(assertLiveWalletNetwork).mockReset()
    vi.mocked(assertLiveWalletNetwork).mockResolvedValue({ chainId: "gnoland-1", address: ADDR, rpcUrl: "https://rpc.gno.land" })
})

describe("signInWithWallet", () => {
    it("binds the challenge to the chain and signs with the key Adena reports", async () => {
        const w = wallet()
        const a = auth()
        await expect(signInWithWallet(w, a, "gnoland-1")).resolves.toBe(TOKEN)
        expect(assertLiveWalletNetwork).toHaveBeenCalledWith("gnoland-1", { address: ADDR })
        expect(a.getChallenge).toHaveBeenCalledWith(CHAIN_PUBKEY, "gnoland-1")
        expect(w.signLoginChallenge).toHaveBeenCalledWith("gnoland-1", "AQID", expect.any(Object))
        expect(a.getToken.mock.calls[0][1]).toBe("sig")
        const info = infoOf(a)
        expect(info.userPubkeyJson).toBe('{"from":"adena"}')
        expect(info.userAddress).toBeUndefined()
        expect(info.chainId).toBe("gnoland-1")
        expect(info.challenge.chainId).toBe("gnoland-1")
    })

    it("keeps the chain's key when Adena's reply names none", async () => {
        const a = auth()
        await signInWithWallet(wallet({ signLoginChallenge: vi.fn(async () => ({ signature: "sig", pubKey: "" })) }), a, "gnoland-1")
        expect(infoOf(a).userPubkeyJson).toBe(CHAIN_PUBKEY)
    })

    it("asks by address when the account has no key on Adena's network, so the server can ask for activation", async () => {
        const a = auth()
        await signInWithWallet(wallet({ signLoginChallenge: vi.fn(async () => "no-key" as const) }), a, "gnoland-1")
        expect(a.getToken.mock.calls[0][1]).toBe("")
        expect(infoOf(a).userAddress).toBe(ADDR)
        expect(infoOf(a).userPubkeyJson).toBeUndefined()
    })

    it("sends nothing unsigned for any other refusal, and says which it was", async () => {
        const cases = [
            ["declined", "You declined the login message in Adena. Sign in again when you're ready."],
            ["session-account", SESSION_ACCOUNT_LOGIN_MSG],
            ["unsupported", "This version of Adena can't sign Memba's login message. Update Adena, then sign in again."],
            ["failed", "Adena couldn't sign the login message. Try again."],
            ["no-answer", "Adena didn't answer — reload this tab (needed after Adena updates)."],
            ["closed", "Adena closed its window or hit an error (another tab may have asked it something). Try again."],
        ] as const
        for (const [refusal, message] of cases) {
            const a = auth()
            await expect(signInWithWallet(wallet({ signLoginChallenge: vi.fn(async () => refusal) }), a, "gnoland-1")).rejects.toThrow(message)
            expect(a.getToken).not.toHaveBeenCalled()
        }
    })

    it("asks for the challenge while Adena's network is checked live, and signs only after the check passed", async () => {
        let pass!: (v: Awaited<ReturnType<typeof assertLiveWalletNetwork>>) => void
        vi.mocked(assertLiveWalletNetwork).mockReturnValue(new Promise((r) => { pass = r }))
        const w = wallet()
        const a = auth()
        const signing = signInWithWallet(w, a, "gnoland-1")
        await Promise.resolve()
        expect(a.getChallenge).toHaveBeenCalledOnce()
        expect(w.signLoginChallenge).not.toHaveBeenCalled()
        pass({ chainId: "gnoland-1", address: ADDR, rpcUrl: "https://rpc.gno.land" })
        await expect(signing).resolves.toBe(TOKEN)
        expect(w.signLoginChallenge).toHaveBeenCalledOnce()
    })

    it("a refused network check signs nothing and drops the challenge, even one that failed too", async () => {
        vi.mocked(assertLiveWalletNetwork).mockRejectedValue(new WalletNetworkError("Your wallet is on onyx-1, but this page is on gnoland-1 — switch Adena to gnoland-1 and try again."))
        const w = wallet()
        const a = auth()
        await expect(signInWithWallet(w, a, "gnoland-1")).rejects.toThrow("Your wallet is on onyx-1")
        expect(w.signLoginChallenge).not.toHaveBeenCalled()
        expect(a.getToken).not.toHaveBeenCalled()
        // The challenge request failing as well must not surface as an unhandled rejection.
        const unhandled = vi.fn()
        process.on("unhandledRejection", unhandled)
        try {
            // A plain function: a vi.fn would itself observe the rejection it returns.
            const down = { ...auth(), getChallenge: async () => { throw new Error("backend down") } }
            await expect(signInWithWallet(wallet(), down, "gnoland-1")).rejects.toThrow("Your wallet is on onyx-1")
            await new Promise((r) => setTimeout(r, 20))
        } finally {
            process.off("unhandledRejection", unhandled)
        }
        expect(unhandled).not.toHaveBeenCalled()
    })

    it("says the backend's failure when the check passes but the challenge failed", async () => {
        const down = auth({ getChallenge: vi.fn(async () => { throw new Error("backend down") }) })
        await expect(signInWithWallet(wallet(), down, "gnoland-1")).rejects.toThrow("backend down")
    })

    it("hands Adena's window progress to the caller and still times the flow", async () => {
        const onSent = vi.fn()
        const onSlow = vi.fn()
        const w = wallet({
            signLoginChallenge: vi.fn<LoginWallet["signLoginChallenge"]>(async (_c, _n, watch) => {
                watch?.onSent?.()
                watch?.onSlow?.()
                return { signature: "sig", pubKey: "" }
            }),
        })
        await signInWithWallet(w, auth(), "gnoland-1", { watch: { onSent, onSlow } })
        expect(onSent).toHaveBeenCalledOnce()
        expect(onSlow).toHaveBeenCalledOnce()
    })

    it("says the login message expired once its challenge has, and otherwise names the network to check", async () => {
        vi.useFakeTimers({ now: Date.parse("2026-10-01T12:00:00Z"), toFake: ["Date"] })
        try {
            const at = (expiration: string) => {
                const a = auth({ getToken: vi.fn(async () => null) })
                a.getChallenge.mockResolvedValueOnce({ nonce: new Uint8Array([1]), expiration, serverSignature: new Uint8Array([9]), boundPubkeyHash: "", chainId: "gnoland-1" })
                return signInWithWallet(wallet(), a, "gnoland-1")
            }
            // Expired at the very instant of the check.
            await expect(at("2026-10-01T12:00:00Z")).rejects.toThrow("The login message expired before Memba could check it. Sign in again.")
            await expect(at("2026-10-01T12:00:01Z")).rejects.toThrow("Memba couldn't verify this sign-in. Make sure Adena is on gnoland-1, then sign in again.")
        } finally { vi.useRealTimers() }
    })

    it("passes the activation error through so the caller can open the activation step", async () => {
        const a = auth({ getToken: vi.fn(async () => { throw new Error("Activate your wallet (AUTH-ACTIVATE-01)") }) })
        await expect(signInWithWallet(wallet(), a, "gnoland-1")).rejects.toThrow("AUTH-ACTIVATE-01")
    })

    it("fails clearly without a wallet or a challenge", async () => {
        await expect(signInWithWallet(wallet({ connected: false }), auth(), "gnoland-1")).rejects.toThrow("Connect your wallet")
        await expect(signInWithWallet(wallet(), auth({ getChallenge: vi.fn(async () => undefined) }), "gnoland-1")).rejects.toThrow("couldn't start")
    })
})

describe("walletOnOtherChain", () => {
    it("names both networks only when Adena reports another one", () => {
        expect(walletOnOtherChain("onyx-1", "gnoland-1")).toBe("Adena is on onyx-1, but Memba is on gnoland-1. Switch Adena to gnoland-1 to sign in.")
        expect(walletOnOtherChain("gnoland-1", "gnoland-1")).toBeNull()
        expect(walletOnOtherChain("", "gnoland-1")).toBeNull()
    })
})
