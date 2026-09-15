import { afterEach, expect, it, vi } from "vitest"
import { doContractBroadcast, setTxConfirmationCallback, setWalletRpcContext } from "./grc20"
import { GNO_CHAIN_ID } from "./config"
afterEach(() => { setTxConfirmationCallback(null); setWalletRpcContext(null, false, null); vi.unstubAllGlobals() })
it("rechecks prepared governance context after confirmation before asking Adena to sign", async () => {
    const DoContract = vi.fn()
    vi.stubGlobal("adena", { DoContract })
    setWalletRpcContext("https://selected.invalid", true, GNO_CHAIN_ID)
    let current = true
    setTxConfirmationCallback(async () => { current = false; return true })
    await expect(doContractBroadcast([], "role", { retry: false, beforeSign: () => { if (!current) throw new Error("context changed") } })).rejects.toThrow("context changed")
    expect(DoContract).not.toHaveBeenCalled()
})
it("never retries an uncertain governance submission", async () => {
    const DoContract = vi.fn().mockRejectedValue(new Error("fetch failed"))
    vi.stubGlobal("adena", { DoContract })
    setWalletRpcContext("https://selected.invalid", true, GNO_CHAIN_ID)
    await expect(doContractBroadcast([], "role", { retry: false })).rejects.toThrow("fetch failed")
    expect(DoContract).toHaveBeenCalledTimes(1)
})
