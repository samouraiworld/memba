/**
 * Every in-app route lives under /:network. A bare `to="/validators"`,
 * `href={`/u/${name}`}` or an HTML-string `<a href="/profile/…">` falls through
 * NetworkGate to LegacyRedirect, which costs a redirect hop and swaps the
 * network the user is on for the stored/default one. Links must be built with
 * useNetworkPath()/useNetworkNav() (or currentNetworkKey() outside React).
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"

const src = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Static files served at the site root, not app routes. */
const ROOT_ASSETS = new Set(["/blog.rss"])

/** Tags whose to/href is used verbatim. Wrappers such as SidebarLink add the
 *  network prefix themselves and are not listed. */
const RAW_TAGS = new Set(["Link", "NavLink", "a"])

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) return name === "gen" ? [] : sourceFiles(p)
        return /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.endsWith(".d.ts") ? [p] : []
    })
}

/** Bare app-route links in one file's source, as "line: /path" strings. */
export function bareLinks(text: string): string[] {
    const out: string[] = []
    // to="/x", href="/x", to={"/x"}, href={`/x/${y}`} — the value may sit on a
    // later line than the tag name, and props before it may contain "=>".
    for (const m of text.matchAll(/\b(?:to|href)=\{?\s*["'`](\/[a-z][^"'`$]*)/g)) {
        if (ROOT_ASSETS.has(m[1])) continue
        // Skip comment lines (e.g. docs quoting gnoweb's own HTML).
        const lineStart = text.lastIndexOf("\n", m.index) + 1
        if (/^\s*(\*|\/\/)/.test(text.slice(lineStart, m.index))) continue
        const tagStart = text.lastIndexOf("<", m.index)
        const tag = /^<([A-Za-z][\w.]*)/.exec(text.slice(tagStart))?.[1]
        if (!tag || !RAW_TAGS.has(tag)) continue
        out.push(`${text.slice(0, m.index).split("\n").length}: ${m[1]}`)
    }
    return out
}

describe("network-prefixed links", () => {
    it("detects every bare-link shape it is meant to catch", () => {
        expect(bareLinks('<Link to="/validators">x</Link>')).toEqual(["1: /validators"])
        expect(bareLinks("<Link to={`/profile/${a}`}>x</Link>")).toEqual(["1: /profile/"])
        expect(bareLinks('<Link to={"/x"}>x</Link>')).toEqual(["1: /x"])
        expect(bareLinks("<a\n  onMouseEnter={e => go(e)}\n  href={`/u/${n}`}\n>x</a>")).toEqual(["3: /u/"])
        expect(bareLinks('`<a href="/profile/${addr}" class="md">`')).toEqual(["1: /profile/"])
        // Not bare / not raw tags:
        expect(bareLinks("<Link to={np(`profile/${a}`)}>x</Link>")).toEqual([])
        expect(bareLinks("<a href={`/${network}/profile/${a}`}>x</a>")).toEqual([])
        expect(bareLinks('<SidebarLink to="/quest-admin" />')).toEqual([])
        expect(bareLinks('<a href="/blog.rss">rss</a>')).toEqual([])
        expect(bareLinks(' *   <a href="/r/samcrew/memba_dao">doc example</a>')).toEqual([])
    })

    it("no source file links to an app route without the /:network prefix", () => {
        const offenders = sourceFiles(src).flatMap(file =>
            bareLinks(readFileSync(file, "utf8")).map(hit => `${relative(src, file)}:${hit}`),
        )
        expect(offenders).toEqual([])
    })
})
