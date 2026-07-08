import { describe, it, expect } from "vitest"
import {
    REVIEWS_PKG_PATH,
    buildPostReviewMsg,
    buildEditReviewMsg,
    buildReactMsg,
    buildCommentMsg,
    buildFlagMsg,
    buildDeleteReviewMsg,
} from "./reviews"

// B2a: the reviews engine is subject-agnostic and there is more than one deployed reviews realm
// (validator/profile web-of-trust + the reputation-isolated App Store reviews realm). The write
// builders (and reads) default to REVIEWS_PKG_PATH but accept an explicit `realm`, so a caller can
// target a different realm by path with no other change. These tests pin that contract so the
// existing validator/profile callers (which pass no realm) keep hitting REVIEWS_PKG_PATH.

const APP_REVIEWS = "gno.land/r/samcrew/memba_appstore_reviews_v1"

describe("reviews realm-path threading", () => {
    it("defaults to REVIEWS_PKG_PATH when no realm is passed (back-compat)", () => {
        expect(buildPostReviewMsg("g1caller", "subj", 5, "great").value.pkg_path).toBe(REVIEWS_PKG_PATH)
        expect(buildReactMsg("g1caller", 7, "like").value.pkg_path).toBe(REVIEWS_PKG_PATH)
        expect(buildFlagMsg("g1caller", 7).value.pkg_path).toBe(REVIEWS_PKG_PATH)
    })

    it("targets an explicit realm when one is passed", () => {
        const m = buildPostReviewMsg("g1caller", "gno.land/r/samcrew/block_party", 5, "great", APP_REVIEWS)
        expect(m.value.pkg_path).toBe(APP_REVIEWS)
        // only the realm changes — func/args/caller are untouched
        expect(m.value.func).toBe("PostReview")
        expect(m.value.args).toEqual(["gno.land/r/samcrew/block_party", "5", "great"])
        expect(m.value.caller).toBe("g1caller")
        expect(m.value.send).toBe("")
    })

    it("threads the realm through every builder", () => {
        expect(buildEditReviewMsg("g1c", 1, 4, "b", APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildReactMsg("g1c", 1, "dislike", APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildCommentMsg("g1c", 1, "nice", APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildFlagMsg("g1c", 1, APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
        expect(buildDeleteReviewMsg("g1c", 1, APP_REVIEWS).value.pkg_path).toBe(APP_REVIEWS)
    })
})
