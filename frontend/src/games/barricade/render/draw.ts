/**
 * Canvas renderer — a pure function of (ctx, SimState, size, fx?). Never mutates
 * sim state and never reads the clock; all gameplay motion comes from the sim's
 * integer state. The optional FxState carries render-only juice (screenshake,
 * particles, flashes, floating onomatopoeia) — reading it here cannot change a
 * replay (see fx.parity.test.ts).
 *
 * Direction: "Riso Protest — Night Edition." Screen-print on a DARK ink stock
 * (so the game sits native in Memba's dark shell and the warm rebel / flashes
 * glow instead of muting on cream). Bold ink outlines + per-archetype
 * silhouettes; warm rebel vs. cold Order machines (threat-coding); Memba tokens
 * for chrome (JetBrains Mono, teal accent, gold scrap). The light "Riso Protest"
 * stays the collection PFP + exported share-card look; this is the playable
 * surface only. Full sprite/PFP art is a follow-on.
 */

import { ARCHETYPES, WAVE_TOTAL } from "../sim/waves"
import { MARSHAL_CYCLE, MARSHAL_UP, MOLOTOV_COST, MOLOTOV_MAX, panopticonMode } from "../sim/engine"
import { BARRICADE_MAX_HP, LANES, LANE_LENGTH, RALLY_FULL, type ArchetypeId, type SimState } from "../sim/types"
import { layout, laneCenterX, yFromFrac, type FxState, type Layout } from "./fx"
import { laneThreats } from "./telegraph"
import { buildSkyline } from "./nightsky"

export type ViewSize = { width: number; height: number }

const TAU = Math.PI * 2

// ── Night-edition riso plates ────────────────────────────────────────────────
const STOCK = "#141026" // ink-dark ground stock
const STOCK_ALT = "#191333" // alternating lane tint
const HORIZON = "#0f0c1e" // darker sky band at the top of the field
const DIVIDER = "rgba(239,231,212,0.10)" // faint paper-tone lane lines
const INK_LINE = "#0a0812" // outline ink (near-black)
const PAPER = "#efe7d4" // now a foreground ink (HUD numerals, scraps)
const VERMILION = "#e0392b" // the rebel + sensor eyes + hit flash
const OCHRE = "#dba43c" // barricade timber
const TEAL = "#00d4aa" // --color-brand — Memba signature accent (rally-ready)
const GOLD = "#f5a623" // scrap currency (matches app gold)
const SKYLINE_INK = "#0a0816" // city silhouette on the horizon (darker than the stock)
const SEARCHLIGHT = "#9fb4e0" // cold surveillance beam

// Order machines — cold steels, brightened to read on the dark stock.
const MACHINE_COLOR: Record<ArchetypeId, string> = {
    drone: "#8fa8e0",
    netter: "#7f9fd8",
    walker: "#6b82c0",
    phalanx: "#5870b0",
    siege: "#42568f",
    broadcast: "#2b2748",
    testudo: "#4a5ba0", // shield-wall steel
    swarm: "#9fb4e8", // pale flyer
    rampart: "#3d4f86", // heavy slab armor
    charger: "#7c96d4", // raked wedge
    flanker: "#8aa2dc", // crab-drone
    mortar: "#51639c", // artillery rig
    marshal: "#35437a", // command shield-bearer
    kettle: "#2f3c6e", // kettling rig
    dampener: "#6d87c8", // water-cannon tanker
    carrier: "#455890", // riot-van spawner
    jammer: "#96aade", // jam-ring mast
    mender: "#7d94cc", // welding nurse-drone
    panopticon: "#232043", // the apex watchtower
}

/** Fill the current path, then a paper rim-light on the up-left edge, then ink it. */
function inkFill(ctx: CanvasRenderingContext2D, fill: string, lw = 3): void {
    ctx.fillStyle = fill
    ctx.fill()
    ctx.lineJoin = "round"
    ctx.lineCap = "round"
    ctx.lineWidth = lw
    ctx.strokeStyle = INK_LINE
    ctx.stroke()
}

// ── Riot-machine silhouettes ─────────────────────────────────────────────────
// The Order is mechanized riot apparatus — shields, vans, drones, water cannons —
// so it reads as the state cracking down while staying MACHINES (GDD §4: no
// depicting violence against real people). ctx path commands only (no Path2D, so
// jsdom tests run). Each draws its parts back-to-front, then inks them.
const WHEEL = "#131022"
const SHIELD = "#8ea6dd"

function inkRect(ctx: CanvasRenderingContext2D, x0: number, y0: number, ww: number, hh: number, fill: string, lw = 3): void {
    ctx.beginPath()
    ctx.rect(x0, y0, ww, hh)
    inkFill(ctx, fill, lw)
}
function inkCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, lw = 2.5): void {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, TAU)
    inkFill(ctx, fill, lw)
}
function eye(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    ctx.fillStyle = VERMILION
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, TAU)
    ctx.fill()
}

