/**
 * Web-Audio synth — no sound files, every blip generated live (oscillator +
 * gain envelope). Audio is one of the three biggest drivers of "impact feel";
 * the cheapest way to add it is to synthesize and couple it to the same FX
 * events the visuals use, so the sound fires on the exact frame of the hit.
 *
 * Muted by default (mobile web autoplay policy); `resume()` runs on the first
 * user gesture. Degrades to a silent no-op wherever Web Audio is unavailable
 * (SSR, tests), so it is safe to construct anywhere.
 */

import type { FxEvent } from "./fxEvents"

export const BASE_FREQ = 200
const SEMITONE = 1.05946
const COMBO_CAP = 18

/** Kill pitch rises with the streak (combo), capped so it never gets shrill. */
export function comboToFreq(combo: number): number {
    return BASE_FREQ * Math.pow(SEMITONE, Math.min(Math.max(combo, 0), COMBO_CAP))
}

/** Small per-hit detune in cents so repeated blips never feel robotic. */
export function detuneCents(rng: () => number): number {
    return (rng() * 2 - 1) * 25
}

function audioCtor(): typeof AudioContext | null {
    if (typeof window === "undefined") return null
    const w = window as unknown as {
        AudioContext?: typeof AudioContext
        webkitAudioContext?: typeof AudioContext
    }
    return w.AudioContext ?? w.webkitAudioContext ?? null
}

export class GameAudio {
    private ctx: AudioContext | null = null
    muted: boolean

    constructor(muted = true, private rng: () => number = Math.random) {
        this.muted = muted
    }

    /** Lazily create the context (must follow a user gesture on most browsers). */
    private ensure(): AudioContext | null {
        if (this.ctx) return this.ctx
        const Ctor = audioCtor()
        if (!Ctor) return null
        try {
            this.ctx = new Ctor()
        } catch {
            this.ctx = null
        }
        return this.ctx
    }

    setMuted(muted: boolean): void {
        this.muted = muted
        if (!muted) this.resume()
    }

    resume(): void {
        const ctx = this.ensure()
        if (ctx && ctx.state === "suspended") void ctx.resume()
    }

    /** Release the audio context on unmount. */
    close(): void {
        if (this.ctx) {
            void this.ctx.close()
            this.ctx = null
        }
    }

    private blip(freq: number, dur: number, type: OscillatorType, gain: number, detune = 0): void {
        if (this.muted) return
        const ctx = this.ensure()
        if (!ctx) return
        const t = ctx.currentTime
        const osc = ctx.createOscillator()
        const env = ctx.createGain()
        osc.type = type
        osc.frequency.setValueAtTime(freq, t)
        if (detune) osc.detune.setValueAtTime(detune, t)
        env.gain.setValueAtTime(gain, t)
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        osc.connect(env).connect(ctx.destination)
        osc.start(t)
        osc.stop(t + dur)
    }

    /** Route an FX event to a sound. `combo` drives the kill pitch-ladder. */
    onFxEvent(ev: FxEvent, combo: number): void {
        if (this.muted) return
        switch (ev.kind) {
            case "kill":
                this.blip(comboToFreq(combo), 0.07, "square", 0.06, detuneCents(this.rng))
                break
            case "barricadeHit":
                // Bass = power; a short low thud sells the damage.
                this.blip(70, 0.16, "sawtooth", 0.14)
                break
            case "rally":
                this.blip(330, 0.28, "triangle", 0.12)
                break
            case "bossSpawn":
            case "phase":
                if (ev.kind === "bossSpawn" || ev.phase === "boss") this.blip(55, 0.5, "sawtooth", 0.12)
                break
            case "deploy":
                this.blip(180, 0.09, "square", 0.05)
                break
            default:
                break
        }
    }
}
