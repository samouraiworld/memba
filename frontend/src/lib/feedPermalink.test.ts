import { describe, it, expect } from "vitest"
import { feedPostPermalink } from "./feedPermalink"

describe("feedPostPermalink", () => {
    it("carries the network prefix from the current path", () => {
        expect(
            feedPostPermalink(42n, { origin: "https://memba.samourai.app", pathname: "/test13/feed" }),
        ).toBe("https://memba.samourai.app/test13/feed/post/42")
    })

    it("works from a thread page (deeper path)", () => {
        expect(
            feedPostPermalink(7n, { origin: "https://memba.samourai.app", pathname: "/gnoland1/feed/post/7" }),
        ).toBe("https://memba.samourai.app/gnoland1/feed/post/7")
    })

    it("degrades to an un-prefixed link when no network segment is present", () => {
        expect(feedPostPermalink(1n, { origin: "https://x.io", pathname: "/" })).toBe("https://x.io/feed/post/1")
    })
})