function drawMachine(
    ctx: CanvasRenderingContext2D,
    kind: ArchetypeId,
    x: number,
    y: number,
    s: number,
    color: string,
    shieldOpen = false, // marshal only: the pavise visibly lowers in its open window
): void {
    switch (kind) {
        case "drone": { // surveillance quad-drone — rotor bar + discs + a camera eye
            inkRect(ctx, x - s * 0.5, y - s * 0.36, s, s * 0.09, color, 2)
            inkCircle(ctx, x - s * 0.46, y - s * 0.31, s * 0.14, color, 2)
            inkCircle(ctx, x + s * 0.46, y - s * 0.31, s * 0.14, color, 2)
            inkRect(ctx, x - s * 0.2, y - s * 0.28, s * 0.4, s * 0.36, color, 3)
            eye(ctx, x, y + s * 0.02, s * 0.11)
            break
        }
        case "netter": { // net-cannon / kettling rig — launcher + a net mouth
            inkRect(ctx, x - s * 0.4, y - s * 0.36, s * 0.8, s * 0.42, color, 3)
            ctx.beginPath()
            ctx.moveTo(x - s * 0.5, y + s * 0.5)
            ctx.lineTo(x - s * 0.3, y + s * 0.06)
            ctx.lineTo(x + s * 0.3, y + s * 0.06)
            ctx.lineTo(x + s * 0.5, y + s * 0.5)
            ctx.closePath()
            inkFill(ctx, "#2b3350", 3)
            ctx.strokeStyle = "rgba(239,231,212,0.35)"
            ctx.lineWidth = 1
            for (let i = -1; i <= 1; i++) {
                ctx.beginPath()
                ctx.moveTo(x + i * s * 0.18, y + s * 0.08)
                ctx.lineTo(x + i * s * 0.34, y + s * 0.48)
                ctx.stroke()
            }
            eye(ctx, x, y - s * 0.14, s * 0.1)
            break
        }
        case "walker": { // riot-shield trooper mech — body + a raised riot shield
            ctx.beginPath()
            ctx.moveTo(x - s * 0.3, y + s * 0.5)
            ctx.lineTo(x - s * 0.3, y - s * 0.16)
            ctx.quadraticCurveTo(x, y - s * 0.62, x + s * 0.3, y - s * 0.16)
            ctx.lineTo(x + s * 0.3, y + s * 0.5)
            ctx.closePath()
            inkFill(ctx, color, 3)
            eye(ctx, x, y - s * 0.3, s * 0.09)
            inkRect(ctx, x - s * 0.34, y - s * 0.02, s * 0.68, s * 0.56, SHIELD, 3)
            ctx.strokeStyle = INK_LINE
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(x - s * 0.34, y + s * 0.22)
            ctx.lineTo(x + s * 0.34, y + s * 0.22)
            ctx.stroke()
            break
        }
        case "phalanx": { // riot shield-wall — a line of interlocked shields
            for (let i = -1; i <= 1; i++) {
                inkRect(ctx, x + i * s * 0.4 - s * 0.17, y - s * 0.4, s * 0.34, s * 0.8, i === 0 ? color : SHIELD, 3)
            }
            eye(ctx, x, y - s * 0.16, s * 0.1)
            break
        }
        case "siege": { // armoured riot van / water cannon on wheels
            inkCircle(ctx, x - s * 0.28, y + s * 0.34, s * 0.17, WHEEL, 2.5)
            inkCircle(ctx, x + s * 0.28, y + s * 0.34, s * 0.17, WHEEL, 2.5)
            inkRect(ctx, x - s * 0.46, y - s * 0.3, s * 0.92, s * 0.6, color, 3)
            inkRect(ctx, x - s * 0.09, y - s * 0.52, s * 0.18, s * 0.24, color, 2.5)
            inkCircle(ctx, x, y - s * 0.52, s * 0.09, "#2b3350", 2)
            eye(ctx, x - s * 0.24, y - s * 0.06, s * 0.09)
            break
        }
        case "broadcast": { // surveillance / propaganda tower on treads
            inkRect(ctx, x - s * 0.44, y + s * 0.28, s * 0.88, s * 0.22, "#1f1b35", 3)
            inkCircle(ctx, x - s * 0.28, y + s * 0.5, s * 0.12, WHEEL, 2.5)
            inkCircle(ctx, x, y + s * 0.5, s * 0.12, WHEEL, 2.5)
            inkCircle(ctx, x + s * 0.28, y + s * 0.5, s * 0.12, WHEEL, 2.5)
            ctx.beginPath()
            ctx.moveTo(x - s * 0.28, y + s * 0.3)
            ctx.lineTo(x - s * 0.15, y - s * 0.34)
            ctx.lineTo(x + s * 0.15, y - s * 0.34)
            ctx.lineTo(x + s * 0.28, y + s * 0.3)
            ctx.closePath()
            inkFill(ctx, color, 3)
            ctx.strokeStyle = INK_LINE
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(x, y - s * 0.34)
            ctx.lineTo(x, y - s * 0.56)
            ctx.stroke()
            inkCircle(ctx, x + s * 0.13, y - s * 0.5, s * 0.1, color, 2)
            eye(ctx, x, y - s * 0.06, s * 0.15)
            break
        }
        case "testudo": { // tower-shield bot — a big raised riot shield up front
            inkRect(ctx, x - s * 0.26, y - s * 0.28, s * 0.52, s * 0.74, color, 3) // body
            eye(ctx, x, y - s * 0.36, s * 0.08)
            inkRect(ctx, x - s * 0.44, y - s * 0.46, s * 0.88, s * 0.9, SHIELD, 3) // full frontal shield
            ctx.strokeStyle = INK_LINE
            ctx.lineWidth = 2
            for (let i = -1; i <= 1; i++) {
                ctx.beginPath()
                ctx.moveTo(x + i * s * 0.29, y - s * 0.46)
                ctx.lineTo(x + i * s * 0.29, y + s * 0.44)
                ctx.stroke()
            }
            eye(ctx, x, y - s * 0.02, s * 0.06) // a sensor slit peers over the shield
            break
        }
        case "swarm": { // small fast quad-copter — arrives in numbers
            inkRect(ctx, x - s * 0.4, y - s * 0.11, s * 0.8, s * 0.07, color, 2) // rotor bar
            inkCircle(ctx, x - s * 0.38, y - s * 0.08, s * 0.1, color, 2)
            inkCircle(ctx, x + s * 0.38, y - s * 0.08, s * 0.1, color, 2)
            inkRect(ctx, x - s * 0.14, y - s * 0.05, s * 0.28, s * 0.26, color, 2) // body
            eye(ctx, x, y + s * 0.07, s * 0.08)
            break
        }
        case "rampart": { // armored slab crawler — heavy-wide silhouette = HP sponge
            inkCircle(ctx, x - s * 0.34, y + s * 0.42, s * 0.13, WHEEL, 2.5)
            inkCircle(ctx, x, y + s * 0.42, s * 0.13, WHEEL, 2.5)
            inkCircle(ctx, x + s * 0.34, y + s * 0.42, s * 0.13, WHEEL, 2.5)
            inkRect(ctx, x - s * 0.5, y - s * 0.24, s, s * 0.62, color, 3.5) // the slab
            inkRect(ctx, x - s * 0.4, y - s * 0.38, s * 0.8, s * 0.16, color, 2.5) // upper plate
            ctx.strokeStyle = INK_LINE // armor seams
            ctx.lineWidth = 2
            for (let i = -1; i <= 1; i++) {
                ctx.beginPath()
                ctx.moveTo(x + i * s * 0.25, y - s * 0.24)
                ctx.lineTo(x + i * s * 0.25, y + s * 0.38)
                ctx.stroke()
            }
            eye(ctx, x, y - s * 0.31, s * 0.07) // a narrow view slit
            break
        }
        case "charger": { // forward-raked ram wedge — reads FAST, hits the wall hard
            ctx.beginPath()
            ctx.moveTo(x - s * 0.34, y - s * 0.4)
            ctx.lineTo(x + s * 0.34, y - s * 0.4)
            ctx.lineTo(x, y + s * 0.52) // the ram point, raked toward the barricade
            ctx.closePath()
            inkFill(ctx, color, 3)
            inkRect(ctx, x - s * 0.2, y - s * 0.5, s * 0.4, s * 0.14, color, 2.5) // engine block
            eye(ctx, x, y - s * 0.12, s * 0.09)
            break
        }
        case "flanker": { // vaulting crab-drone — wide legs read sideways-mobile
            ctx.strokeStyle = INK_LINE // splayed legs first, body inks over them
            ctx.lineWidth = 3
            for (const sx of [-1, 1]) {
                ctx.beginPath()
                ctx.moveTo(x + sx * s * 0.16, y + s * 0.02)
                ctx.lineTo(x + sx * s * 0.46, y - s * 0.18)
                ctx.lineTo(x + sx * s * 0.52, y + s * 0.3)
                ctx.stroke()
            }
            ctx.beginPath()
            ctx.ellipse(x, y + s * 0.02, s * 0.3, s * 0.22, 0, 0, TAU)
            inkFill(ctx, color, 3)
            eye(ctx, x - s * 0.09, y, s * 0.07)
            eye(ctx, x + s * 0.09, y, s * 0.07)
            break
        }
        case "mortar": { // standoff artillery — barrel-forward silhouette, parked
            inkCircle(ctx, x - s * 0.26, y + s * 0.42, s * 0.14, WHEEL, 2.5)
            inkCircle(ctx, x + s * 0.26, y + s * 0.42, s * 0.14, WHEEL, 2.5)
            inkRect(ctx, x - s * 0.4, y + s * 0.06, s * 0.8, s * 0.34, color, 3) // carriage
            ctx.save() // the tube, angled at the barricade
            ctx.translate(x, y + s * 0.1)
            ctx.rotate(0.5)
            inkRect(ctx, -s * 0.09, -s * 0.62, s * 0.18, s * 0.62, color, 2.5)
            inkCircle(ctx, 0, -s * 0.62, s * 0.11, "#2b3350", 2)
            ctx.restore()
            eye(ctx, x - s * 0.26, y + s * 0.16, s * 0.08)
            break
        }
        case "marshal": { // command mech behind a full-height pavise shield
            inkRect(ctx, x - s * 0.24, y - s * 0.34, s * 0.48, s * 0.84, color, 3.5) // body
            inkRect(ctx, x - s * 0.16, y - s * 0.5, s * 0.32, s * 0.2, color, 2.5) // command head
            eye(ctx, x, y - s * 0.4, s * 0.08)
            // The pavise: raised = full cover; open window = visibly LOWERED,
            // exposing the body — "timing is the counterplay" needs a tell.
            const shTop = shieldOpen ? y + s * 0.06 : y - s * 0.42
            const shH = shieldOpen ? s * 0.46 : s * 0.94
            inkRect(ctx, x - s * 0.5, shTop, s, shH, SHIELD, 3.5)
            ctx.strokeStyle = INK_LINE // shield chevrons (rank marks)
            ctx.lineWidth = 2.5
            const chevY = shieldOpen ? s * 0.3 : 0
            for (let i = 0; i <= 1; i++) {
                ctx.beginPath()
                ctx.moveTo(x - s * 0.3, y + chevY - s * 0.1 + i * s * 0.24)
                ctx.lineTo(x, y + chevY + s * 0.08 + i * s * 0.24)
                ctx.lineTo(x + s * 0.3, y + chevY - s * 0.1 + i * s * 0.24)
                ctx.stroke()
            }
            if (!shieldOpen) eye(ctx, x, y - s * 0.24, s * 0.07) // sensor over the rim
            break
        }
        case "kettle": { // kettling rig — a wide corral frame with a brood bay
            inkCircle(ctx, x - s * 0.36, y + s * 0.46, s * 0.13, WHEEL, 2.5)
            inkCircle(ctx, x + s * 0.36, y + s * 0.46, s * 0.13, WHEEL, 2.5)
            inkRect(ctx, x - s * 0.52, y - s * 0.1, s * 1.04, s * 0.5, color, 3.5) // corral body
            inkRect(ctx, x - s * 0.52, y - s * 0.44, s * 0.14, s * 0.4, color, 3) // left gate post
            inkRect(ctx, x + s * 0.38, y - s * 0.44, s * 0.14, s * 0.4, color, 3) // right gate post
            inkRect(ctx, x - s * 0.2, y + s * 0.02, s * 0.4, s * 0.26, "#141026", 2.5) // brood bay
            eye(ctx, x - s * 0.1, y + s * 0.14, s * 0.05) // hatchlings' eyes inside
            eye(ctx, x + s * 0.1, y + s * 0.14, s * 0.05)
            eye(ctx, x, y - s * 0.22, s * 0.09)
            break
        }
        case "carrier": { // riot-van spawner — a boxy transport with side hatches
            inkCircle(ctx, x - s * 0.3, y + s * 0.42, s * 0.14, WHEEL, 2.5)
            inkCircle(ctx, x + s * 0.3, y + s * 0.42, s * 0.14, WHEEL, 2.5)
            inkRect(ctx, x - s * 0.5, y - s * 0.26, s, s * 0.62, color, 3.5) // hull
            inkRect(ctx, x - s * 0.5, y - s * 0.02, s * 0.16, s * 0.3, "#141026", 2.5) // left hatch
            inkRect(ctx, x + s * 0.34, y - s * 0.02, s * 0.16, s * 0.3, "#141026", 2.5) // right hatch
            inkRect(ctx, x - s * 0.14, y - s * 0.42, s * 0.28, s * 0.18, color, 2.5) // cab
            eye(ctx, x, y - s * 0.33, s * 0.08)
            break
        }
        case "jammer": { // jam-ring mast — a thin pylon under a broadcast ring
            inkRect(ctx, x - s * 0.2, y + s * 0.24, s * 0.4, s * 0.24, color, 2.5) // base
            inkRect(ctx, x - s * 0.05, y - s * 0.34, s * 0.1, s * 0.6, color, 2.5) // mast
            ctx.beginPath() // the ring
            ctx.ellipse(x, y - s * 0.38, s * 0.3, s * 0.14, 0, 0, TAU)
            ctx.lineWidth = 3
            ctx.strokeStyle = color
            ctx.stroke()
            ctx.strokeStyle = INK_LINE
            ctx.lineWidth = 1.5
            ctx.stroke()
            eye(ctx, x, y - s * 0.06, s * 0.08)
            break
        }
        case "mender": { // welding nurse-drone — a stubby body with tool arms forward
            inkCircle(ctx, x, y, s * 0.28, color, 3) // pod body
            ctx.strokeStyle = INK_LINE // twin tool arms reaching up-lane
            ctx.lineWidth = 3
            for (const sx of [-1, 1]) {
                ctx.beginPath()
                ctx.moveTo(x + sx * s * 0.18, y - s * 0.14)
                ctx.lineTo(x + sx * s * 0.3, y - s * 0.44)
                ctx.stroke()
            }
            inkCircle(ctx, x - s * 0.3, y - s * 0.46, s * 0.07, OCHRE, 1.5) // welding tips
            inkCircle(ctx, x + s * 0.3, y - s * 0.46, s * 0.07, OCHRE, 1.5)
            eye(ctx, x, y - s * 0.04, s * 0.08)
            break
        }
        case "dampener": { // water-cannon tanker — a barrel body and a hose snout
            inkCircle(ctx, x - s * 0.28, y + s * 0.44, s * 0.14, WHEEL, 2.5)
            inkCircle(ctx, x + s * 0.28, y + s * 0.44, s * 0.14, WHEEL, 2.5)
            ctx.beginPath() // rounded tank
            ctx.ellipse(x, y, s * 0.46, s * 0.34, 0, 0, TAU)
            inkFill(ctx, color, 3)
            inkRect(ctx, x - s * 0.08, y + s * 0.26, s * 0.42, s * 0.12, color, 2.5) // hose snout
            inkCircle(ctx, x + s * 0.36, y + s * 0.32, s * 0.08, "#2b3350", 2) // nozzle
            ctx.strokeStyle = "rgba(239,231,212,0.35)" // tank hoops
            ctx.lineWidth = 1.5
            for (const off of [-0.18, 0.12]) {
                ctx.beginPath()
                ctx.moveTo(x + s * off, y - s * 0.32)
                ctx.lineTo(x + s * off, y + s * 0.32)
                ctx.stroke()
            }
            eye(ctx, x - s * 0.2, y - s * 0.12, s * 0.08)
            break
        }
        case "panopticon": { // the apex — a walking watchtower ringed with eyes
            inkCircle(ctx, x - s * 0.3, y + s * 0.48, s * 0.13, WHEEL, 2.5)
            inkCircle(ctx, x + s * 0.3, y + s * 0.48, s * 0.13, WHEEL, 2.5)
            ctx.beginPath() // tapering tower
            ctx.moveTo(x - s * 0.34, y + s * 0.44)
            ctx.lineTo(x - s * 0.16, y - s * 0.44)
            ctx.lineTo(x + s * 0.16, y - s * 0.44)
            ctx.lineTo(x + s * 0.34, y + s * 0.44)
            ctx.closePath()
            inkFill(ctx, color, 3.5)
            inkRect(ctx, x - s * 0.3, y - s * 0.58, s * 0.6, s * 0.18, color, 3) // the observation crown
            eye(ctx, x - s * 0.18, y - s * 0.49, s * 0.06) // the ring of eyes
            eye(ctx, x, y - s * 0.49, s * 0.07)
            eye(ctx, x + s * 0.18, y - s * 0.49, s * 0.06)
            eye(ctx, x, y - s * 0.1, s * 0.1) // the central gaze
            break
        }
    }
}

