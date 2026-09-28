import { beforeEach, describe, expect, it, vi } from "vitest"
import { storeReviewRequest, type StoreReviewDraft } from "./reviewRequest"

const mocks = vi.hoisted(() => ({
    available: vi.fn(() => true),
    allowed: vi.fn(() => true),
    fetchApp: vi.fn(),
    broadcast: vi.fn(),
}))

vi.mock("../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/config")>(),
    isAppReviewsAvailable: mocks.available,
    isRealmValidOn: mocks.allowed,
}))
vi.mock("../../../lib/appStore", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/appStore")>(),
    fetchApp: mocks.fetchApp,
}))
vi.mock("../../../lib/grc20", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/grc20")>(),
    doContractBroadcast: mocks.broadcast,
}))

const draft: StoreReviewDraft = {
    subject: "gno.land/r/samcrew/app",
    appName: "Test App",
    caller: `g1${"q".repeat(38)}`,
    rating: 4,
    body: "Useful app",
    realmPath: "gno.land/r/samcrew/memba_appstore_reviews_v1",
    networkKey: "mainnet",
    chainId: "gnoland-1",
}

beforeEach(() => {
    mocks.available.mockReset().mockReturnValue(true)
    mocks.allowed.mockReset().mockReturnValue(true)
    mocks.fetchApp.mockReset().mockResolvedValue({ status: "live" })
    mocks.broadcast.mockReset().mockResolvedValue({ hash: "review-hash" })
})

describe("native App Store review signing", () => {
    it("reviews the exact PostReview call and rechecks the live listing before Adena", async () => {
        const request = storeReviewRequest(draft)
        const msg = request.prepare(undefined).msgs[0]
        expect(msg).toEqual({
            type: "vm/MsgCall",
            value: { caller: draft.caller, send: "", pkg_path: draft.realmPath, func: "PostReview", args: [draft.subject, "4", "Useful app"] },
        })
        expect(request.lines(undefined)).toContainEqual(["Network", "gnoland-1"])
        await request.recheck?.(undefined)
        expect(mocks.fetchApp).toHaveBeenCalledWith(draft.subject)
        const beforeSign = vi.fn()
        await request.send(undefined, beforeSign)
        expect(mocks.broadcast).toHaveBeenCalledWith([msg], "Review app", { retry: false, beforeSign })
    })

    it("rejects an unpublished or delisted app before signing", async () => {
        const request = storeReviewRequest(draft)
        mocks.fetchApp.mockResolvedValue({ status: "delisted" })
        await expect(request.recheck?.(undefined)).rejects.toThrow(/no longer a live listing/)
        expect(mocks.broadcast).not.toHaveBeenCalled()
    })

    it("fails closed when the reviews realm is disabled or unavailable on this network", async () => {
        mocks.available.mockReturnValue(false)
        expect(() => storeReviewRequest(draft)).toThrow(/not available/)
        mocks.available.mockReturnValue(true)
        mocks.allowed.mockReturnValue(false)
        expect(() => storeReviewRequest(draft)).toThrow(/not available/)
    })

    it("enforces the realm's UTF-8 body limit and rating range", () => {
        expect(() => storeReviewRequest({ ...draft, rating: 0 })).toThrow(/Select a rating/)
        expect(() => storeReviewRequest({ ...draft, body: "é".repeat(1001) })).toThrow(/2,000 bytes/)
    })
})
