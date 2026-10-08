import { describe, expect, it } from "vitest"
import { buildCatalogue } from "../../../lib/appCatalogue"
import { ECOSYSTEM_PROJECTS } from "../../../lib/ecosystemDirectory"
import { entrySubject } from "./entryMedia"
import { STORE_ESSENTIALS, STORE_FEATURED } from "./featured"

describe("store entries", () => {
    it("reviews an editorial entry under its pinned project subject", () => {
        const entries = buildCatalogue([], ECOSYSTEM_PROJECTS, "mainnet")
        expect(entrySubject(entries.find((e) => e.project?.id === "adena")!)).toBe("memba:app/adena")
        expect(entrySubject(entries.find((e) => e.project?.id === "gnoswap")!)).toBe("gno.land/r/gnoswap/router")
    })
    it("features and lists only known projects", () => {
        const ids = ECOSYSTEM_PROJECTS.map((p) => p.id)
        for (const id of [...STORE_FEATURED, ...STORE_ESSENTIALS]) expect(ids).toContain(id)
    })
})
