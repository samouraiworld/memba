import { describe, expect, it } from "vitest"
import { isDeepLink, parseOsPath } from "./osPath"
import { tokenToTarget, windowToken } from "./urlSync"
import { specForTarget, urlForWindow } from "./windows"

const MSIG = "g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l"

describe("parseOsPath", () => {
    it("reads the bare desktop, with or without a trailing slash", () => {
        expect(parseOsPath("/os")).toEqual({ kind: "desktop" })
        expect(parseOsPath("/os/")).toEqual({ kind: "desktop" })
    })

    it("opens a weighted DAO's window from its old workspace address typed under the DAOs app, on exactly the /os/dao/<name> terms", () => {
        const at = (tail: string) => parseOsPath(`/os/daos/weighted-dao/gno.land/r/samcrew/memba_dao${tail}`)
        expect(at("")).toEqual({ kind: "dao", name: "memba_dao", section: "overview" })
        expect(at("/members")).toEqual({ kind: "dao", name: "memba_dao", section: "members" })
        expect(at("/proposals")).toEqual({ kind: "dao", name: "memba_dao", section: "proposals" })
        expect(at("/proposals/3")).toEqual({ kind: "proposal", dao: "memba_dao", n: 3 })
        // Anything that route would not read is unknown, never a nearby window.
        for (const tail of ["/proposals/3/x", "/members/x/y", "/proposals/abc", "/proposals/new", "/proposal/3", "/propose", "/settings", "/channels", "/plugin"]) {
            expect(at(tail).kind, tail).toBe("unknown")
        }
        for (const path of ["/os/daos/weighted-dao", "/os/daos/weighted-dao/not-a-realm", "/os/daos/weighted-dao/gno.land/r/SamCrew/Memba_DAO", "/os/daos/weighted-dao/gno.land/r/samcrew/../memba_dao", `/os/daos/weighted-dao/gno.land/r/samcrew/${"x".repeat(80)}`]) {
            expect(parseOsPath(path).kind, path).toBe("unknown")
        }
        // Other DAOs app sections are unchanged.
        expect(parseOsPath("/os/daos/new")).toEqual({ kind: "app", app: "daos", section: "new" })
    })

    it("gives the window opened from the old workspace address the DAO window's own address and saved token", () => {
        for (const tail of ["", "/members", "/proposals/3"]) {
            const target = parseOsPath(`/os/daos/weighted-dao/gno.land/r/samcrew/memba_dao${tail}`)
            // The same window as its own address opens, saved and restored the same way (a DAO window's token keeps no section).
            const own = parseOsPath(`/os/dao/memba_dao${tail}`)
            expect(target).toEqual(own)
            expect(parseOsPath(urlForWindow(specForTarget(target)!))).toEqual(own)
            expect(tokenToTarget(windowToken(target)!)).toEqual(tokenToTarget(windowToken(own)!))
            expect(tokenToTarget(windowToken(target)!)).not.toBeNull()
        }
    })

    it("reads About as a system window, never as an app section", () => {
        expect(parseOsPath("/os/about")).toEqual({ kind: "about" })
        expect(parseOsPath("/os/about/extra").kind).toBe("unknown")
    })

    it("reads apps by their slug, keeping any section", () => {
        expect(parseOsPath("/os/wallet")).toEqual({ kind: "app", app: "wallet", section: null })
        expect(parseOsPath("/os/dev-report")).toEqual({ kind: "app", app: "devreport", section: null })
        expect(parseOsPath("/os/wallet/send")).toEqual({ kind: "app", app: "wallet", section: "send" })
        expect(parseOsPath("/os/meet")).toEqual({ kind: "app", app: "meet", section: null })
        expect(parseOsPath("/os/meet/abc-defg-hij").kind).toBe("unknown")
    })

    it("reads DAO folders and their sections", () => {
        expect(parseOsPath("/os/dao/memba_dao")).toEqual({ kind: "dao", name: "memba_dao", section: "overview" })
        expect(parseOsPath("/os/dao/memba_dao/treasury")).toEqual({ kind: "dao", name: "memba_dao", section: "treasury" })
        expect(parseOsPath("/os/dao/memba_dao/proposals")).toEqual({ kind: "dao", name: "memba_dao", section: "proposals" })
    })

    it("reads the New proposal wizard link", () => {
        expect(parseOsPath("/os/dao/memba_dao/proposals/new")).toEqual({ kind: "new-proposal", dao: "memba_dao" })
    })

    it("reads a proposal", () => {
        expect(parseOsPath("/os/dao/memba_dao/proposals/12")).toEqual({ kind: "proposal", dao: "memba_dao", n: 12 })
    })

    it("reads a multisig by its address", () => {
        expect(parseOsPath(`/os/multisig/${MSIG}`)).toEqual({ kind: "multisig", address: MSIG })
        expect(parseOsPath("/os/multisig")).toEqual({ kind: "app", app: "multisig", section: null })
    })

    it("refuses malformed links instead of guessing", () => {
        for (const p of [
            "/os/nope",
            "/os/dao",
            "/os/dao/<script>",
            "/os/dao/memba_dao/proposals/twelve",
            "/os/dao/memba_dao/votes",
            "/os/dao/memba_dao/proposals/12/extra",
            "/os/multisig/g1short",
            "/os/multisig/G103KJRKW6L0A9LE0A0Q0DSGY0UYT4JYHA55CD4L",
            "/os/%E0%A4%A",
            "/mainnet/os",
        ]) {
            expect(parseOsPath(p).kind, p).toBe("unknown")
        }
    })

    it("treats everything but the bare desktop as a deep link", () => {
        expect(isDeepLink(parseOsPath("/os"))).toBe(false)
        expect(isDeepLink(parseOsPath("/os/feed"))).toBe(true)
        expect(isDeepLink(parseOsPath("/os/dao/memba_dao/proposals/12"))).toBe(true)
        expect(isDeepLink(parseOsPath("/os/nope"))).toBe(true)
    })
})
