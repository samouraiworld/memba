import { describe, expect, it } from "vitest"
import { initState } from "../sim/engine"
import { ARCHETYPES } from "../sim/waves"
import type { ArchetypeId, Enemy, SimState } from "../sim/types"
import { draw25d } from "./draw25d"
import { initFx, layout, pushFxEvents } from "./fx"

// The 2.5D comparator is a render-only pass, so its contract is the same as the 2D
// renderer's: it must draw without throwing and WITHOUT mutating the sim state or
// the fx layer. (The look itself is verified on a real phone — the bake-off.)
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
                calls.ellipseYs.push(cy)
            },
            arc() {
                calls.arc++
            },
            fill() {},
            createPattern() {
                return null // halftone safely skips with no pattern
            },
            createLinearGradient() {
                return { addColorStop() {} } // the distance-fog gradient
            },
            stroke() {
                calls.stroke++
            },
            fillRect() {
                calls.fillRect++
            },
            strokeRect() {}, // the HUD HP-bar outline
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
    const kinds = Object.keys(ARCHETYPES) as ArchetypeId[]
    const enemies: Enemy[] = kinds.map((k, i) => ({
        id: i,
        archetype: k,
        lane: i % 3,
        pos: 20_000 + i * 4_000,
        hp: ARCHETYPES[k].hp,
        speed: ARCHETYPES[k].speed,
        bornTick: 0,
        hasFlanked: false,
    }))
    return { ...initState("draw25d-test"), enemies }
}

describe("draw25d (2.5D comparator)", () => {
    it("renders the front line (lanes, parapet, bust, HUD) without mutating the sim", () => {
        const { ctx, calls } = stubCtx()
        const state = initState("draw25d-test")
        const before = JSON.stringify(state)
        expect(() => draw25d(ctx, state, { width: 390, height: 700 })).not.toThrow()
        expect(JSON.stringify(state)).toEqual(before)
        expect(calls.fillRect).toBeGreaterThan(0)
        expect(calls.stroke).toBeGreaterThan(0) // lane dividers + inked parapet/bust
        expect(calls.fillText).toBeGreaterThan(0) // the HUD
    })

    it("renders every archetype in perspective without throwing or mutating state", () => {
        const { ctx } = stubCtx()
        const state = withEnemies()
        const before = JSON.stringify(state)
        expect(() => draw25d(ctx, state, { width: 390, height: 700 })).not.toThrow()
        expect(JSON.stringify(state)).toEqual(before)
    })

    it("raises a boss on the horizon during the boss phase (extra draw ops vs a bare wave)", () => {
        const bare = stubCtx()
        draw25d(bare.ctx, { ...initState("draw25d-test"), enemies: [], phase: "wave" }, { width: 390, height: 700 })
        const boss = stubCtx()
        draw25d(boss.ctx, { ...initState("draw25d-test"), enemies: [], phase: "boss" }, { width: 390, height: 700 })
        expect(boss.calls.fillRect + boss.calls.arc).toBeGreaterThan(bare.calls.fillRect + bare.calls.arc)
    })

    it("renders fire zones, projectiles and the fx layer without throwing or mutating them", () => {
        const state: SimState = {
            ...initState("draw25d-test"),
            hazards: [{ id: 0, lane: 1, posLo: 40_000, posHi: 60_000, dmgPerTick: 500, expiresAtTick: 9_999 }],
            projectiles: [{ id: 0, lane: 0, dist: 50_000, impactTick: 9_999 }],
        }
        const fx = initFx(false)
        pushFxEvents(fx, [{ kind: "kill", lane: 1, posFrac: 0.5, weight: 2, archetype: "walker" }, { kind: "rally" }], layout(390, 700))
        const stateBefore = JSON.stringify(state)
        const fxBefore = fx.particles.length
        const { ctx } = stubCtx()
        expect(() => draw25d(ctx, state, { width: 390, height: 700 }, fx)).not.toThrow()
        expect(JSON.stringify(state)).toEqual(stateBefore)
        expect(fx.particles.length).toEqual(fxBefore) // render never mutates fx
    })
})
