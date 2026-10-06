import { afterEach, describe, expect, it, vi } from "vitest"
import type { Token } from "../gen/memba/v1/memba_pb"

const token = { userAddress: "g1owner" } as unknown as Token

async function load(clientId: string) {
    vi.resetModules()
    vi.stubEnv("VITE_GITHUB_CLIENT_ID", clientId)
    return import("./githubLink")
}

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    sessionStorage.clear()
})

describe("githubLink", () => {
    it("is available only with the OAuth app's client id", async () => {
        expect((await load("")).githubLinkAvailable()).toBe(false)
        expect((await load("Ov23test")).githubLinkAvailable()).toBe(true)
    })

    it("asks the backend for a session-bound state and sends the browser to GitHub with it", async () => {
        const { startGithubLink } = await load("Ov23test")
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ state: "s/1" }), { status: 200 }))
        vi.stubGlobal("fetch", fetchMock)
        const go = vi.fn()
        await startGithubLink(token, "g1owner", go)
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/github\/oauth\/state$/)
        expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toHaveProperty("Authorization")
        const url = new URL(go.mock.calls[0][0])
        expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize")
        expect(url.searchParams.get("client_id")).toBe("Ov23test")
        expect(url.searchParams.get("state")).toBe("s/1")
        expect(url.searchParams.get("redirect_uri")).toBe(`${window.location.origin}/github/callback`)
        expect(url.searchParams.get("scope")).toBe("read:user")
        expect(sessionStorage.getItem("returnToProfile")).toBe("g1owner")
    })

    it("stays here when the backend issues no state", async () => {
        const { startGithubLink } = await load("Ov23test")
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not signed in" }), { status: 401 })))
        const go = vi.fn()
        await expect(startGithubLink(token, "g1owner", go)).rejects.toThrow("not signed in")
        expect(go).not.toHaveBeenCalled()
        expect(sessionStorage.getItem("returnToProfile")).toBeNull()
    })
})
