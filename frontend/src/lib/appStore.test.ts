import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
    isSafeRealmPath,
    isV3Path,
    isAppStoreV3,
    APPSTORE_REALM_PATH,
    fetchLiveApps,
    fetchLiveAppsPage,
    fetchLiveCatalogue,
    fetchAppStrict,
    fetchByStatus,
    fetchByPublisher,
    fetchAppStoreStats,
} from "./appStore"
import * as shared from "./dao/shared"
import { ACTIVE_NETWORK_KEY, appStorePathFor } from "./config"

describe("APPSTORE_REALM_PATH", () => {
    it("follows the per-network path for the active network", () => {
        expect(APPSTORE_REALM_PATH).toBe(appStorePathFor(ACTIVE_NETWORK_KEY))
        expect(isAppStoreV3()).toBe(isV3Path(APPSTORE_REALM_PATH))
    })
    it("uses v3 on mainnet and v2 on pearl", () => {
        expect(appStorePathFor("mainnet")).toBe("gno.land/r/samcrew/memba_appstore_v3")
        expect(appStorePathFor("pearl")).toBe("gno.land/r/samcrew/memba_appstore_v2")
    })
})

describe("isV3Path (which realm generation is active)", () => {
    it("recognizes a v3 realm path and rejects v2", () => {
        expect(isV3Path("gno.land/r/samcrew/memba_appstore_v3")).toBe(true)
        expect(isV3Path("gno.land/r/samcrew/memba_appstore_v2")).toBe(false)
        // must anchor on the suffix — a v3 substring mid-path shouldn't match
        expect(isV3Path("gno.land/r/samcrew/memba_appstore_v3_beta")).toBe(false)
    })
})

describe("fetchByStatus (v3 per-status window)", () => {
    beforeEach(() => vi.restoreAllMocks())
    afterEach(() => vi.restoreAllMocks())

    it("queries ListByStatusJSON with the status literal and coerces + drops unsafe pkgPaths", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("[unused]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue([
            { id: 1, pkgPath: "gno.land/r/samcrew/block_party", name: "Block Party", status: "pending" },
            { id: 2, pkgPath: `gno.land/r/x") + Evil("`, name: "Evil", status: "pending" },
        ])
        const apps = await fetchByStatus("pending", 0, 20)
        expect(apps).toHaveLength(1)
        expect(apps[0].status).toBe("pending")
        // status is JSON-encoded into the expression (never interpolated raw)
        const expr = qe.mock.calls[0][2]
        expect(expr).toContain("ListByStatusJSON")
        expect(expr).toContain('"pending"')
    })

    it("parses v3-only fields (screenshots / rejectReason / resubmit) and leaves them undefined when absent", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue("[unused]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue([
            {
                id: 3, pkgPath: "gno.land/r/samcrew/app_a", name: "A", status: "rejected",
                rejectReason: "broken link", screenshotCIDs: ["cidA", "cidB", 7], resubmitCount: 2, paidResubmitCredit: true,
            },
            { id: 4, pkgPath: "gno.land/r/samcrew/app_b", name: "B", status: "live" },
        ])
        const [a, b] = await fetchByStatus("rejected", 0, 20)
        expect(a.rejectReason).toBe("broken link")
        expect(a.screenshotCIDs).toEqual(["cidA", "cidB"]) // non-string CID dropped
        expect(a.resubmitCount).toBe(2)
        expect(a.paidResubmitCredit).toBe(true)
        // absent on a v2-shaped listing → undefined / falsy, not fabricated
        expect(b.rejectReason).toBeUndefined()
        expect(b.screenshotCIDs).toBeUndefined()
        expect(b.paidResubmitCredit).toBe(false)
    })

    it("returns [] when the realm/getter yields nothing (e.g. v2 has no ListByStatusJSON)", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue("")
        const apps = await fetchByStatus("live", 0, 20)
        expect(apps).toEqual([])
    })
})

describe("fetchByPublisher (v3 my-submissions window)", () => {
    beforeEach(() => vi.restoreAllMocks())
    afterEach(() => vi.restoreAllMocks())

    it("queries ListByPublisherJSON with the JSON-encoded address and coerces the window", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("[unused]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue([
            { id: 5, pkgPath: "gno.land/r/samcrew/mine_v1", name: "Mine", status: "rejected", rejectReason: "no descr" },
        ])
        const mine = await fetchByPublisher("g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0", 0, 50)
        expect(mine).toHaveLength(1)
        expect(mine[0].rejectReason).toBe("no descr")
        const expr = qe.mock.calls[0][2]
        expect(expr).toContain("ListByPublisherJSON")
        expect(expr).toContain('"g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"')
    })

    it("refuses to query with a non-address-shaped publisher (qeval injection guard)", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("[unused]")
        await expect(fetchByPublisher(`g1x") + Evil("`, 0, 50)).resolves.toEqual([])
        await expect(fetchByPublisher("", 0, 50)).resolves.toEqual([])
        expect(qe).not.toHaveBeenCalled()
    })

    it("returns [] when the realm/getter yields nothing (e.g. v2 has no ListByPublisherJSON)", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue("")
        await expect(fetchByPublisher("g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0", 0, 50)).resolves.toEqual([])
    })
})

