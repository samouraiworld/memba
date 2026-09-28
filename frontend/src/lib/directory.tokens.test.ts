import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./dao/shared", async importOriginal => ({
    ...await importOriginal<typeof import("./dao/shared")>(),
    queryRender: vi.fn(),
}))

import { GNO_RPC_URL, GRC20_FACTORY_PATH, currentNetworkKey } from "./config"
import { queryRender } from "./dao/shared"
import { fetchTokens } from "./directory"

const listing = "# GRC20 Tokens (1)\n- [Foo ($FOO)](/r/samcrew/tokenfactory_v2:FOO)"

describe("Directory token trust boundary", () => {
    beforeEach(() => {
        sessionStorage.clear()
        vi.mocked(queryRender).mockReset()
    })

    it("uses a verified read instead of the best-effort Home cache", async () => {
        sessionStorage.setItem(`memba_dir_${currentNetworkKey()}_tokens`, JSON.stringify({
            ts: Date.now(), data: [{ slug: "WRONG", name: "Wrong chain", symbol: "WRONG", path: "wrong" }],
        }))
        vi.mocked(queryRender).mockResolvedValue(listing)

        expect(await fetchTokens(true)).toEqual([{
            slug: "FOO", name: "Foo", symbol: "FOO", path: "gno.land/r/samcrew/tokenfactory_v2:FOO",
        }])
        expect(queryRender).toHaveBeenCalledWith(GNO_RPC_URL, GRC20_FACTORY_PATH, "", true)
        expect(await fetchTokens(true)).toHaveLength(1)
        expect(queryRender).toHaveBeenCalledTimes(1)
    })

    it("reports an outage or unverified chain and never caches it as an empty list", async () => {
        vi.mocked(queryRender).mockRejectedValueOnce(new Error("RPC serves another network"))
            .mockResolvedValueOnce(listing)

        await expect(fetchTokens(true)).rejects.toThrow("RPC serves another network")
        expect(await fetchTokens(true)).toHaveLength(1)
        expect(queryRender).toHaveBeenCalledTimes(2)
    })

    it("distinguishes a genuine empty factory listing from a failed read", async () => {
        vi.mocked(queryRender).mockResolvedValueOnce("# GRC20 Tokens (0)")
        expect(await fetchTokens(true)).toEqual([])
        expect(await fetchTokens(true)).toEqual([])
        expect(queryRender).toHaveBeenCalledTimes(1)
    })

    it("rejects a missing or not-found factory response", async () => {
        vi.mocked(queryRender).mockResolvedValueOnce(null).mockResolvedValueOnce("404")
        await expect(fetchTokens(true)).rejects.toThrow("could not be read")
        await expect(fetchTokens(true)).rejects.toThrow("could not be read")
        expect(queryRender).toHaveBeenCalledTimes(2)
    })
})
