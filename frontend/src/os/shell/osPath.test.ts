import { describe, expect, it } from "vitest"
import { isDeepLink, parseOsPath } from "./osPath"

const MSIG = "g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l"

describe("parseOsPath", () => {
    it("reads the bare desktop, with or without a trailing slash", () => {
        expect(parseOsPath("/os")).toEqual({ kind: "desktop" })
        expect(parseOsPath("/os/")).toEqual({ kind: "desktop" })
    })

    it("reads apps by their slug, keeping any section", () => {
        expect(parseOsPath("/os/wallet")).toEqual({ kind: "app", app: "wallet", section: null })
        expect(parseOsPath("/os/dev-report")).toEqual({ kind: "app", app: "devreport", section: null })
        expect(parseOsPath("/os/wallet/send")).toEqual({ kind: "app", app: "wallet", section: "send" })
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
