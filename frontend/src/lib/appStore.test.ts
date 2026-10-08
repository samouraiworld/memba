import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
    isSafeRealmPath,
    appStoreVersion,
    isPublishablePath,
    isAppStoreV3OrLater,
    isAppStoreV4,
    APPSTORE_REALM_PATH,
    fetchLiveApps,
    fetchLiveAppsPage,
    fetchLiveCatalogue,
    fetchAppStrict,
    fetchByStatus,
    fetchByPublisher,
    fetchAppStoreStats,
    appFlagStorageBytes,
    assertAppReportApplies,
    buildFlagAppMsg,
    submitAppReport,
    APP_FLAG_GAS_WANTED,
    fetchCuratorQueue,
    fetchMyListings,
    NothingSentError,
} from "./appStore"
import * as shared from "./dao/shared"
import * as grc20 from "./grc20"
import { depositCapUgnot } from "./dao/v2Budget"
import { ACTIVE_NETWORK_KEY, appStorePathFor } from "./config"

describe("APPSTORE_REALM_PATH", () => {
    it("follows the per-network path for the active network", () => {
        expect(APPSTORE_REALM_PATH).toBe(appStorePathFor(ACTIVE_NETWORK_KEY))
        expect(isAppStoreV3OrLater()).toBe(appStoreVersion(APPSTORE_REALM_PATH) >= 3)
        expect(isAppStoreV4()).toBe(appStoreVersion(APPSTORE_REALM_PATH) >= 4)
    })
    it("uses v3 on mainnet and v2 on pearl", () => {
        expect(appStorePathFor("mainnet")).toBe("gno.land/r/samcrew/memba_appstore_v3")
        expect(appStorePathFor("pearl")).toBe("gno.land/r/samcrew/memba_appstore_v2")
    })
})

describe("isPublishablePath (v4's validPkgPath)", () => {
    it("accepts what gno.land publishes and nothing looser", () => {
        for (const ok of ["gno.land/r/samcrew/my_app_v1", "gno.land/p/a/b-c/d1", "gno.land/r/g1abc/x"]) expect(isPublishablePath(ok), ok).toBe(true)
        for (const bad of ["gno.land/r/Samcrew/app", "gno.land/r/samcrew/my.app", "gno.land/r/samcrew/1app", "gno.land/r/samcrew/a__b",
            "gno.land/r/samcrew/a_/b", "gno.land/r/samcrew/app_", "gno.land/r/", `gno.land/r/${"a".repeat(200)}`]) expect(isPublishablePath(bad), bad).toBe(false)
    })
})

