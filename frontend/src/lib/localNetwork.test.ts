import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { LOCAL_CHAIN_ID, LOCAL_GNOWEB_URL, LOCAL_NETWORK_KEY, LOCAL_RPC_URL, localNetworkEnabled, withLocalRpcInCsp } from "./localNetwork"

describe("the dev-only local network", () => {
    it("is gnodev's defaults", () => {
        expect(LOCAL_NETWORK_KEY).toBe("local")
        expect(LOCAL_CHAIN_ID).toBe("dev")
        expect(LOCAL_RPC_URL).toBe("http://localhost:26657")
        expect(LOCAL_GNOWEB_URL).toBe("http://localhost:8888")
    })

    it("is on only with the flag set to exactly \"true\", and never in unit tests", () => {
        expect(localNetworkEnabled("development", "true")).toBe(true)
        expect(localNetworkEnabled("test", "true")).toBe(false)
        expect(localNetworkEnabled("development", "TRUE")).toBe(false)
        expect(localNetworkEnabled("development", "1")).toBe(false)
        expect(localNetworkEnabled("development", "")).toBe(false)
        expect(localNetworkEnabled("development", undefined)).toBe(false)
    })
})

const indexHtml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../index.html"), "utf8")
/** The dev CSP's connect-src sources (the comment above the meta also says "connect-src"; this one starts with 'self'). */
const connectSrc = (html: string) => html.match(/connect-src\s+('self'[^;]*);/)?.[1].trim().split(/\s+/) ?? []

describe("withLocalRpcInCsp", () => {
    it("adds the local node to the dev CSP's connect-src and keeps every other source", () => {
        const before = connectSrc(indexHtml)
        expect(before.length).toBeGreaterThan(1)
        expect(before).not.toContain("http://localhost:26657")
        expect(connectSrc(withLocalRpcInCsp(indexHtml))).toEqual([...before, "http://localhost:26657"])
    })

    it("changes nothing else on the page, and nothing on a second pass", () => {
        const once = withLocalRpcInCsp(indexHtml)
        expect(once.replace(" http://localhost:26657", "")).toBe(indexHtml)
        expect(withLocalRpcInCsp(once)).toBe(once)
    })

    it("leaves a page without a CSP meta unchanged, even when its text mentions connect-src", () => {
        const page = "<!doctype html><!-- connect-src notes; here --><p>connect-src 'self' a;</p>"
        expect(withLocalRpcInCsp(page)).toBe(page)
    })
})
