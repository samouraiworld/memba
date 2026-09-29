import { beforeEach, describe, expect, it, vi } from "vitest"
import { homeExcerpt, homeRealmPath, readHomeRealm } from "./profileHome"
import { resilientAbciQueryDetailed } from "../../lib/rpcFallback"

vi.mock("../../lib/config", () => ({ GNO_CHAIN_ID: "gnoland-1", getExplorerBaseUrl: () => "https://gno.land" }))
vi.mock("../../lib/dao/chainIdentity", () => ({ assertRpcChain: vi.fn(async () => {}) }))
vi.mock("../../lib/rpcFallback", () => ({ resilientAbciQueryDetailed: vi.fn() }))

const address = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"

describe("address-owned Home discovery", () => {
    beforeEach(() => vi.clearAllMocks())

    it("builds the address namespace and rejects malformed addresses", () => {
        expect(homeRealmPath(address)).toBe("gno.land/r/" + address + "/home")
        expect(() => homeRealmPath("g1invalid")).toThrow("Invalid Home address")
    })

    it("extracts plain text without embedding inline images or markup", () => {
        const excerpt = homeExcerpt("# My Home\n![art](data:image/svg+xml;base64,AAAA)\n<gno-columns>Welcome **builders**.</gno-columns>\n[Visit](https://example.org)")
        expect(excerpt).toEqual({ title: "My Home", summary: "Welcome builders. Visit" })
    })

    it("reports a rendered realm and its original source URL", async () => {
        vi.mocked(resilientAbciQueryDetailed).mockResolvedValue({ kind: "ok", text: "# Alice Home\nPublic work." })
        await expect(readHomeRealm(address)).resolves.toEqual({
            status: "found", path: "gno.land/r/" + address + "/home",
            url: "https://gno.land/r/" + address + "/home", title: "Alice Home", summary: "Public work.",
        })
    })

    it("does not turn empty or failed reads into a discovered Home", async () => {
        vi.mocked(resilientAbciQueryDetailed).mockResolvedValueOnce({ kind: "empty" })
        expect((await readHomeRealm(address)).status).toBe("unavailable")
        vi.mocked(resilientAbciQueryDetailed).mockRejectedValueOnce(new Error("offline"))
        expect((await readHomeRealm(address)).status).toBe("unavailable")
    })
})
