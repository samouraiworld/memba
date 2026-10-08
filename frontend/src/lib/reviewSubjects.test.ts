import { describe, expect, it } from "vitest"
import { ECOSYSTEM_PROJECTS } from "./ecosystemDirectory"
import { GAME_REVIEW_SUBJECTS, isCuratedReviewSubject, projectReviewSubject } from "./reviewSubjects"

// These strings are stored on-chain with every review. Changing one orphans its reviews:
// a new project gets a new line here, an existing line never changes.
describe("review subjects are permanent", () => {
    it("pins every game subject", () => {
        expect(GAME_REVIEW_SUBJECTS).toEqual({
            "block-party": "gno.land/r/samcrew/block_party",
            "space-invaders": "gno.land/r/samcrew/space_invaders",
            "barricade": "gno.land/r/samcrew/barricade",
            "connect4": "gno.land/r/samcrew/connect4",
        })
    })
    it("pins every curated project subject", () => {
        expect(Object.fromEntries(ECOSYSTEM_PROJECTS.map((p) => [p.id, projectReviewSubject(p)]))).toEqual({
            adena: "memba:app/adena",
            gnoswap: "gno.land/r/gnoswap/router",
            boards: "gno.land/r/gnoland/boards2/v0",
            akkadia: "memba:app/akkadia",
            "bubble-rumble": "memba:app/bubble-rumble",
            gnofly: "gno.land/r/g1t2kg2vtr3fukg43eujkn6x53gfdyakhngt4sfd/gnofly/game/v0",
            kourt: "gno.land/r/g1ecsuj0q572jr0dhu29q9njtnmw03hyu7tyyvv6/kourt",
            gnoscan: "memba:app/gnoscan",
            playground: "memba:app/playground",
            mygnoscan: "memba:app/mygnoscan",
        })
    })
    it("recognises only curated subjects", () => {
        expect(isCuratedReviewSubject("memba:app/adena")).toBe(true)
        expect(isCuratedReviewSubject("gno.land/r/samcrew/barricade")).toBe(true)
        expect(isCuratedReviewSubject("memba:app/unknown")).toBe(false)
        expect(isCuratedReviewSubject("gno.land/r/someone/app")).toBe(false)
    })
})
