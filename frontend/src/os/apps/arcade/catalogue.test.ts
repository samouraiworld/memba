import { describe, expect, it } from "vitest"
import { GAME_REVIEW_SUBJECTS } from "../../../lib/reviewSubjects"
import { ARCADE_GAMES, gameById, gameSection } from "./catalogue"

describe("Arcade catalogue", () => {
    it("lists the four games on their existing routes, reviewed under their pinned subjects", () => {
        expect(ARCADE_GAMES.map((g) => [g.id, g.section, g.reviewSubject])).toEqual([
            ["block-party", "game", GAME_REVIEW_SUBJECTS["block-party"]],
            ["space-invaders", "space-invaders", GAME_REVIEW_SUBJECTS["space-invaders"]],
            ["barricade", "barricade", GAME_REVIEW_SUBJECTS.barricade],
            ["connect4", "connect4", GAME_REVIEW_SUBJECTS.connect4],
        ])
    })
    it("finds a game by id and builds its page section", () => {
        expect(gameById("barricade")?.name).toBe("BARRICADE")
        expect(gameById("nope")).toBeUndefined()
        expect(gameSection(gameById("connect4")!)).toBe("g/connect4")
    })
    it("only Block Party has a live daily board; Connect 4 is the only staked game", () => {
        expect(ARCADE_GAMES.filter((g) => g.dailyBoard).map((g) => g.id)).toEqual(["block-party"])
        expect(ARCADE_GAMES.filter((g) => g.cost === "staked").map((g) => g.id)).toEqual(["connect4"])
    })
})
