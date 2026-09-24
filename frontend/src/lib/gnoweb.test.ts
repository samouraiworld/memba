/**
 * Tests for the namespace listing parser and gnoweb URL config.
 */
import { describe, it, expect } from "vitest"
import { parseQpathsListing, getGnowebUrl } from "./gnoweb"
import { NETWORKS, DEFAULT_NETWORK, getExplorerBaseUrlFor } from "./config"

// ── parseQpathsListing ───────────────────────────────────────

// vm/qpaths on gnoland-1 for "gno.land/r/samcrew/" (2026-09-24), abridged.
const SAMPLE_QPATHS = [
    "gno.land/r/samcrew/escrow_v3",
    "gno.land/r/samcrew/home",
    "gno.land/r/samcrew/memba_appstore_v3",
    "gno.land/r/samcrew/memba_reviews_v2",
].join("\n")

describe("parseQpathsListing", () => {
    const baseUrl = "https://gno.land"

    it("maps each qpaths line to a gnoweb path, name and URL", () => {
        const items = parseQpathsListing(SAMPLE_QPATHS, baseUrl, "samcrew", "r")
        expect(items.map(i => i.path)).toEqual(["/r/samcrew/escrow_v3", "/r/samcrew/home", "/r/samcrew/memba_appstore_v3", "/r/samcrew/memba_reviews_v2"])
        expect(items[1]).toEqual({ path: "/r/samcrew/home", name: "home", gnowebUrl: "https://gno.land/r/samcrew/home" })
    })

    it("returns nothing for an empty answer or the other kind", () => {
        expect(parseQpathsListing("", baseUrl, "samcrew", "r")).toEqual([])
        expect(parseQpathsListing(SAMPLE_QPATHS, baseUrl, "samcrew", "p")).toEqual([])
    })

    it("tolerates CRLF line endings", () => {
        expect(parseQpathsListing("gno.land/r/samcrew/home\r\ngno.land/r/samcrew/escrow_v3\r\n", baseUrl, "samcrew", "r").map(i => i.name)).toEqual(["home", "escrow_v3"])
    })
})

// ── getGnowebUrl ─────────────────────────────────────────────

describe("getGnowebUrl", () => {
    it("returns URL for test13 (official testnet)", () => {
        expect(getGnowebUrl("test13")).toBe("https://test13.testnets.gno.land")
    })

    it("returns betanet's own gnoweb for gnoland1 — NOT mainnet", () => {
        // Was "https://gno.land": mainnet. It answers 200 for shared paths like
        // /u/<name>, so a betanet link silently rendered another chain's data.
        // betanet.testnets.gno.land serves <meta name="chainid" content="gnoland1">.
        expect(getGnowebUrl("gnoland1")).toBe("https://betanet.testnets.gno.land")
        expect(getGnowebUrl("gnoland1")).not.toBe("https://gno.land")
    })

    it("returns undefined for removed networks", () => {
        expect(getGnowebUrl("test12")).toBeUndefined()
        expect(getGnowebUrl("portal-loop")).toBeUndefined()
        expect(getGnowebUrl("staging")).toBeUndefined()
    })

    it("returns undefined for unknown chain", () => {
        expect(getGnowebUrl("unknown-chain")).toBeUndefined()
    })

    // ── Regression: the topaz cutover reintroduced the exact bug the test13
    // entry above was added to prevent, and nothing here caught it because the
    // suite only ever tested the two networks that already worked.
    it("resolves the ACTIVE default network — not just the legacy ones", () => {
        expect(
            getGnowebUrl(DEFAULT_NETWORK),
            `getGnowebUrl("${DEFAULT_NETWORK}") is undefined. Directory drawers then fall back to ` +
            `https://gno.land (MAINNET — our realms 404 there) and lib/directory's namespace ` +
            `discovery silently stops marking anything deploymentStatus:"live".`,
        ).toBeDefined()
    })

    it("resolves EVERY configured network, so adding one cannot silently skip it", () => {
        const missing = Object.keys(NETWORKS).filter((k) => !getGnowebUrl(k))
        expect(missing, `networks with no gnoweb URL: ${missing.join(", ")}`).toEqual([])
    })

    it("is keyed by network KEY, not chain id — the distinction that broke topaz", () => {
        // "topaz" is the key; "topaz-1" is the chain id. Passing the chain id
        // must NOT resolve, or callers can be wrong and still look right.
        expect(getGnowebUrl("topaz")).toBe("https://topaz.testnets.gno.land")
        expect(getGnowebUrl("topaz-1")).toBeUndefined()
    })

    it("agrees with getExplorerBaseUrlFor — one source of truth, not two maps", () => {
        for (const key of Object.keys(NETWORKS)) {
            expect(getGnowebUrl(key)).toBe(getExplorerBaseUrlFor(key))
        }
    })
})
