import { describe, it, expect } from "vitest"
import { buildShareCardModel, drawFeedShareCard, type ShareCardPost } from "./feedShareCard"

const live: ShareCardPost = {
    author: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c",
    body: "Gno-native multisig is finally usable. Here's why it matters for DAOs.",
    replyCount: 3,
}

/** A minimal 2D-context stand-in that records every fillText string. jsdom has no
 *  canvas, so the draw path is verified against this spy rather than real pixels. */
function mockCtx() {
    const texts: string[] = []
    const rects: Array<[number, number, number, number]> = []
    return {
        canvas: { width: 1200, height: 630 },
        // settable style props the drawer touches
        font: "",
        fillStyle: "",
        textAlign: "" as CanvasTextAlign,
        textBaseline: "" as CanvasTextBaseline,
        save() {},
        restore() {},
        fillRect(x: number, y: number, w: number, h: number) {
            rects.push([x, y, w, h])
        },
        fillText(t: string) {
            texts.push(t)
        },
        measureText(t: string) {
            return { width: t.length * 12 }
        },
        beginPath() {},
        roundRect() {},
        rect() {},
        fill() {},
        clip() {},
        _texts: texts,
        _rects: rects,
    }
}

describe("buildShareCardModel", () => {
    it("carries the body + abbreviated handle + url for a live post", () => {
        const m = buildShareCardModel(live, "https://memba.samourai.app/feed/post/9")
        expect(m.tomb).toBe(false)
        expect(m.handle).toBe("g1747t…kx59c")
        expect(m.bodyText).toContain("Gno-native multisig")
        expect(m.url).toBe("memba.samourai.app/feed/post/9") // protocol stripped for display
    })

    it("(P0) suppresses the body for a hidden or deleted post", () => {
        for (const bad of [
            { ...live, hidden: true },
            { ...live, deleted: true },
        ]) {
            const m = buildShareCardModel(bad, "https://memba.samourai.app/feed/post/9")
            expect(m.tomb).toBe(true)
            expect(m.bodyText).not.toContain("multisig")
            expect(m.bodyText.toLowerCase()).toContain("no longer available")
        }
    })
})

describe("drawFeedShareCard", () => {
    it("paints the Memba wordmark, the handle and the body for a live post", () => {
        const ctx = mockCtx()
        drawFeedShareCard(ctx as unknown as CanvasRenderingContext2D, buildShareCardModel(live, "https://memba.samourai.app/feed/post/9"))
        const joined = ctx._texts.join(" ")
        expect(joined).toContain("MEMBA")
        expect(joined).toContain("g1747t…kx59c")
        expect(joined).toContain("multisig")
        expect(ctx._rects.length).toBeGreaterThan(0) // paper + accent bar painted
    })

    it("(P0) never paints a tombstoned body onto the canvas", () => {
        const ctx = mockCtx()
        const secret = "SECRET-do-not-render"
        drawFeedShareCard(
            ctx as unknown as CanvasRenderingContext2D,
            buildShareCardModel({ ...live, body: secret, hidden: true }, "https://memba.samourai.app/feed/post/9"),
        )
        const joined = ctx._texts.join(" ")
        expect(joined).not.toContain("SECRET")
        expect(joined.toLowerCase()).toContain("no longer available")
    })

    it("wraps and clamps a very long body to a bounded number of lines", () => {
        const ctx = mockCtx()
        const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ")
        drawFeedShareCard(ctx as unknown as CanvasRenderingContext2D, buildShareCardModel({ ...live, body: long }, "https://memba.samourai.app/feed/post/9"))
        // body lines are bounded; the last one ellipsizes rather than overflowing.
        const bodyLines = ctx._texts.filter((t) => t.startsWith("word") || t.includes("…"))
        expect(bodyLines.length).toBeLessThanOrEqual(7)
        expect(ctx._texts.some((t) => t.endsWith("…"))).toBe(true)
    })
})
