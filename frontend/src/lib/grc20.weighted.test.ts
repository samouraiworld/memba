import { afterEach, expect, it, vi } from "vitest"
import { doContractBroadcast, setTxConfirmationCallback, setWalletRpcContext } from "./grc20"
import { GNO_CHAIN_ID } from "./config"
import { liveWallet } from "../test/walletStub"
afterEach(() => { setTxConfirmationCallback(null); setWalletRpcContext(null, false, null); vi.unstubAllGlobals() })
it("rechecks prepared governance context after confirmation before asking Adena to sign", async () => {
    const DoContract = vi.fn()
    vi.stubGlobal("adena", { ...liveWallet(), DoContract })
    setWalletRpcContext("https://selected.invalid", true, GNO_CHAIN_ID)
    let current = true
    setTxConfirmationCallback(async () => { current = false; return true })
    await expect(doContractBroadcast([], "role", { retry: false, beforeSign: () => { if (!current) throw new Error("context changed") } })).rejects.toThrow("context changed")
    expect(DoContract).not.toHaveBeenCalled()
})
it("never retries an uncertain governance submission", async () => {
    const DoContract = vi.fn().mockRejectedValue(new Error("fetch failed"))
    vi.stubGlobal("adena", { ...liveWallet(), DoContract })
    setWalletRpcContext("https://selected.invalid", true, GNO_CHAIN_ID)
    await expect(doContractBroadcast([], "role", { retry: false })).rejects.toThrow("fetch failed")
    expect(DoContract).toHaveBeenCalledTimes(1)
})

it("waits for asynchronous authority validation before invoking the wallet", async () => {
    const DoContract = vi.fn()
    vi.stubGlobal("adena", { ...liveWallet(), DoContract })
    setWalletRpcContext("https://selected.invalid", true, GNO_CHAIN_ID)
    let fail: ((error: Error) => void) | undefined
    const result = doContractBroadcast([], "recovery", { retry: false, beforeSign: () => new Promise<void>((_resolve, reject) => { fail = reject }) })
    await Promise.resolve()
    expect(DoContract).not.toHaveBeenCalled()
    fail!(new Error("member key was replaced"))
    await expect(result).rejects.toThrow("member key was replaced")
    expect(DoContract).not.toHaveBeenCalled()
})