describe("appStoreVersion (which realm generation is active)", () => {
    it("reads the generation from an App Store realm path", () => {
        expect(appStoreVersion("gno.land/r/samcrew/memba_appstore_v2")).toBe(2)
        expect(appStoreVersion("gno.land/r/samcrew/memba_appstore_v3")).toBe(3)
        expect(appStoreVersion("gno.land/r/samcrew/memba_appstore_v4")).toBe(4)
        // anchored on the suffix and on the realm name: no other path names a generation
        expect(appStoreVersion("gno.land/r/samcrew/memba_appstore_v3_beta")).toBe(0)
        expect(appStoreVersion("gno.land/r/samcrew/escrow_v4")).toBe(0)
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
        // Read on a node whose chain is checked on every failover.
        expect(qe).toHaveBeenLastCalledWith(expect.any(String), APPSTORE_REALM_PATH, `GetListingJSON("${path}")`, true)

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

    it("rejects dot and empty segments, which a link would resolve to another page", () => {
        expect(isSafeRealmPath("gno.land/r/a/../../../settings")).toBe(false)
        expect(isSafeRealmPath("gno.land/r/a/./b")).toBe(false)
        expect(isSafeRealmPath("gno.land/r/a/..")).toBe(false)
        expect(isSafeRealmPath("gno.land/r/a//b")).toBe(false)
        expect(isSafeRealmPath("gno.land/r/a/")).toBe(false)
        expect(isSafeRealmPath("gno.land/r/")).toBe(false)
        expect(isSafeRealmPath("gno.land/r/a/v1.2")).toBe(true) // a dot inside a segment is a name
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

describe("reporting a listing (FlagApp)", () => {
    const PKG = "gno.land/r/samcrew/space_invaders"
    const CALLER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
    afterEach(() => vi.restoreAllMocks())

    /** The listing read answers `status`; the per-account report read answers `flagged`. */
    function chain(status: string | null, flagged: string | null) {
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue(status === null ? null : { pkgPath: PKG, name: "Space Invaders", status })
        return vi.spyOn(shared, "queryEval").mockImplementation(async (_rpc, _pkg, expr) =>
            expr.startsWith("GetListingJSON") ? (status === null ? '("null" string)' : "[listing]") : flagged)
    }

    it("sizes the deposit cap on the bytes measured for real listing paths", () => {
        // Measured on gnoland-1: 1,095 B (block_party), 1,098 B (space_invaders), 1,095 B (gnoswap/router).
        expect(appFlagStorageBytes("gno.land/r/samcrew/block_party")).toBeGreaterThanOrEqual(1_095)
        expect(appFlagStorageBytes(PKG)).toBeGreaterThanOrEqual(1_098)
        expect(appFlagStorageBytes("gno.land/r/gnoswap/router")).toBeGreaterThanOrEqual(1_095)
        expect(buildFlagAppMsg(CALLER, PKG).value.max_deposit).toBe(`${depositCapUgnot(appFlagStorageBytes(PKG))}ugnot`)
    })

    it("lets a first report on a live or pending listing through, reading both on a verified node", async () => {
        const qe = chain("live", "(false bool)")
        await expect(assertAppReportApplies(CALLER, PKG)).resolves.toBeUndefined()
        expect(qe).toHaveBeenCalledWith(expect.any(String), APPSTORE_REALM_PATH, `HasGovernanceFlag("${PKG}", "${CALLER}")`, true)
        chain("pending", "(false bool)")
        await expect(assertAppReportApplies(CALLER, PKG)).resolves.toBeUndefined()
    })

    it("stops a second report, a closed or missing listing, an unreadable answer and a guest before the wallet", async () => {
        chain("live", "(true bool)")
        await expect(assertAppReportApplies(CALLER, PKG)).rejects.toThrow("already reported")
        chain("delisted", "(false bool)")
        await expect(assertAppReportApplies(CALLER, PKG)).rejects.toThrow("can no longer be reported")
        chain(null, "(false bool)")
        await expect(assertAppReportApplies(CALLER, PKG)).rejects.toThrow("can no longer be reported")
        chain("live", null)
        await expect(assertAppReportApplies(CALLER, PKG)).rejects.toThrow("could not be read")
        await expect(assertAppReportApplies("", PKG)).rejects.toThrow("Connect your wallet")
    })

    it("sends from the classic page at the measured gas and the fee read now, checking again before the wallet", async () => {
        const qe = chain("live", "(false bool)")
        vi.spyOn(grc20, "freshFeeForGasWanted").mockResolvedValue(21_000)
        const broadcast = vi.spyOn(grc20, "doContractBroadcast").mockImplementation(async (_msgs, _memo, opts) => {
            await opts?.beforeSign?.()
            return { hash: "h" } as never
        })
        await expect(submitAppReport(CALLER, PKG)).resolves.toBe("h")
        expect(broadcast).toHaveBeenCalledWith([buildFlagAppMsg(CALLER, PKG)], "Report app", expect.objectContaining({ gasWanted: APP_FLAG_GAS_WANTED, gasFee: 21_000 }))
        // Once before the confirmation, once in beforeSign: two listing reads and two report reads.
        expect(qe).toHaveBeenCalledTimes(4)
    })

    it("sends nothing when this account reported it meanwhile", async () => {
        const qe = chain("live", "(false bool)")
        vi.spyOn(grc20, "freshFeeForGasWanted").mockResolvedValue(21_000)
        const wallet = vi.fn()
        vi.spyOn(grc20, "doContractBroadcast").mockImplementation(async (_msgs, _memo, opts) => {
            qe.mockImplementation(async (_rpc, _pkg, expr) => expr.startsWith("GetListingJSON") ? "[listing]" : "(true bool)")
            await opts?.beforeSign?.()
            wallet()
            return { hash: "h" } as never
        })
        // Stopped in the check after the confirmation: marked as nothing sent, with the reason.
        const sent = submitAppReport(CALLER, PKG)
        await expect(sent).rejects.toBeInstanceOf(NothingSentError)
        await expect(sent).rejects.toThrow("already reported")
        expect(wallet).not.toHaveBeenCalled()
    })
})

describe("curator queue (read-only)", () => {
    afterEach(() => vi.restoreAllMocks())
    const item = (id: number) => ({ id, pkgPath: `gno.land/r/alice/app${id}`, name: `App ${id}`, status: "pending" })
    const CURATOR = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"

    function registry(pendingTotal: unknown, curators: unknown, windows: unknown[][], pendingAfter = pendingTotal) {
        let page = 0
        let statsReads = 0
        return vi.spyOn(shared, "queryEval").mockImplementation(async (_rpc, _pkg, expr) => {
            if (expr === "GetStatsJSON()") return JSON.stringify({ pending: statsReads++ === 0 ? pendingTotal : pendingAfter, registrationFee: 1_000_000, paused: false })
            if (expr === "GetCuratorsJSON()") return JSON.stringify(curators)
            return JSON.stringify(windows[page++] ?? [])
        })
    }
    beforeEach(() => { vi.spyOn(shared, "parseQevalJSON").mockImplementation((raw) => JSON.parse(raw)) })

    it("counts the pending listings reports hide from the registry's lists, reading every call on a verified node", async () => {
        const qe = registry(3, [CURATOR], [[item(1), item(2)]])
        await expect(fetchCuratorQueue(100)).resolves.toMatchObject({ hidden: 1, curators: [CURATOR], pending: [{ name: "App 1" }, { name: "App 2" }] })
        expect(qe).toHaveBeenCalledWith(expect.any(String), APPSTORE_REALM_PATH, 'ListByStatusJSON("pending", 0, 100)', true)
        for (const call of qe.mock.calls) expect(call[3]).toBe(true)
    })

    it("pages to the end, and does not state a hidden count when it stopped early", async () => {
        registry(3, [CURATOR], [[item(1), item(2)], [item(3)]])
        await expect(fetchCuratorQueue(2)).resolves.toMatchObject({ hidden: 0, pending: [{}, {}, {}] })
        registry(9, [CURATOR], [[item(1), item(2)], [item(3), item(4)]])
        await expect(fetchCuratorQueue(2, 2)).resolves.toMatchObject({ hidden: null })
    })

    it("states no hidden count when the pending counter moved while the pages were read", async () => {
        registry(3, [CURATOR], [[item(1), item(2)]], 4)
        await expect(fetchCuratorQueue()).resolves.toMatchObject({ hidden: null, pending: [{}, {}] })
    })

    it("never asks for a window longer than the realm serves", async () => {
        const qe = registry(0, [CURATOR], [[]])
        await fetchCuratorQueue(500)
        expect(qe).toHaveBeenCalledWith(expect.any(String), APPSTORE_REALM_PATH, 'ListByStatusJSON("pending", 0, 100)', true)
    })

    it("throws instead of showing an empty queue when a read fails or answers nonsense", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue(null)
        await expect(fetchCuratorQueue()).rejects.toThrow("unavailable")
        registry("3", [CURATOR], [[]])
        await expect(fetchCuratorQueue()).rejects.toThrow("invalid state")
        registry(0, ['x") or Steal("'], [[]])
        await expect(fetchCuratorQueue()).rejects.toThrow("invalid curator data")
        registry(0, [CURATOR], [{} as never])
        await expect(fetchCuratorQueue()).rejects.toThrow("invalid page")
    })
})

describe("a listing field the realm does not give", () => {
    afterEach(() => vi.restoreAllMocks())
    it("stays missing instead of reading as zero", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue("[raw]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue({ pkgPath: "gno.land/r/samcrew/block_party", name: "Block Party", status: "live" })
        await expect(fetchAppStrict("gno.land/r/samcrew/block_party")).resolves.toMatchObject({ resubmitCount: undefined })
    })
})

describe("a publisher's own listings (strict)", () => {
    afterEach(() => vi.restoreAllMocks())
    const ME = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
    const row = (id: number) => ({ id, pkgPath: `gno.land/r/alice/app${id}`, name: `App ${id}`, status: "rejected" })

    it("reads every status on a verified node, page by page, and says when it stopped early", async () => {
        vi.spyOn(shared, "parseQevalJSON").mockImplementation((raw) => JSON.parse(raw))
        const pages = [Array.from({ length: 100 }, (_, i) => row(i + 1)), [row(101)]]
        const qe = vi.spyOn(shared, "queryEval").mockImplementation(async () => JSON.stringify(pages.shift() ?? []))
        await expect(fetchMyListings(ME)).resolves.toMatchObject({ complete: true, listings: expect.arrayContaining([expect.objectContaining({ name: "App 101" })]) })
        expect(qe).toHaveBeenNthCalledWith(2, expect.any(String), APPSTORE_REALM_PATH, `ListByPublisherJSON("${ME}", 100, 100)`, true)
        qe.mockImplementation(async () => JSON.stringify(Array.from({ length: 100 }, (_, i) => row(i + 1))))
        await expect(fetchMyListings(ME, 2)).resolves.toMatchObject({ complete: false })
    })

    it("counts the rows the registry returns that Memba does not show", async () => {
        vi.spyOn(shared, "parseQevalJSON").mockImplementation((raw) => JSON.parse(raw))
        vi.spyOn(shared, "queryEval").mockResolvedValue(JSON.stringify([row(1), { ...row(2), pkgPath: "gno.land/r/alice/has space" }]))
        await expect(fetchMyListings(ME)).resolves.toMatchObject({ unshown: 1, complete: true, listings: [expect.objectContaining({ name: "App 1" })] })
    })

    it("throws instead of reading as no listings, and refuses a non-address", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue(null)
        await expect(fetchMyListings(ME)).rejects.toThrow("unavailable")
        await expect(fetchMyListings('x") or Steal("')).rejects.toThrow("Connect your wallet first.")
    })
})
