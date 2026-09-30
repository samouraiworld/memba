import { describe, expect, it, vi } from "vitest"
vi.mock("./profileData", async (original) => ({ ...(await original<typeof import("./profileData")>()), readProfileOnChain: vi.fn() }))
vi.mock("../../lib/grc20", async (original) => ({ ...(await original<typeof import("../../lib/grc20")>()), freshFeeForGasWanted: vi.fn(), doContractBroadcast: vi.fn() }))
import { doContractBroadcast, FALLBACK_GAS_PRICE, freshFeeForGasWanted } from "../../lib/grc20"
import { defaultProfileDocument, readProfileOnChain, type ProfileChainRead } from "./profileData"
import { canPublishProfileDocument, draftFromChain, profileChanges, profileMessages, profilePublishRequest } from "./profilePublish"

const ADDRESS = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const base: ProfileChainRead = {
    core: { displayName: "Alice", bio: "Hi", avatar: null, homepage: null, location: null },
    document: defaultProfileDocument(), documentPresent: false, documentProblem: false, missingCore: [],
}

describe("profile publication", () => {
    it("builds calls only for edited fields, owned by the wallet", () => {
        const draft = draftFromChain(base)
        draft.core.bio = "Hello Gno"
        const changes = profileChanges(base, draft)
        expect(changes).toEqual([{ field: "Bio", before: "Hi", after: "Hello Gno", created: false }])
        expect(profileMessages(ADDRESS, changes)).toEqual([{
            type: "vm/MsgCall",
            value: { caller: ADDRESS, send: "", pkg_path: expect.any(String), func: "SetStringField", args: ["Bio", "Hello Gno"], max_deposit: "20000ugnot" },
        }])
    })

    it("caps the deposit of a field written for the first time at twice its storage", () => {
        const draft = draftFromChain(base)
        draft.core.location = "Paris"
        const [msg] = profileMessages(ADDRESS, profileChanges(base, draft))
        expect(msg.value).toMatchObject({ args: ["Location", "Paris"], max_deposit: "450000ugnot" })
    })

    it("rejects unsafe URLs and oversize values before a review opens", () => {
        const draft = draftFromChain(base)
        draft.core.homepage = "javascript:alert(1)"
        expect(() => profileChanges(base, draft)).toThrow("homepage must be")
        draft.core.homepage = ""
        draft.core.bio = "x".repeat(501)
        expect(() => profileChanges(base, draft)).toThrow("bio is too long")
    })

    it("publishes title, company, links and layout in the versioned public field on mainnet", () => {
        const draft = draftFromChain(base)
        draft.document.title = "Designer"
        draft.document.company = "Cooperative"
        draft.document.links = [{ label: "Work", url: "https://example.org/" }]
        if (!canPublishProfileDocument) {
            expect(() => profileChanges(base, draft)).toThrow("does not support")
            return
        }
        const changes = profileChanges(base, draft)
        expect(changes).toHaveLength(1)
        expect(changes[0].field).toBe("memba.profile.v1")
        expect(JSON.parse(changes[0].after)).toMatchObject({
            version: 1, title: "Designer", company: "Cooperative",
            links: [{ label: "Work", url: "https://example.org/" }],
        })
        expect(profileMessages(ADDRESS, changes)[0].value.args).toEqual(["memba.profile.v1", changes[0].after])
    })

    it("stops if the published field changed since editing", async () => {
        const draft = draftFromChain(base)
        draft.core.bio = "New bio"
        const request = profilePublishRequest(ADDRESS, base, draft, FALLBACK_GAS_PRICE, vi.fn())
        vi.mocked(readProfileOnChain).mockResolvedValueOnce({ ...base, core: { ...base.core, bio: "Other edit" } })
        await expect(request.recheck?.(undefined)).rejects.toThrow("changed")
        vi.mocked(readProfileOnChain).mockResolvedValueOnce({ ...base, core: { ...base.core, bio: "New bio" } })
        await expect(request.verify?.(undefined, "hash", null)).resolves.toBe(true)
        expect(request.prepare(undefined).msgs).toHaveLength(1)
        expect(request.acks).toHaveLength(1)
        expect(request.lines(undefined)).toContainEqual(["Bio", "New bio"])
    })

    it("states the deposit and fee, and sends exactly that gas limit and fee", async () => {
        const draft = draftFromChain(base)
        draft.core.bio = "New bio"
        draft.core.location = "Paris"
        const request = profilePublishRequest(ADDRESS, base, draft, FALLBACK_GAS_PRICE, vi.fn())
        expect(request.lines(undefined)).toContainEqual(["Storage deposit", "≈ 0.2274 GNOT (cap 0.47 GNOT)"])
        expect(request.lines(undefined)).toContainEqual(["Network fee", "0.0192 GNOT"])
        expect(request.note).toContain("stays locked for good")
        vi.mocked(doContractBroadcast).mockResolvedValueOnce({ hash: "hash" })
        const beforeSign = vi.fn()
        await request.send(undefined, beforeSign)
        expect(doContractBroadcast).toHaveBeenCalledWith(request.prepare(undefined).msgs, "Memba profile", { gasWanted: 16_000_000, gasFee: 19_200, retry: false, beforeSign })
    })

    it("stops before the wallet when the reviewed fee no longer covers the network price", async () => {
        const draft = draftFromChain(base)
        draft.core.bio = "New bio"
        const request = profilePublishRequest(ADDRESS, base, draft, FALLBACK_GAS_PRICE, vi.fn())
        vi.mocked(readProfileOnChain).mockResolvedValue(base)
        vi.mocked(freshFeeForGasWanted).mockImplementationOnce(async (gas) => Math.ceil(gas * 1.2 * 2 / 1000))
        await expect(request.recheck?.(undefined)).rejects.toThrow("fee increased")
        vi.mocked(freshFeeForGasWanted).mockImplementationOnce(async (gas) => Math.ceil(gas * 1.2 / 1000))
        await expect(request.recheck?.(undefined)).resolves.toBeUndefined()
    })
})
