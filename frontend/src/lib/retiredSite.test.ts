// @vitest-environment node
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { osUrlForClassic } from "../os/page/classicRoute"
import { NEW_ORIGIN, RETIRED_HOSTS } from "./retiredSite"
import { SITEMAP_NETWORK, SITEMAP_PATHS } from "./sitemap"

const toml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../netlify.toml"), "utf8")

/** The [[redirects]] blocks, in file order. */
const redirects = toml.split(/^\[\[redirects\]\]$/m).slice(1).map((block) => {
    const field = (name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, "m").exec(block.split(/^\[/m)[0])?.[1]
    return { from: JSON.parse(field("from") ?? '""') as string, to: JSON.parse(field("to") ?? '""') as string, status: Number(field("status")), force: field("force") === "true" }
})
const hostOf = (from: string) => /^https:\/\/([^/]+)/.exec(from)?.[1] ?? null
const hostRules = redirects.filter((r) => hostOf(r.from))
const hosts = [...new Set(hostRules.map((r) => hostOf(r.from)!))]

describe("the classic site's redirects (netlify.toml)", () => {
    it("match the retired hosts only, above every other rule, all forced", () => {
        expect(hosts.length).toBeGreaterThan(0)
        for (const host of hosts) expect(RETIRED_HOSTS.has(host), host).toBe(true)
        const firstPlain = redirects.findIndex((r) => !hostOf(r.from))
        expect(redirects.slice(0, firstPlain).every((r) => hostOf(r.from))).toBe(true)
        expect(redirects.slice(firstPlain).some((r) => hostOf(r.from))).toBe(false)
        for (const r of hostRules) expect(r.force, r.from).toBe(true)
    })

    for (const host of hosts) {
        const rules = hostRules.filter((r) => hostOf(r.from) === host)
        const target = (path: string) => rules.find((r) => r.from === `https://${host}${path}`)

        it(`${host}: serves the service-worker kill switch at /sw.js`, () => {
            expect(target("/sw.js")).toMatchObject({ to: "/sw-retire.js", status: 200 })
        })

        it(`${host}: sends every sitemap page straight to its Memba OS window`, () => {
            expect(target("/")).toMatchObject({ to: `${NEW_ORIGIN}/os`, status: 302 })
            for (const path of SITEMAP_PATHS) {
                const from = `/${SITEMAP_NETWORK}${path === "/" ? "/" : path}`
                expect(target(from), from).toMatchObject({ to: NEW_ORIGIN + osUrlForClassic(from, SITEMAP_NETWORK), status: 302 })
            }
            expect(target(`/${SITEMAP_NETWORK}/blog/:slug`)).toMatchObject({ to: `${NEW_ORIGIN}${osUrlForClassic(`/${SITEMAP_NETWORK}/blog/x`, SITEMAP_NETWORK)!.replace(/x$/, ":slug")}`, status: 302 })
        })

        it(`${host}: sends everything else to the same path on memba.club, last`, () => {
            expect(rules.at(-1)).toMatchObject({ from: `https://${host}/*`, to: `${NEW_ORIGIN}/:splat`, status: 302 })
            expect(rules.filter((r) => r.from.endsWith("/*"))).toHaveLength(1)
        })
    }
})
