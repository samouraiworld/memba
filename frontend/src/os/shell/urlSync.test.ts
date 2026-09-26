import { afterEach, describe, expect, it } from "vitest"
import { parseOsPath } from "./osPath"
import { loadSavedTargets, OS_WINDOWS_KEY, saveWindows, targetsFromUrl, tokenToTarget, urlForWindows, windowToken, windowsStorageKey } from "./urlSync"
import { appSpec, EMPTY_WINDOWS, specForTarget, welcomeSpec, windowsForNavigation, windowsReducer, type WindowsState } from "./windows"
import { applyToJoinSpec } from "../daos/joinSpec"

const desk = { w: 1200, h: 760 }
const MSIG = "g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l"

afterEach(() => localStorage.clear())

describe("?w= tokens", () => {
    it("round-trip every linkable window", () => {
        for (const url of ["/os/feed", "/os/feed/post/12", "/os/dev-report", "/os/arcade/game", "/os/arcade/space-invaders", "/os/arcade/barricade", "/os/arcade/runs", "/os/arcade/daily-board", "/os/dao/memba_dao", "/os/dao/my.dao", "/os/dao/memba_dao/proposals/12", "/os/dao/my.dao/proposals/3", "/os/dao/memba_dao/proposals/new", "/os/daos/new", "/os/feedback", "/os/about", `/os/multisig/${MSIG}`]) {
            const t = parseOsPath(url)
            expect(tokenToTarget(windowToken(t)!), url).toEqual(t)
        }
    })

    it("refuse anything a typed link would refuse", () => {
        for (const bad of ["app.nope", "arcade.invalid", "arcade.game/other", "dao.<b>", "prop.memba_dao.x", "prop.12", "msig.g1short", "feed", ".feed", "x.y"]) {
            expect(tokenToTarget(bad), bad).toBeNull()
        }
    })

    it("aren't made for Welcome or not-found windows", () => {
        expect(windowToken(null)).toBeNull()
        expect(windowToken(parseOsPath("/os/nope"))).toBeNull()
    })

    it("keeps an invalid deep link visible for typo correction", () => {
        const s = windowsReducer(EMPTY_WINDOWS, { type: "open", spec: specForTarget(parseOsPath("/os/unknown-audit-path"))!, desk })
        expect(urlForWindows(s.wins)).toBe("/os/unknown-audit-path")
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
        expect(targetsFromUrl("/os", `?w=app.nope,${many}`).others.length).toBeLessThanOrEqual(32)
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

    it("preserves a Feed thread beside the separate join window through URL and session restoration", () => {
        let s = windowsReducer(EMPTY_WINDOWS, { type: "open", spec: appSpec("feed", "post/12"), desk })
        s = windowsReducer(s, { type: "open", spec: applyToJoinSpec(), desk })
        expect(urlForWindows(s.wins)).toBe("/os/feed?compose=join&osJoin=1&w=feed.post.12")

        const { front, others } = targetsFromUrl("/os/feed", "?compose=join&osJoin=1&w=feed.post.12")
        expect(specForTarget(front)?.key).toBe("flow:feed-join")
        expect(others).toEqual([{ kind: "app", app: "feed", section: "post/12" }])
        expect(specForTarget(others[0])?.key).toBe("app:feed")
        const roundTrip = windowsForNavigation(s, [specForTarget(front)!, ...others.map(target => specForTarget(target)!)], desk, true)
        expect(roundTrip.wins).toHaveLength(2)
        expect(roundTrip.wins.find(win => win.key === "app:feed")).toMatchObject({ id: s.wins[0].id, target: { section: "post/12" } })

        const threadFront = windowsReducer(s, { type: "focus", id: s.wins[0].id })
        expect(urlForWindows(threadFront.wins)).toBe("/os/feed/post/12?w=feed.join")
        const behind = targetsFromUrl("/os/feed/post/12", "?w=feed.join").others
        expect(specForTarget(behind[0])?.key).toBe("flow:feed-join")

        saveWindows(s.wins)
        const restored = loadSavedTargets().map(({ target }) => specForTarget(target))
        expect(restored.map(spec => spec?.key)).toEqual(["app:feed", "flow:feed-join"])
        expect(restored[0]?.target).toMatchObject({ section: "post/12" })
        expect(specForTarget(targetsFromUrl("/os/feed", "?compose=join").front)?.key).toBe("app:feed")
    })
})

describe("saved session", () => {
    it("restores a minimised meeting with its room code intact", () => {
        let state = windowsReducer(EMPTY_WINDOWS, { type: "open", spec: appSpec("meet", "abc-defg-hij"), desk })
        state = windowsReducer(state, { type: "minimise", id: state.wins[0].id })
        saveWindows(state.wins)
        expect(loadSavedTargets()[0]).toMatchObject({ target: { kind: "app", app: "meet", section: "abc-defg-hij" }, geom: { min: true } })
    })
    it("partitions window paths and page queries by chain and account", () => {
        const s = windowsReducer(EMPTY_WINDOWS, { type: "open", spec: appSpec("feed", null, "compose=join"), desk })
        saveWindows(s.wins, "member:gnoland-1:g1alpha")
        expect(loadSavedTargets("member:gnoland-1:g1alpha")[0].target).toMatchObject({ app: "feed", query: "compose=join" })
        expect(loadSavedTargets("member:gnoland-1:g1beta")).toEqual([])
        expect(loadSavedTargets("guest:gnoland-1")).toEqual([])
        expect(localStorage.getItem(windowsStorageKey("member:gnoland-1:g1alpha"))).not.toBeNull()
        expect(localStorage.getItem(OS_WINDOWS_KEY)).toBeNull()
    })
    it("restores the lobby and separate game windows without losing their sections", () => {
        let s = windowsReducer(EMPTY_WINDOWS, { type: "open", spec: appSpec("arcade"), desk })
        s = windowsReducer(s, { type: "open", spec: appSpec("arcade", "barricade"), desk })
        s = windowsReducer(s, { type: "open", spec: appSpec("arcade", "space-invaders"), desk })
        expect(urlForWindows(s.wins)).toBe("/os/arcade/space-invaders?w=app.arcade,arcade.barricade")
        expect(targetsFromUrl("/os/arcade/space-invaders", "?w=app.arcade,arcade.barricade").others).toEqual([
            { kind: "app", app: "arcade", section: null },
            { kind: "app", app: "arcade", section: "barricade" },
        ])
        saveWindows(s.wins)
        expect(loadSavedTargets().map(({ target }) => target)).toEqual([
            { kind: "app", app: "arcade", section: null },
            { kind: "app", app: "arcade", section: "barricade" },
            { kind: "app", app: "arcade", section: "space-invaders" },
        ])
    })

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

    it("keeps a busy desk with more than twelve distinct windows on reload", () => {
        let s = EMPTY_WINDOWS
        for (let n = 1; n <= 14; n++) {
            s = windowsReducer(s, { type: "open", spec: specForTarget(parseOsPath(`/os/dao/memba_dao/proposals/${n}`))!, desk })
        }
        const url = new URL(urlForWindows(s.wins), "https://memba.club")
        expect(targetsFromUrl(url.pathname, url.search).others).toHaveLength(13)
        saveWindows(s.wins)
        expect(loadSavedTargets()).toHaveLength(14)
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
