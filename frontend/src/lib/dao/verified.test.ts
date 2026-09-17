import { describe, expect, it } from "vitest"
import { MEMBA_DAO } from "../config"
import { daoIdentity, VERIFIED_DAOS } from "./verified"

describe("verified DAO identity", () => {
    it("verifies only an exact chain and path match", () => {
        expect(daoIdentity("gnoland-1", "gno.land/r/gov/dao", "GovDAO")).toEqual({ verified: true, verifiedName: "GovDAO", lookalikeOf: null })
        expect(daoIdentity("pearl-1", MEMBA_DAO.realmPath, "anything").verified).toBe(true)
        // Memba DAO is not verified on mainnet.
        expect(daoIdentity("gnoland-1", MEMBA_DAO.realmPath, "Memba DAO").verified).toBe(false)
        expect(daoIdentity("gnoland-1", "gno.land/r/gov/dao/v3", "GovDAO").verified).toBe(false)
        expect(daoIdentity("unknown-chain", "gno.land/r/gov/dao", "GovDAO").verified).toBe(false)
    })

    it("flags names that match a verified DAO once case, spaces and punctuation are ignored", () => {
        for (const name of ["MembaDAO", "Memba DAO", "memba-dao", "Memba_DAO."]) {
            expect(daoIdentity("pearl-1", "gno.land/r/alice/dao", name).lookalikeOf, name).toBe("MembaDAO")
        }
        for (const name of ["Gov DAO", "govdao", "Gov-DAO"]) {
            expect(daoIdentity("pearl-1", "gno.land/r/alice/dao", name).lookalikeOf, name).toBe("GovDAO")
        }
    })

    it("flags a self-declared name that matches a verified DAO at another path", () => {
        expect(daoIdentity("gnoland-1", "gno.land/r/lookalike/dao", "govdao")).toEqual({ verified: false, verifiedName: null, lookalikeOf: "GovDAO" })
        expect(daoIdentity("gnoland-1", "gno.land/r/lookalike/dao", "  GovDAO ").lookalikeOf).toBe("GovDAO")
        expect(daoIdentity("pearl-1", "gno.land/r/alice/dao", "MEMBA DAO").lookalikeOf).toBe("MembaDAO")
        expect(daoIdentity("gnoland-1", "gno.land/r/alice/dao", "Alice DAO").lookalikeOf).toBeNull()
    })

    it("never verifies the demo DAO realms", () => {
        for (const list of Object.values(VERIFIED_DAOS)) {
            for (const d of list) expect(d.path.startsWith("gno.land/r/samcrew/daodemo")).toBe(false)
        }
        expect(daoIdentity("pearl-1", "gno.land/r/samcrew/daodemo/custom_condition", "Demo").verified).toBe(false)
    })
})