/** The rebel: a human bust (head + shoulders) — warm, rounded, unmistakably not a machine. */
function rebelPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    ctx.beginPath()
    // shoulders
    ctx.moveTo(x - s * 0.5, y + s * 0.5)
    ctx.quadraticCurveTo(x - s * 0.5, y + s * 0.02, x - s * 0.24, y - s * 0.05)
    // head
    ctx.quadraticCurveTo(x - s * 0.26, y - s * 0.5, x, y - s * 0.5)
    ctx.quadraticCurveTo(x + s * 0.26, y - s * 0.5, x + s * 0.24, y - s * 0.05)
    ctx.quadraticCurveTo(x + s * 0.5, y + s * 0.02, x + s * 0.5, y + s * 0.5)
    ctx.closePath()
}

function groundShadow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    ctx.fillStyle = "rgba(6,4,12,0.4)"
    ctx.beginPath()
    ctx.ellipse(x, y + s * 0.52, s * 0.42, s * 0.14, 0, 0, TAU)
    ctx.fill()
}

// ── Halftone screen (the collection's screen-print signature) ────────────────
// A cached offscreen dot-tile, laid over the field as a faint repeating pattern
// so the dark ground reads as printed ink rather than a flat fill. Built once,
// browser-only — jsdom has no real canvas, so this returns null and the pass
// no-ops in tests. Purely decorative; nothing here touches the sim.
let halftoneTile: HTMLCanvasElement | null | undefined
function getHalftoneTile(): HTMLCanvasElement | null {
    if (halftoneTile !== undefined) return halftoneTile
    if (typeof document === "undefined") return (halftoneTile = null)
    try {
        const tile = document.createElement("canvas")
        tile.width = 6
        tile.height = 6
        const tctx = tile.getContext("2d")
        if (!tctx) return (halftoneTile = null)
        // Two dots on the tile diagonal → a 45° halftone lattice when repeated.
        tctx.fillStyle = PAPER
        for (const [cx, cy] of [
            [1.5, 1.5],
            [4.5, 4.5],
        ]) {
            tctx.beginPath()
            tctx.arc(cx, cy, 0.9, 0, TAU)
            tctx.fill()
        }
        return (halftoneTile = tile)
    } catch {
        return (halftoneTile = null)
    }
}

