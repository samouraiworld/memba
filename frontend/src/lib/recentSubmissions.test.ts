import { afterEach, describe, expect, it, vi } from "vitest"
import {
    fetchRecentSubmissions, mainnetSubmissionBlockUrl, mainnetSubmissionTxUrl,
    parseRecentSubmissions, RECENT_SUBMISSIONS_ENDPOINT, RecentSubmissionsError,
} from "./recentSubmissions"

const HASH = "LEDHNAXCxlrRMTKCsmlLNDMkIK1eLhfWUGxSAzFcEV4="
const HEX = "2c40c73405c2c65ad1313282b2694b34332420ad5e2e17d6506c5203315c115e"
const REALM = "gno.land/r/demo/one"
const PACKAGE = "gno.land/p/demo/two"

function row(path: string, blockHeight: number, txIndex = 0) {
    return { path, kind: path.startsWith("gno.land/r/") ? "realm" : "package", creator: "g1creator", txHash: HASH, blockHeight, txIndex }
}

function document(rows: unknown[] = [row(REALM, 20_000), row(PACKAGE, 19_999)]): Record<string, unknown> {
    return {
        chainId: "gnoland-1", source: "official-mainnet-tx-indexer", checkedAt: "2026-09-22T14:26:04.934542864Z",
        indexedHeight: 20_000, windowStart: 9_801, windowEnd: 20_000, coverage: "window-only", rows,
    }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe("recent submissions response", () => {
    it("validates, sorts newest-first and keeps the newest transaction for each path", () => {
        const parsed = parseRecentSubmissions(document([
            row(REALM, 19_995), row(PACKAGE, 19_999), row(REALM, 20_000),
        ]))
        expect(parsed.rows.map(item => [item.path, item.blockHeight])).toEqual([[REALM, 20_000], [PACKAGE, 19_999]])
        expect(parsed.checkedAt).toBe("2026-09-22T14:26:04.934542864Z")
    })

    it.each([
        [{ chainId: "pearl-1" }, "wrong-source"],
        [{ source: "indexer.pearl.testnets.gno.land" }, "wrong-source"],
        [{ coverage: "all-history" }, "invalid-response"],
        [{ windowStart: 1 }, "invalid-response"],
        [{ rows: [row("gno.land/r/demo/../bad", 20_000)] }, "invalid-response"],
        [{ rows: [{ ...row(REALM, 20_000), kind: "package" }] }, "invalid-response"],
        [{ rows: [{ ...row(REALM, 20_000), blockHeight: 9_800 }] }, "invalid-response"],
        [{ rows: [{ ...row(REALM, 20_000), txHash: "bad" }] }, "invalid-response"],
        [{ rows: Array.from({ length: 13 }, (_, i) => row(`gno.land/p/demo/p${i}`, 20_000 - i)) }, "invalid-response"],
    ] as const)("rejects invalid source or rows: %j", (patch, kind) => {
        expect(() => parseRecentSubmissions({ ...document(), ...patch })).toThrowError(new RecentSubmissionsError(kind))
    })

    it("constructs exact official mainnet transaction and block RPC links", () => {
        expect(mainnetSubmissionTxUrl(HASH)).toBe(`https://rpc.gno.land/tx?hash=0x${HEX}`)
        expect(mainnetSubmissionBlockUrl(20_000)).toBe("https://rpc.gno.land/block?height=20000")
        expect(mainnetSubmissionTxUrl("bad")).toBeNull()
        expect(mainnetSubmissionBlockUrl(-1)).toBeNull()
    })
})

describe("recent submissions fetch", () => {
    it("makes one fixed GET without a client GraphQL document or row RPC", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(document()), { status: 200 }))
        vi.stubGlobal("fetch", fetchMock)
        expect((await fetchRecentSubmissions()).rows).toHaveLength(2)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0][0]).toBe(RECENT_SUBMISSIONS_ENDPOINT)
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET", headers: { Accept: "application/json" } })
    })

    it("separates wrong-source and unavailable responses", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...document(), chainId: "pearl-1" }), { status: 200 })).mockResolvedValueOnce(new Response("{}", { status: 503 })))
        await expect(fetchRecentSubmissions()).rejects.toMatchObject({ kind: "wrong-source" })
        await expect(fetchRecentSubmissions()).rejects.toMatchObject({ kind: "unavailable" })
    })

    it("reports a client deadline and aborts the request", async () => {
        let aborted = false
        vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("aborted", "AbortError")) })
        })))
        await expect(fetchRecentSubmissions(undefined, 20)).rejects.toMatchObject({ kind: "timeout" })
        expect(aborted).toBe(true)
    })
})
