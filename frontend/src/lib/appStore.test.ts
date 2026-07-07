import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { isSafeRealmPath, APPSTORE_REALM_PATH, fetchLiveApps } from "./appStore"
import * as shared from "./dao/shared"

describe("APPSTORE_REALM_PATH", () => {
    it("points at the v2 realm", () => {
        expect(APPSTORE_REALM_PATH.endsWith("_v2")).toBe(true)
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
