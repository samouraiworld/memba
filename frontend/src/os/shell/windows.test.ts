import { describe, expect, it } from "vitest"
import { parseOsPath } from "./osPath"
import {
    appSpec, daoSpec, DOCK_ROOM, EMPTY_WINDOWS, frontWindow, specForTarget, urlForWindow, welcomeSpec, windowsReducer,
    type WindowsAction, type WindowsState,
} from "./windows"

const desk = { w: 1200, h: 760 }
const run = (...actions: WindowsAction[]) => actions.reduce<WindowsState>(windowsReducer, EMPTY_WINDOWS)
const open = (spec = appSpec("feed"), center = false): WindowsAction => ({ type: "open", spec, desk, center })
const byKey = (s: WindowsState, key: string) => s.wins.find((w) => w.key === key)!

describe("windowsReducer", () => {
    it("opens windows on top and refocuses an already-open key instead of duplicating it", () => {
        let s = run(open(welcomeSpec()), open(appSpec("feed")))
        expect(frontWindow(s.wins)?.key).toBe("app:feed")
        s = windowsReducer(s, open(welcomeSpec()))
        expect(s.wins).toHaveLength(2)
        expect(frontWindow(s.wins)?.key).toBe("welcome")
    })

    it("cascades new windows and centres on request, inside the desk and above the dock", () => {
        const s = run(open(appSpec("daos")), open(daoSpec("crew")), open(welcomeSpec(), true))
        const [a, b, c] = s.wins
        expect(b.x - a.x).toBe(34)
        expect(b.y - a.y).toBe(28)
        expect(c.x).toBe((desk.w - c.width) / 2)
        for (const w of s.wins) {
            expect(w.x).toBeGreaterThanOrEqual(0)
            expect(w.y + w.height).toBeLessThanOrEqual(desk.h - DOCK_ROOM)
        }
    })

    it("shrinks a window that doesn't fit a small desk", () => {
        const s = windowsReducer(EMPTY_WINDOWS, { type: "open", spec: appSpec("feed"), desk: { w: 360, h: 500 } })
        expect(s.wins[0].width).toBeLessThanOrEqual(360)
    })

    it("moves, but always keeps the title bar reachable", () => {
        let s = run(open())
        const id = s.wins[0].id
        s = windowsReducer(s, { type: "move", id, x: 300, y: 120, desk })
        expect(s.wins[0]).toMatchObject({ x: 300, y: 120 })
        s = windowsReducer(s, { type: "move", id, x: 5000, y: -50, desk })
        expect(s.wins[0].x).toBe(desk.w - 80)
        expect(s.wins[0].y).toBe(0)
        s = windowsReducer(s, { type: "move", id, x: -5000, y: 5000, desk })
        expect(s.wins[0].x).toBe(80 - s.wins[0].width)
        expect(s.wins[0].y).toBe(desk.h - 40)
    })

    it("resizes within a minimum and the desk", () => {
        let s = run(open())
        const id = s.wins[0].id
        s = windowsReducer(s, { type: "resize", id, width: 100, height: 100, desk })
        expect(s.wins[0]).toMatchObject({ width: 320, height: 220 })
        s = windowsReducer(s, { type: "resize", id, width: 9999, height: 9999, desk })
        expect(s.wins[0].x + s.wins[0].width).toBe(desk.w - 8)
    })

    it("minimises out of focus, and focusing restores", () => {
        let s = run(open(appSpec("wallet")), open(appSpec("feed")))
        const feed = byKey(s, "app:feed")
        s = windowsReducer(s, { type: "minimise", id: feed.id })
        expect(frontWindow(s.wins)?.key).toBe("app:wallet")
        s = windowsReducer(s, { type: "focus", id: feed.id })
        expect(byKey(s, "app:feed").min).toBe(false)
        expect(frontWindow(s.wins)?.key).toBe("app:feed")
    })

    it("reopening a minimised key restores it", () => {
        let s = run(open(appSpec("feed")))
        s = windowsReducer(s, { type: "minimise", id: s.wins[0].id })
        s = windowsReducer(s, open(appSpec("feed")))
        expect(s.wins[0].min).toBe(false)
    })

    it("toggles maximise, and a drag leaves maximised", () => {
        let s = run(open())
        const id = s.wins[0].id
        s = windowsReducer(s, { type: "toggleMax", id })
        expect(s.wins[0].max).toBe(true)
        s = windowsReducer(s, { type: "move", id, x: 40, y: 40, desk })
        expect(s.wins[0].max).toBe(false)
    })

    it("tiles the two front windows side by side", () => {
        let s = run(open(appSpec("wallet")), open(appSpec("feed")), open(appSpec("arcade")))
        s = windowsReducer(s, { type: "tile", desk })
        const arcade = byKey(s, "app:arcade")
        const feed = byKey(s, "app:feed")
        expect(arcade.x).toBe(8)
        expect(feed.x).toBe(8 + desk.w / 2)
        expect(arcade.width).toBe(desk.w / 2 - 16)
        expect(byKey(s, "app:wallet").width).toBe(420) // untouched: only the two front windows tile
    })

    it("cycles through visible windows with next", () => {
        let s = run(open(appSpec("wallet")), open(appSpec("feed")), open(appSpec("arcade")))
        const order = [0, 1, 2].map(() => {
            s = windowsReducer(s, { type: "next" })
            return frontWindow(s.wins)?.key
        })
        expect(order).toEqual(["app:wallet", "app:feed", "app:arcade"])
    })

    it("minimise all leaves no front window; close and close-all remove", () => {
        let s = run(open(appSpec("wallet")), open(appSpec("feed")))
        expect(frontWindow(windowsReducer(s, { type: "minimiseAll" }).wins)).toBeNull()
        s = windowsReducer(s, { type: "close", id: byKey(s, "app:feed").id })
        expect(s.wins.map((w) => w.key)).toEqual(["app:wallet"])
        expect(windowsReducer(s, { type: "closeAll" }).wins).toEqual([])
    })

    it("never reuses an id, including after a restore", () => {
        let s = run(open(welcomeSpec()))
        const first = s.wins[0].id
        s = windowsReducer(s, { type: "close", id: first })
        s = windowsReducer(s, open(welcomeSpec()))
        expect(s.wins[0].id).not.toBe(first)
        const restored = windowsReducer(EMPTY_WINDOWS, { type: "restore", wins: s.wins })
        const after = windowsReducer(restored, open(appSpec("feed")))
        expect(new Set(after.wins.map((w) => w.id)).size).toBe(2)
        expect(frontWindow(after.wins)?.key).toBe("app:feed")
    })
})

