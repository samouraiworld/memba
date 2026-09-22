/**
 * draw25d.ts — 2.5D front-line renderer, first built for the Phase 0 bake-off.
 *
 * Same frozen sim, same archetype art (reuses draw.ts's `drawMachine`), but
 * composed as a fake-perspective "front line": a receding ground plane
 * (foreshortened, lanes fanning OUT toward a big PARAPET foreground), a
 * Paris backdrop, original game-only defender and boss art with procedural
 * fallbacks, distance fog, and parallax depth rungs. It is the default desktop
 * view; compact screens retain 2D until the physical-phone renderer decision.
 *
 * Render-only: it reads the same per-frame SimState + FxState the 2D renderer
 * does and mutates neither, so the sim, its replay log, and the G3 verifier are
 * untouched (fx.parity covers this). Compact screens use 2D by default, and
 * VITE_ENABLE_BARRICADE_25D / ?r25d=1 can select this view explicitly.
 */
import { ARCHETYPES, WAVE_TOTAL } from "../sim/waves"
import { MARSHAL_CYCLE, MARSHAL_UP, MOLOTOV_MAX, panopticonMode } from "../sim/engine"
import { BARRICADE_MAX_HP, LANES, LANE_LENGTH, RALLY_FULL, type SimState } from "../sim/types"
import { layout, laneCenterX, type FxState, type Layout } from "./fx"
import { laneThreats } from "./telegraph"
import { paletteFor } from "./palette"
import { drawMachine, groundShadow, drawNightSky, paintHalftone, MACHINE_COLOR, type ViewSize } from "./draw"
import { scenePlate } from "./art"
import { spriteFor } from "./sprites"

// Riso-plate palette (subset — matches draw.ts / fx.ts).
const STOCK = "#141026"
const INK = "#0a0812"
const VERMILION = "#e0392b"
const OCHRE = "#dba43c"
const PAPER = "#efe7d4"
const TEAL = "#00d4aa"
const GOLD = "#f5a623"
const TAU = Math.PI * 2
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

function drawCover(ctx: CanvasRenderingContext2D, art: HTMLImageElement, x: number, y: number, w: number, h: number): void {
    const sourceRatio = art.naturalWidth / art.naturalHeight
    const targetRatio = w / h
    if (sourceRatio > targetRatio) {
        const sw = art.naturalHeight * targetRatio
        ctx.drawImage(art, (art.naturalWidth - sw) / 2, 0, sw, art.naturalHeight, x, y, w, h)
    } else {
        const sh = art.naturalWidth / targetRatio
        ctx.drawImage(art, 0, (art.naturalHeight - sh) / 2, art.naturalWidth, sh, x, y, w, h)
    }
}

function inkFill(ctx: CanvasRenderingContext2D, fill: string, lw = 3): void {
    ctx.fillStyle = fill
    ctx.fill()
    ctx.lineJoin = "round"
    ctx.lineCap = "round"
    ctx.lineWidth = lw
    ctx.strokeStyle = INK
    ctx.stroke()
}
function inkRect(ctx: CanvasRenderingContext2D, x: number, y: number, ww: number, hh: number, fill: string, lw = 3): void {
    ctx.beginPath()
    ctx.rect(x, y, ww, hh)
    inkFill(ctx, fill, lw)
}
function inkCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, lw = 2.5): void {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, TAU)
    inkFill(ctx, fill, lw)
}

// ── The fake-perspective projection ──────────────────────────────────────────
// frac 0 = spawn (far, at the horizon), 1 = barricade (near, at the foreground).
// pf = frac^GAMMA foreshortens: near rows spread out, far rows compress toward the
// horizon (the receding read). Lanes fan OUT toward the barricade (NEAR_W > 1) so
// the near front line reads broad in portrait — depth, plus recovered width.
const HORIZON_FRAC = 0.15
const GAMMA = 2.3
const FAR_W = 0.32
const NEAR_W = 1.24
const SCALE_FAR = 0.46
const SCALE_NEAR = 1.62

type Proj = { x: number; y: number; scale: number; pf: number }

