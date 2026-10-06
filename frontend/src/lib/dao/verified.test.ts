import { describe, expect, it } from "vitest"
import { MEMBA_DAO } from "../config"
import { daoIdentity, VERIFIED_DAOS } from "./verified"

describe("verified DAO identity", () => {
    it("verifies only an exact chain and path match", () => {
        expect(daoIdentity("gnoland-1", "gno.land/r/gov/dao", "GovDAO")).toEqual({ verified: true, verifiedName: "GovDAO", lookalikeOf: null })
        // Memba DAO is not verified on mainnet.
        expect(daoIdentity("gnoland-1", MEMBA_DAO.realmPath, "Memba DAO").verified).toBe(false)
        // Pearl (pearl-1) is retired: nothing verifies on its chain id any more,
        // not GovDAO and not the Memba DAO that was verified there.
        expect(daoIdentity("pearl-1", "gno.land/r/gov/dao", "GovDAO").verified).toBe(false)
        expect(daoIdentity("pearl-1", MEMBA_DAO.realmPath, "MembaDAO").verified).toBe(false)
        expect(daoIdentity("gnoland-1", "gno.land/r/gov/dao/v3", "GovDAO").verified).toBe(false)
        expect(daoIdentity("unknown-chain", "gno.land/r/gov/dao", "GovDAO").verified).toBe(false)
    })

    it("flags names that match a verified DAO once case, spaces and punctuation are ignored", () => {
        for (const name of ["GovDAO", "Gov DAO", "govdao", "Gov-DAO", "Gov_DAO.", "GOV dao"]) {
            expect(daoIdentity("gnoland-1", "gno.land/r/alice/dao", name).lookalikeOf, name).toBe("GovDAO")
        }
    })

    it("flags a self-declared name that matches a verified DAO at another path", () => {
        expect(daoIdentity("gnoland-1", "gno.land/r/lookalike/dao", "govdao")).toEqual({ verified: false, verifiedName: null, lookalikeOf: "GovDAO" })
        expect(daoIdentity("gnoland-1", "gno.land/r/lookalike/dao", "  GovDAO ").lookalikeOf).toBe("GovDAO")
        // Lookalikes are judged against the chain's own verified list: the
        // retired pearl-1 has none, and mainnet does not verify Memba DAO.
        expect(daoIdentity("pearl-1", "gno.land/r/alice/dao", "GovDAO").lookalikeOf).toBeNull()
        expect(daoIdentity("gnoland-1", "gno.land/r/alice/dao", "MEMBA DAO").lookalikeOf).toBeNull()
        expect(daoIdentity("gnoland-1", "gno.land/r/alice/dao", "Alice DAO").lookalikeOf).toBeNull()
    })

    it("never verifies the demo DAO realms", () => {
        for (const list of Object.values(VERIFIED_DAOS)) {
            for (const d of list) expect(d.path.startsWith("gno.land/r/samcrew/daodemo")).toBe(false)
        }
        expect(daoIdentity("gnoland-1", "gno.land/r/samcrew/daodemo/custom_condition", "Demo").verified).toBe(false)
    })
})