describe("fetchLiveApps (coerce drops unsafe pkgPaths)", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("drops a listing whose pkgPath is not a safe realm path", async () => {
        const safe = { id: 1, pkgPath: "gno.land/r/samcrew/block_party", name: "Block Party" }
        const unsafe = { id: 2, pkgPath: `gno.land/r/x") + Evil("`, name: "Evil" }
        vi.spyOn(shared, "queryEval").mockResolvedValue("[unused]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue([safe, unsafe])

        const apps = await fetchLiveApps(0, 10)
        expect(apps).toHaveLength(1)
        expect(apps[0].pkgPath).toBe(safe.pkgPath)
        expect(apps.some((a) => a.pkgPath.includes("Evil"))).toBe(false)
    })
})

describe("strict catalogue windows", () => {
    afterEach(() => vi.restoreAllMocks())

    it("distinguishes an unavailable registry from an empty one", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue(null)
        await expect(fetchLiveAppsPage(0, 20)).rejects.toThrow("unavailable")
    })

    it("continues past a dropped unsafe entry and reports whether the cap was reached", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue("[unused]")
        const safe = (n: number) => ({ id: n, pkgPath: `gno.land/r/samcrew/app_${n}`, name: `App ${n}`, status: "live" })
        const parsed = vi.spyOn(shared, "parseQevalJSON")
            .mockReturnValueOnce([safe(1), { id: 2, pkgPath: `gno.land/r/x") Evil("`, name: "Evil" }])
            .mockReturnValueOnce([safe(3)])
        const result = await fetchLiveCatalogue(2, 3)
        expect(result).toMatchObject({ complete: true, apps: [{ name: "App 1" }, { name: "App 3" }] })
        expect(parsed).toHaveBeenCalledTimes(2)
    })

    it("does not claim full search when the bounded page cap is reached", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue("[unused]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue([
            { id: 1, pkgPath: "gno.land/r/samcrew/a", name: "A", status: "live" },
            { id: 2, pkgPath: "gno.land/r/samcrew/b", name: "B", status: "live" },
        ])
        await expect(fetchLiveCatalogue(2, 2)).resolves.toMatchObject({ complete: false })
    })
})

describe("strict native app detail", () => {
    afterEach(() => vi.restoreAllMocks())

    it("distinguishes RPC failure, an absent listing, and invalid payloads", async () => {
        const path = "gno.land/r/samcrew/block_party"
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue(null)
        await expect(fetchAppStrict(path)).rejects.toThrow("unavailable")

        qe.mockResolvedValue('("null" string)')
        await expect(fetchAppStrict(path)).resolves.toBeNull()

        qe.mockResolvedValue("[payload]")
        const parsed = vi.spyOn(shared, "parseQevalJSON").mockReturnValue({ pkgPath: "gno.land/r/other/app", name: "Wrong app" })
        await expect(fetchAppStrict(path)).rejects.toThrow("invalid listing")
        parsed.mockReturnValue({ pkgPath: path, name: "Block Party", status: "live" })
        await expect(fetchAppStrict(path)).resolves.toMatchObject({ pkgPath: path, name: "Block Party" })
        parsed.mockReturnValue(null)
        await expect(fetchAppStrict(path)).rejects.toThrow("invalid listing")
    })
})

describe("isSafeRealmPath (qeval-expression injection guard)", () => {
    it("accepts well-formed realm/package paths", () => {
        expect(isSafeRealmPath("gno.land/r/samcrew/memba_feed_v1")).toBe(true)
        expect(isSafeRealmPath("gno.land/p/nt/avl/v0")).toBe(true)
        expect(isSafeRealmPath("gno.land/r/gnoland/users/v1")).toBe(true)
    })

    it("rejects anything that could break out of the qeval expression", () => {
        expect(isSafeRealmPath(`gno.land/r/x") + Evil("`)).toBe(false) // quote/paren injection
        expect(isSafeRealmPath("gno.land/r/x y")).toBe(false) // space
        expect(isSafeRealmPath("gno.land/r/x\ny")).toBe(false) // newline
        expect(isSafeRealmPath("evil.com/r/x")).toBe(false) // wrong host
        expect(isSafeRealmPath("gno.land/x/y")).toBe(false) // not r/ or p/
        expect(isSafeRealmPath("")).toBe(false)
        expect(isSafeRealmPath("gno.land/r/" + "a".repeat(300))).toBe(false) // over length cap
    })
})

describe("fetchAppStoreStats (masthead counts via GetStatsJSON)", () => {
    beforeEach(() => vi.restoreAllMocks())
    afterEach(() => vi.restoreAllMocks())

    it("queries GetStatsJSON and parses the v2 shape", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("[raw]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue({
            total: 2, live: 2, registrationFee: 1000000, paused: false,
        })
        const stats = await fetchAppStoreStats()
        expect(qe).toHaveBeenCalledWith(expect.anything(), APPSTORE_REALM_PATH, "GetStatsJSON()")
        expect(stats).toEqual({ total: 2, live: 2, registrationFee: 1000000, paused: false })
    })

    it("tolerates the v3 superset shape (extra per-status counts ignored)", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue("[raw]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue({
            total: 5, live: 2, pending: 2, rejected: 1, delisted: 0,
            registrationFee: 1000000, paused: true,
        })
        const stats = await fetchAppStoreStats()
        expect(stats).toEqual({ total: 5, live: 2, registrationFee: 1000000, paused: true })
    })

    it("returns null on empty qeval, non-object payloads, or missing counts", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("")
        expect(await fetchAppStoreStats()).toBeNull()

        qe.mockResolvedValue("[raw]")
        const pj = vi.spyOn(shared, "parseQevalJSON")
        for (const bad of [null, [], "nope", { total: "2", live: 2 }, { live: 3 }]) {
            pj.mockReturnValue(bad)
            expect(await fetchAppStoreStats()).toBeNull()
        }
    })
})
