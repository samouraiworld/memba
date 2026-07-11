/**
 * Canvas renderer — pure function of (ctx, SimState, size). Never mutates sim
 * state, never reads the clock; all motion comes from the sim's integer state.
 * Placeholder art (flat shapes) — the chibi sprite pipeline lands in G2.
 */

import { ARCHETYPES, WAVE_TOTAL } from "../sim/waves"
import { BARRICADE_MAX_HP, LANES, LANE_LENGTH, RALLY_FULL, type SimState } from "../sim/types"

export type ViewSize = { width: number; height: number }

const ARCHETYPE_COLOR: Record<string, string> = {
    drone: "#8fb4ff",
    walker: "#c78fff",
    phalanx: "#7fe0c3",
    netter: "#ffd166",
    siege: "#ff8f6b",
    broadcast: "#ff4d6d",
}

const INK = "#10131c"
const PAPER = "#f4efe6"
const LANE_A = "#1a1f2e"
const LANE_B = "#151a27"
const BARRICADE = "#e0b34c"
const PLAYER = "#ff4d6d"

export function draw(ctx: CanvasRenderingContext2D, s: SimState, view: ViewSize): void {
    const { width: w, height: h } = view
    const hudH = Math.floor(h * 0.1)
    const barricadeH = Math.floor(h * 0.08)
    const fieldH = h - hudH - barricadeH
    const laneW = w / LANES

    ctx.clearRect(0, 0, w, h)

    // field lanes
    for (let lane = 0; lane < LANES; lane++) {
        ctx.fillStyle = lane % 2 === 0 ? LANE_A : LANE_B
        ctx.fillRect(lane * laneW, hudH, laneW, fieldH)
    }

    // enemies (top = spawn, bottom = barricade)
    for (const e of s.enemies) {
        const frac = Math.min(1, e.pos / LANE_LENGTH)
        const a = ARCHETYPES[e.archetype]
        const hpFrac = Math.max(0.35, e.hp / a.hp)
        const size = (e.archetype === "broadcast" ? 0.62 : 0.34) * laneW * hpFrac
        const x = e.lane * laneW + laneW / 2
        const y = hudH + frac * (fieldH - size / 2)
        ctx.fillStyle = ARCHETYPE_COLOR[e.archetype]
        ctx.fillRect(x - size / 2, y - size / 2, size, size)
        ctx.fillStyle = INK
        ctx.fillRect(x - size / 2, y + size / 2 - 3, size, 3)
    }

    // player marker sitting on the barricade in their lane
    const px = s.playerLane * laneW + laneW / 2
    ctx.fillStyle = PLAYER
    ctx.fillRect(px - laneW * 0.14, hudH + fieldH - 26, laneW * 0.28, 22)

    // turrets + armed crowd markers
    for (let lane = 0; lane < LANES; lane++) {
        if (s.turrets[lane] > 0) {
            ctx.fillStyle = BARRICADE
            ctx.fillRect(lane * laneW + laneW / 2 - 6, hudH + fieldH - 44, 12, 12)
        }
    }
    if (s.armed > 0) {
        ctx.fillStyle = "#9be07f"
        ctx.fillRect(0, hudH + fieldH - 4, w, 4)
    }

    // barricade bar with HP fill
    ctx.fillStyle = INK
    ctx.fillRect(0, hudH + fieldH, w, barricadeH)
    const hpFrac = Math.max(0, s.barricadeHp / BARRICADE_MAX_HP)
    ctx.fillStyle = BARRICADE
    ctx.fillRect(0, hudH + fieldH, Math.floor(w * hpFrac), barricadeH)

    // HUD: score / wave / scrap / rally meter
    ctx.fillStyle = PAPER
    ctx.font = "bold 14px system-ui, sans-serif"
    ctx.fillText(`SCORE ${s.score}`, 8, hudH - 10)
    ctx.fillText(`WAVE ${Math.min(s.wave + 1, WAVE_TOTAL)}/${WAVE_TOTAL}`, Math.floor(w * 0.38), hudH - 10)
    ctx.fillText(`SCRAP ${s.scrap}`, Math.floor(w * 0.68), hudH - 10)
    const rallyFrac = Math.min(1, s.rallyMeter / RALLY_FULL)
    ctx.fillStyle = INK
    ctx.fillRect(0, 0, w, 6)
    ctx.fillStyle = rallyFrac >= 1 ? PLAYER : "#5a6b9e"
    ctx.fillRect(0, 0, Math.floor(w * rallyFrac), 6)

    // phase overlays
    if (s.phase === "choice") {
        ctx.fillStyle = PAPER
        ctx.font = "bold 18px system-ui, sans-serif"
        ctx.fillText("WAVE HELD — choose your next move", 12, hudH + 30)
    } else if (s.phase === "boss") {
        ctx.fillStyle = ARCHETYPE_COLOR.broadcast
        ctx.font = "bold 18px system-ui, sans-serif"
        ctx.fillText("THE BROADCAST TOWER APPROACHES", 12, hudH + 30)
    }
}