describe("navigation", () => {
    const specs = (...urls: string[]) => urls.map((u) => specForTarget(parseOsPath(u))!)

    it("a link opens its window on top of the others", () => {
        let s = run(open(appSpec("feed")))
        s = windowsReducer(s, { type: "navigate", specs: specs("/os/validators"), desk, exact: false })
        expect(s.wins.map((w) => w.key)).toEqual(["app:feed", "app:validators"])
        expect(frontWindow(s.wins)?.key).toBe("app:validators")
    })

    it("back/forward returns to exactly the URL's windows, keeping the ones that stay where they were", () => {
        let s = run(open(appSpec("feed")), open(appSpec("wallet")), open(appSpec("arcade")))
        const feed = byKey(s, "app:feed")
        s = windowsReducer(s, { type: "minimise", id: byKey(s, "app:arcade").id })
        s = windowsReducer(s, { type: "move", id: feed.id, x: 333, y: 99, desk })
        s = windowsReducer(s, { type: "navigate", specs: specs("/os/feed"), desk, exact: true })
        expect(s.wins.map((w) => w.key).sort()).toEqual(["app:arcade", "app:feed"])
        expect(byKey(s, "app:feed")).toMatchObject({ x: 333, y: 99 })
        expect(byKey(s, "app:arcade").min).toBe(true) // not in URLs, left alone
    })
})

describe("link windows", () => {
    it("titles a proposal link and round-trips its URL", () => {
        const spec = specForTarget(parseOsPath("/os/dao/memba_dao/proposals/12"))!
        expect(spec.title).toBe("memba_dao · Proposal #12")
        expect(urlForWindow(spec)).toBe("/os/dao/memba_dao/proposals/12")
    })

    it("round-trips app, DAO section and multisig URLs", () => {
        for (const url of ["/os/wallet", "/os/wallet/send", "/os/dev-report", "/os/dao/memba_dao", "/os/dao/memba_dao/treasury", "/os/multisig/g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l"]) {
            expect(urlForWindow(specForTarget(parseOsPath(url))!)).toBe(url)
        }
    })

    it("opens the Create DAO wizard in its own window, beside the DAOs app", () => {
        const spec = specForTarget(parseOsPath("/os/daos/new"))!
        expect(spec).toMatchObject({ key: "flow:dao", title: "Create a DAO", app: "daos" })
        expect(specForTarget(parseOsPath("/os/daos"))!.key).not.toBe(spec.key)
        expect(urlForWindow(spec)).toBe("/os/daos/new")
    })

    it("opens nothing for the bare desktop and a not-found window for a bad link", () => {
        expect(specForTarget(parseOsPath("/os"))).toBeNull()
        expect(specForTarget(parseOsPath("/os/nope"))?.key).toBe("notfound")
    })
})
