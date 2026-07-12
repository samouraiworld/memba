/**
 * Canvas renderer — a pure function of (ctx, SimState, size, fx?). Never mutates
 * sim state and never reads the clock; all gameplay motion comes from the sim's
 * integer state. The optional FxState carries render-only juice (screenshake,
 * particles, flashes, floating onomatopoeia) — reading it here cannot change a
 * replay (see fx.parity.test.ts).
 *
 * Direction: "Riso Protest" — flat screen-print plates, warm rebel vs. cold
 * Order machines (threat-coding by colour temperature). Full sprite/atlas art
 * is a follow-on; enemies are palette silhouettes for now.
 */

import { ARCHETYPES, WAVE_TOTAL } from "../sim/waves"
import { BARRICADE_MAX_HP, LANES, LANE_LENGTH, RALLY_FULL, type ArchetypeId, type SimState } from "../sim/types"
import { layout, laneCenterX, yFromFrac, type FxState } from "./fx"

export type ViewSize = { width: number; height: number }

const TAU = Math.PI * 2

// Riso plates.
const PAPER = "#efe7d4"
const PAPER_ALT = "#eae0cb"
const INK = "#201a2e"
const DIVIDER = "#cdbf9f"
const VERMILION = "#e0392b"
const OCHRE = "#dba43c"

// Order machines — all cold (threat-coding). Distinct steels for readability.
const MACHINE_COLOR: Record<ArchetypeId, string> = {
    drone: "#5b6b8f",
    netter: "#6a7fa8",
    walker: "#454f6b",
    phalanx: "#373f59",
    siege: "#2b3350",
    broadcast: "#201a2e",
}

export function draw(ctx: CanvasRenderingContext2D, s: SimState, view: ViewSize, fx?: FxState): void {
    const { width: w, height: h } = view
    const lay = layout(w, h)
    const { hudH, barricadeH, fieldH, laneW } = lay

    // Paper ground (full canvas, unshaken so the shake never reveals a gap).
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, w, h)
    for (let lane = 0; lane < LANES; lane++) {
        if (lane % 2 === 1) {
            ctx.fillStyle = PAPER_ALT
            ctx.fillRect(lane * laneW, hudH, laneW, fieldH)
        }
        ctx.fillStyle = DIVIDER
        ctx.fillRect(lane * laneW, hudH, 1, fieldH)
    }

    // Shaken scene group.
    ctx.save()
    if (fx && (fx.shakeX !== 0 || fx.shakeY !== 0 || fx.shakeRot !== 0)) {
        const cx = w / 2
        const cy = hudH + fieldH / 2
        ctx.translate(cx + fx.shakeX, cy + fx.shakeY)
        ctx.rotate(fx.shakeRot)
        ctx.translate(-cx, -cy)
    }

    // Enemies — cold silhouettes; boss carries a lone vermilion "eye".
    for (const e of s.enemies) {
        const frac = Math.min(1, e.pos / LANE_LENGTH)
        const a = ARCHETYPES[e.archetype]
        const hpFrac = Math.max(0.4, e.hp / a.hp)
        const size = (e.archetype === "broadcast" ? 0.62 : 0.34) * laneW * hpFrac
        const x = laneCenterX(lay, e.lane)
        const y = yFromFrac(lay, frac)
        ctx.fillStyle = MACHINE_COLOR[e.archetype]
        ctx.fillRect(x - size / 2, y - size / 2, size, size)
        ctx.fillStyle = INK
        ctx.fillRect(x - size / 2, y + size / 2 - 3, size, 3)
        if (e.archetype === "broadcast") {
            ctx.fillStyle = VERMILION
            ctx.fillRect(x - size * 0.12, y - size * 0.12, size * 0.24, size * 0.24)
        }
    }

    // Turrets + armed crowd.
    for (let lane = 0; lane < LANES; lane++) {
        if (s.turrets[lane] > 0) {
            ctx.fillStyle = OCHRE
            ctx.fillRect(lane * laneW + laneW / 2 - 6, hudH + fieldH - 44, 12, 12)
        }
    }
    if (s.armed > 0) {
        ctx.fillStyle = OCHRE
        ctx.fillRect(0, hudH + fieldH - 4, w, 4)
    }

    // Rebel — warm, leans on lane moves.
    const lean = fx ? fx.playerLean * laneW * 0.12 : 0
    const px = laneCenterX(lay, s.playerLane) + lean
    ctx.fillStyle = VERMILION
    ctx.fillRect(px - laneW * 0.14, hudH + fieldH - 26, laneW * 0.28, 22)

    // Barricade band with ochre HP fill + plank ticks.
    ctx.fillStyle = INK
    ctx.fillRect(0, hudH + fieldH, w, barricadeH)
    const hpFrac = Math.max(0, s.barricadeHp / BARRICADE_MAX_HP)
    ctx.fillStyle = OCHRE
    ctx.fillRect(0, hudH + fieldH, Math.floor(w * hpFrac), barricadeH)
    ctx.fillStyle = INK
    for (let i = 1; i < 8; i++) ctx.fillRect((w * i) / 8, hudH + fieldH, 1, barricadeH)

    // Particles (halftone-ish ink flecks), inside the shake group.
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

    // Full-field pops (unshaken overlays).
    if (fx && fx.impact > 0) {
        ctx.globalAlpha = fx.impact * 0.5
        ctx.fillStyle = PAPER
        ctx.fillRect(0, hudH, w, fieldH)
        ctx.globalAlpha = 1
    }
    if (fx && fx.flash > 0) {
        ctx.globalAlpha = Math.min(0.6, fx.flash * 0.6)
        ctx.fillStyle = VERMILION
        ctx.fillRect(0, hudH, w, fieldH)
        ctx.globalAlpha = 1
    }

    // HUD.
    ctx.fillStyle = INK
    ctx.font = "bold 14px 'Arial Narrow', system-ui, sans-serif"
    ctx.fillText(`SCORE ${s.score}`, 8, hudH - 10)
    ctx.fillText(`WAVE ${Math.min(s.wave + 1, WAVE_TOTAL)}/${WAVE_TOTAL}`, Math.floor(w * 0.38), hudH - 10)
    ctx.fillText(`SCRAP ${s.scrap}`, Math.floor(w * 0.68), hudH - 10)
    const rallyFrac = Math.min(1, s.rallyMeter / RALLY_FULL)
    ctx.fillStyle = INK
    ctx.fillRect(0, 0, w, 6)
    ctx.fillStyle = rallyFrac >= 1 ? VERMILION : "#8a7f68"
    ctx.fillRect(0, 0, Math.floor(w * rallyFrac), 6)

    // Onomatopoeia floaters (unshaken, screen space).
    if (fx) {
        ctx.textAlign = "center"
        ctx.font = "bold 20px 'Arial Narrow', system-ui, sans-serif"
        for (const f of fx.floaters) {
            ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.maxLife))
            ctx.fillStyle = f.color
            ctx.fillText(f.text, f.x, f.y)
        }
        ctx.globalAlpha = 1
        ctx.textAlign = "start"
    }

    // Phase captions.
    if (s.phase === "choice") {
        ctx.fillStyle = INK
        ctx.font = "bold 18px 'Arial Narrow', system-ui, sans-serif"
        ctx.fillText("WAVE HELD — choose your next move", 12, hudH + 30)
    } else if (s.phase === "boss") {
        ctx.fillStyle = VERMILION
        ctx.font = "bold 18px 'Arial Narrow', system-ui, sans-serif"
        ctx.fillText("THE BROADCAST TOWER APPROACHES", 12, hudH + 30)
    }
}
