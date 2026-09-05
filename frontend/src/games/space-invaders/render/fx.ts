import { CONFIG, type GameEvent } from "../engine";
import { rngFloat } from "../engine/prng";

// Cosmetic state has an RNG stream separate from the deterministic simulation.
// It is deliberately bounded and never reads or writes GameState, so adding
// visual richness cannot change replay or verification results.

export type FxColor = "paper" | "shot" | "hero" | "danger" | "signal" | "gold";
export type ParticleKind = "pixel" | "spark" | "trail";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: FxColor;
  kind: ParticleKind;
  size: number;
}

export interface ScorePopup {
  x: number;
  y: number;
  text: string;
  life: number;
  maxLife: number;
  color: FxColor;
  size: number;
}

export interface FxState {
  rng: number; // separate cosmetic PRNG state — NOT the sim's rng
  particles: Particle[];
  popups: ScorePopup[];
  shake: number;
  flash: number;
  signal: number;
  reducedMotion: boolean;
}

export const FX_LIMITS = { particles: 300, popups: 120 } as const;

const PARTICLE_MS = 460;
const MUZZLE_MS = 170;
const POPUP_MS = 760;
const BANNER_MS = 1100;
const SHAKE_DECAY_PER_MS = 0.028;
const FLASH_DECAY_PER_MS = 0.004;
const SIGNAL_DECAY_PER_MS = 0.0014;
const POPUP_DRIFT_PX_PER_MS = 0.026;

const ROW_COLORS: readonly FxColor[] = ["gold", "signal", "danger", "paper", "signal"];

export function createFx(seed: number, opts?: { reducedMotion?: boolean }): FxState {
  return {
    rng: seed >>> 0,
    particles: [],
    popups: [],
    shake: 0,
    flash: 0,
    signal: 0,
    reducedMotion: !!opts?.reducedMotion,
  };
}

function rnd(fx: FxState): number {
  const r = rngFloat(fx.rng);
  fx.rng = r.state;
  return r.value;
}

function popup(
  fx: FxState,
  x: number,
  y: number,
  text: string,
  color: FxColor,
  size = 9,
  life = POPUP_MS,
): void {
  fx.popups.push({ x, y, text, life, maxLife: life, color, size });
}

function burst(
  fx: FxState,
  x: number,
  y: number,
  count: number,
  color: FxColor,
  speed = 0.085,
): void {
  if (fx.reducedMotion) return;
  for (let i = 0; i < count; i++) {
    const angle = rnd(fx) * Math.PI * 2;
    const velocity = 0.025 + rnd(fx) * speed;
    const life = PARTICLE_MS * (0.72 + rnd(fx) * 0.56);
    fx.particles.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      life,
      maxLife: life,
      color: i % 4 === 0 ? "paper" : color,
      kind: i % 3 === 0 ? "spark" : "pixel",
      size: i % 4 === 0 ? 2 : 1,
    });
  }
}

function celebrate(fx: FxState): void {
  if (fx.reducedMotion) return;
  for (let i = 0; i < 28; i++) {
    const x = 28 + rnd(fx) * (CONFIG.arena.w - 56);
    const life = 620 + rnd(fx) * 360;
    fx.particles.push({
      x,
      y: CONFIG.arena.h * 0.34 + rnd(fx) * 24,
      vx: (rnd(fx) - 0.5) * 0.045,
      vy: -(0.025 + rnd(fx) * 0.055),
      life,
      maxLife: life,
      color: i % 2 === 0 ? "hero" : "gold",
      kind: i % 3 === 0 ? "trail" : "pixel",
      size: i % 4 === 0 ? 2 : 1,
    });
  }
}

function capFx(fx: FxState): void {
  if (fx.particles.length > FX_LIMITS.particles) {
    fx.particles.splice(0, fx.particles.length - FX_LIMITS.particles);
  }
  if (fx.popups.length > FX_LIMITS.popups) {
    fx.popups.splice(0, fx.popups.length - FX_LIMITS.popups);
  }
}

