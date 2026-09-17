import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { friendlyDaoError } from "./errors"

const realm = readFileSync(join(import.meta.dirname, "..", "templates", "dao", "v2", "realm.ts"), "utf8")
// Every panic the version-2 realm can raise outside genesis and page arguments.
const panics = [...realm.matchAll(/panic\("([^"]+)"\)/g)].map((m) => m[1])
    .filter((p) => !p.startsWith("genesis:") && !p.startsWith("offset") && !p.startsWith("limit"))

const wrapped = (msg: string) => new Error(`--= Error =--\nData: ${msg}\nMsg Traces:\n    0  gno/tm2/pkg/errors/errors.go:103 - VM panic: ${msg}\nStacktrace:\npanic: ${msg}\nExecute at gno.land/r/alice/team/team.gno:518`)

describe("version-2 DAO error messages", () => {
    it("found the realm's panics", () => {
        expect(panics.length).toBeGreaterThan(25)
    })

    it.each(panics)("maps %s to a sentence without internals", (panic) => {
        const text = friendlyDaoError(wrapped(panic))
        expect(text).not.toContain("gno.land/")
        expect(text).not.toContain("panic")
        expect(text).not.toBe(panic)
        expect(text).toMatch(/\.$/)
    })

    it("maps overlapping messages to the specific one", () => {
        expect(friendlyDaoError(wrapped("proposal is not accepted, or its execution window has passed"))).toMatch(/not accepted/)
        expect(friendlyDaoError(wrapped("execution window has passed"))).toBe("The execution window for this proposal has closed.")
        expect(friendlyDaoError(wrapped("invalid role"))).toMatch(/not a role of this DAO/)
        expect(friendlyDaoError(wrapped("duplicate role"))).toMatch(/twice/)
    })

    it("maps a too-low deposit cap", () => {
        expect(friendlyDaoError(new Error("not enough deposit to cover the storage usage: requires 700000ugnot for 7000 bytes"))).toMatch(/storage deposit limit/)
    })

    it("falls back to the generic messages", () => {
        expect(friendlyDaoError(new Error("Transaction cancelled by user"))).not.toMatch(/DAO/)
    })
})
