import { describe, expect, it } from "vitest"
import { ECOSYSTEM_PROJECTS } from "./ecosystemDirectory"
import { normalizeAppUrl, notOnChain } from "./appCatalogue"

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
})
