import { describe, expect, it } from "vitest"
import { OS_APPS } from "../apps"
import { parseOsPath } from "../shell/osPath"
import { specForTarget, urlForWindow } from "../shell/windows"
import { classicForSection, classicHome, matchRoute, osTargetForClassic, pageNeedsWallet, sectionForClassic } from "./classicRoute"

const ADDR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

describe("matchRoute", () => {
    it("matches params and trailing splats like the route table", () => {
        expect(matchRoute("feed/post/:id", "feed/post/12")).toBe(true)
        expect(matchRoute("feed/post/:id", "feed/post")).toBe(false)
        expect(matchRoute("apps/*", "apps")).toBe(true)
        expect(matchRoute("apps/*", "apps/x/y")).toBe(true)
        expect(matchRoute("validators", "validators/x")).toBe(false)
    })
})

describe("sections", () => {
    it("drop the app's first segment when that round-trips", () => {
        expect(sectionForClassic("feed", "feed/post/12")).toBe("post/12")
        expect(sectionForClassic("validators", `validators/${ADDR}`)).toBe(ADDR)
        expect(sectionForClassic("store", "apps/submit")).toBe("submit")
        expect(sectionForClassic("devreport", "gnolove/teams")).toBe("teams")
    })

    it("keep the classic path when dropping would land on another page", () => {
        expect(sectionForClassic("validators", "alerts")).toBe("alerts")
        expect(sectionForClassic("quests", "quests/points")).toBe("quests/points")
        expect(sectionForClassic("multisig", "create")).toBe("create")
    })

    it("are null for the app's home", () => {
        expect(sectionForClassic("feed", "feed")).toBeNull()
        expect(classicHome("store")).toBe("apps")
        expect(classicHome("wallet")).toBe("")
        expect(classicHome("terminal")).toBeNull()
    })

    it("round-trip every static route of every app", () => {
        for (const app of OS_APPS) {
            for (const route of app.routes) {
                const page = route.replace(/\/\*$/, "/x").replace(/:[A-Za-z]+/g, "p1")
                expect(classicForSection(app.id, sectionForClassic(app.id, page)), `${app.id} ${page}`).toBe(page === classicHome(app.id) ? classicHome(app.id) : page)
            }
        }
    })

    it("refuse a section that isn't one of the app's pages", () => {
        expect(classicForSection("feed", "nope/nope")).toBeNull()
    })
})

describe("osTargetForClassic", () => {
    it("maps pages to their app window, with a URL that parses back", () => {
        const t = osTargetForClassic("/mainnet/feed/post/12", "mainnet")!
        expect(t).toEqual({ kind: "app", app: "feed", section: "post/12" })
        const url = urlForWindow(specForTarget(t)!)
        expect(url).toBe("/os/feed/post/12")
        expect(parseOsPath(url)).toEqual(t)
    })

    it("sends DAO pages to the native DAO windows", () => {
        expect(osTargetForClassic("/mainnet/dao/gno.land/r/gov/dao", "mainnet")).toEqual({ kind: "dao", name: "govdao", section: "overview" })
        expect(osTargetForClassic("/mainnet/dao/gno.land/r/alice/team/proposal/7", "mainnet")).toEqual({ kind: "proposal", dao: "alice.team", n: 7 })
        expect(osTargetForClassic("/mainnet/dao/gno.land/r/alice/team/propose", "mainnet")).toEqual({ kind: "new-proposal", dao: "alice.team" })
        expect(osTargetForClassic("/mainnet/dao/create", "mainnet")).toEqual({ kind: "app", app: "daos", section: "new" })
    })

    it("maps a multisig page to the multisig window, and its other pages to the app", () => {
        expect(osTargetForClassic(`/mainnet/multisig/${ADDR}`, "mainnet")).toEqual({ kind: "multisig", address: ADDR })
        const propose = osTargetForClassic(`/mainnet/multisig/${ADDR}/propose`, "mainnet")!
        expect(propose).toEqual({ kind: "app", app: "multisig", section: `${ADDR}/propose` })
        expect(parseOsPath(urlForWindow(specForTarget(propose)!))).toEqual(propose)
    })

    it("maps the home page to Wallet, keeps the page's query, and refuses other networks and unknown pages", () => {
        expect(osTargetForClassic("/mainnet/", "mainnet")).toEqual({ kind: "app", app: "wallet", section: null })
        expect(osTargetForClassic("/mainnet/tx/5?ms=g1", "mainnet")).toEqual({ kind: "app", app: "wallet", section: "tx/5", query: "ms=g1" })
        expect(osTargetForClassic("/betanet/feed", "mainnet")).toBeNull()
        expect(osTargetForClassic("/mainnet/github/callback", "mainnet")).toBeNull()
        expect(osTargetForClassic("/mainnet/feedback", "mainnet")).toEqual({ kind: "feedback" })
    })

    it("gives a bare legacy path the current network, as LegacyRedirect does", () => {
        expect(osTargetForClassic("/validators/hacker", "mainnet")).toEqual({ kind: "app", app: "validators", section: "hacker" })
        expect(osTargetForClassic("/os/feed", "mainnet")).toBeNull()
    })

    it("keeps a page's query string with its window target", () => {
        expect(osTargetForClassic("/mainnet/validators?tab=alerts", "mainnet")).toEqual({ kind: "app", app: "validators", section: null, query: "tab=alerts" })
        expect(osTargetForClassic("/mainnet/directory?tab=tokens#top", "mainnet")).toEqual({ kind: "app", app: "explorer", section: null, query: "tab=tokens" })
        expect(osTargetForClassic("/mainnet/validators", "mainnet")).toStrictEqual({ kind: "app", app: "validators", section: null })
        // DAO windows are native: a query means nothing to them.
        expect(osTargetForClassic("/mainnet/dao/gno.land/r/gov/dao?x=1", "mainnet")).toEqual({ kind: "dao", name: "govdao", section: "overview" })
    })
})

describe("pageNeedsWallet", () => {
    it("covers the pages that send guests away in the classic app", () => {
        expect(["profile", "multisig", "create", "import", `multisig/${ADDR}`, `multisig/${ADDR}/propose`].every(pageNeedsWallet)).toBe(true)
        expect(["feed", "validators", "profile/g1x", "apps"].some(pageNeedsWallet)).toBe(false)
    })
})
