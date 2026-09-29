import { describe, expect, it } from "vitest"
import { ECOSYSTEM_PROJECTS } from "./ecosystemDirectory"
import { buildCatalogue, filterCatalogue, normalizeAppUrl, notOnChain, parseCatalogueFilters, updateCatalogueFilters } from "./appCatalogue"
import type { AppListing } from "./appStore"

describe("one App Store catalogue", () => {
    it("matches ordinary web addresses across scheme, www, case, and trailing slash", () => {
        expect(normalizeAppUrl("https://www.GnoSwap.io/")).toBe("gnoswap.io")
        expect(normalizeAppUrl("http://gnoswap.io/?from=store")).toBe("gnoswap.io")
        expect(normalizeAppUrl("https://gno.land/r/gnoland/boards2/v0/")).toBe("gno.land/r/gnoland/boards2/v0")
        expect(normalizeAppUrl("/game")).toBeNull()
        expect(normalizeAppUrl("javascript:alert(1)")).toBeNull()
    })

    it("hides GnoSwap and Boards when live listings match, retaining external games and tools", () => {
        const live = [
            { pkgPath: "gno.land/r/gnoswap/router", appURL: "https://www.gnoswap.io/" },
            { pkgPath: "gno.land/r/gnoland/boards2/v0/", appURL: "" },
        ]
        expect(notOnChain(ECOSYSTEM_PROJECTS, live).map((project) => project.id)).toEqual([
            "adena", "akkadia", "bubble-rumble", "kourt", "gnoscan", "playground", "mygnoscan",
        ])
        expect(notOnChain(ECOSYSTEM_PROJECTS, [])).toHaveLength(ECOSYSTEM_PROJECTS.length)
    })

    it("also hides a newly registered project by its verified realm, even when its web address differs", () => {
        const live = [{ pkgPath: "gno.land/r/g1ecsuj0q572jr0dhu29q9njtnmw03hyu7tyyvv6/kourt", appURL: "https://new.kourt.xyz/" }]
        expect(notOnChain(ECOSYSTEM_PROJECTS, live).some((project) => project.id === "kourt")).toBe(false)
    })

    it("always keeps off-chain tools in the static directory", () => {
        const live = [{ pkgPath: "gno.land/r/other/registry_entry", appURL: "https://www.adena.app/" }]
        expect(notOnChain(ECOSYSTEM_PROJECTS, live).some((project) => project.id === "adena")).toBe(true)
    })

    it("does not let a copied web URL erase an independently linked project", () => {
        const impostor = [{ pkgPath: "gno.land/r/stranger/other", appURL: "https://bubblerumble.net/" }]
        expect(notOnChain(ECOSYSTEM_PROJECTS, impostor).some((project) => project.id === "bubble-rumble")).toBe(true)
    })

    it("joins verified realm identities, searches both sources, and keeps provenance", () => {
        const live: AppListing[] = [
            { id: 1, pkgPath: "gno.land/r/gnoswap/router", name: "GnoSwap", tagline: "Swap on Gno", category: "DeFi", iconCID: "", appURL: "https://gnoswap.io/", publisher: "g1owner", status: "live", flagCount: 0, createdAt: 1 },
            { id: 2, pkgPath: "gno.land/r/samcrew/game", name: "A game", tagline: "Play daily", category: "Games", iconCID: "", appURL: "/game", publisher: "g1owner", status: "pending", flagCount: 0, createdAt: 2 },
        ]
        const entries = buildCatalogue(live, ECOSYSTEM_PROJECTS)
        expect(entries.filter((entry) => entry.name === "GnoSwap")).toHaveLength(1)
        expect(entries[0]).toMatchObject({ source: "registry", category: "Exchange", realmPath: "gno.land/r/gnoswap/router" })
        expect(entries.some((entry) => entry.name === "A game")).toBe(false)
        expect(filterCatalogue(entries, { q: "swap", category: "all", availability: "mainnet" }).map((entry) => entry.id)).toEqual(["registry:gno.land/r/gnoswap/router"])
        expect(filterCatalogue(entries, { q: "bubble", category: "Games", availability: "unknown" }).map((entry) => entry.id)).toEqual(["editorial:bubble-rumble"])
        expect(filterCatalogue(entries, { q: "adena", category: "Wallet", availability: "tools" }).map((entry) => entry.id)).toEqual(["editorial:adena"])
        const testnet = buildCatalogue([live[0]], ECOSYSTEM_PROJECTS, "testnet")
        expect(filterCatalogue(testnet, { q: "swap", category: "all", availability: "testnet" }).map((entry) => entry.id)).toEqual(["registry:gno.land/r/gnoswap/router"])
        expect(filterCatalogue(testnet, { q: "swap", category: "all", availability: "mainnet" })).toEqual([])
    })

    it("bounds and round-trips catalogue URL filters", () => {
        const filters = parseCatalogueFilters(new URLSearchParams({ q: "a".repeat(400), category: "__proto__", availability: "unknown" }))
        expect(filters).toEqual({ q: "a".repeat(200), category: "all", availability: "unknown" })
        const next = updateCatalogueFilters(new URLSearchParams("ref=shared"), { q: "Block Party", category: "Games" })
        expect(next.toString()).toBe("ref=shared&q=Block+Party&category=Games")
        expect(updateCatalogueFilters(next, { q: "", category: "all" }).toString()).toBe("ref=shared")
    })
})
