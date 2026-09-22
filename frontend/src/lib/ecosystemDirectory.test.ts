import { describe, it, expect } from "vitest"
import { filterEcosystemProjects } from "./ecosystemDirectory"
import { parseEcosystemFilters, updateEcosystemFilters } from "./ecosystemDirectoryUrl"
const defaults = { q: "", category: "all", availability: "all" } as const

describe("editorial discovery", () => {
    it("searches exact realm paths, trims input and combines independent facets", () => {
        expect(filterEcosystemProjects({ ...defaults, q: "  BOARDS2/v0  ", availability: "mainnet" }).map(p => p.id)).toEqual(["boards"])
        expect(filterEcosystemProjects({ ...defaults, q: "boards", category: "Wallet" })).toEqual([])
    })
    it("does not turn tool or external-app labels into mainnet deployment claims", () => {
        expect(filterEcosystemProjects({ ...defaults, availability: "mainnet" }).map(p => p.id)).toEqual(["boards", "gnoscan", "mygnoscan"])
        expect(filterEcosystemProjects({ ...defaults, availability: "unknown" }).map(p => p.id)).toEqual(["gnoswap", "akkadia"])
        expect(filterEcosystemProjects({ ...defaults, availability: "testnet" }).map(p => p.id)).toEqual(["gnoscan"])
        expect(filterEcosystemProjects({ ...defaults, availability: "tools", category: "Wallet" }).map(p => p.id)).toEqual(["adena"])
    })
    it("bounds hostile URL input and defaults invalid facets", () => {
        expect(parseEcosystemFilters(new URLSearchParams({ q: "x".repeat(1000), category: "__proto__", availability: "live" }))).toEqual({ ...defaults, q: "x".repeat(200) })
    })
    it("round trips filters and resets without deleting unrelated state", () => {
        const params = updateEcosystemFilters(new URLSearchParams("ref=share"), { q: "r/x & y", category: "Creative worlds", availability: "unknown" })
        expect(parseEcosystemFilters(params)).toEqual({ q: "r/x & y", category: "Creative worlds", availability: "unknown" })
        expect(updateEcosystemFilters(params, defaults).toString()).toBe("ref=share")
    })
})
