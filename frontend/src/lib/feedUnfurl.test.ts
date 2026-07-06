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

    it("detects a Memba app token link as a live token ref", () => {
        const u = parseUnfurls("holding https://app.memba.world/test13/tokens/MEMBA")
        expect(u).toEqual([
            { kind: "token", symbol: "MEMBA", href: "https://app.memba.world/test13/tokens/MEMBA" },
        ])
    })

    it("only treats a network-scoped /tokens/ path as a token (not arbitrary sites)", () => {
        const u = parseUnfurls("see https://example.com/foo/tokens/BAR")
        expect(u).toEqual([{ kind: "link", url: "https://example.com/foo/tokens/BAR", host: "example.com" }])
    })

    it("ignores a token path with a non-network first segment", () => {
        const u = parseUnfurls("https://app.memba.world/en/tokens/NEWS")
        expect(u).toEqual([{ kind: "link", url: "https://app.memba.world/en/tokens/NEWS", host: "app.memba.world" }])
    })

    it("detects a Memba app validator link as a validator ref", () => {
        const addr = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
        const u = parseUnfurls(`gm to ${`https://app.memba.world/test13/validators/${addr}`}`)
        expect(u).toEqual([
            { kind: "validator", address: addr, href: `https://app.memba.world/test13/validators/${addr}` },
        ])
    })

    it("does not treat /validators/hacker or /validators/valoper/<op> as a validator ref", () => {
        expect(parseUnfurls("https://app.memba.world/test13/validators/hacker")).toEqual([
            { kind: "link", url: "https://app.memba.world/test13/validators/hacker", host: "app.memba.world" },
        ])
        // A 4-segment valoper subpath is not the canonical /validators/<addr> shape.
        expect(parseUnfurls("https://app.memba.world/test13/validators/valoper/g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"))
            .toEqual([{ kind: "link", url: "https://app.memba.world/test13/validators/valoper/g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", host: "app.memba.world" }])
    })
})
