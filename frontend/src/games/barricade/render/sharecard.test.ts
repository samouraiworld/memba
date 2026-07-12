import { describe, expect, it } from "vitest"
import { buildShareText } from "./sharecard"

describe("buildShareText", () => {
    it("a win → every wave cleared, with verdict + formatted score", () => {
        const t = buildShareText({ score: 48200, won: true, waves: 8, total: 8, date: "2026-07-12" })
        expect(t).toContain("MEMBA: BARRICADE — 2026-07-12")
        expect(t).toContain("THE LINE HELD · 48,200 · wave 8/8")
        expect(t.split("\n")[2]).toBe("🟩🟩🟩🟩🟩🟩🟩🟩")
        expect(t).not.toContain("🟥")
    })

    it("a loss at wave 5 → cleared, the fall, then unreached", () => {
        const t = buildShareText({ score: 21200, won: false, waves: 5, total: 8, date: "2026-07-12" })
        expect(t).toContain("THE LINE FELL · 21,200 · wave 5/8")
        expect(t.split("\n")[2]).toBe("🟩🟩🟩🟩🟥⬛⬛⬛")
    })

    it("appends a url only when provided", () => {
        expect(buildShareText({ score: 1, won: false, waves: 1, total: 8, date: "d" })).not.toMatch(/https?:/)
        const withUrl = buildShareText({ score: 1, won: false, waves: 1, total: 8, date: "d", url: "https://memba.example" })
        expect(withUrl.endsWith("https://memba.example")).toBe(true)
    })

    it("stays spoiler-free — no seed, enemy, or lane details", () => {
        const t = buildShareText({ score: 100, won: false, waves: 3, total: 8, date: "2026-07-12" }).toLowerCase()
        expect(t).not.toMatch(/drone|walker|phalanx|netter|siege|broadcast|seed|lane/)
    })
})
