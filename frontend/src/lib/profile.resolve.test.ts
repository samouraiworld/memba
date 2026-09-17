import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./rpcFallback", async (orig) => ({
    ...(await orig<typeof import("./rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
    resilientFetch: vi.fn(),
}))

import { resilientAbciQuery, resilientFetch } from "./rpcFallback"
import { resolveOnChainUsername } from "./profile"
import { clearRegisteredUsernameCache, parseResolveAddressResult } from "./dao/shared"

const query = vi.mocked(resilientAbciQuery)
const MOUL = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const TEST1 = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
// Verbatim gnoland-1 qeval output (read-only query, node_info.network verified).
const LIVE_MOUL = `(&(struct{("${MOUL}" .uverse.address),("moul" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)`
const LIVE_NIL = "(nil *gno.land/r/sys/users.UserData)"

describe("on-chain username resolution", () => {
    beforeEach(() => {
        clearRegisteredUsernameCache()
        query.mockReset()
        vi.mocked(resilientFetch).mockReset()
    })

    it("resolves a registered address through ResolveAddress", async () => {
        query.mockResolvedValue(LIVE_MOUL)
        expect(await resolveOnChainUsername(MOUL)).toBe("@moul")
        expect(query).toHaveBeenCalledWith("vm/qeval", `gno.land/r/sys/users.ResolveAddress(address("${MOUL}"))`, true)
        // The registry home page is never scraped.
        expect(resilientFetch).not.toHaveBeenCalled()
    })

    it("returns no username for an unregistered address", async () => {
        query.mockResolvedValue(LIVE_NIL)
        expect(await resolveOnChainUsername(TEST1)).toBe("")
    })

    it("returns no username for a deleted registration", async () => {
        query.mockResolvedValue(LIVE_MOUL.replace("(false bool)", "(true bool)"))
        expect(await resolveOnChainUsername(MOUL)).toBe("")
    })

    it("ignores a record for a different address", async () => {
        query.mockResolvedValue(LIVE_MOUL)
        expect(await resolveOnChainUsername(TEST1)).toBe("")
    })

    it("never interpolates an invalid address into the query", async () => {
        query.mockResolvedValue(LIVE_MOUL)
        expect(await resolveOnChainUsername('g1x")) + evil(("')).toBe("")
        expect(await resolveOnChainUsername(MOUL.slice(0, -1) + "q")).toBe("")
        expect(query).not.toHaveBeenCalled()
    })

    it("caches definitive answers and retries after a failed read", async () => {
        query.mockRejectedValueOnce(new Error("RPC down"))
        expect(await resolveOnChainUsername(MOUL)).toBe("")
        query.mockResolvedValue(LIVE_MOUL)
        expect(await resolveOnChainUsername(MOUL)).toBe("@moul")
        expect(await resolveOnChainUsername(MOUL)).toBe("@moul")
        expect(query).toHaveBeenCalledTimes(2)
    })

    it("parses only the exact UserData literal", () => {
        expect(parseResolveAddressResult(LIVE_MOUL, MOUL)).toBe("moul")
        expect(parseResolveAddressResult(LIVE_NIL, MOUL)).toBe("")
        expect(parseResolveAddressResult("# r/sys/users\n\nhome page", MOUL)).toBeNull()
        expect(parseResolveAddressResult(LIVE_MOUL.replace('"moul"', '"mo ul"'), MOUL)).toBeNull()
    })
})
