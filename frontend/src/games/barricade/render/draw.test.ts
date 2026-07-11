import { describe, expect, it } from "vitest"
import { initState } from "../sim/engine"
import { draw } from "./draw"

function stubCtx() {
    const calls = { fillRect: 0 }
    return {
        ctx: {
            save() {},
            restore() {},
            clearRect() {},
            fillRect() {
                calls.fillRect++
            },
            fillText() {},
            set fillStyle(_v: string) {},
            set globalAlpha(_v: number) {},
            set font(_v: string) {},
        } as unknown as CanvasRenderingContext2D,
        calls,
    }
}

describe("draw", () => {
    it("renders lanes, barricade and HUD without mutating the sim state", () => {
        const { ctx, calls } = stubCtx()
        const state = initState("draw-test")
        const before = JSON.stringify(state)
        expect(() => draw(ctx, state, { width: 390, height: 700 })).not.toThrow()
        expect(JSON.stringify(state)).toEqual(before)
        expect(calls.fillRect).toBeGreaterThan(3)
    })
})
