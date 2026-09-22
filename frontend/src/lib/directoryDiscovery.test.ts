import { beforeEach, describe, expect, it, vi } from "vitest"
import { NETWORKS, ACTIVE_NETWORK_KEY } from "./config"
import { directorySeeds, SEED_PACKAGES } from "./directorySeeds"
import { directorySeedData, fetchDirectoryDiscovery } from "./directoryDiscovery"
import { fetchRealms } from "./directory"
import { fetchNamespaceListing } from "./gnoweb"
vi.mock("./gnoweb", () => ({ fetchNamespaceListing: vi.fn() }))

beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })
describe("network-scoped discovery", () => {
    it("keeps mainnet evidence separate from historical testnet references", () => {
        const main = directorySeeds("mainnet")
        expect(main.packages).toEqual([])
        expect(main.realms.map(r => r.path)).toEqual(["gno.land/r/gnoland/boards2/v0", "gno.land/r/gov/dao", "gno.land/r/gnoland/blog"])
        expect(main.realms.every(r => r.networkKey === "mainnet" && r.provenance === "editorial" && r.checkedAt === "2026-09-22")).toBe(true)
        const testnet = directorySeeds("pearl")
        expect(testnet.packages).toHaveLength(SEED_PACKAGES.length)
        expect([...testnet.realms, ...testnet.packages].every(r => r.networkKey === "pearl" && r.provenance === "reference" && !r.checkedAt)).toBe(true)
        expect(directorySeedData("unknown", [])).toEqual({ packages: [], realms: [], status: "unavailable" })
    })
    it("does not relabel the loaded chain's saved paths for another network", () => {
        localStorage.setItem("memba_saved_daos", JSON.stringify([{ realmPath: "gno.land/r/custom/saved", name: "Saved", addedAt: Date.now(), network: ACTIVE_NETWORK_KEY, chainId: NETWORKS[ACTIVE_NETWORK_KEY].chainId }]))
        expect(fetchRealms(ACTIVE_NETWORK_KEY).find(r => r.path.endsWith("/custom/saved"))?.provenance).toBe("saved")
        const other = ACTIVE_NETWORK_KEY === "pearl" ? "mainnet" : "pearl"
        expect(fetchRealms(other).some(r => r.path.endsWith("/custom/saved"))).toBe(false)
    })
    it("retains editorial data on partial failure and only merges identified listings", async () => {
        vi.mocked(fetchNamespaceListing).mockResolvedValueOnce({ status: "unavailable", items: [] }).mockResolvedValueOnce({ status: "ready", items: [{ name: "listed", path: "/r/samcrew/listed", gnowebUrl: "https://gno.land/r/samcrew/listed" }] })
        const result = await fetchDirectoryDiscovery("mainnet", [])
        expect(result.status).toBe("partial")
        expect(result.realms).toHaveLength(4)
        expect(result.realms[3]).toMatchObject({ networkKey: "mainnet", provenance: "namespace" })
        expect(JSON.stringify(result)).not.toContain("Deployed at block")
        expect(fetchNamespaceListing).toHaveBeenNthCalledWith(1, NETWORKS.mainnet.explorerUrl, "samcrew", "p", NETWORKS.mainnet.chainId)
        expect(fetchNamespaceListing).toHaveBeenCalledTimes(2)
    })
    it("distinguishes successful empty discovery from failure without mutating seeds", async () => {
        vi.mocked(fetchNamespaceListing).mockResolvedValue({ status: "ready", items: [] })
        const result = await fetchDirectoryDiscovery("pearl", [])
        expect(result.status).toBe("ready")
        result.packages[0].description = "mutated"
        expect(directorySeeds("pearl").packages[0].description).not.toBe("mutated")
        vi.mocked(fetchNamespaceListing).mockResolvedValue({ status: "unavailable", items: [] })
        expect((await fetchDirectoryDiscovery("pearl", [])).status).toBe("partial")
    })
})
