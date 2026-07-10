import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
    isSafeRealmPath,
    isV3Path,
    isAppStoreV3,
    APPSTORE_REALM_PATH,
    fetchLiveApps,
    fetchByStatus,
    fetchByPublisher,
    fetchAppStoreStats,
} from "./appStore"
import * as shared from "./dao/shared"

describe("APPSTORE_REALM_PATH", () => {
    it("defaults to the v2 realm (repoint to v3 is env-driven, not a code change)", () => {
        // Default (no VITE_APPSTORE_REALM_PATH override) stays on the live v2 realm so the App
        // Store keeps working before v3 is deployed + migrated.
        expect(APPSTORE_REALM_PATH.endsWith("_v2")).toBe(true)
        expect(isAppStoreV3()).toBe(false)
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
