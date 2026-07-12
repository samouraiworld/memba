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
import { BARRICADE_MAX_HP, LANES, LANE_LENGTH, RALLY_FULL, type ArchetypeId, type SimState } from "../sim/types"
import { layout, laneCenterX, yFromFrac, type FxState } from "./fx"

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

// Order machines — cold steels, brightened to read on the dark stock.
const MACHINE_COLOR: Record<ArchetypeId, string> = {
    drone: "#8fa8e0",
    netter: "#7f9fd8",
    walker: "#6b82c0",
    phalanx: "#5870b0",
    siege: "#42568f",
    broadcast: "#2b2748",
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

// ── Per-archetype silhouettes (ctx path commands; no Path2D so jsdom tests run).
// Each builds a closed path centred on (x,y), sized by s, then callers ink it.
function machinePath(ctx: CanvasRenderingContext2D, kind: ArchetypeId, x: number, y: number, s: number): void {
    ctx.beginPath()
    switch (kind) {
        case "drone": // fast dart / downward chevron
            ctx.moveTo(x, y + s * 0.52)
            ctx.lineTo(x - s * 0.42, y - s * 0.34)
            ctx.lineTo(x, y - s * 0.12)
            ctx.lineTo(x + s * 0.42, y - s * 0.34)
            ctx.closePath()
            break
        case "netter": // wide trapezoid + two claw prongs
            ctx.moveTo(x - s * 0.5, y - s * 0.28)
            ctx.lineTo(x + s * 0.5, y - s * 0.28)
            ctx.lineTo(x + s * 0.34, y + s * 0.22)
            ctx.lineTo(x + s * 0.44, y + s * 0.5)
            ctx.lineTo(x + s * 0.2, y + s * 0.26)
            ctx.lineTo(x - s * 0.2, y + s * 0.26)
            ctx.lineTo(x - s * 0.44, y + s * 0.5)
            ctx.lineTo(x - s * 0.34, y + s * 0.22)
            ctx.closePath()
            break
        case "walker": // riot-trooper tombstone + squared shoulders
            ctx.moveTo(x - s * 0.36, y + s * 0.5)
            ctx.lineTo(x - s * 0.36, y - s * 0.16)
            ctx.quadraticCurveTo(x, y - s * 0.62, x + s * 0.36, y - s * 0.16)
            ctx.lineTo(x + s * 0.36, y + s * 0.5)
            ctx.closePath()
            break
        case "phalanx": { // wide hexagon shield
            const wd = s * 0.6
            const ht = s * 0.42
            ctx.moveTo(x - wd, y)
            ctx.lineTo(x - wd * 0.55, y - ht)
            ctx.lineTo(x + wd * 0.55, y - ht)
            ctx.lineTo(x + wd, y)
            ctx.lineTo(x + wd * 0.55, y + ht)
            ctx.lineTo(x - wd * 0.55, y + ht)
            ctx.closePath()
            break
        }
        case "siege": // heavy octagon with a pointed ram nose
            ctx.moveTo(x - s * 0.24, y - s * 0.5)
            ctx.lineTo(x + s * 0.24, y - s * 0.5)
            ctx.lineTo(x + s * 0.5, y - s * 0.18)
            ctx.lineTo(x + s * 0.5, y + s * 0.14)
            ctx.lineTo(x + s * 0.2, y + s * 0.32)
            ctx.lineTo(x, y + s * 0.54) // ram nose
            ctx.lineTo(x - s * 0.2, y + s * 0.32)
            ctx.lineTo(x - s * 0.5, y + s * 0.14)
            ctx.lineTo(x - s * 0.5, y - s * 0.18)
            ctx.closePath()
            break
        case "broadcast": { // tall stacked tower + antenna
            const bw = s * 0.34
            ctx.moveTo(x - bw, y + s * 0.5)
            ctx.lineTo(x - bw * 0.6, y - s * 0.2)
            ctx.lineTo(x - s * 0.12, y - s * 0.2)
            ctx.lineTo(x - s * 0.05, y - s * 0.5) // antenna
            ctx.lineTo(x + s * 0.05, y - s * 0.5)
            ctx.lineTo(x + s * 0.12, y - s * 0.2)
            ctx.lineTo(x + bw * 0.6, y - s * 0.2)
            ctx.lineTo(x + bw, y + s * 0.5)
            ctx.closePath()
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

export function draw(ctx: CanvasRenderingContext2D, s: SimState, view: ViewSize, fx?: FxState): void {
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
    // depth (nearer = bigger) as well as HP → the lane reads as receding.
    const sorted = [...s.enemies].sort((a, b) => a.pos - b.pos)
    for (const e of sorted) {
        const frac = Math.min(1, e.pos / LANE_LENGTH)
        const a = ARCHETYPES[e.archetype]
        const hpFrac = Math.max(0.55, e.hp / a.hp)
        const depth = 0.62 + 0.38 * frac
        const size = (e.archetype === "broadcast" ? 0.66 : 0.4) * laneW * depth * hpFrac
        const x = laneCenterX(lay, e.lane)
        const y = yFromFrac(lay, frac)
        groundShadow(ctx, x, y, size)
        machinePath(ctx, e.archetype, x, y, size)
        inkFill(ctx, MACHINE_COLOR[e.archetype], 3)
        // lone vermilion sensor eye — a surveillance state
        ctx.fillStyle = VERMILION
        ctx.beginPath()
        ctx.arc(x, y - size * (e.archetype === "broadcast" ? 0.18 : 0.06), size * 0.1, 0, TAU)
        ctx.fill()
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
    ctx.fillText(`WAVE ${Math.min(s.wave + 1, WAVE_TOTAL)}/${WAVE_TOTAL}`, w - 10, 22)
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
        machinePath(ctx, k, x, y, size)
        inkFill(ctx, MACHINE_COLOR[k], 3)
        ctx.fillStyle = VERMILION
        ctx.beginPath()
        ctx.arc(x, y - size * 0.06, size * 0.1, 0, TAU)
        ctx.fill()
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
