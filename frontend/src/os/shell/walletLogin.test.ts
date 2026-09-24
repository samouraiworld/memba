import { describe, expect, it, vi } from "vitest"
import type { Token } from "../../gen/memba/v1/memba_pb"
import { signInWithWallet, type LoginAuth, type LoginWallet } from "./walletLogin"

const ADDR = "g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l"
const CHAIN_PUBKEY = '{"type":"tendermint/PubKeySecp256k1","value":"chain"}'
const TOKEN = { userAddress: ADDR } as unknown as Token

function wallet(over: Partial<LoginWallet> = {}): LoginWallet {
    return {
        connected: true,
        address: ADDR,
        pubkeyJSON: CHAIN_PUBKEY,
        signLoginChallenge: vi.fn(async () => ({ signature: "sig", pubKey: '{"from":"adena"}' })),
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

describe("signInWithWallet", () => {
    it("binds the challenge to the chain and signs with the key Adena reports", async () => {
        const w = wallet()
        const a = auth()
        await expect(signInWithWallet(w, a, "gnoland-1")).resolves.toBe(TOKEN)
        expect(a.getChallenge).toHaveBeenCalledWith(CHAIN_PUBKEY, "gnoland-1")
        expect(w.signLoginChallenge).toHaveBeenCalledWith("gnoland-1", "AQID")
        expect(a.getToken.mock.calls[0][1]).toBe("sig")
        const info = infoOf(a)
        expect(info.userPubkeyJson).toBe('{"from":"adena"}')
        expect(info.userAddress).toBeUndefined()
        expect(info.chainId).toBe("gnoland-1")
        expect(info.challenge.chainId).toBe("gnoland-1")
    })

    it("falls back to an address-only request when an untransacted wallet can't sign", async () => {
        const a = auth()
        await signInWithWallet(wallet({ pubkeyJSON: "", signLoginChallenge: vi.fn(async () => null) }), a, "gnoland-1")
        expect(a.getChallenge).toHaveBeenCalledWith(undefined, "gnoland-1")
        expect(a.getToken.mock.calls[0][1]).toBe("")
        expect(infoOf(a).userAddress).toBe(ADDR)
        expect(infoOf(a).userPubkeyJson).toBeUndefined()
    })

    it("passes the activation error through so the caller can open the activation step", async () => {
        const a = auth({ getToken: vi.fn(async () => { throw new Error("Activate your wallet (AUTH-ACTIVATE-01)") }) })
        await expect(signInWithWallet(wallet(), a, "gnoland-1")).rejects.toThrow("AUTH-ACTIVATE-01")
    })

    it("fails clearly without a wallet, a challenge or a token", async () => {
        await expect(signInWithWallet(wallet({ connected: false }), auth(), "gnoland-1")).rejects.toThrow("Connect your wallet")
        await expect(signInWithWallet(wallet(), auth({ getChallenge: vi.fn(async () => undefined) }), "gnoland-1")).rejects.toThrow("couldn't start")
        await expect(signInWithWallet(wallet(), auth({ getToken: vi.fn(async () => null) }), "gnoland-1")).rejects.toThrow("Sign-in failed")
    })
})
