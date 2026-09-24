import { afterEach, expect, it, vi } from "vitest"
import { assertLiveWalletChain } from "./weightedWallet"

const address = "g1lyejwwmxef5tn8nx69saykmgm8rlr4xq9yeh3z"
const trusted = "https://rpc.test13.testnets.gno.land:443"
function wallet({ accountChain = "test-13", networkChain = "test-13" as string | null, rpcUrl = trusted, who = address, status = "success" } = {}) {
    const adena = {
        GetAccount: vi.fn(async () => ({ status, data: { address: who, chainId: accountChain } })),
        GetNetwork: vi.fn(async () => ({ data: { ...(networkChain === null ? {} : { chainId: networkChain }), rpcUrl } })),
    }
    vi.stubGlobal("adena", adena)
    return adena
}
const check = () => assertLiveWalletChain({ chainId: "test-13", address })
afterEach(() => vi.unstubAllGlobals())

it("passes a wallet that is on the page's chain now, through a trusted RPC, on the same account", async () => {
    const adena = wallet()
    await expect(check()).resolves.toBeUndefined()
    expect(adena.GetAccount).toHaveBeenCalledTimes(1)
    expect(adena.GetNetwork).toHaveBeenCalledTimes(1)
    wallet({ networkChain: null })
    await expect(check()).resolves.toBeUndefined()
})

it("refuses an empty or unknown wallet chain id", async () => {
    wallet({ accountChain: "", networkChain: "" })
    await expect(check()).rejects.toThrow("network is unknown")
    wallet({ accountChain: "", networkChain: null })
    await expect(check()).rejects.toThrow("network is unknown")
    wallet({ status: "failure" })
    await expect(check()).rejects.toThrow("network is unknown")
    vi.stubGlobal("adena", undefined)
    await expect(check()).rejects.toThrow("cannot be verified")
})

it("refuses a wallet on gnoland-1 even when the page is on a test network", async () => {
    wallet({ accountChain: "gnoland-1", networkChain: "gnoland-1", rpcUrl: "https://rpc.gno.land:443" })
    await expect(check()).rejects.toThrow("gnoland-1, where governance writes remain on hold")
    wallet({ accountChain: "test-13", networkChain: "gnoland-1" })
    await expect(check()).rejects.toThrow("two different networks")
    await expect(assertLiveWalletChain({ chainId: "gnoland-1", address })).rejects.toThrow("on hold")
})

it("refuses another chain, an untrusted RPC or another account", async () => {
    wallet({ accountChain: "dev", networkChain: "dev" })
    await expect(check()).rejects.toThrow("not test-13")
    wallet({ rpcUrl: "https://evil.example" })
    await expect(check()).rejects.toThrow("cannot be trusted")
    wallet({ rpcUrl: "" })
    await expect(check()).rejects.toThrow("cannot be trusted")
    wallet({ who: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c" })
    await expect(check()).rejects.toThrow("account changed")
})
