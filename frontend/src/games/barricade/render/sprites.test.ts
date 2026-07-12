import { beforeEach, describe, expect, it } from "vitest"
import { clearSprites, registerSprite, spriteFor } from "./sprites"

describe("the hand-inked atlas seam", () => {
    beforeEach(() => clearSprites())

    it("starts empty — every machine renders procedurally until art is registered", () => {
        expect(spriteFor("drone")).toBeNull()
        expect(spriteFor("panopticon")).toBeNull()
    })

    it("a registered sprite is returned for its archetype only", () => {
        const img = { fake: true } as unknown as CanvasImageSource
        registerSprite("broadcast", img)
        expect(spriteFor("broadcast")).toBe(img)
        expect(spriteFor("drone")).toBeNull()
    })
})
