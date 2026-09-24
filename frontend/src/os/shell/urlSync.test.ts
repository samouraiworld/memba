import { afterEach, describe, expect, it } from "vitest"
import { parseOsPath } from "./osPath"
import { loadSavedTargets, OS_WINDOWS_KEY, saveWindows, targetsFromUrl, tokenToTarget, urlForWindows, windowToken } from "./urlSync"
import { appSpec, EMPTY_WINDOWS, specForTarget, welcomeSpec, windowsReducer, type WindowsState } from "./windows"

const desk = { w: 1200, h: 760 }
const MSIG = "g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l"

afterEach(() => localStorage.clear())

describe("?w= tokens", () => {
    it("round-trip every linkable window", () => {
        for (const url of ["/os/feed", "/os/dev-report", "/os/dao/memba_dao", "/os/dao/my.dao", "/os/dao/memba_dao/proposals/12", "/os/dao/my.dao/proposals/3", "/os/dao/memba_dao/proposals/new", "/os/daos/new", "/os/feedback", `/os/multisig/${MSIG}`]) {
            const t = parseOsPath(url)
            expect(tokenToTarget(windowToken(t)!), url).toEqual(t)
        }
    })

    it("refuse anything a typed link would refuse", () => {
        for (const bad of ["app.nope", "dao.<b>", "prop.memba_dao.x", "prop.12", "msig.g1short", "feed", ".feed", "x.y"]) {
            expect(tokenToTarget(bad), bad).toBeNull()
        }
    })

    it("aren't made for Welcome or not-found windows", () => {
        expect(windowToken(null)).toBeNull()
        expect(windowToken(parseOsPath("/os/nope"))).toBeNull()
    })
})

describe("URL ⇄ windows", () => {
    it("reads the done-when link of day 3: the proposal in front, the feed behind", () => {
        const { front, others } = targetsFromUrl("/os/dao/memba_dao/proposals/12", "?w=app.feed")
        expect(front).toEqual({ kind: "proposal", dao: "memba_dao", n: 12 })
        expect(others).toEqual([{ kind: "app", app: "feed", section: null }])
    })

    it("drops bad ?w= tokens and caps their number", () => {
        const many = Array.from({ length: 40 }, () => "app.feed").join(",")
        expect(targetsFromUrl("/os", `?w=app.nope,${many}`).others.length).toBeLessThanOrEqual(12)
        expect(targetsFromUrl("/os", "?w=%3Cscript%3E").others).toEqual([])
    })

    it("writes the front window's path and the other visible windows, back to front", () => {
        let s: WindowsState = EMPTY_WINDOWS
        for (const url of ["/os/feed", "/os/wallet", "/os/dao/memba_dao/proposals/12"]) {
            s = windowsReducer(s, { type: "open", spec: specForTarget(parseOsPath(url))!, desk })
        }
        s = windowsReducer(s, { type: "open", spec: welcomeSpec(), desk })
        s = windowsReducer(s, { type: "focus", id: s.wins[2].id })
        expect(urlForWindows(s.wins)).toBe("/os/dao/memba_dao/proposals/12?w=app.feed,app.wallet")
        s = windowsReducer(s, { type: "minimise", id: s.wins[0].id })
        expect(urlForWindows(s.wins)).toBe("/os/dao/memba_dao/proposals/12?w=app.wallet")
        expect(urlForWindows([])).toBe("/os")
    })
})

describe("saved session", () => {
    it("saves linkable windows with their geometry and restores them", () => {
        let s = windowsReducer(EMPTY_WINDOWS, { type: "open", spec: appSpec("feed"), desk })
        s = windowsReducer(s, { type: "open", spec: welcomeSpec(), desk })
        s = windowsReducer(s, { type: "move", id: s.wins[0].id, x: 222, y: 111, desk })
        saveWindows(s.wins)
        const back = loadSavedTargets()
        expect(back).toHaveLength(1)
        expect(back[0].target).toEqual({ kind: "app", app: "feed", section: null })
        expect(back[0].geom).toMatchObject({ x: 222, y: 111 })
    })

    it("ignores a corrupted or hostile store", () => {
        localStorage.setItem(OS_WINDOWS_KEY, "{not json")
        expect(loadSavedTargets()).toEqual([])
        localStorage.setItem(OS_WINDOWS_KEY, JSON.stringify([{ token: "dao.<img>" }, { token: 5 }, null, { token: "app.feed", x: "NaN" }]))
        const back = loadSavedTargets()
        expect(back).toHaveLength(1)
        expect(back[0].geom.x).toBe(60)
    })
})

describe("page query strings", () => {
    const open = (s: WindowsState, url: string, search = "") => {
        const t = targetsFromUrl(url, search).front
        return windowsReducer(s, { type: "open", spec: specForTarget(t)!, desk })
    }

    it("give the front window its page's query, beside the reserved w key", () => {
        const { front, others } = targetsFromUrl("/os/validators", "?tab=alerts&w=app.feed")
        expect(front).toEqual({ kind: "app", app: "validators", section: null, query: "tab=alerts" })
        expect(others).toEqual([{ kind: "app", app: "feed", section: null }])
        expect(targetsFromUrl("/os/validators", "").front).toEqual({ kind: "app", app: "validators", section: null, query: "" })
    })

    it("write the front window's query first, then w", () => {
        let s = open(EMPTY_WINDOWS, "/os/feed")
        s = open(s, "/os/validators", "?tab=alerts")
        expect(urlForWindows(s.wins)).toBe("/os/validators?tab=alerts&w=app.feed")
        const alone = open(EMPTY_WINDOWS, "/os/store", "?category=games&q=a%20b")
        expect(urlForWindows(alone.wins)).toBe("/os/store?category=games&q=a+b")
    })

    it("round-trip through the address bar", () => {
        const s = open(open(EMPTY_WINDOWS, "/os/feed"), "/os/validators", "?tab=alerts")
        const url = new URL(urlForWindows(s.wins), "https://memba.club")
        expect(targetsFromUrl(url.pathname, url.search).front).toEqual({ kind: "app", app: "validators", section: null, query: "tab=alerts" })
    })

    it("only belong to page windows: DAO, proposal and multisig windows ignore them", () => {
        expect(targetsFromUrl("/os/dao/memba_dao/proposals/12", "?tab=x").front).toEqual({ kind: "proposal", dao: "memba_dao", n: 12 })
        const s = open(EMPTY_WINDOWS, "/os/dao/memba_dao", "?tab=x")
        expect(urlForWindows(s.wins)).toBe("/os/dao/memba_dao")
    })

    it("stay with a window behind the front one: kept in the saved session, not in w", () => {
        const s = open(open(EMPTY_WINDOWS, "/os/validators", "?tab=alerts"), "/os/feed")
        expect(urlForWindows(s.wins)).toBe("/os/feed?w=app.validators")
        saveWindows(s.wins)
        const back = loadSavedTargets().find((x) => x.target.kind === "app" && x.target.app === "validators")!
        expect(back.target).toEqual({ kind: "app", app: "validators", section: null, query: "tab=alerts" })
    })

    it("drop anything that isn't a plain query string from saved state", () => {
        localStorage.setItem(OS_WINDOWS_KEY, JSON.stringify([{ token: "app.validators", query: 42, x: 1, y: 1, width: 400, height: 300, z: 1 }]))
        expect(loadSavedTargets()[0].target).toEqual({ kind: "app", app: "validators", section: null })
    })
})