export function fxConsume(fx: FxState, events: GameEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case "alienKilled": {
        const x = event.x + CONFIG.alien.w / 2;
        const y = event.y + CONFIG.alien.h / 2;
        // The engine event intentionally carries no awarded score delta; a
        // numeric base-points label becomes false once the combo multiplier
        // applies. Keep this layer honest without touching replay state.
        popup(fx, x, y, "HIT", "gold");
        burst(fx, x, y, 11, ROW_COLORS[event.row] ?? "paper");
        if (!fx.reducedMotion) fx.shake = Math.max(fx.shake, 1.4);
        break;
      }
      case "playerFired":
        if (!fx.reducedMotion) {
          for (let i = 0; i < 3; i++) {
            fx.particles.push({
              x: event.x,
              y: CONFIG.player.baselineY,
              vx: (rnd(fx) - 0.5) * 0.025,
              vy: 0.025 + rnd(fx) * 0.035,
              life: MUZZLE_MS,
              maxLife: MUZZLE_MS,
              color: i === 0 ? "paper" : "shot",
              kind: i === 0 ? "spark" : "trail",
              size: i === 0 ? 2 : 1,
            });
          }
        }
        break;
      case "playerHit":
        if (!fx.reducedMotion) {
          fx.shake = Math.max(fx.shake, 5.5);
          fx.flash = Math.max(fx.flash, 1);
        }
        break;
      case "lifeLost":
        popup(fx, CONFIG.arena.w / 2, CONFIG.player.baselineY - 25, "LINK LOST", "danger", 10, BANNER_MS);
        break;
      case "waveCleared":
        popup(fx, CONFIG.arena.w / 2, CONFIG.arena.h * 0.38, "WAVE SYNCED", "hero", 11, BANNER_MS);
        celebrate(fx);
        if (!fx.reducedMotion) {
          fx.shake = Math.max(fx.shake, 2.8);
          fx.signal = 1;
        }
        break;
      case "ufoSpawned":
        popup(fx, CONFIG.arena.w / 2, CONFIG.ufo.y + 22, "RARE SIGNAL", "signal", 8, BANNER_MS);
        if (!fx.reducedMotion) fx.signal = Math.max(fx.signal, 0.72);
        break;
      case "ufoKilled": {
        const x = event.x + CONFIG.ufo.w / 2;
        const y = event.y + CONFIG.ufo.h / 2;
        popup(fx, x, y + 3, `+${event.points}`, "signal", 11, BANNER_MS);
        burst(fx, x, y, 24, "signal", 0.12);
        if (!fx.reducedMotion) {
          fx.shake = Math.max(fx.shake, 3.8);
          fx.signal = 1;
        }
        break;
      }
      // Formation movement and misses stay visually quiet; their cadence is
      // already communicated by the lattice and projectile trails.
      case "alienStep":
      case "shotMissed":
        break;
    }
  }
  capFx(fx);
}

export function fxUpdate(fx: FxState, dtMs: number): void {
  const dt = Math.max(0, Math.min(100, dtMs));
  let particleWrite = 0;
  for (let i = 0; i < fx.particles.length; i++) {
    const particle = fx.particles[i];
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.life -= dt;
    if (particle.life > 0) fx.particles[particleWrite++] = particle;
  }
  fx.particles.length = particleWrite;

  const drift = fx.reducedMotion ? 0 : POPUP_DRIFT_PX_PER_MS;
  let popupWrite = 0;
  for (let i = 0; i < fx.popups.length; i++) {
    const scorePopup = fx.popups[i];
    scorePopup.y -= drift * dt;
    scorePopup.life -= dt;
    if (scorePopup.life > 0) fx.popups[popupWrite++] = scorePopup;
  }
  fx.popups.length = popupWrite;

  fx.shake = Math.max(0, fx.shake - SHAKE_DECAY_PER_MS * dt);
  fx.flash = Math.max(0, fx.flash - FLASH_DECAY_PER_MS * dt);
  fx.signal = Math.max(0, fx.signal - SIGNAL_DECAY_PER_MS * dt);
}
