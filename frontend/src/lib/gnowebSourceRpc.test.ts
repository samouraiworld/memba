/**
 * W5.2 — fetchRealmSourceViaRpc / fetchRealmSourceSmart.
 *
 * The RPC (vm/qfile) path is now primary: gnoweb serves no CORS headers, so
 * browser fetches of $source HTML fail regardless of host. These tests pin:
 *   1. listing + per-file fetch composition into RealmSource
 *   2. gnomod.toml (and legacy gno.mod) captured as gnoModContent
 *   3. per-file failure tolerated (fail per-file, not per-realm)
 *   4. SSRF guard + empty-listing → null
 *   5. Smart(): session-cache hit → no RPC; RPC failure → gnoweb fallback
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fetchRealmSourceViaRpc, fetchRealmSourceSmart } from "./gnowebSource"

const mocks = vi.hoisted(() => ({
    abci: vi.fn<(path: string, data: string) => Promise<string | null>>(),
}))

vi.mock("./rpcFallback", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./rpcFallback")>()),
    resilientAbciQuery: mocks.abci,
}))

const REALM = "/r/samcrew/memba_dao"
const PKG = `gno.land${REALM}`

const DAO_GNO = 'package memba_dao\n\nimport "gno.land/p/samcrew/daokit"\n\nfunc Render(path string) string { return "" }\n'
const GNOMOD = 'module = "gno.land/r/samcrew/memba_dao"\n'

function mockChain(responses: Record<string, string | null>) {
    mocks.abci.mockImplementation(async (path: string, data: string) => {
        if (path !== "vm/qfile") throw new Error(`unexpected query path ${path}`)
        if (data in responses) return responses[data]
        return null
    })
}

beforeEach(() => {
    mocks.abci.mockReset()
    sessionStorage.clear()
})

describe("fetchRealmSourceViaRpc", () => {
    it("composes listing + file bodies into a RealmSource", async () => {
        mockChain({
            [PKG]: "gnomod.toml\nmemba_dao.gno",
            [`${PKG}/gnomod.toml`]: GNOMOD,
            [`${PKG}/memba_dao.gno`]: DAO_GNO,
        })

        const src = await fetchRealmSourceViaRpc(REALM)
        expect(src).not.toBeNull()
        // .gno sources lead (files[0] is the drawer's initially active file);
        // manifests/docs trail.
        expect(src!.files.map(f => f.name)).toEqual(["memba_dao.gno", "gnomod.toml"])
        expect(src!.gnoModContent).toBe(GNOMOD)
        expect(src!.imports).toContain("gno.land/p/samcrew/daokit")
        expect(src!.functions.some(f => f.name === "Render" && f.isExported)).toBe(true)
    })

    it("captures legacy gno.mod as gnoModContent", async () => {
        mockChain({
            [PKG]: "gno.mod\nmemba_dao.gno",
            [`${PKG}/gno.mod`]: "module gno.land/r/samcrew/memba_dao\n",
            [`${PKG}/memba_dao.gno`]: DAO_GNO,
        })
        const src = await fetchRealmSourceViaRpc(REALM)
        expect(src!.gnoModContent).toContain("module gno.land")
    })

    it("tolerates a single failed file (fail per-file, not per-realm)", async () => {
        mockChain({
            [PKG]: "broken.gno\nmemba_dao.gno",
            // broken.gno resolves null (missing from responses)
            [`${PKG}/memba_dao.gno`]: DAO_GNO,
        })
        const src = await fetchRealmSourceViaRpc(REALM)
        expect(src).not.toBeNull()
        expect(src!.files.map(f => f.name)).toEqual(["memba_dao.gno"])
    })

    it("returns null when the listing is empty or unavailable", async () => {
        mockChain({ [PKG]: null })
        expect(await fetchRealmSourceViaRpc(REALM)).toBeNull()
        mockChain({ [PKG]: "" })
        expect(await fetchRealmSourceViaRpc(REALM)).toBeNull()
    })

    it("rejects invalid paths without querying (SSRF guard)", async () => {
        expect(await fetchRealmSourceViaRpc("http://evil.com")).toBeNull()
        expect(await fetchRealmSourceViaRpc("/r/../../etc")).toBeNull()
        expect(mocks.abci).not.toHaveBeenCalled()
    })

    it("skips test files when extracting functions but still lists them", async () => {
        mockChain({
            [PKG]: "memba_dao.gno\nmemba_dao_test.gno",
            [`${PKG}/memba_dao.gno`]: DAO_GNO,
            [`${PKG}/memba_dao_test.gno`]: "package memba_dao\n\nfunc TestRenderOnly(t *testing.T) {}\n",
        })
        const src = await fetchRealmSourceViaRpc(REALM)
        expect(src!.files).toHaveLength(2)
        expect(src!.functions.some(f => f.name === "TestRenderOnly")).toBe(false)
    })
})

describe("fetchRealmSourceSmart", () => {
    it("serves from session cache without hitting the RPC", async () => {
        mockChain({
            [PKG]: "memba_dao.gno",
            [`${PKG}/memba_dao.gno`]: DAO_GNO,
        })
        const first = await fetchRealmSourceSmart("https://gnoweb.example", REALM)
        expect(first).not.toBeNull()
        const callsAfterFirst = mocks.abci.mock.calls.length

        const second = await fetchRealmSourceSmart("https://gnoweb.example", REALM)
        expect(second).toEqual(first)
        expect(mocks.abci.mock.calls.length).toBe(callsAfterFirst)
    })

    it("falls back to the gnoweb scrape when the RPC path yields nothing", async () => {
        mockChain({ [PKG]: null })
        const html = `<h3>memba_dao.gno</h3><pre><code>${DAO_GNO.replace(/</g, "&lt;")}</code></pre>`
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, text: async () => html })   // $source
            .mockResolvedValueOnce({ ok: true, text: async () => "" })      // $help
        vi.stubGlobal("fetch", fetchMock)
        try {
            const src = await fetchRealmSourceSmart("https://gnoweb.example", REALM)
            expect(src).not.toBeNull()
            expect(src!.files[0].name).toBe("memba_dao.gno")
            expect(String(fetchMock.mock.calls[0][0])).toBe(`https://gnoweb.example${REALM}$source`)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