/**
 * Night backdrop at the horizon — a city skyline silhouette with a few lit
 * windows and two cold searchlights sweeping down the street. `tick` drives the
 * sweep (integer sim tick in play, a wall-clock proxy on the attract screen);
 * the beams still under reduced motion while the city stays. Pure render.
 */
function drawNightSky(ctx: CanvasRenderingContext2D, lay: Layout, tick: number, reducedMotion: boolean): void {
    const { w, hudH, fieldH } = lay
    const skyH = fieldH * 0.16
    const horizonY = hudH + skyH

    // Searchlights — faint beams sweeping down the street from the city.
    ctx.fillStyle = SEARCHLIGHT
    for (const b of [
        { x: 0.28, ph: 0 },
        { x: 0.72, ph: 2.2 },
    ]) {
        const sweep = reducedMotion ? 0 : Math.sin(tick * 0.008 + b.ph)
        const ox = b.x * w
        const ang = Math.PI / 2 + sweep * 0.42 // pointing down-field, sweeping
        const len = fieldH * 0.5
        const spread = 0.075
        ctx.globalAlpha = 0.05
        ctx.beginPath()
        ctx.moveTo(ox, horizonY)
        ctx.lineTo(ox + Math.cos(ang - spread) * len, horizonY + Math.sin(ang - spread) * len)
        ctx.lineTo(ox + Math.cos(ang + spread) * len, horizonY + Math.sin(ang + spread) * len)
        ctx.closePath()
        ctx.fill()
    }
    ctx.globalAlpha = 1

    // Skyline silhouette, then a few lit windows.
    const sky = buildSkyline()
    ctx.fillStyle = SKYLINE_INK
    for (const bld of sky) {
        ctx.fillRect(bld.x * w, horizonY - bld.h * skyH, bld.w * w, bld.h * skyH)
    }
    ctx.fillStyle = "rgba(219,164,60,0.5)" // faint lit windows (gold)
    for (const bld of sky) {
        const bh = bld.h * skyH
        for (const wy of bld.windows) {
            ctx.fillRect(bld.x * w + bld.w * w * 0.35, horizonY - bh + wy * bh, Math.max(1, bld.w * w * 0.14), 1.5)
        }
    }
}

