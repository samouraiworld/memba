import { afterEach, describe, expect, it, vi } from "vitest"
import { chainPublicKey } from "./account"
import { ACTIVATION_VISIBLE_WITHIN_MS, activationCosts, activationMsgs, activationOnChain } from "./activation"

vi.mock("./account", async (original) => ({ ...(await original<typeof import("./account")>()), chainPublicKey: vi.fn() }))

const ME = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const KEY = { "@type": "/tm.PubKeySecp256k1", value: "A0key" }

afterEach(() => {
    vi.useRealTimers()
    vi.mocked(chainPublicKey).mockReset()
})

describe("activation", () => {
    it("sends 1 ugnot from the address to itself: nothing is written, nothing leaves the address", () => {
        expect(activationMsgs(ME)).toEqual([{ type: "/bank.MsgSend", value: { from_address: ME, to_address: ME, amount: "1ugnot" } }])
    })

    it("costs the network fee only: 2,000,000 gas at the live price, with 20 % headroom", () => {
        expect(activationCosts({ gas: 1000, ugnot: 1 })).toEqual({ gasWanted: 2_000_000, feeUgnot: 2_400 })
    })
})

describe("activationOnChain", () => {
    it("resolves once the chain shows the key, counting a failed read as not yet", async () => {
        vi.useFakeTimers()
        vi.mocked(chainPublicKey).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("fetch failed")).mockResolvedValue(KEY)
        const seen = activationOnChain(ME)
        await vi.advanceTimersByTimeAsync(4_000)
        await expect(seen).resolves.toBe(true)
        expect(chainPublicKey).toHaveBeenCalledTimes(3)
        expect(chainPublicKey).toHaveBeenCalledWith(ME)
    })

    it("gives up when the key does not show in time", async () => {
        vi.useFakeTimers()
        vi.mocked(chainPublicKey).mockResolvedValue(null)
        const seen = activationOnChain(ME)
        let settled = false
        void seen.then(() => { settled = true })
        await vi.advanceTimersByTimeAsync(ACTIVATION_VISIBLE_WITHIN_MS - 2_001)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(2_001)
        await expect(seen).resolves.toBe(false)
    })

    it("stops reading when it is no longer needed", async () => {
        vi.useFakeTimers()
        vi.mocked(chainPublicKey).mockResolvedValue(null)
        const stop = new AbortController()
        const seen = activationOnChain(ME, stop.signal)
        await vi.advanceTimersByTimeAsync(0)
        stop.abort()
        await vi.advanceTimersByTimeAsync(2_000)
        await expect(seen).resolves.toBe(false)
        expect(chainPublicKey).toHaveBeenCalledTimes(1)
    })
})
