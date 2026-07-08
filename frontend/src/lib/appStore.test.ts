import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { isSafeRealmPath, isV3Path, isAppStoreV3, APPSTORE_REALM_PATH, fetchLiveApps, fetchByStatus } from "./appStore"
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
