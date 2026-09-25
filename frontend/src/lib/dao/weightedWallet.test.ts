import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { assertLiveWalletChain } from "./weightedWallet"
import { assertLiveWalletNetwork } from "../walletNetworkGuard"
vi.mock("../walletNetworkGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("../walletNetworkGuard")>()
    return { ...actual, assertLiveWalletNetwork: vi.fn(actual.assertLiveWalletNetwork) }
})

const address = "g1lyejwwmxef5tn8nx69saykmgm8rlr4xq9yeh3z"
const trusted = "https://rpc.test13.testnets.gno.land:443"
function wallet({ accountChain = "test-13", networkChain = "test-13" as string | null, rpcUrl = trusted, who = address, status = "success", type = "" } = {}) {
    const adena = {
        GetAccount: vi.fn(async () => ({ status, type, data: { address: who, chainId: accountChain } })),
        GetNetwork: vi.fn(async () => ({ data: { ...(networkChain === null ? {} : { chainId: networkChain }), rpcUrl } })),
    }
    vi.stubGlobal("adena", adena)
    return adena
}
const check = () => assertLiveWalletChain({ chainId: "test-13", address })
let actualGuard: typeof assertLiveWalletNetwork
beforeEach(async () => {
    actualGuard = (await vi.importActual<typeof import("../walletNetworkGuard")>("../walletNetworkGuard")).assertLiveWalletNetwork
    vi.mocked(assertLiveWalletNetwork).mockReset().mockImplementation(actualGuard)
})
afterEach(() => vi.unstubAllGlobals())

it("delegates to the shared wallet-network guard with the page's chain and the session account", async () => {
    wallet()
    await expect(check()).resolves.toMatchObject({ chainId: "test-13", address })
    expect(assertLiveWalletNetwork).toHaveBeenCalledExactlyOnceWith("test-13", { address })
})

it("refuses an empty or unknown wallet chain id (shared guard)", async () => {
    wallet({ accountChain: "", networkChain: "" })
    await expect(check()).rejects.toThrow("did not report its network")
    wallet({ accountChain: "", networkChain: null })
    await expect(check()).rejects.toThrow("did not report its network")
    wallet({ status: "failure", type: "WALLET_LOCKED" })
    await expect(check()).rejects.toThrow("Adena is locked")
})

it("refuses a wallet on gnoland-1 even when the page is on a test network", async () => {
    wallet({ accountChain: "gnoland-1", networkChain: "gnoland-1", rpcUrl: "https://rpc.gno.land:443" })
    await expect(check()).rejects.toThrow(/gnoland-1/)
    wallet({ accountChain: "test-13", networkChain: "gnoland-1" })
    await expect(check()).rejects.toThrow("two different networks")
})

it("refuses a held page chain without asking the wallet", async () => {
    const adena = wallet({ accountChain: "gnoland-1", networkChain: "gnoland-1", rpcUrl: "https://rpc.gno.land:443" })
    await expect(assertLiveWalletChain({ chainId: "gnoland-1", address })).rejects.toThrow("on hold")
    expect(adena.GetAccount).not.toHaveBeenCalled()
    expect(assertLiveWalletNetwork).not.toHaveBeenCalled()
})

it("adds the hold list on top of whatever chain the shared guard accepted", async () => {
    // Should the shared guard ever accept a held chain, the wrapper still refuses.
    vi.mocked(assertLiveWalletNetwork).mockResolvedValue({ chainId: "gnoland-1", address, rpcUrl: "" })
    await expect(check()).rejects.toThrow("where governance writes remain on hold")
})

it("keeps the shared guard's other refusals: another chain, untrusted RPC, another account", async () => {
    wallet({ accountChain: "dev", networkChain: "dev" })
    await expect(check()).rejects.toThrow("switch Adena")
    wallet({ rpcUrl: "https://evil.example" })
    await expect(check()).rejects.toThrow("untrusted RPC")
    wallet({ who: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c" })
    await expect(check()).rejects.toThrow("not the one connected")
})
