import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/grc20", async (orig) => ({
    ...(await orig<typeof import("../../lib/grc20")>()),
    doContractBroadcast: vi.fn(async () => ({ hash: "H" })),
    freshFeeForGasWanted: vi.fn(async () => 2_400),
}))

import { doContractBroadcast, freshFeeForGasWanted } from "../../lib/grc20"
import { activationRequest } from "./activation"

const ME = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const PRICE = { gas: 1000, ugnot: 1 }

afterEach(() => { vi.clearAllMocks() })

describe("activation", () => {
    it("sends exactly the reviewed message at the reviewed fee, as an OS activation", async () => {
        const req = activationRequest(ME, PRICE)
        const beforeSign = vi.fn(async () => {})
        await req.send(undefined, beforeSign)
        expect(doContractBroadcast).toHaveBeenCalledWith(req.prepare(undefined).msgs, "Memba Network Activation", { osActivation: true, gasWanted: 2_000_000, gasFee: 2_400, beforeSign })
    })

    it("re-reads the price before Adena opens and refuses a fee that rose", async () => {
        const req = activationRequest(ME, PRICE)
        await expect(req.recheck!(undefined)).resolves.toBeUndefined()
        vi.mocked(freshFeeForGasWanted).mockResolvedValueOnce(4_800)
        await expect(req.recheck!(undefined)).rejects.toThrow()
    })
})