function projectFlat(lay: Layout, flatX: number, frac: number): Proj {
    const pf = Math.pow(clamp01(frac), GAMMA)
    const horizonY = lay.hudH + lay.fieldH * HORIZON_FRAC
    const nearY = lay.hudH + lay.fieldH
    const cx = lay.w / 2
    const widthScale = FAR_W + (NEAR_W - FAR_W) * pf
    return {
        x: cx + (flatX - cx) * widthScale,
        y: horizonY + (nearY - horizonY) * pf,
        scale: SCALE_FAR + (SCALE_NEAR - SCALE_FAR) * pf,
        pf,
    }
}
const projLane = (lay: Layout, lane: number, frac: number): Proj => projectFlat(lay, laneCenterX(lay, lane), frac)
// Lane-EDGE x (edge in [0..LANES]) at a depth — for the receding ground trapezoids.
const edgeX = (lay: Layout, edge: number, frac: number): number => projectFlat(lay, edge * lay.laneW, frac).x

// ── Hero art with procedural fallbacks for unloaded/offline images ───────────

/** A large cold Order chassis rising on the spawn horizon during a boss looming. */
function drawHorizonBoss(ctx: CanvasRenderingContext2D, cx: number, horizonY: number, s: number): void {
    const art = scenePlate("broadcast")
    if (art) {
        const height = s * 0.9
        const width = height * art.naturalWidth / art.naturalHeight
        ctx.drawImage(art, cx - width / 2, horizonY - height * 0.82, width, height)
        return
    }
    const y = horizonY - s * 0.02
    ctx.globalAlpha = 0.92
    inkRect(ctx, cx - s * 0.5, y - s * 0.42, s, s * 0.44, "#2b2748", 3) // slab body
    inkRect(ctx, cx - s * 0.62, y - s * 0.28, s * 0.16, s * 0.3, "#232043", 3) // left tower
    inkRect(ctx, cx + s * 0.46, y - s * 0.28, s * 0.16, s * 0.3, "#232043", 3) // right tower
    inkRect(ctx, cx - s * 0.12, y - s * 0.6, s * 0.24, s * 0.2, "#232043", 3) // crown
    // optics array — the central gaze runs hot
    inkCircle(ctx, cx - s * 0.2, y - s * 0.2, s * 0.05, "#8fb0e0", 2)
    inkCircle(ctx, cx + s * 0.2, y - s * 0.2, s * 0.05, "#8fb0e0", 2)
    ctx.fillStyle = VERMILION
    ctx.beginPath()
    ctx.arc(cx, y - s * 0.22, s * 0.07, 0, TAU)
    ctx.fill()
    ctx.globalAlpha = 1
}

/** The defender's parapet across the near foreground — the "you hold the wall" frame. */
function drawParapet(ctx: CanvasRenderingContext2D, lay: Layout, s: SimState): void {
    const { w, h, hudH, fieldH } = lay
    const barricadeY = hudH + fieldH
    const crest = barricadeY - fieldH * 0.015
    // The wall is built from street cobbles and cart timber, not a modern
    // sandbag fortification. Missing stones expose damage as HP drops.
    ctx.fillStyle = "#211a30"
    ctx.beginPath()
    ctx.moveTo(0, crest + 12)
    ctx.quadraticCurveTo(w / 2, crest - 8, w, crest + 12)
    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    ctx.fill()
    // Salvaged cart rails interrupt the masonry rhythm and make its
    // street-built origin clear without modern barbed wire or sandbags.
    for (const side of [0, 1]) {
        const x = side ? w * 0.84 : w * 0.16
        const dir = side ? 1 : -1
        ctx.beginPath()
        ctx.moveTo(x - dir * w * 0.07, crest + fieldH * 0.06)
        ctx.lineTo(x + dir * w * 0.04, crest - fieldH * 0.065)
        ctx.lineTo(x + dir * w * 0.065, crest - fieldH * 0.055)
        ctx.lineTo(x - dir * w * 0.045, crest + fieldH * 0.07)
        ctx.closePath()
        inkFill(ctx, "#81572d", 2.5)
    }
    // A timber cart beam braces the lower rows.
    ctx.strokeStyle = "#81572d"
    ctx.lineWidth = Math.max(5, fieldH * 0.018)
    ctx.beginPath()
    ctx.moveTo(0, crest + fieldH * 0.06)
    ctx.lineTo(w, crest + fieldH * 0.038)
    ctx.stroke()
    ctx.strokeStyle = INK
    ctx.lineWidth = 2
    ctx.stroke()

    const hpFrac = clamp01(s.barricadeHp / BARRICADE_MAX_HP)
    for (let row = 1; row >= 0; row--) {
        const stones = row ? 11 : 9
        const bw = w / stones
        for (let i = 0; i < stones; i++) {
            if (i / stones > hpFrac + 0.1) continue
            const shift = row ? bw * 0.35 : 0
            const bx = i * bw - shift
            const by = crest + (row ? fieldH * 0.015 : -fieldH * 0.022) + Math.sin(i * 2.3 + row) * 4
            const stoneH = fieldH * (row ? 0.058 : 0.067)
            ctx.beginPath()
            ctx.moveTo(bx + bw * 0.1, by + stoneH * 0.11)
            ctx.lineTo(bx + bw * (0.68 + (i % 3) * 0.05), by)
            ctx.lineTo(bx + bw * 0.95, by + stoneH * 0.28)
            ctx.lineTo(bx + bw * (0.86 + (i % 2) * 0.05), by + stoneH * 0.85)
            ctx.lineTo(bx + bw * 0.17, by + stoneH)
            ctx.lineTo(bx, by + stoneH * 0.64)
            ctx.closePath()
            inkFill(ctx, row ? (i % 2 ? "#554e62" : "#6b6170") : (i % 3 ? "#807784" : "#9b9090"), 2.5)
            ctx.strokeStyle = "rgba(239,231,212,0.3)"
            ctx.lineWidth = 1.3
            ctx.beginPath()
            ctx.moveTo(bx + bw * 0.16, by + stoneH * 0.26)
            ctx.lineTo(bx + bw * 0.62, by + stoneH * 0.2)
            ctx.stroke()
        }
    }
}

