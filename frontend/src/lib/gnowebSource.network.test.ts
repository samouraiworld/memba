/**
 * Realm source cache network isolation.
 *
 * Switching networks reloads the app while sessionStorage survives, so the
 * realm source cache must be keyed by the active chain: the same realm path
 * can hold different code on different networks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const REALM = "/r/samcrew/memba_dao"
const PKG = `gno.land${REALM}`
const LEGACY_KEY = `memba_gnosrc_source_${REALM}`

const mocks = vi.hoisted(() => ({
    abci: vi.fn<(path: string, data: string) => Promise<string | null>>(),
}))

vi.mock("./rpcFallback", () => ({ resilientAbciQuery: mocks.abci }))

const gno = (label: string) => `package memba_dao\n\nfunc Render(path string) string { return "${label}" }\n`

async function onChain(chain: string, rpcBody: string | null) {
    // The application reloads modules when switching networks; sessionStorage survives.
    vi.resetModules()
    vi.doMock("./config", () => ({
        GNO_CHAIN_ID: chain,
        networkScopedKey: (base: string) => `${base}::${chain}`,
    }))
    mocks.abci.mockImplementation(async (path: string, data: string) => {
        if (path !== "vm/qfile") throw new Error(`unexpected query path ${path}`)
        if (rpcBody === null) return null
        if (data === PKG) return "memba_dao.gno"
        if (data === `${PKG}/memba_dao.gno`) return rpcBody
        return null
    })
    return import("./gnowebSource")
}

const allContent = (src: { files: { content: string }[] } | null) =>
    (src?.files ?? []).map(f => f.content).join("\n")

beforeEach(() => {
    sessionStorage.clear()
    mocks.abci.mockReset()
})
afterEach(() => {
    vi.doUnmock("./config")
    vi.unstubAllGlobals()
})

describe("realm source cache network isolation", () => {
    it("does not serve another chain's cached source for the same path", async () => {
        const pearl = await onChain("pearl-1", gno("testnet"))
        const first = await pearl.fetchRealmSourceSmart("https://pearl.example", REALM)
        expect(allContent(first)).toContain("testnet")
        const callsAfterPearl = mocks.abci.mock.calls.length
        expect(callsAfterPearl).toBeGreaterThan(0)

        const mainnet = await onChain("gnoland-1", gno("mainnet"))
        const second = await mainnet.fetchRealmSourceSmart("https://gno.example", REALM)
        expect(mocks.abci.mock.calls.length).toBeGreaterThan(callsAfterPearl)
        expect(allContent(second)).toContain("mainnet")
        expect(allContent(second)).not.toContain("testnet")
    })

    it("reuses the same-chain cache without a second RPC round", async () => {
        const mainnet = await onChain("gnoland-1", gno("mainnet"))
        const first = await mainnet.fetchRealmSourceSmart("https://gno.example", REALM)
        const calls = mocks.abci.mock.calls.length

        const again = await onChain("gnoland-1", gno("changed"))
        const second = await again.fetchRealmSourceSmart("https://gno.example", REALM)
        expect(second).toEqual(first)
        expect(mocks.abci.mock.calls.length).toBe(calls)
    })

    it("scopes the gnoweb HTML fallback cache per chain", async () => {
        const html = (label: string) =>
            `<h3>memba_dao.gno</h3><pre><code>${gno(label).replace(/</g, "&lt;")}</code></pre>`
        const fetchMock = vi.fn(async (url: string) => {
            if (url.endsWith("$help")) return { ok: true, text: async () => "" }
            return { ok: true, text: async () => html(url.includes("pearl") ? "testnet" : "mainnet") }
        })
        vi.stubGlobal("fetch", fetchMock)

        const pearl = await onChain("pearl-1", null)
        const first = await pearl.fetchRealmSourceSmart("https://pearl.example", REALM)
        expect(allContent(first)).toContain("testnet")
        const fetchesAfterPearl = fetchMock.mock.calls.length

        const mainnet = await onChain("gnoland-1", null)
        const second = await mainnet.fetchRealmSource("https://gno.example", REALM)
        expect(fetchMock.mock.calls.length).toBeGreaterThan(fetchesAfterPearl)
        expect(allContent(second)).toContain("mainnet")
        expect(allContent(second)).not.toContain("testnet")
    })

    it("ignores legacy unscoped entries", async () => {
        sessionStorage.setItem(LEGACY_KEY, JSON.stringify({
            data: { files: [{ name: "memba_dao.gno", content: "legacy", lines: 1 }], functions: [], imports: [] },
            ts: Date.now(),
        }))
        const mainnet = await onChain("gnoland-1", gno("mainnet"))
        const src = await mainnet.fetchRealmSourceSmart("https://gno.example", REALM)
        expect(mocks.abci).toHaveBeenCalled()
        expect(allContent(src)).toContain("mainnet")
        expect(allContent(src)).not.toContain("legacy")
    })

    it("rejects a scoped entry whose recorded chain does not match", async () => {
        sessionStorage.setItem(`${LEGACY_KEY}::gnoland-1`, JSON.stringify({
            data: { files: [{ name: "memba_dao.gno", content: "mismatched", lines: 1 }], functions: [], imports: [] },
            ts: Date.now(),
            chainId: "pearl-1",
        }))
        const mainnet = await onChain("gnoland-1", gno("mainnet"))
        const src = await mainnet.fetchRealmSourceSmart("https://gno.example", REALM)
        expect(mocks.abci).toHaveBeenCalled()
        expect(allContent(src)).toContain("mainnet")
        expect(allContent(src)).not.toContain("mismatched")
    })

    it("records the chain on written entries", async () => {
        const mainnet = await onChain("gnoland-1", gno("mainnet"))
        await mainnet.fetchRealmSourceSmart("https://gno.example", REALM)
        const raw = sessionStorage.getItem(`${LEGACY_KEY}::gnoland-1`)
        expect(raw).not.toBeNull()
        expect(JSON.parse(raw!).chainId).toBe("gnoland-1")
        expect(sessionStorage.getItem(LEGACY_KEY)).toBeNull()
    })
})
