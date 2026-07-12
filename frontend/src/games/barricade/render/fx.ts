/**
 * Render-only juice layer. Holds transient presentation state — screenshake,
 * particles, flashes, floating onomatopoeia — driven entirely from FX events
 * (see fxEvents.ts). Nothing here touches the sim or the input log, so it can
 * never change a replay; `prefers-reduced-motion` collapses it to near-nothing.
 *
 * The sim owns truth; this owns feel. All wall-clock/random use lives here
 * (never in sim/), where it is safe.
 */

import { LANES } from "../sim/types"
import type { FxEvent } from "./fxEvents"

export type Rng = () => number

export type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number }
export type Floater = { x: number; y: number; life: number; maxLife: number; text: string; color: string }

export type FxState = {
    shakeMag: number // 0..1, decays
    shakeX: number
    shakeY: number
    shakeRot: number // radians
    impact: number // 0..1 heavy-hit brightness pop, decays
    flash: number // 0..1 rally/boss full-field flash, decays
    playerLean: number // -1..1, decays
    combo: number // render-side kill streak (onomatopoeia + audio pitch)
    particles: Particle[]
    floaters: Floater[]
    reducedMotion: boolean
}

export type Layout = { w: number; h: number; hudH: number; barricadeH: number; fieldH: number; laneW: number }

// Riso-plate palette (matches draw.ts — the locked "Riso Protest" direction).
const INK = "#201a2e"
const VERMILION = "#e0392b"
const OCHRE = "#dba43c"
const PAPER = "#efe7d4"

const MAX_PARTICLES = 220
const MAX_FLOATERS = 12
const MAX_SHAKE_PX = 10
const MAX_SHAKE_ROT = 0.014 // ~0.8° at full magnitude — "reads as force", not a glitch
const SHAKE_DECAY = 0.8
const IMPACT_DECAY = 0.78
const FLASH_DECAY = 0.85
const LEAN_DECAY = 0.8
const GRAVITY = 0.16

/** Shared field geometry — the ONE source both draw() and fx placement use. */
export function layout(w: number, h: number): Layout {
    const hudH = Math.floor(h * 0.1)
    const barricadeH = Math.floor(h * 0.08)
    const fieldH = h - hudH - barricadeH
    const laneW = w / LANES
    return { w, h, hudH, barricadeH, fieldH, laneW }
}

export const laneCenterX = (lay: Layout, lane: number): number => lane * lay.laneW + lay.laneW / 2
export const yFromFrac = (lay: Layout, frac: number): number => lay.hudH + frac * lay.fieldH

export function initFx(reducedMotion = false): FxState {
    return {
        shakeMag: 0,
        shakeX: 0,
        shakeY: 0,
        shakeRot: 0,
        impact: 0,
        flash: 0,
        playerLean: 0,
        combo: 0,
        particles: [],
        floaters: [],
        reducedMotion,
    }
}

function addShake(fx: FxState, mag: number): void {
    fx.shakeMag = Math.min(1, Math.max(fx.shakeMag, mag))
}

function spawnBurst(fx: FxState, x: number, y: number, n: number, colors: string[], rng: Rng, spread = 3): void {
    for (let i = 0; i < n; i++) {
        if (fx.particles.length >= MAX_PARTICLES) return
        const ang = rng() * Math.PI * 2
        const spd = rng() * spread + 0.5
        const life = 14 + Math.floor(rng() * 16)
        fx.particles.push({
            x,
            y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd - 1,
            life,
            maxLife: life,
            color: colors[Math.floor(rng() * colors.length)],
            size: 1.5 + rng() * 2,
        })
    }
}

function pushFloater(fx: FxState, x: number, y: number, text: string, color: string): void {
    if (fx.floaters.length >= MAX_FLOATERS) fx.floaters.shift()
    fx.floaters.push({ x, y, life: 42, maxLife: 42, text, color })
}

const COMBO_WORDS = ["boum", "vas-y", "tenez", "encore"]

/**
 * Fold a batch of FX events into the presentation state. `rng` is injectable so
 * tests are deterministic; it defaults to Math.random in the browser.
 */
