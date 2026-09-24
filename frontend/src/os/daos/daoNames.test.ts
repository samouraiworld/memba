import { describe, expect, it } from "vitest"
import { DAO_REALM_PATH } from "../../lib/config"
import { nameForRealm, realmForName } from "./daoNames"

describe("DAO names (D35)", () => {
    it("maps the two aliases both ways", () => {
        expect(realmForName("govdao")).toBe("gno.land/r/gov/dao")
        expect(realmForName("memba_dao")).toBe(DAO_REALM_PATH)
        expect(nameForRealm("gno.land/r/gov/dao")).toBe("govdao")
        expect(nameForRealm(DAO_REALM_PATH)).toBe("memba_dao")
    })

    it("writes any other realm path with dots, reversibly", () => {
        for (const path of ["gno.land/r/alice/team", "gno.land/r/samcrew/dao_v2", "gno.land/r/a/b/c", "gno.land/r/my-org/team"]) {
            const name = nameForRealm(path)!
            expect(name).not.toContain("/")
            expect(realmForName(name)).toBe(path)
        }
        expect(nameForRealm("gno.land/r/alice/team")).toBe("alice.team")
    })

    it("refuses what can't be a realm", () => {
        for (const bad of ["team", "Alice.team", "alice..team", "alice.te-am", ".team", "alice.", "constructor", "__proto__", "a.b.c.d.e.f.g"]) {
            expect(realmForName(bad), bad).toBeNull()
        }
        for (const bad of ["gno.land/p/alice/lib", "gno.land/r/alice", "gno.land/r/Alice/Team", "evil.com/r/a/b"]) {
            expect(nameForRealm(bad), bad).toBeNull()
        }
    })
})
