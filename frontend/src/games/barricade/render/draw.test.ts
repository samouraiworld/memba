import { describe, expect, it } from "vitest"
import { initState } from "../sim/engine"
import { ARCHETYPES } from "../sim/waves"
import type { ArchetypeId, Enemy, SimState } from "../sim/types"
import { draw } from "./draw"
import { initFx, layout, pushFxEvents } from "./fx"

function stubCtx() {
    const calls = { fillRect: 0, arc: 0, fillText: 0, stroke: 0, ellipseYs: [] as number[] }
    return {
        ctx: {
            save() {},
            restore() {},
            clearRect() {},
            translate() {},
            rotate() {},
            scale() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            quadraticCurveTo() {},
            closePath() {},
            rect() {},
            ellipse(_x: number, cy: number) {
                calls.ellipseYs.push(cy) // ground shadows — one per drawn actor, at its y
            },
            arc() {
                calls.arc++
            },
            fill() {},
            stroke() {
                calls.stroke++
            },
            fillRect() {
                calls.fillRect++
            },
            fillText() {
                calls.fillText++
            },
            set fillStyle(_v: string) {},
            set strokeStyle(_v: string) {},
            set globalAlpha(_v: number) {},
            set lineWidth(_v: number) {},
            set lineJoin(_v: string) {},
            set lineCap(_v: string) {},
            set font(_v: string) {},
            set textAlign(_v: string) {},
            set textBaseline(_v: string) {},
        } as unknown as CanvasRenderingContext2D,
        calls,
    }
}

function withEnemies(): SimState {
    const kinds: ArchetypeId[] = ["drone", "netter", "walker", "phalanx", "siege", "broadcast"]
    const enemies: Enemy[] = kinds.map((k, i) => ({
        id: i,
        archetype: k,
        lane: i % 3,
        pos: 20_000 + i * 10_000,
        hp: ARCHETYPES[k].hp,
        speed: ARCHETYPES[k].speed,
    }))
    return { ...initState("draw-test"), enemies }
}

describe("draw", () => {
    it("renders lanes, barricade and HUD without mutating the sim state", () => {
        const { ctx, calls } = stubCtx()
        const state = initState("draw-test")
        const before = JSON.stringify(state)
        expect(() => draw(ctx, state, { width: 390, height: 700 })).not.toThrow()
        expect(JSON.stringify(state)).toEqual(before)
        expect(calls.fillRect).toBeGreaterThan(3)
        expect(calls.stroke).toBeGreaterThan(0) // outlined actors, not bare fills
    })

    it("renders every archetype silhouette without throwing or mutating state", () => {
        const { ctx } = stubCtx()
        const state = withEnemies()
        const before = JSON.stringify(state)
        expect(() => draw(ctx, state, { width: 390, height: 700 })).not.toThrow()
        expect(JSON.stringify(state)).toEqual(before)
    })

    it("draws an enemy at its interpolated position when an interp map is passed", () => {
        const enemies: Enemy[] = [
            { id: 7, archetype: "drone", lane: 1, pos: 20_000, hp: ARCHETYPES.drone.hp, speed: ARCHETYPES.drone.speed },
        ]
        const state = { ...initState("draw-test"), enemies }
        const before = JSON.stringify(state)

        const raw = stubCtx()
        draw(raw.ctx, state, { width: 390, height: 700 })

        const interpDraw = stubCtx()
        const interp = new Map<number, number>([[7, 90_000]]) // shove it far closer to the barricade
        const mapBefore = JSON.stringify([...interp])
        draw(interpDraw.ctx, state, { width: 390, height: 700 }, undefined, interp)

        // The interpolated position moves the unit's ground shadow down the field.
        expect(interpDraw.calls.ellipseYs).not.toEqual(raw.calls.ellipseYs)
        // draw is pure: it mutates neither the interp map nor the sim state.
        expect(JSON.stringify([...interp])).toBe(mapBefore)
        expect(JSON.stringify(state)).toBe(before)
    })

    it("draws a wind-up telegraph for a front unit near the barricade", () => {
        const mk = (pos: number): SimState => ({
            ...initState("draw-test"),
            enemies: [{ id: 1, archetype: "walker", lane: 1, pos, hp: ARCHETYPES.walker.hp, speed: ARCHETYPES.walker.speed }],
        })
        const near = stubCtx()
        draw(near.ctx, mk(96_000), { width: 390, height: 700 }) // frac 0.96 → telegraph fires
        const far = stubCtx()
        draw(far.ctx, mk(20_000), { width: 390, height: 700 }) // frac 0.20 → no telegraph
        // Same unit + archetype ⇒ identical silhouette strokes; the extra strokes
        // near the barricade are the aim-line + chevron telegraph.
        expect(near.calls.stroke).toBeGreaterThan(far.calls.stroke)
    })

    it("renders the fx layer (particles + floaters) without touching it", () => {
        const { ctx, calls } = stubCtx()
        const state = initState("draw-test")
        const fx = initFx(false)
        pushFxEvents(fx, [{ kind: "kill", lane: 1, posFrac: 0.5, weight: 2, archetype: "walker" }, { kind: "rally" }], layout(390, 700))
        const before = JSON.stringify(fx.particles.length)
        expect(() => draw(ctx, state, { width: 390, height: 700 }, fx)).not.toThrow()
        expect(calls.arc).toBeGreaterThan(0) // particles drawn as dots
        expect(JSON.stringify(fx.particles.length)).toEqual(before) // draw never mutates fx
    })
})