/** Original game-only defender; procedural fallback remains for unloaded art. */
function drawParapetBust(ctx: CanvasRenderingContext2D, cx: number, baseY: number, s: number, fx?: FxState): void {
    const lean = fx ? fx.playerLean * 0.12 : 0
    const x = cx + lean * s
    const y = baseY - s * 0.02
    const art = scenePlate("citizen")
    if (art) {
        const width = s * 1.18
        const height = width * art.naturalHeight / art.naturalWidth
        ctx.drawImage(art, x - width / 2, baseY - height * 0.83, width, height)
        return
    }
    ctx.globalAlpha = 0.35 // grounding shadow
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.ellipse(x, baseY + s * 0.5, s * 0.6, s * 0.14, 0, 0, TAU)
    ctx.fill()
    ctx.globalAlpha = 1
    // shoulders (warm)
    ctx.beginPath()
    ctx.moveTo(x - s * 0.6, baseY + s * 0.55)
    ctx.quadraticCurveTo(x - s * 0.58, y + s * 0.06, x - s * 0.26, y - s * 0.02)
    ctx.quadraticCurveTo(x - s * 0.28, y - s * 0.52, x, y - s * 0.52)
    ctx.quadraticCurveTo(x + s * 0.28, y - s * 0.52, x + s * 0.26, y - s * 0.02)
    ctx.quadraticCurveTo(x + s * 0.58, y + s * 0.06, x + s * 0.6, baseY + s * 0.55)
    ctx.closePath()
    inkFill(ctx, VERMILION, 3.5)
    // Two cut-paper lapels break up the red mass and give the bust a torso.
    ctx.beginPath()
    ctx.moveTo(x - s * 0.26, y - s * 0.02)
    ctx.lineTo(x - s * 0.06, y + s * 0.43)
    ctx.lineTo(x - s * 0.34, y + s * 0.3)
    ctx.closePath()
    inkFill(ctx, "#a72e2b", 2)
    ctx.beginPath()
    ctx.moveTo(x + s * 0.26, y - s * 0.02)
    ctx.lineTo(x + s * 0.06, y + s * 0.43)
    ctx.lineTo(x + s * 0.34, y + s * 0.3)
    ctx.closePath()
    inkFill(ctx, "#b93930", 2)
    ctx.fillStyle = PAPER
    ctx.fillRect(x - s * 0.035, y + s * 0.1, s * 0.07, s * 0.24)
    // head
    inkCircle(ctx, x, y - s * 0.28, s * 0.26, OCHRE, 3.5)
    // bandana (tricolore blue)
    ctx.beginPath()
    ctx.moveTo(x - s * 0.26, y - s * 0.34)
    ctx.quadraticCurveTo(x, y - s * 0.46, x + s * 0.26, y - s * 0.34)
    ctx.lineTo(x + s * 0.26, y - s * 0.26)
    ctx.quadraticCurveTo(x, y - s * 0.38, x - s * 0.26, y - s * 0.26)
    ctx.closePath()
    inkFill(ctx, "#2b49a0", 2.5)
    // A tied bandana tail, strong brows and a few ink marks give the front bust
    // expression at both phone size and the larger desktop scale.
    ctx.beginPath()
    ctx.moveTo(x + s * 0.22, y - s * 0.3)
    ctx.lineTo(x + s * 0.38, y - s * 0.23)
    ctx.lineTo(x + s * 0.31, y - s * 0.1)
    ctx.closePath()
    inkFill(ctx, "#2b49a0", 2)
    ctx.strokeStyle = INK
    ctx.lineWidth = Math.max(1.5, s * 0.028)
    ctx.beginPath()
    ctx.moveTo(x - s * 0.16, y - s * 0.29)
    ctx.lineTo(x - s * 0.05, y - s * 0.31)
    ctx.moveTo(x + s * 0.05, y - s * 0.31)
    ctx.lineTo(x + s * 0.16, y - s * 0.29)
    ctx.stroke()
    // eyes, nose and a determined mouth
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(x - s * 0.1, y - s * 0.24, s * 0.03, 0, TAU)
    ctx.arc(x + s * 0.1, y - s * 0.24, s * 0.03, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = Math.max(1, s * 0.015)
    ctx.beginPath()
    ctx.moveTo(x, y - s * 0.19)
    ctx.lineTo(x - s * 0.015, y - s * 0.12)
    ctx.lineTo(x + s * 0.035, y - s * 0.11)
    ctx.moveTo(x - s * 0.08, y - s * 0.045)
    ctx.quadraticCurveTo(x, y - s * 0.02, x + s * 0.08, y - s * 0.05)
    ctx.stroke()
    // a raised fist beside the shoulder
    inkRect(ctx, x + s * 0.43, y + s * 0.17, s * 0.12, s * 0.22, VERMILION, 2.5)
    inkRect(ctx, x + s * 0.39, y - s * 0.01, s * 0.2, s * 0.2, OCHRE, 2.5)
    ctx.strokeStyle = INK
    ctx.lineWidth = Math.max(1, s * 0.012)
    for (let i = 1; i < 4; i++) {
        ctx.beginPath()
        ctx.moveTo(x + s * (0.39 + 0.05 * i), y - s * 0.005)
        ctx.lineTo(x + s * (0.39 + 0.05 * i), y + s * 0.075)
        ctx.stroke()
    }
}

// ── HUD (compact — the 2.5D arm keeps chrome minimal so the scene reads) ──────
function drawHud25d(ctx: CanvasRenderingContext2D, lay: Layout, s: SimState): void {
    const { w, hudH } = lay
    ctx.fillStyle = "rgba(10,8,18,0.72)"
    ctx.fillRect(0, 0, w, hudH)
    ctx.font = `700 ${Math.floor(hudH * 0.32)}px "JetBrains Mono", ui-monospace, monospace`
    ctx.textBaseline = "middle"
    // wordmark w/ a vermilion / tricolore off-register slip
    ctx.fillStyle = "#2b49a0"
    ctx.fillText("BARRICADE", 11, hudH * 0.5)
    ctx.fillStyle = VERMILION
    ctx.fillText("BARRICADE", 10, hudH * 0.5 - 1)
    // barricade HP bar
    const barW = w * 0.34
    const barX = w - barW - 12
    const barY = hudH * 0.3
    const barH = hudH * 0.22
    ctx.strokeStyle = INK
    ctx.lineWidth = 1
    ctx.strokeRect(barX, barY, barW, barH)
    ctx.fillStyle = VERMILION
    ctx.fillRect(barX + 1, barY + 1, (barW - 2) * clamp01(s.barricadeHp / BARRICADE_MAX_HP), barH - 2)
    // wave + score
    ctx.font = `600 ${Math.floor(hudH * 0.24)}px "JetBrains Mono", ui-monospace, monospace`
    ctx.fillStyle = PAPER
    ctx.fillText(`WAVE ${s.wave}${s.phase === "boss" ? " · BOSS" : ""}`, 11, hudH * 0.82)
    ctx.fillStyle = GOLD
    ctx.textAlign = "right"
    ctx.fillText(String(s.score), w - 12, hudH * 0.82)
    ctx.textAlign = "left"
    // molotov + rally pips under the HP bar
    const pip = hudH * 0.12
    const banked = Math.floor(s.molotovCharge / (MOLOTOV_MAX / 3))
    for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < banked ? VERMILION : "rgba(239,231,212,0.18)"
        ctx.beginPath()
        ctx.arc(barX + 4 + i * (pip + 4), hudH * 0.8, pip * 0.5, 0, TAU)
        ctx.fill()
    }
    ctx.fillStyle = s.rallyMeter >= RALLY_FULL ? TEAL : "rgba(0,212,170,0.25)"
    ctx.fillRect(barX + barW * 0.4, hudH * 0.74, barW * 0.6 * clamp01(s.rallyMeter / RALLY_FULL), hudH * 0.1)
}

