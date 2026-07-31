/**
 * Tests for gnoweb namespace explorer — parsing and config.
 */
import { describe, it, expect } from "vitest"
import { parseGnowebListing, getGnowebUrl } from "./gnoweb"
import { NETWORKS, DEFAULT_NETWORK, getExplorerBaseUrlFor } from "./config"

// ── Real HTML samples from gnoweb ────────────────────────────

const SAMPLE_REALMS_HTML = `
<!DOCTYPE html>
<html>
<body>
<nav>
  <a href="/r/">r</a>
  <a href="/r/samcrew">samcrew</a>
</nav>
<main>
  <ul>
    <li><a href="/r/samcrew/_deps/demo/profile">/r/samcrew/_deps/demo/profile</a></li>
    <li><a href="/r/samcrew/daodemo/custom_condition">/r/samcrew/daodemo/custom_condition</a></li>
    <li><a href="/r/samcrew/daodemo/custom_resource">/r/samcrew/daodemo/custom_resource</a></li>
    <li><a href="/r/samcrew/daodemo/simple_dao">/r/samcrew/daodemo/simple_dao</a></li>
    <li><a href="/r/samcrew/lab/lze">/r/samcrew/lab/lze</a></li>
    <li><a href="/r/samcrew/memba_dao">/r/samcrew/memba_dao</a></li>
    <li><a href="/r/samcrew/memba_dao_candidature">/r/samcrew/memba_dao_candidature</a></li>
    <li><a href="/r/samcrew/memba_dao_candidature_v2">/r/samcrew/memba_dao_candidature_v2</a></li>
    <li><a href="/r/samcrew/memba_dao_channels">/r/samcrew/memba_dao_channels</a></li>
    <li><a href="/r/samcrew/memba_dao_channels_v2">/r/samcrew/memba_dao_channels_v2</a></li>
    <li><a href="/r/samcrew/tokenfactory">/r/samcrew/tokenfactory</a></li>
  </ul>
</main>
</body>
</html>
`

const SAMPLE_PACKAGES_HTML = `
<!DOCTYPE html>
<html>
<body>
<main>
  <ul>
    <li><a href="/p/samcrew/basedao">/p/samcrew/basedao</a></li>
    <li><a href="/p/samcrew/daocond">/p/samcrew/daocond</a></li>
    <li><a href="/p/samcrew/daokit">/p/samcrew/daokit</a></li>
    <li><a href="/p/samcrew/piechart">/p/samcrew/piechart</a></li>
    <li><a href="/p/samcrew/realmid">/p/samcrew/realmid</a></li>
    <li><a href="/p/samcrew/tablesort">/p/samcrew/tablesort</a></li>
    <li><a href="/p/samcrew/urlfilter">/p/samcrew/urlfilter</a></li>
    <li><a href="/p/samcrew/_deps/onbloc/json">/p/samcrew/_deps/onbloc/json</a></li>
    <li><a href="/p/samcrew/_deps/onbloc/uint256">/p/samcrew/_deps/onbloc/uint256</a></li>
  </ul>
</main>
</body>
</html>
`

// ── parseGnowebListing ───────────────────────────────────────

describe("parseGnowebListing", () => {
    const baseUrl = "https://gnoweb.test12.moul.p2p.team"

    it("extracts all realm paths from real gnoweb HTML", () => {
        const items = parseGnowebListing(SAMPLE_REALMS_HTML, baseUrl, "r")
        expect(items.length).toBe(11)
        expect(items.map(i => i.path)).toContain("/r/samcrew/memba_dao")
        expect(items.map(i => i.path)).toContain("/r/samcrew/tokenfactory")
        expect(items.map(i => i.path)).toContain("/r/samcrew/memba_dao_candidature_v2")
        expect(items.map(i => i.path)).toContain("/r/samcrew/memba_dao_channels_v2")
    })

    it("extracts all package paths from real gnoweb HTML", () => {
        const items = parseGnowebListing(SAMPLE_PACKAGES_HTML, baseUrl, "p")
        expect(items.length).toBe(9)
        expect(items.map(i => i.path)).toContain("/p/samcrew/basedao")
        expect(items.map(i => i.path)).toContain("/p/samcrew/daokit")
        expect(items.map(i => i.path)).toContain("/p/samcrew/urlfilter")
    })

    it("extracts correct names from paths", () => {
        const items = parseGnowebListing(SAMPLE_REALMS_HTML, baseUrl, "r")
        const membaDao = items.find(i => i.path === "/r/samcrew/memba_dao")
        expect(membaDao?.name).toBe("memba_dao")
    })

    it("generates correct gnoweb URLs", () => {
        const items = parseGnowebListing(SAMPLE_REALMS_HTML, baseUrl, "r")
        const membaDao = items.find(i => i.path === "/r/samcrew/memba_dao")
        expect(membaDao?.gnowebUrl).toBe("https://gnoweb.test12.moul.p2p.team/r/samcrew/memba_dao")
    })

    it("deduplicates paths (gnoweb HTML has repeated links)", () => {
        // Gnoweb pages often have the same link in <nav> and <main>
        const duplicatedHtml = `
            <a href="/r/samcrew/memba_dao">/r/samcrew/memba_dao</a>
            <a href="/r/samcrew/memba_dao">Open</a>
            <a href="/r/samcrew/memba_dao">/r/samcrew/memba_dao</a>
        `
        const items = parseGnowebListing(duplicatedHtml, baseUrl, "r")
        expect(items.length).toBe(1)
    })

    it("skips namespace root and parent paths", () => {
        const htmlWithRoots = `
            <a href="/r/">r</a>
            <a href="/r/samcrew">samcrew</a>
            <a href="/r/samcrew/memba_dao">dao</a>
        `
        const items = parseGnowebListing(htmlWithRoots, baseUrl, "r")
        // Only /r/samcrew/memba_dao should be included (3 segments: r, samcrew, memba_dao)
        expect(items.length).toBe(1)
        expect(items[0].path).toBe("/r/samcrew/memba_dao")
    })

    it("returns empty array for empty HTML", () => {
        const items = parseGnowebListing("", baseUrl, "r")
        expect(items).toEqual([])
    })

    it("returns empty array for HTML with no matching links", () => {
        const items = parseGnowebListing('<a href="/about">About</a>', baseUrl, "r")
        expect(items).toEqual([])
    })

    it("handles deep nested paths", () => {
        const html = '<a href="/r/samcrew/_deps/demo/profile">/r/samcrew/_deps/demo/profile</a>'
        const items = parseGnowebListing(html, baseUrl, "r")
        expect(items.length).toBe(1)
        expect(items[0].name).toBe("profile")
        expect(items[0].path).toBe("/r/samcrew/_deps/demo/profile")
    })

    it("does not match package paths when looking for realms", () => {
        const items = parseGnowebListing(SAMPLE_PACKAGES_HTML, baseUrl, "r")
        // Package HTML only has /p/ links, not /r/ links
        expect(items.length).toBe(0)
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