/** Lay the cached halftone screen over a rect (no-op when no tile is available). */
function paintHalftone(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const half = getHalftoneTile()
    if (!half) return
    const pat = ctx.createPattern(half, "repeat")
    if (!pat) return
    ctx.save()
    ctx.globalAlpha = 0.09
    ctx.fillStyle = pat
    ctx.fillRect(x, y, w, h)
    ctx.restore()
}

export function draw(
    ctx: CanvasRenderingContext2D,
    s: SimState,
    view: ViewSize,
    fx?: FxState,
    interp?: Map<number, number>,
): void {
    const { width: w, height: h } = view
    const lay = layout(w, h)
    const { hudH, barricadeH, fieldH, laneW } = lay
    const fieldTop = hudH
    const fieldBottom = hudH + fieldH

    // ── Dark ink ground (full canvas; the shake never reveals a gap). ─────────
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = STOCK
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = HORIZON
    ctx.fillRect(0, fieldTop, w, fieldH * 0.16) // a darker sky band = a horizon
    for (let lane = 0; lane < LANES; lane++) {
        if (lane % 2 === 1) {
            ctx.fillStyle = STOCK_ALT
            ctx.fillRect(lane * laneW, fieldTop, laneW, fieldH)
        }
        ctx.fillStyle = DIVIDER
        ctx.fillRect(Math.round(lane * laneW), fieldTop, 1, fieldH)
    }

    // Night backdrop (skyline + searchlights) at the horizon, then the halftone
    // screen over the whole field — both fixed to the "paper" (before the shake
    // group) so they stay put while the scene shakes on top.
    drawNightSky(ctx, lay, s.tick, fx?.reducedMotion ?? false)
    paintHalftone(ctx, 0, fieldTop, w, fieldH)

    // ── Shaken scene group. ──────────────────────────────────────────────────
    ctx.save()
    if (fx && (fx.shakeX !== 0 || fx.shakeY !== 0 || fx.shakeRot !== 0)) {
        const cx = w / 2
        const cy = fieldTop + fieldH / 2
        ctx.translate(cx + fx.shakeX, cy + fx.shakeY)
        ctx.rotate(fx.shakeRot)
        ctx.translate(-cx, -cy)
    }

    // Enemies, far-first so nearer units overlap correctly; size grows with
    // depth (nearer = bigger) as well as HP → the lane reads as receding. Each
    // unit is drawn at its INTERPOLATED position (smooth above 60Hz); we sort by
    // that same value so the z-order matches what's actually painted.
    const rendered = s.enemies
        .map((e) => ({ e, pos: interp?.get(e.id) ?? e.pos }))
        .sort((a, b) => a.pos - b.pos)

    // Wind-up telegraph: the front unit of each lane that's about to reach the
    // barricade gets a pulsing vermilion aim-line + chevron so the incoming lane
    // is readable in time. Drawn behind the units (they sit atop their warning);
    // pure render (positions + tick only) — the pulse stills under reduced motion
    // but the warning stays.
    const threats = laneThreats(rendered.map((r) => ({ lane: r.e.lane, pos: r.pos })))
    if (threats.length > 0) {
        const pulse = fx?.reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(s.tick * 0.25)
        ctx.strokeStyle = VERMILION
        ctx.lineJoin = "round"
        ctx.lineCap = "round"
        for (const t of threats) {
            const cx = laneCenterX(lay, t.lane)
            const y = yFromFrac(lay, t.frac)
            // Floor keeps a near-barricade threat legible at the pulse trough;
            // the pulse adds the eye-catching throb. Faint when it first crosses
            // the band (low intensity), strong at the line.
            const alpha = t.intensity * (0.5 + 0.45 * pulse)
            // aim-line down to the barricade
            ctx.globalAlpha = alpha * 0.6
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(cx, y)
            ctx.lineTo(cx, fieldBottom)
            ctx.stroke()
            // chevron at the line — "incoming here"
            ctx.globalAlpha = alpha
            ctx.lineWidth = 3
            const cwid = laneW * 0.16
            ctx.beginPath()
            ctx.moveTo(cx - cwid, fieldBottom - 12)
            ctx.lineTo(cx, fieldBottom - 3)
            ctx.lineTo(cx + cwid, fieldBottom - 12)
            ctx.stroke()
        }
        ctx.globalAlpha = 1
    }

    for (const { e, pos } of rendered) {
        const frac = Math.min(1, pos / LANE_LENGTH)
        const a = ARCHETYPES[e.archetype]
        const hpFrac = Math.max(0.55, e.hp / a.hp)
        const depth = 0.62 + 0.38 * frac
        const size = (e.archetype === "broadcast" ? 0.66 : 0.4) * laneW * depth * hpFrac
        const x = laneCenterX(lay, e.lane)
        const y = yFromFrac(lay, frac)
        groundShadow(ctx, x, y, size)
        const shieldOpen = e.archetype === "marshal" && (s.tick - e.bornTick) % MARSHAL_CYCLE >= MARSHAL_UP
        drawMachine(ctx, e.archetype, x, y, size, MACHINE_COLOR[e.archetype], shieldOpen)
        // The Panopticon telegraphs its rotation: four pips over the crown, the
        // active denial mode lit vermilion — reading the clock IS the counterplay.
        if (e.archetype === "panopticon") {
            const mode = panopticonMode(e, s.tick)
            for (let m = 0; m < 4; m++) {
                ctx.fillStyle = m === mode ? VERMILION : "rgba(239,231,212,0.25)"
                ctx.beginPath()
                ctx.arc(x - size * 0.24 + m * size * 0.16, y - size * 0.72, size * 0.05, 0, TAU)
                ctx.fill()
            }
        }
    }

    // Fire zones — a scorch decal + flat-cel riso flames (no gradients: nested
    // vermilion → ochre → paper tongues, flickering on the sim tick).
    for (const hz of s.hazards) {
        const cx = laneCenterX(lay, hz.lane)
        const yLo = yFromFrac(lay, Math.min(1, hz.posLo / LANE_LENGTH))
        const yHi = yFromFrac(lay, Math.min(1, hz.posHi / LANE_LENGTH))
        const bandW = laneW * 0.72
        ctx.globalAlpha = 0.32
        ctx.fillStyle = "#180d08"
        ctx.fillRect(cx - bandW / 2, yLo, bandW, yHi - yLo) // scorch
        const life = Math.max(0.2, Math.min(1, (hz.expiresAtTick - s.tick) / 60)) // guttering fade
        const flick = fx?.reducedMotion ? 0 : Math.sin(s.tick * 0.6 + hz.id) * 3
        const midY = (yLo + yHi) / 2
        ctx.globalAlpha = 0.85 * (fx?.reducedMotion ? 0.7 : 1)
        for (const t of [
            { col: VERMILION, sc: 1 },
            { col: OCHRE, sc: 0.6 },
            { col: PAPER, sc: 0.28 },
        ]) {
            const fw = bandW * 0.5 * t.sc * (0.7 + 0.3 * life)
            const fh = (yHi - yLo) * 0.95 * t.sc * life
            ctx.fillStyle = t.col
            ctx.beginPath()
            ctx.moveTo(cx - fw, midY + fh * 0.4)
            ctx.quadraticCurveTo(cx - fw * 0.3, midY - fh + flick, cx, midY - fh * 1.15 + flick)
            ctx.quadraticCurveTo(cx + fw * 0.3, midY - fh + flick, cx + fw, midY + fh * 0.4)
            ctx.closePath()
            ctx.fill()
        }
        ctx.globalAlpha = 1
    }

    // Molotovs in flight — a bottle arcing from the barricade toward its target.
    for (const p of s.projectiles) {
        const cx = laneCenterX(lay, p.lane)
        const targetY = yFromFrac(lay, Math.min(1, p.dist / LANE_LENGTH))
        const prog = Math.max(0, Math.min(1, 1 - Math.max(0, p.impactTick - s.tick) / 24))
        const py = fieldBottom + (targetY - fieldBottom) * prog - Math.sin(prog * Math.PI) * fieldH * 0.12
        ctx.save()
        ctx.translate(cx, py)
        ctx.rotate(prog * 6)
        ctx.fillStyle = OCHRE
        ctx.beginPath()
        ctx.arc(0, 0, Math.max(2, laneW * 0.05), 0, TAU)
        ctx.fill()
        ctx.fillStyle = VERMILION // the lit rag
        ctx.beginPath()
        ctx.arc(0, -laneW * 0.05, Math.max(1, laneW * 0.022), 0, TAU)
        ctx.fill()
        ctx.restore()
    }

    // Dying machines — flung off the field, squashing + spinning + fading.
    if (fx) {
        for (const d of fx.deaths) {
            ctx.save()
            ctx.globalAlpha = Math.max(0, d.life / d.maxLife)
            ctx.translate(d.x, d.y)
            ctx.rotate(d.rot)
            ctx.scale(d.sx, d.sy)
            drawMachine(ctx, d.archetype, 0, 0, d.size, MACHINE_COLOR[d.archetype])
            ctx.restore()
        }
        ctx.globalAlpha = 1
    }

    // Turrets (deployed) — small outlined ochre emplacements.
    for (let lane = 0; lane < LANES; lane++) {
        if (s.turrets[lane] > 0) {
            const tx = lane * laneW + laneW / 2
            ctx.beginPath()
            ctx.rect(tx - 7, fieldBottom - 46, 14, 14)
            inkFill(ctx, OCHRE, 2)
        }
    }
    if (s.armed > 0) {
        ctx.fillStyle = TEAL
        ctx.globalAlpha = 0.5
        ctx.fillRect(0, fieldBottom - 5, w, 3)
        ctx.globalAlpha = 1
    }

    // Rebel — warm bust silhouette; leans on lane moves.
    const lean = fx ? fx.playerLean * laneW * 0.12 : 0
    const px = laneCenterX(lay, s.playerLane) + lean
    const rebelS = laneW * 0.34
    const rebelY = fieldBottom - rebelS * 0.5 - 6
    groundShadow(ctx, px, rebelY, rebelS)
    rebelPath(ctx, px, rebelY, rebelS)
    inkFill(ctx, VERMILION, 3)

    // Particles — hard ink/print flecks, inside the shake group.
    if (fx) {
        for (const p of fx.particles) {
            ctx.globalAlpha = Math.max(0, p.life / p.maxLife)
            ctx.fillStyle = p.color
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.size, 0, TAU)
            ctx.fill()
        }
        ctx.globalAlpha = 1
    }
    ctx.restore()

    // ── Barricade as a built object: a row of outlined timber blocks whose
    // count follows HP; a small tricolore flag on top. ──────────────────────
    const hpFrac = Math.max(0, s.barricadeHp / BARRICADE_MAX_HP)
    const planks = 10
    const intact = Math.ceil(hpFrac * planks)
    const pw = w / planks
    ctx.fillStyle = STOCK
    ctx.fillRect(0, fieldBottom, w, barricadeH)
    for (let i = 0; i < planks; i++) {
        const alive = i < intact
        const bx = i * pw
        const bh = alive ? barricadeH : barricadeH * 0.4
        ctx.beginPath()
        ctx.rect(bx + 1, fieldBottom + (barricadeH - bh), pw - 2, bh)
        inkFill(ctx, alive ? OCHRE : "#3a2f1e", 2)
    }
    // flag pole + tricolore at the strongest point of the line
    const fx0 = w * 0.5
    ctx.strokeStyle = INK_LINE
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(fx0, fieldBottom + 2)
    ctx.lineTo(fx0, fieldBottom - 16)
    ctx.stroke()
    for (let k = 0; k < 3; k++) {
        ctx.fillStyle = [VERMILION, PAPER, "#2b49a0"][k]
        ctx.fillRect(fx0 + 1, fieldBottom - 16 + k * 4, 14, 4)
    }

    // ── Full-field pops (unshaken). ──────────────────────────────────────────
    if (fx && fx.impact > 0) {
        ctx.globalAlpha = fx.impact * 0.32
        ctx.fillStyle = PAPER
        ctx.fillRect(0, fieldTop, w, fieldH)
        ctx.globalAlpha = 1
    }
    if (fx && fx.flash > 0) {
        ctx.globalAlpha = Math.min(0.5, fx.flash * 0.5)
        ctx.fillStyle = VERMILION
        ctx.fillRect(0, fieldTop, w, fieldH)
        ctx.globalAlpha = 1
    }

    // ── HUD (in-canvas masthead, Memba tokens). ──────────────────────────────
    ctx.fillStyle = "#100c1e"
    ctx.fillRect(0, 0, w, hudH)
    ctx.fillStyle = DIVIDER
    ctx.fillRect(0, hudH - 1, w, 1)
    // molotov charge — a vermilion bar with a notch at each throw threshold.
    const chargeFrac = Math.min(1, s.molotovCharge / MOLOTOV_MAX)
    ctx.fillStyle = "rgba(224,57,43,0.15)"
    ctx.fillRect(10, hudH - 22, w - 20, 5)
    ctx.fillStyle = VERMILION
    ctx.fillRect(10, hudH - 22, Math.floor((w - 20) * chargeFrac), 5)
    ctx.fillStyle = STOCK
    for (let i = 1; i * MOLOTOV_COST < MOLOTOV_MAX; i++) {
        ctx.fillRect(10 + Math.floor(((w - 20) * (i * MOLOTOV_COST)) / MOLOTOV_MAX), hudH - 22, 1, 5)
    }
    // rally meter — a real charge bar; teal track, ochre→vermilion fill, teal-ready.
    const rallyFrac = Math.min(1, s.rallyMeter / RALLY_FULL)
    const ready = rallyFrac >= 1
    ctx.fillStyle = "rgba(239,231,212,0.12)"
    ctx.fillRect(10, hudH - 12, w - 20, 7)
    ctx.fillStyle = ready ? TEAL : OCHRE
    ctx.fillRect(10, hudH - 12, Math.floor((w - 20) * rallyFrac), 7)
    // numerals in JetBrains Mono
    ctx.textBaseline = "alphabetic"
    ctx.fillStyle = GOLD
    ctx.font = "600 10px 'JetBrains Mono', monospace"
    ctx.fillText("SCORE", 10, 20)
    ctx.fillStyle = PAPER
    ctx.font = "700 22px 'JetBrains Mono', monospace"
    ctx.fillText(s.score.toLocaleString(), 10, 44)
    ctx.textAlign = "right"
    ctx.fillStyle = "#c9c2b0"
    ctx.font = "600 11px 'JetBrains Mono', monospace"
    // Past the boss, the HUD switches to the headline stat: the siege round.
    if (s.wave >= WAVE_TOTAL) {
        ctx.fillStyle = VERMILION
        ctx.fillText(`SIEGE r${s.wave - (WAVE_TOTAL - 1)}`, w - 10, 22)
    } else {
        ctx.fillText(`WAVE ${Math.min(s.wave + 1, WAVE_TOTAL)}/${WAVE_TOTAL}`, w - 10, 22)
    }
    ctx.fillStyle = GOLD
    ctx.fillText(`◆ ${s.scrap.toLocaleString()}`, w - 10, 40)
    ctx.textAlign = "start"

    // Onomatopoeia floaters (unshaken).
    if (fx) {
        ctx.textAlign = "center"
        ctx.font = "700 20px 'JetBrains Mono', monospace"
        for (const f of fx.floaters) {
            ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.maxLife))
            ctx.fillStyle = f.color
            ctx.fillText(f.text, f.x, f.y)
        }
        ctx.globalAlpha = 1
        ctx.textAlign = "start"
    }

    // Phase captions — printed ink-block banners.
    const caption = s.phase === "choice" ? "WAVE HELD" : s.phase === "boss" ? "THE BROADCAST TOWER" : ""
    if (caption) {
        const boss = s.phase === "boss"
        ctx.textAlign = "center"
        ctx.font = "700 20px 'JetBrains Mono', monospace"
        ctx.fillStyle = boss ? VERMILION : OCHRE
        ctx.fillText(caption, w / 2, fieldTop + fieldH * 0.32)
        ctx.font = "600 11px 'JetBrains Mono', monospace"
        ctx.fillStyle = "#c9c2b0"
        ctx.fillText(boss ? "the signal approaches" : "choose your next move", w / 2, fieldTop + fieldH * 0.32 + 20)
        ctx.textAlign = "start"
    }
}