export function pushFxEvents(fx: FxState, events: FxEvent[], lay: Layout, rng: Rng = Math.random): void {
    for (const ev of events) {
        // Reduced motion: keep the combo bookkeeping (scoring feel) but emit no
        // shake, particles, flashes or moving text.
        if (fx.reducedMotion) {
            if (ev.kind === "kill") fx.combo++
            else if (ev.kind === "barricadeHit") fx.combo = 0
            continue
        }

        switch (ev.kind) {
            case "kill": {
                fx.combo++
                addShake(fx, 0.18 + ev.weight * 0.12)
                if (ev.weight >= 3) fx.impact = Math.max(fx.impact, 0.45)
                const x = laneCenterX(lay, ev.lane)
                const y = yFromFrac(lay, ev.posFrac)
                spawnBurst(fx, x, y, 3 + ev.weight, [INK, VERMILION], rng, 2 + ev.weight)
                fx.playerLean = Math.max(-1, Math.min(1, ev.lane - 1)) * 0.4
                if (fx.combo % 5 === 0) pushFloater(fx, x, y, COMBO_WORDS[(fx.combo / 5) % COMBO_WORDS.length | 0], VERMILION)
                break
            }
            case "barricadeHit": {
                fx.combo = 0
                addShake(fx, Math.min(1, 0.5 + ev.damageFrac * 6))
                fx.impact = Math.max(fx.impact, 0.4)
                const y = lay.hudH + lay.fieldH
                spawnBurst(fx, lay.w * (0.2 + rng() * 0.6), y, 6, [OCHRE, INK], rng, 3)
                break
            }
            case "rally": {
                fx.flash = 1
                addShake(fx, 0.7)
                spawnBurst(fx, lay.w / 2, lay.hudH + lay.fieldH * 0.5, 18, [VERMILION, PAPER, OCHRE], rng, 5)
                pushFloater(fx, lay.w / 2, lay.hudH + lay.fieldH * 0.4, "tenez!", VERMILION)
                break
            }
            case "rallyReady":
                fx.flash = Math.max(fx.flash, 0.15)
                break
            case "move":
                addShake(fx, 0.1)
                fx.playerLean = Math.max(-1, Math.min(1, ev.lane - 1)) * 0.6
                break
            case "phase":
                if (ev.phase === "boss") {
                    addShake(fx, 0.9)
                    fx.flash = Math.max(fx.flash, 0.4)
                } else if (ev.phase === "won" || ev.phase === "lost") {
                    fx.flash = Math.max(fx.flash, 0.5)
                }
                break
            case "bossSpawn":
                addShake(fx, 0.9)
                fx.impact = Math.max(fx.impact, 0.6)
                fx.flash = Math.max(fx.flash, 0.4)
                pushFloater(fx, laneCenterX(lay, ev.lane), lay.hudH + lay.fieldH * 0.3, "the broadcast tower", INK)
                break
            case "deploy":
                addShake(fx, 0.12)
                spawnBurst(fx, laneCenterX(lay, ev.lane), lay.hudH + lay.fieldH - 30, 4, [OCHRE, INK], rng, 2)
                break
            case "stun":
                addShake(fx, 0.2)
                pushFloater(fx, laneCenterX(lay, ev.lane), lay.hudH + lay.fieldH - 40, "stunned", INK)
                break
        }
    }
}

/** Advance every transient one frame. Pure render bookkeeping — no sim reads. */
export function stepFx(fx: FxState, rng: Rng = Math.random): void {
    fx.shakeMag *= SHAKE_DECAY
    if (fx.shakeMag < 0.02) fx.shakeMag = 0
    if (fx.shakeMag > 0 && !fx.reducedMotion) {
        fx.shakeX = (rng() * 2 - 1) * fx.shakeMag * MAX_SHAKE_PX
        fx.shakeY = (rng() * 2 - 1) * fx.shakeMag * MAX_SHAKE_PX
        fx.shakeRot = (rng() * 2 - 1) * fx.shakeMag * MAX_SHAKE_ROT
    } else {
        fx.shakeX = 0
        fx.shakeY = 0
        fx.shakeRot = 0
    }

    fx.impact *= IMPACT_DECAY
    if (fx.impact < 0.02) fx.impact = 0
    fx.flash *= FLASH_DECAY
    if (fx.flash < 0.02) fx.flash = 0
    fx.playerLean *= LEAN_DECAY
    if (Math.abs(fx.playerLean) < 0.02) fx.playerLean = 0

    let w = 0
    for (let i = 0; i < fx.particles.length; i++) {
        const p = fx.particles[i]
        p.x += p.vx
        p.y += p.vy
        p.vy += GRAVITY
        p.life--
        if (p.life > 0) fx.particles[w++] = p
    }
    fx.particles.length = w

    let fw = 0
    for (let i = 0; i < fx.floaters.length; i++) {
        const f = fx.floaters[i]
        f.y -= 0.8
        f.life--
        if (f.life > 0) fx.floaters[fw++] = f
    }
    fx.floaters.length = fw
}
