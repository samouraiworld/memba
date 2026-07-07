import { describe, it, expect } from "vitest"
import { toExplorerRelPath, explorerHref } from "./explorerLink"

describe("toExplorerRelPath", () => {
    it("reduces a gno.land path to the bare pkgpath", () => {
        expect(toExplorerRelPath("gno.land/r/samcrew/memba_feed_v1")).toBe("r/samcrew/memba_feed_v1")
        expect(toExplorerRelPath("/r/x/y")).toBe("r/x/y")
        expect(toExplorerRelPath("r/x/y")).toBe("r/x/y")
        expect(toExplorerRelPath("p/demo/avl/")).toBe("p/demo/avl")
    })
    it("strips protocol/host and render/help/query suffixes", () => {
        expect(toExplorerRelPath("https://test13.testnets.gno.land/r/x/y")).toBe("r/x/y")
        expect(toExplorerRelPath("gno.land/r/x/y:render/sub")).toBe("r/x/y")
        expect(toExplorerRelPath("gno.land/r/x/y$help")).toBe("r/x/y")
        expect(toExplorerRelPath("gno.land/r/x/y?a=b")).toBe("r/x/y")
    })
    it("returns '' for empty/unusable input", () => {
        expect(toExplorerRelPath("")).toBe("")
        expect(toExplorerRelPath("gno.land/")).toBe("")
    })
})

describe("explorerHref", () => {
    it("builds the network-prefixed explorer route", () => {
        expect(explorerHref("test13", "gno.land/r/x/y")).toBe("/test13/explorer/r/x/y")
        expect(explorerHref("test13", "gno.land/r/samcrew/memba_feed_v1")).toBe(
            "/test13/explorer/r/samcrew/memba_feed_v1",
        )
    })
    it("returns '' when the realm path is unusable (caller renders nothing)", () => {
        expect(explorerHref("test13", "")).toBe("")
        expect(explorerHref("test13", "gno.land/")).toBe("")
    })
})