/** A screen-printed title plate fills the calm ready state before the first wave. */
function drawReadyPlate(ctx: CanvasRenderingContext2D, lay: Layout): void {
    const { w, hudH, fieldH } = lay
    const x = w * 0.085
    const top = hudH + fieldH * 0.36
    const headline = Math.min(w * 0.072, fieldH * 0.12)
    ctx.save()
    ctx.textBaseline = "alphabetic"
    ctx.font = `900 ${Math.floor(headline)}px "JetBrains Mono", ui-monospace, monospace`
    ctx.fillStyle = "#2b49a0"
    ctx.fillText("HOLD THE", x + 4, top + 4)
    ctx.fillText("LINE.", x + 4, top + headline * 1.05 + 4)
    ctx.fillStyle = PAPER
    ctx.fillText("HOLD THE", x, top)
    ctx.fillStyle = VERMILION
    ctx.fillText("LINE.", x, top + headline * 1.05)
    ctx.fillStyle = OCHRE
    ctx.fillRect(x, top + headline * 1.27, Math.min(w * 0.37, headline * 7), 3)
    ctx.font = `700 ${Math.max(11, Math.floor(headline * 0.24))}px "JetBrains Mono", ui-monospace, monospace`
    ctx.fillStyle = PAPER
    ctx.fillText(`LIBERTÉ · ÉGALITÉ  /  ${WAVE_TOTAL} WAVES`, x, top + headline * 1.66)
    ctx.restore()
}

