import { describe, it, expect } from "vitest"
import { parseUnfurls } from "./feedUnfurl"

describe("parseUnfurls", () => {
    it("finds a bare gno.land realm path (r/namespace/realm)", () => {
        const u = parseUnfurls("check out r/samcrew/memba_feed_v1 today")
        expect(u).toEqual([{ kind: "realm", path: "r/samcrew/memba_feed_v1", href: "https://gno.land/r/samcrew/memba_feed_v1" }])
    })

    it("classifies a gno.land realm URL as a realm, not a generic link", () => {
        const u = parseUnfurls("see https://gno.land/r/gnoland/blog")
        expect(u).toEqual([{ kind: "realm", path: "r/gnoland/blog", href: "https://gno.land/r/gnoland/blog" }])
    })

    it("recognises pure-package paths too (p/...)", () => {
        const u = parseUnfurls("uses gno.land/p/demo/avl")
        expect(u[0]).toMatchObject({ kind: "realm", path: "p/demo/avl" })
    })

    it("treats other URLs as external links with their host", () => {
        const u = parseUnfurls("blog at https://example.com/a/b?x=1")
        expect(u).toEqual([{ kind: "link", url: "https://example.com/a/b?x=1", host: "example.com" }])
    })

    it("returns nothing for a plain post", () => {
        expect(parseUnfurls("just a normal thought, no links")).toEqual([])
    })

    it("dedupes repeated references", () => {
        const u = parseUnfurls("r/samcrew/x and again r/samcrew/x")
        expect(u).toHaveLength(1)
    })

    it("caps the number of unfurls (anti-spam)", () => {
        const body = "r/a/b r/c/d r/e/f r/g/h r/i/j"
        expect(parseUnfurls(body).length).toBeLessThanOrEqual(3)
    })

    it("does not misfire on words containing r/ mid-token", () => {
        expect(parseUnfurls("interior/design is nice")).toEqual([])
    })
})
