import { describe, expect, it } from "vitest"
import { parseOsPath } from "./osPath"
import { appSpec, frontWindow, specForTarget, urlForWindow, welcomeSpec, windowsReducer } from "./windows"

const empty = { top: 0, seq: 0, wins: [] }

describe("windowsReducer", () => {
    it("opens windows on top and focuses an already-open key instead of duplicating it", () => {
        let s = windowsReducer(empty, { type: "open", spec: welcomeSpec() })
        s = windowsReducer(s, { type: "open", spec: appSpec("feed") })
        expect(frontWindow(s.wins)?.key).toBe("app:feed")
        s = windowsReducer(s, { type: "open", spec: welcomeSpec() })
        expect(s.wins).toHaveLength(2)
        expect(frontWindow(s.wins)?.key).toBe("welcome")
    })

    it("focuses and closes by id", () => {
        let s = windowsReducer(empty, { type: "open", spec: welcomeSpec() })
        s = windowsReducer(s, { type: "open", spec: appSpec("feed") })
        const welcome = s.wins.find((w) => w.key === "welcome")!
        s = windowsReducer(s, { type: "focus", id: welcome.id })
        expect(frontWindow(s.wins)?.id).toBe(welcome.id)
        s = windowsReducer(s, { type: "close", id: welcome.id })
        expect(s.wins.map((w) => w.key)).toEqual(["app:feed"])
        expect(windowsReducer(s, { type: "closeAll" }).wins).toEqual([])
    })

    it("never reuses an id after a close", () => {
        let s = windowsReducer(empty, { type: "open", spec: welcomeSpec() })
        const first = s.wins[0].id
        s = windowsReducer(s, { type: "close", id: first })
        s = windowsReducer(s, { type: "open", spec: welcomeSpec() })
        expect(s.wins[0].id).not.toBe(first)
    })
})

describe("deep-link windows", () => {
    it("titles a proposal link and round-trips its URL", () => {
        const spec = specForTarget(parseOsPath("/os/dao/memba_dao/proposals/12"))!
        expect(spec.title).toBe("memba_dao · Proposal #12")
        expect(urlForWindow(spec)).toBe("/os/dao/memba_dao/proposals/12")
    })

    it("round-trips app, DAO section and multisig URLs", () => {
        for (const url of ["/os/wallet", "/os/dev-report", "/os/dao/memba_dao", "/os/dao/memba_dao/treasury", "/os/multisig/g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l"]) {
            expect(urlForWindow(specForTarget(parseOsPath(url))!)).toBe(url)
        }
    })

    it("opens nothing for the bare desktop and a not-found window for a bad link", () => {
        expect(specForTarget(parseOsPath("/os"))).toBeNull()
        expect(specForTarget(parseOsPath("/os/nope"))?.key).toBe("notfound")
    })
})
