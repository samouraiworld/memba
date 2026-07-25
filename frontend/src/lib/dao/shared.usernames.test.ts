/**
 * B-5 Phase 0 (G2): resolveUsernames must scope its cache and registry path
 * to the network it actually QUERIED, not the frozen active network.
 *
 * Before this fix the cache key and registry path were module constants
 * derived from the active network — so a cross-network CAL read (real since
 * B-4) would write foreign-chain usernames under the ACTIVE network's
 * localStorage key and serve them as current. These tests go through the real
 * transport routing (fetch stubbed) so the lane split is exercised too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { resolveUsernames, type DAOMember } from "./shared"
import { GNO_RPC_URL, GNO_CHAIN_ID, NETWORKS, ACTIVE_NETWORK_KEY } from "../config"

const ACTIVE_CACHE_KEY = `memba_usernames::${GNO_CHAIN_ID}`

/** A real non-active network from config — the cross-network read target. */
const otherEntry = Object.entries(NETWORKS).find(([k]) => k !== ACTIVE_NETWORK_KEY)
if (!otherEntry) throw new Error("test requires at least two configured networks")
const OTHER = otherEntry[1]
const OTHER_CACHE_KEY = `memba_usernames::${OTHER.chainId}`

/** An endpoint no NETWORKS entry knows. */
const UNKNOWN_RPC = "https://rpc.unknown-chain.example"

function member(address: string): DAOMember {
    return { address, roles: [], tier: "", votingPower: 0, username: "" }
}

function renderResponse(text: string) {
    return {
        ok: true,
        json: async () => ({ result: { response: { ResponseBase: { Data: btoa(text) } } } }),
    }
}

beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(renderResponse("# User - `alice`")))
})

afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
})

describe("resolveUsernames — network-scoped cache (G2)", () => {
    it("active-network resolution caches under the ACTIVE network's key (unchanged behavior)", async () => {
        const members = [member("g1aaa")]
        await resolveUsernames(GNO_RPC_URL, members)
        expect(members[0].username).toBe("@alice")
        const cached = JSON.parse(localStorage.getItem(ACTIVE_CACHE_KEY) ?? "{}")
        expect(cached.entries?.g1aaa?.username).toBe("@alice")
    })

    it("a KNOWN non-active network caches under ITS OWN chain key — never the active one", async () => {
        const members = [member("g1bbb")]
        await resolveUsernames(OTHER.rpcUrl, members)
        expect(members[0].username).toBe("@alice")
        // The poisoning pin: nothing may land under the active network's key.
        expect(localStorage.getItem(ACTIVE_CACHE_KEY)).toBeNull()
        const cached = JSON.parse(localStorage.getItem(OTHER_CACHE_KEY) ?? "{}")
        expect(cached.entries?.g1bbb?.username).toBe("@alice")
    })

    it("an UNKNOWN endpoint resolves but writes NO cache at all (no guessed identity)", async () => {
        const members = [member("g1ccc")]
        await resolveUsernames(UNKNOWN_RPC, members)
        expect(members[0].username).toBe("@alice")
        expect(localStorage.getItem(ACTIVE_CACHE_KEY)).toBeNull()
        expect(Object.keys(localStorage).filter(k => k.startsWith("memba_usernames"))).toHaveLength(0)
    })

    it("an active-network cache hit is NOT served to a cross-network read", async () => {
        // Prime the active cache.
        await resolveUsernames(GNO_RPC_URL, [member("g1ddd")])
        const fetchMock = vi.mocked(fetch)
        const callsAfterPrime = fetchMock.mock.calls.length
        // Same address, other network: must re-query (its cache is separate),
        // and every request must target the other network's endpoint.
        const members = [member("g1ddd")]
        await resolveUsernames(OTHER.rpcUrl, members)
        expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterPrime)
        for (const call of fetchMock.mock.calls.slice(callsAfterPrime)) {
            expect(call[0]).toBe(OTHER.rpcUrl)
        }
    })

    it("queries the QUERIED network's registry path, not the active constant", async () => {
        // All configured networks currently share r/sys/users, so pin the
        // mechanism instead: the request body's qrender path must embed the
        // registry path that belongs to the queried network's config entry.
        await resolveUsernames(OTHER.rpcUrl, [member("g1eee")])
        const fetchMock = vi.mocked(fetch)
        const body = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))
        const data = atob(body.params.data)
        const expectedRegistry = OTHER.userRegistryPath || "gno.land/r/sys/users"
        expect(data.startsWith(`${expectedRegistry}:`)).toBe(true)
    })
})