/**
 * Idle "attract" scene for the ready / done canvas — the game at rest, so the
 * first thing a player sees is alive, not a dead black box. Render-only, driven
 * by a wall-clock `t` (seconds); never touches the sim.
 */
export function drawAttract(ctx: CanvasRenderingContext2D, view: ViewSize, t: number, reducedMotion = false): void {
    const { width: w, height: h } = view
    const lay = layout(w, h)
    const { hudH, barricadeH, fieldH, laneW } = lay
    const fieldTop = hudH
    const fieldBottom = hudH + fieldH
    const tt = reducedMotion ? 0 : t

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = STOCK
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = HORIZON
    ctx.fillRect(0, fieldTop, w, fieldH * 0.16)
    for (let lane = 0; lane < LANES; lane++) {
        if (lane % 2 === 1) {
            ctx.fillStyle = STOCK_ALT
            ctx.fillRect(lane * laneW, fieldTop, laneW, fieldH)
        }
        ctx.fillStyle = DIVIDER
        ctx.fillRect(Math.round(lane * laneW), fieldTop, 1, fieldH)
    }
    drawNightSky(ctx, lay, tt * 60, reducedMotion) // same backdrop as in play
    paintHalftone(ctx, 0, fieldTop, w, fieldH) // same screen-print grain as in play
    ctx.fillStyle = "#100c1e"
    ctx.fillRect(0, 0, w, hudH)

    const demo: ArchetypeId[] = ["drone", "walker", "phalanx"]
    demo.forEach((k, i) => {
        const lane = i % LANES
        const frac = (tt * 0.05 + i * 0.31) % 1
        const size = 0.4 * laneW * (0.62 + 0.38 * frac)
        const x = laneCenterX(lay, lane)
        const y = yFromFrac(lay, frac)
        groundShadow(ctx, x, y, size)
        drawMachine(ctx, k, x, y, size, MACHINE_COLOR[k])
    })

    const bob = Math.sin(tt * 2) * 2
    const px = laneCenterX(lay, 1)
    const rebelS = laneW * 0.34
    const rebelY = fieldBottom - rebelS * 0.5 - 6 + bob
    groundShadow(ctx, px, rebelY, rebelS)
    rebelPath(ctx, px, rebelY, rebelS)
    inkFill(ctx, VERMILION, 3)

    const planks = 10
    const pw = w / planks
    ctx.fillStyle = STOCK
    ctx.fillRect(0, fieldBottom, w, barricadeH)
    for (let i = 0; i < planks; i++) {
        ctx.beginPath()
        ctx.rect(i * pw + 1, fieldBottom, pw - 2, barricadeH)
        inkFill(ctx, OCHRE, 2)
    }
    const pole = w * 0.5
    ctx.strokeStyle = INK_LINE
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(pole, fieldBottom + 2)
    ctx.lineTo(pole, fieldBottom - 16)
    ctx.stroke()
    for (let k = 0; k < 3; k++) {
        ctx.fillStyle = [VERMILION, PAPER, "#2b49a0"][k]
        ctx.fillRect(pole + 1, fieldBottom - 16 + k * 4, 14, 4)
    }

    const pulse = reducedMotion ? 0.85 : 0.55 + 0.45 * Math.sin(tt * 3)
    ctx.globalAlpha = pulse
    ctx.textAlign = "center"
    ctx.fillStyle = TEAL
    ctx.font = "700 14px 'JetBrains Mono', monospace"
    ctx.fillText("▶  PRESS DAILY RUN", w / 2, fieldTop + fieldH * 0.68)
    ctx.globalAlpha = 1
    ctx.textAlign = "start"
}
