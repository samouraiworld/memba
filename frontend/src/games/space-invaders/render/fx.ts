import { CONFIG, type GameEvent } from "../engine";
import { rngFloat } from "../engine/prng";

// The cosmetic layer. Reads the deterministic event channel and produces
// visual-only state (particles, floating score popups, screen shake) using its
// OWN rng seeded independently of the simulation. Nothing here may read or
// write GameState — that keeps the onchain replay byte-identical regardless of
// how much juice is on screen.

export type FxColor = "phosphor" | "shot" | "hero";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: FxColor;
  size: number;
}

export interface ScorePopup {
  x: number;
  y: number;
  text: string;
  life: number;
  maxLife: number;
}

export interface FxState {
  rng: number; // separate cosmetic PRNG state — NOT the sim's rng
  particles: Particle[];
  popups: ScorePopup[];
  shake: number; // current shake magnitude in px
  reducedMotion: boolean;
}

const MAX_PARTICLES = 300;
const MAX_POPUPS = 120;
const PARTICLE_MS = 420;
const MUZZLE_MS = 150;
const POPUP_MS = 700;
const SHAKE_DECAY_PER_MS = 0.03;
const POPUP_DRIFT_PX_PER_MS = 0.03;

export function createFx(seed: number, opts?: { reducedMotion?: boolean }): FxState {
  return {
    rng: seed >>> 0,
    particles: [],
    popups: [],
    shake: 0,
    reducedMotion: !!opts?.reducedMotion,
  };
}

function rnd(fx: FxState): number {
  const r = rngFloat(fx.rng);
  fx.rng = r.state;
  return r.value;
}

export function fxConsume(fx: FxState, events: GameEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case "alienKilled": {
        const pts = CONFIG.points[e.row] ?? CONFIG.points[CONFIG.points.length - 1];
        const cx = e.x + CONFIG.alien.w / 2;
        const cy = e.y + CONFIG.alien.h / 2;
        // Popup is informational — shown even under reduced motion.
        fx.popups.push({ x: cx, y: cy, text: `+${pts}`, life: POPUP_MS, maxLife: POPUP_MS });
        if (!fx.reducedMotion) {
          for (let i = 0; i < 8; i++) {
            const ang = rnd(fx) * Math.PI * 2;
            const spd = 0.02 + rnd(fx) * 0.06;
            fx.particles.push({
              x: cx,
              y: cy,
              vx: Math.cos(ang) * spd,
              vy: Math.sin(ang) * spd,
              life: PARTICLE_MS,
              maxLife: PARTICLE_MS,
              color: "phosphor",
              size: 2,
            });
          }
          fx.shake = Math.max(fx.shake, 1.5);
        }
        break;
      }
      case "playerFired":
        if (!fx.reducedMotion) {
          for (let i = 0; i < 2; i++) {
            fx.particles.push({
              x: e.x,
              y: CONFIG.player.baselineY,
              vx: (rnd(fx) - 0.5) * 0.02,
              vy: -(0.03 + rnd(fx) * 0.03),
              life: MUZZLE_MS,
              maxLife: MUZZLE_MS,
              color: "shot",
              size: 1,
            });
          }
        }
        break;
      case "playerHit":
        if (!fx.reducedMotion) fx.shake = Math.max(fx.shake, 6);
        break;
      case "waveCleared":
        if (!fx.reducedMotion) fx.shake = Math.max(fx.shake, 3);
        break;
      // alienStep / lifeLost: no visual effect here.
    }
  }
  if (fx.particles.length > MAX_PARTICLES) {
    fx.particles.splice(0, fx.particles.length - MAX_PARTICLES);
  }
  if (fx.popups.length > MAX_POPUPS) {
    fx.popups.splice(0, fx.popups.length - MAX_POPUPS);
  }
}

export function fxUpdate(fx: FxState, dtMs: number): void {
  for (const p of fx.particles) {
    p.x += p.vx * dtMs;
    p.y += p.vy * dtMs;
    p.life -= dtMs;
  }
  fx.particles = fx.particles.filter((p) => p.life > 0);

  const drift = fx.reducedMotion ? 0 : POPUP_DRIFT_PX_PER_MS;
  for (const q of fx.popups) {
    q.y -= drift * dtMs;
    q.life -= dtMs;
  }
  fx.popups = fx.popups.filter((q) => q.life > 0);

  fx.shake = Math.max(0, fx.shake - SHAKE_DECAY_PER_MS * dtMs);
}
