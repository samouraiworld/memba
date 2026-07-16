/**
 * draw25d.ts — THROWAWAY 2.5D comparator renderer (Phase 0 bake-off, arm A).
 *
 * Same frozen sim, same archetype art (reuses draw.ts's `drawMachine`), but
 * composed as a fake-perspective "front line": a receding ground plane
 * (foreshortened, lanes fanning OUT toward a big PARAPET foreground), a
 * procedural parapet bust + a horizon boss (hero-art placeholders), distance fog,
 * and parallax depth rungs. Its ONLY job is the side-by-side "is 'cheap' about
 * dimensionality, or composition + hero art?" question — a 3D-free arm to weigh
 * against the real spike (PR-0c) before committing to three.
 *
 * Render-only: it reads the same per-frame SimState + FxState the 2D renderer
 * does and mutates neither, so the sim, its replay log, and the G3 verifier are
 * untouched (fx.parity covers this). Gated behind VITE_ENABLE_BARRICADE_25D /
 * ?r25d=1 — never the shipped 2D path.
 */
import { ARCHETYPES } from "../sim/waves"
import { MARSHAL_CYCLE, MARSHAL_UP, MOLOTOV_MAX, panopticonMode } from "../sim/engine"
import { BARRICADE_MAX_HP, LANES, LANE_LENGTH, RALLY_FULL, type SimState } from "../sim/types"
import { layout, laneCenterX, type FxState, type Layout } from "./fx"
import { laneThreats } from "./telegraph"
import { paletteFor } from "./palette"
import { drawMachine, groundShadow, drawNightSky, paintHalftone, MACHINE_COLOR, type ViewSize } from "./draw"

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

// ── Hero placeholders (procedural; real art is a separate owner-gated drop) ───

/** A large cold Order chassis rising on the spawn horizon during a boss looming. */
function drawHorizonBoss(ctx: CanvasRenderingContext2D, cx: number, horizonY: number, s: number): void {
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
    // wall body (crest → bottom of canvas), gently arced toward the viewer
    ctx.fillStyle = "#1a1330"
    ctx.beginPath()
    ctx.moveTo(0, crest + 12)
    ctx.quadraticCurveTo(w / 2, crest - 8, w, crest + 12)
    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    ctx.fill()
    // warm torn-poster crest line
    ctx.strokeStyle = OCHRE
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(0, crest + 12)
    ctx.quadraticCurveTo(w / 2, crest - 8, w, crest + 12)
    ctx.stroke()
    // sandbags along the crest — a low-HP wall reads as gaps toward the right
    const hpFrac = clamp01(s.barricadeHp / BARRICADE_MAX_HP)
    const bags = 7
    const bw = w / bags
    for (let i = 0; i < bags; i++) {
        if (i / bags > hpFrac + 0.1) continue // breached section
        const bx = (i + 0.5) * bw
        const by = crest - 4 + Math.sin(i * 1.7) * 3
        inkRect(ctx, bx - bw * 0.42, by, bw * 0.84, fieldH * 0.055, i % 2 ? "#2a2140" : "#241a38", 2.5)
    }
    // a strand of barbed wire above the crest
    ctx.strokeStyle = "rgba(239,231,212,0.28)"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let x = 0; x <= w; x += 6) ctx.lineTo(x, crest - 10 + Math.sin(x * 0.25) * 3)
    ctx.stroke()
}

/** The rebel bust at the parapet — a big warm PFP placeholder (Pipeline A). */
function drawParapetBust(ctx: CanvasRenderingContext2D, cx: number, baseY: number, s: number, fx?: FxState): void {
    const lean = fx ? fx.playerLean * 0.12 : 0
    const x = cx + lean * s
    const y = baseY - s * 0.02
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
    // eyes
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(x - s * 0.1, y - s * 0.24, s * 0.03, 0, TAU)
    ctx.arc(x + s * 0.1, y - s * 0.24, s * 0.03, 0, TAU)
    ctx.fill()
    // a raised fist beside the shoulder
    inkRect(ctx, x + s * 0.42, y + s * 0.02, s * 0.18, s * 0.18, OCHRE, 2.5)
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

// ── The main 2.5D pass ────────────────────────────────────────────────────────
export function draw25d(ctx: CanvasRenderingContext2D, s: SimState, view: ViewSize, fx?: FxState, interp?: Map<number, number>): void {
    const { width: w, height: h } = view
    const lay = layout(w, h)
    const { hudH, fieldH, laneW } = lay
    const horizonY = hudH + fieldH * HORIZON_FRAC
    const barricadeY = hudH + fieldH
    const plate = paletteFor(s.seed)

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = STOCK
    ctx.fillRect(0, 0, w, h)

    // ── receding ground plane: 3 lane trapezoids, narrow at horizon → fanned near
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
    drawNightSky(ctx, lay, s.tick, fx?.reducedMotion ?? false, plate)

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
        const base = e.archetype === "broadcast" ? 0.66 : 0.4
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

    // ── parapet foreground + hero bust (the defining 2.5D framing) ──
    drawParapet(ctx, lay, s)
    const bustX = projLane(lay, s.playerLane, 1).x
    drawParapetBust(ctx, bustX, barricadeY, laneW * 0.62, fx)

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