// ── The main 2.5D pass ────────────────────────────────────────────────────────
export function draw25d(ctx: CanvasRenderingContext2D, s: SimState, view: ViewSize, fx?: FxState, interp?: Map<number, number>, showReadyPlate = false): void {
    const { width: w, height: h } = view
    const lay = layout(w, h)
    const { hudH, fieldH, laneW } = lay
    const horizonY = hudH + fieldH * HORIZON_FRAC
    const barricadeY = hudH + fieldH
    const plate = paletteFor(s.seed)

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = STOCK
    ctx.fillRect(0, 0, w, h)

    const paris = scenePlate("paris")
    if (paris) drawCover(ctx, paris, 0, hudH, w, fieldH)

    // ── receding ground plane: 3 lane trapezoids, narrow at horizon → fanned near
    if (paris) ctx.globalAlpha = 0.52
    for (let lane = 0; lane < LANES; lane++) {
        ctx.fillStyle = lane % 2 === 1 ? plate.stockAlt : "#191234"
        ctx.beginPath()
        ctx.moveTo(edgeX(lay, lane, 0), horizonY)
        ctx.lineTo(edgeX(lay, lane + 1, 0), horizonY)
        ctx.lineTo(edgeX(lay, lane + 1, 1), barricadeY)
        ctx.lineTo(edgeX(lay, lane, 1), barricadeY)
        ctx.closePath()
        ctx.fill()
    }
    ctx.globalAlpha = 1
    // bright ink lane dividers (converging toward the horizon)
    for (let e = 0; e <= LANES; e++) {
        const edge = e === 0 || e === LANES
        ctx.strokeStyle = edge ? "rgba(219,164,60,0.5)" : "rgba(224,57,43,0.55)"
        ctx.lineWidth = edge ? 1.5 : 2
        ctx.beginPath()
        ctx.moveTo(edgeX(lay, e, 0), horizonY)
        ctx.lineTo(edgeX(lay, e, 1), barricadeY)
        ctx.stroke()
    }
    // parallax depth rungs (faint horizontals that bunch toward the horizon)
    ctx.strokeStyle = "rgba(239,231,212,0.06)"
    ctx.lineWidth = 1
    for (const rf of [0.25, 0.45, 0.64, 0.82, 0.94]) {
        const y = horizonY + (barricadeY - horizonY) * Math.pow(rf, GAMMA)
        ctx.beginPath()
        ctx.moveTo(edgeX(lay, 0, rf), y)
        ctx.lineTo(edgeX(lay, LANES, rf), y)
        ctx.stroke()
    }

    // night city at the horizon
    if (!paris) drawNightSky(ctx, lay, s.tick, fx?.reducedMotion ?? false, plate)

    // horizon boss looming (hero placeholder)
    if (s.phase === "boss" || s.enemies.some((e) => e.archetype === "broadcast" || e.archetype === "panopticon")) {
        drawHorizonBoss(ctx, w / 2, horizonY, Math.min(w * 0.5, laneW * 2.2))
    }

    // distance fog softening the far field
    const fog = ctx.createLinearGradient(0, horizonY, 0, horizonY + fieldH * 0.34)
    fog.addColorStop(0, "rgba(20,16,38,0.82)")
    fog.addColorStop(1, "rgba(20,16,38,0)")
    ctx.fillStyle = fog
    ctx.fillRect(0, horizonY, w, fieldH * 0.34)

    // ── shaken field group ──
    ctx.save()
    if (fx && (fx.shakeX !== 0 || fx.shakeY !== 0 || fx.shakeRot !== 0)) {
        const cx = w / 2
        const cy = (horizonY + barricadeY) / 2
        ctx.translate(cx + fx.shakeX, cy + fx.shakeY)
        ctx.rotate(fx.shakeRot)
        ctx.translate(-cx, -cy)
    }

    const rendered = s.enemies.map((e) => ({ e, pos: interp?.get(e.id) ?? e.pos })).sort((a, b) => a.pos - b.pos)

    // threat telegraphs (projected aim-lines to the barricade)
    const threats = laneThreats(rendered.map((r) => ({ lane: r.e.lane, pos: r.pos })))
    if (threats.length > 0) {
        const pulse = fx?.reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(s.tick * 0.25)
        ctx.strokeStyle = VERMILION
        ctx.lineCap = "round"
        for (const t of threats) {
            const top = projLane(lay, t.lane, t.frac)
            const bot = projLane(lay, t.lane, 1)
            ctx.globalAlpha = t.intensity * (0.5 + 0.45 * pulse) * 0.6
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(top.x, top.y)
            ctx.lineTo(bot.x, bot.y)
            ctx.stroke()
        }
        ctx.globalAlpha = 1
    }

    // enemies (projected, far-first; min-size clamp keeps far units legible)
    for (const { e, pos } of rendered) {
        const frac = clamp01(pos / LANE_LENGTH)
        const a = ARCHETYPES[e.archetype]
        const hpFrac = Math.max(0.55, e.hp / a.hp)
        const p = projLane(lay, e.lane, frac)
        const base = e.archetype === "broadcast" ? 0.78 : spriteFor(e.archetype) ? 0.52 : 0.4
        const size = Math.max(laneW * 0.15, base * laneW * p.scale * hpFrac)
        groundShadow(ctx, p.x, p.y, size)
        const shieldOpen = e.archetype === "marshal" && (s.tick - e.bornTick) % MARSHAL_CYCLE >= MARSHAL_UP
        drawMachine(ctx, e.archetype, p.x, p.y, size, MACHINE_COLOR[e.archetype], shieldOpen)
        if (e.archetype === "panopticon") {
            const mode = panopticonMode(e, s.tick)
            for (let m = 0; m < 4; m++) {
                ctx.fillStyle = m === mode ? VERMILION : "rgba(239,231,212,0.25)"
                ctx.beginPath()
                ctx.arc(p.x - size * 0.24 + m * size * 0.16, p.y - size * 0.72, size * 0.05, 0, TAU)
                ctx.fill()
            }
        }
    }

    // fire zones (projected ground decals)
    for (const hz of s.hazards) {
        const lo = projLane(lay, hz.lane, clamp01(hz.posLo / LANE_LENGTH))
        const hi = projLane(lay, hz.lane, clamp01(hz.posHi / LANE_LENGTH))
        const bandW = laneW * 0.6 * hi.scale
        const life = Math.max(0.2, Math.min(1, (hz.expiresAtTick - s.tick) / 60))
        const flick = fx?.reducedMotion ? 0 : Math.sin(s.tick * 0.6 + hz.id) * 3
        const midY = (lo.y + hi.y) / 2
        ctx.globalAlpha = 0.32
        ctx.fillStyle = "#180d08"
        ctx.fillRect(hi.x - bandW / 2, hi.y, bandW, lo.y - hi.y)
        ctx.globalAlpha = 0.85 * (fx?.reducedMotion ? 0.7 : 1)
        for (const t of [
            { col: VERMILION, sc: 1 },
            { col: OCHRE, sc: 0.6 },
            { col: PAPER, sc: 0.28 },
        ]) {
            const fw = bandW * 0.5 * t.sc * (0.7 + 0.3 * life)
            const fh = (lo.y - hi.y) * 0.9 * t.sc * life
            ctx.fillStyle = t.col
            ctx.beginPath()
            ctx.moveTo(hi.x - fw, midY + fh * 0.4)
            ctx.quadraticCurveTo(hi.x - fw * 0.3, midY - fh + flick, hi.x, midY - fh * 1.15 + flick)
            ctx.quadraticCurveTo(hi.x + fw * 0.3, midY - fh + flick, hi.x + fw, midY + fh * 0.4)
            ctx.closePath()
            ctx.fill()
        }
        ctx.globalAlpha = 1
    }

    // molotovs in flight (arc from the parapet toward the projected target)
    for (const pr of s.projectiles) {
        const target = projLane(lay, pr.lane, clamp01(pr.dist / LANE_LENGTH))
        const from = projLane(lay, pr.lane, 1)
        const prog = Math.max(0, Math.min(1, 1 - Math.max(0, pr.impactTick - s.tick) / 24))
        const px = from.x + (target.x - from.x) * prog
        const py = from.y + (target.y - from.y) * prog - Math.sin(prog * Math.PI) * fieldH * 0.14
        ctx.save()
        ctx.translate(px, py)
        ctx.rotate(prog * 6)
        ctx.fillStyle = OCHRE
        ctx.beginPath()
        ctx.arc(0, 0, Math.max(2, laneW * 0.05 * target.scale), 0, TAU)
        ctx.fill()
        ctx.fillStyle = VERMILION
        ctx.beginPath()
        ctx.arc(0, -laneW * 0.05, Math.max(1, laneW * 0.022), 0, TAU)
        ctx.fill()
        ctx.restore()
    }

    // dying machines + particles (fx — screen-space, at their stored positions)
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
        for (const p of fx.particles) {
            ctx.globalAlpha = Math.max(0, p.life / p.maxLife)
            ctx.fillStyle = p.color
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.size, 0, TAU)
            ctx.fill()
        }
        ctx.globalAlpha = 1
    }

    ctx.restore() // end shaken field group

    if (showReadyPlate) drawReadyPlate(ctx, lay)

    // ── parapet foreground + hero bust (the defining 2.5D framing) ──
    const bustX = projLane(lay, s.playerLane, 1).x
    drawParapetBust(ctx, bustX, barricadeY, laneW * 0.62, fx)
    drawParapet(ctx, lay, s)

    // armed neighbourhood along the crest
    if (s.armed > 0) {
        const fade = Math.min(1, s.armed / 120)
        ctx.globalAlpha = 0.75 * fade
        for (let i = 0; i < 9; i++) {
            const cxp = w * (0.06 + i * 0.11)
            const bob = fx?.reducedMotion ? 0 : ((s.tick >> 3) + i) % 2 === 0 ? 0 : 1.5
            ctx.fillStyle = PAPER
            ctx.beginPath()
            ctx.arc(cxp, barricadeY - 4 + bob, 2.6, 0, TAU)
            ctx.fill()
        }
        ctx.globalAlpha = 1
    }

    // HUD + print overlays
    drawHud25d(ctx, lay, s)
    paintHalftone(ctx, 0, hudH, w, fieldH)
    if (fx && fx.flash > 0.02) {
        ctx.fillStyle = `rgba(224,57,43,${fx.flash * 0.26})`
        ctx.fillRect(0, 0, w, h)
    }
    if (fx) {
        ctx.font = `800 ${Math.floor(laneW * 0.22)}px "JetBrains Mono", ui-monospace, monospace`
        ctx.textAlign = "center"
        for (const f of fx.floaters) {
            ctx.globalAlpha = Math.max(0, f.life / f.maxLife)
            ctx.fillStyle = f.color
            ctx.fillText(f.text.toUpperCase(), f.x, f.y)
        }
        ctx.globalAlpha = 1
        ctx.textAlign = "left"
    }
}
