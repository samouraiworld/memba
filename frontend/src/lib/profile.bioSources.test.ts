import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getProfile: vi.fn() }))
vi.mock("./api", () => ({ api: { getProfile: mocks.getProfile } }))
vi.mock("./dao/shared", async (original) => ({ ...(await original<typeof import("./dao/shared")>()), resolveRegisteredUsername: async () => "" }))

import { fetchBackendProfile, fetchUserProfile } from "./profile"

const ADDRESS = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const API = "https://gnolove.example"
/** Gnolove's answer to /users/<address>; the package and vote lists answer empty. */
function gnolove(user: () => Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/users/") ? user() : new Response("[]")))
}

describe("fetchUserProfile: whether an earlier bio is known", () => {
    beforeEach(() => { mocks.getProfile.mockReset().mockResolvedValue({ profile: { bio: "", company: "", title: "", avatarUrl: "", twitter: "", github: "", website: "" } }) })
    afterEach(() => vi.unstubAllGlobals())

    it("is known when both the backend and Gnolove answered, with a bio or without", async () => {
        gnolove(async () => new Response(JSON.stringify({ login: "alice", bio: "GitHub bio" })))
        expect(await fetchUserProfile(API, ADDRESS)).toMatchObject({ githubBio: "GitHub bio", bioSourcesRead: true })
        // Gnolove answers an address it does not know with status 500 and this text.
        gnolove(async () => new Response("record not found\n", { status: 500 }))
        expect(await fetchUserProfile(API, ADDRESS)).toMatchObject({ githubBio: "", bio: "", bioSourcesRead: true })
    })

    it("is not known when either source did not answer, and the rest of the profile still loads", async () => {
        gnolove(async () => new Response("bad gateway", { status: 502 }))
        expect(await fetchUserProfile(API, ADDRESS)).toMatchObject({ address: ADDRESS, bioSourcesRead: false })
        gnolove(async () => { throw new Error("offline") })
        expect((await fetchUserProfile(API, ADDRESS)).bioSourcesRead).toBe(false)
        gnolove(async () => new Response("record not found", { status: 500 }))
        mocks.getProfile.mockRejectedValue(new Error("offline"))
        expect((await fetchUserProfile(API, ADDRESS)).bioSourcesRead).toBe(false)
        // The exported reader keeps answering null for a backend that is down.
        expect(await fetchBackendProfile(ADDRESS)).toBeNull()
    })
})
