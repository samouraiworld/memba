import { describe, it, expect, vi, beforeEach } from "vitest"

// The reviews reads go through queryEval(rpcUrl, pkgPath, expr). Stub it so the read-side
// tests can assert which realm (pkgPath) each fetch* targets, without touching the network.
vi.mock("./dao/shared", () => ({
    queryEval: vi.fn(async () => `("[]" string)`),
}))

import { queryEval } from "./dao/shared"
import {
    REVIEWS_PKG_PATH,
    fetchReviews,
    fetchComments,
    fetchSummary,
    fetchReputation,
    buildPostReviewMsg,
    buildEditReviewMsg,
    buildDeleteReviewMsg,
    buildReactMsg,
    buildCommentMsg,
    buildEditCommentMsg,
    buildDeleteCommentMsg,
    buildFlagMsg,
    buildHideReviewMsg,
    buildHideCommentMsg,
    buildUnhideMsg,
} from "./reviews"

// B2a: the reviews engine is subject-agnostic and there is more than one deployed reviews realm
// (validator/profile web-of-trust + the reputation-isolated App Store reviews realm). Every read
// and write builder defaults to REVIEWS_PKG_PATH but accepts an explicit `realmPath`, so a caller
// can target a different realm by path with no other change. These tests pin that contract so the
// existing validator/profile callers (which pass no realmPath) keep hitting REVIEWS_PKG_PATH, and
// so an App Store caller can reach the app-reviews realm.

const APP_REVIEWS = "gno.land/r/samcrew/memba_appstore_reviews_v1"
const mockedQueryEval = vi.mocked(queryEval)

describe("reviews realm-path threading — write builders", () => {
    it("defaults to REVIEWS_PKG_PATH when no realmPath is passed (back-compat)", () => {
        expect(buildPostReviewMsg("g1caller", "subj", 5, "great").value.pkg_path).toBe(REVIEWS_PKG_PATH)
        expect(buildReactMsg("g1caller", 7, "like").value.pkg_path).toBe(REVIEWS_PKG_PATH)
        expect(buildFlagMsg("g1caller", 7).value.pkg_path).toBe(REVIEWS_PKG_PATH)
    })

    it("targets an explicit realm when one is passed, leaving func/args/caller/send untouched", () => {
        const m = buildPostReviewMsg("g1caller", "gno.land/r/samcrew/block_party", 5, "great", APP_REVIEWS)
        expect(m.value.pkg_path).toBe(APP_REVIEWS)
        expect(m.value.func).toBe("PostReview")
        expect(m.value.args).toEqual(["gno.land/r/samcrew/block_party", "5", "great"])
        expect(m.value.caller).toBe("g1caller")
        expect(m.value.send).toBe("")
    })

    it("threads the realmPath through every write builder (all 11)", () => {
        expect(buildPostReviewMsg("g1c", "s", 5, "b", APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildEditReviewMsg("g1c", 1, 4, "b", APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildDeleteReviewMsg("g1c", 1, APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildReactMsg("g1c", 1, "dislike", APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildCommentMsg("g1c", 1, "nice", APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildEditCommentMsg("g1c", 1, "nice", APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildDeleteCommentMsg("g1c", 1, APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildFlagMsg("g1c", 1, APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildHideReviewMsg("g1c", 1, APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildHideCommentMsg("g1c", 1, APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildUnhideMsg("g1c", 1, APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
    })
})

describe("reviews realm-path threading — reads", () => {
    beforeEach(() => mockedQueryEval.mockClear())

    // queryEval(rpcUrl, pkgPath, expr) — the 2nd positional arg is the realm the read hits.
    const realmOf = () => mockedQueryEval.mock.calls[0][1]

    it("fetchReviews defaults to REVIEWS_PKG_PATH and honors an explicit realmPath", async () => {
        await fetchReviews("subj")
        expect(realmOf()).toBe(REVIEWS_PKG_PATH)
        mockedQueryEval.mockClear()
        await fetchReviews("subj", 0, 20, APP_REVIEWS)
        expect(realmOf()).toBe(APP_REVIEWS)
    })

    it("fetchComments honors an explicit realmPath", async () => {
        await fetchComments(1, 0, 50, APP_REVIEWS)
        expect(realmOf()).toBe(APP_REVIEWS)
    })

    it("fetchSummary honors an explicit realmPath", async () => {
        await fetchSummary("subj", APP_REVIEWS)
        expect(realmOf()).toBe(APP_REVIEWS)
    })

    it("fetchReputation honors an explicit realmPath", async () => {
        await fetchReputation("g1addr", APP_REVIEWS)
        expect(realmOf()).toBe(APP_REVIEWS)
    })
})
