import { CONFIG, type Alien, type GameState, type Rect } from "../engine";
import type { FxColor, FxState, Particle } from "./fx";
import { drawAlienGlyph, drawPlayerGlyph, drawUfoGlyph } from "./pixelArt";

// A Memba-native "signal swarm" palette: ink-black space, the product's teal,
// governance gold, and a warm danger channel. All art is generated from rects
// and tiny masks so the scaled canvas retains a deliberate pixel-print finish.
const COLORS = {
  void: "#02090d",
  deep: "#041412",
  horizon: "#08211f",
  grid: "#174039",
  ink: "#06100f",
  paper: "#e9fff8",
  dim: "#6e9b91",
  hero: "#00d4aa",
  heroBright: "#73ffdc",
  gold: "#c9a227",
  shot: "#ffd65a",
  danger: "#ff5f6d",
  signal: "#b78cff",
} as const;

const ROW_PALETTES = [
  { body: "#e6c95d", core: "#fff2a8" },
  { body: "#bd96f5", core: "#f1e7ff" },
  { body: "#ff7780", core: "#ffe2df" },
  { body: "#b7ded5", core: "#f1fff9" },
  { body: "#6bd8c2", core: "#d9fff4" },
] as const;

const FX_COLORS: Record<FxColor, string> = {
  paper: COLORS.paper,
  shot: COLORS.shot,
  hero: COLORS.heroBright,
  danger: COLORS.danger,
  signal: COLORS.signal,
  gold: COLORS.gold,
};

function hash32(value: number): number {
  let n = value | 0;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}

/** A stable shake sample: repeated draws of the same visual state are equal. */
export function renderJitter(seed: number, tick: number, axis: number, magnitude: number): number {
  if (magnitude <= 0) return 0;
  const mixed = hash32((seed | 0) ^ Math.imul(tick + 1, 0x9e3779b1) ^ Math.imul(axis + 7, 0x85ebca6b));
  return (((mixed & 0xffff) / 0xffff) * 2 - 1) * magnitude;
}

function drawBackdrop(ctx: CanvasRenderingContext2D, state: GameState, reducedMotion: boolean): void {
  const { w, h } = CONFIG.arena;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLORS.void;
  ctx.fillRect(0, 0, w, h);

  // Layered ink bands create depth without gradients (and stay crisp at 2x).
  ctx.fillStyle = COLORS.deep;
  ctx.fillRect(0, 58, w, h - 58);
  ctx.fillStyle = COLORS.horizon;
  ctx.globalAlpha = 0.58;
  ctx.fillRect(0, 262, w, h - 262);
  ctx.globalAlpha = 1;

  // A seeded star/node field gives each certified run a stable visual identity.
  for (let i = 0; i < 48; i++) {
    const star = hash32((state.seed | 0) ^ Math.imul(i + 1, 0x27d4eb2d));
    const depth = 1 + ((star >>> 27) % 3);
    const x = star % w;
    const y = 10 + ((star >>> 9) % 244);
    const twinkle = reducedMotion ? 0 : ((state.tick >> 4) + (star >>> 24)) % 7 === 0 ? 0.28 : 0;
    ctx.globalAlpha = 0.18 + depth * 0.13 + twinkle;
    ctx.fillStyle = depth === 3 ? COLORS.paper : COLORS.dim;
    ctx.fillRect(x, y, depth === 3 ? 2 : 1, depth === 3 ? 2 : 1);
  }
  ctx.globalAlpha = 1;

  // Perspective rails make the bottom feel like a receiving deck, not empty
  // canvas. They are quiet enough that bullets and bunker damage remain clear.
  ctx.fillStyle = COLORS.grid;
  const horizonY = 324;
  for (let i = 0; i < 5; i++) {
    ctx.globalAlpha = 0.12 + i * 0.025;
    const y = horizonY + i * i * 3;
    ctx.fillRect(0, y, w, 1);
  }
  for (let x = 16; x < w; x += 32) {
    ctx.globalAlpha = 0.1;
    ctx.fillRect(x, horizonY, 1, h - horizonY);
  }
  ctx.globalAlpha = 1;

  // In-canvas registration marks echo Memba's precise interface chrome.
  ctx.fillStyle = COLORS.hero;
  ctx.globalAlpha = 0.32;
  ctx.fillRect(6, 6, 12, 1);
  ctx.fillRect(6, 6, 1, 12);
  ctx.fillRect(w - 18, 6, 12, 1);
  ctx.fillRect(w - 7, 6, 1, 12);
  ctx.globalAlpha = 1;
}

function drawFormationLattice(ctx: CanvasRenderingContext2D, state: GameState, energized: boolean): void {
  ctx.globalAlpha = energized ? 0.2 : 0.12;
  for (let row = 0; row < CONFIG.alien.rows; row++) {
    let previous: Alien | null = null;
    for (const alien of state.aliens) {
      if (!alien.alive || alien.row !== row) continue;
      if (previous) {
        const from = previous.x + previous.w;
        const to = alien.x;
        const y = Math.round(alien.y + alien.h / 2);
        if (to > from) ctx.fillRect(from, y, to - from, 1);
      }
      previous = alien;
    }
  }
  ctx.globalAlpha = 1;

  // Tiny receive pips below every live glyph expose the common signal rhythm.
  for (const alien of state.aliens) {
    if (!alien.alive) continue;
    const pip = energized ? 3 : 1;
    ctx.globalAlpha = energized ? 0.52 : 0.26;
    ctx.fillRect(Math.round(alien.x + alien.w / 2), alien.y + alien.h + 1, 1, pip);
  }
  ctx.globalAlpha = 1;
}

function drawBunker(ctx: CanvasRenderingContext2D, block: Rect & { hp: number }): void {
  if (block.hp <= 0) return;
  const health = Math.max(0, Math.min(1, block.hp / CONFIG.bunker.hp));
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(block.x - 1, block.y + 1, block.w + 2, block.h);
  ctx.fillStyle = health > 0.66 ? COLORS.hero : health > 0.33 ? COLORS.gold : COLORS.danger;
  ctx.globalAlpha = 0.5 + health * 0.42;
  ctx.fillRect(block.x, block.y, block.w, block.h);
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = COLORS.heroBright;
  ctx.fillRect(block.x + 1, block.y, Math.max(1, block.w - 2), 1);

  // Deterministic chips replace opacity-only damage: low-health cover now has
  // a readable, persistent silhouette even for color-vision deficiencies.
  const damage = CONFIG.bunker.hp - block.hp;
  ctx.fillStyle = COLORS.ink;
  ctx.globalAlpha = 1;
  for (let i = 0; i < damage * 3; i++) {
    const chip = hash32(Math.imul(Math.round(block.x) + 31, 97) ^ Math.imul(block.y + 17, 53) ^ i);
    const x = block.x + 1 + (chip % Math.max(1, block.w - 2));
    const y = block.y + ((chip >>> 8) % Math.max(1, block.h));
    const chipHeight = Math.min(i % 3 === 0 ? 2 : 1, block.y + block.h - y);
    ctx.fillRect(x, y, 1, chipHeight);
  }
  ctx.globalAlpha = 1;
}

function drawPlayerShot(ctx: CanvasRenderingContext2D, bullet: Rect, reducedMotion: boolean): void {
  const trail = reducedMotion ? 3 : 9;
  ctx.fillStyle = COLORS.shot;
  ctx.globalAlpha = 0.12;
  ctx.fillRect(bullet.x - 1, bullet.y + bullet.h, bullet.w + 2, trail);
  ctx.globalAlpha = 0.46;
  ctx.fillRect(bullet.x, bullet.y + bullet.h, bullet.w, Math.ceil(trail / 2));
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(bullet.x, bullet.y, bullet.w, bullet.h - 2);
  ctx.fillStyle = COLORS.shot;
  ctx.fillRect(bullet.x, bullet.y + bullet.h - 2, bullet.w, 2);
}

function drawAlienShot(ctx: CanvasRenderingContext2D, bullet: Rect, reducedMotion: boolean): void {
  const trail = reducedMotion ? 3 : 8;
  ctx.fillStyle = COLORS.danger;
  ctx.globalAlpha = 0.16;
  ctx.fillRect(bullet.x - 1, bullet.y - trail, bullet.w + 2, trail);
  ctx.globalAlpha = 0.5;
  ctx.fillRect(bullet.x, bullet.y - Math.ceil(trail / 2), bullet.w, Math.ceil(trail / 2));
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLORS.danger;
  ctx.fillRect(bullet.x, bullet.y, bullet.w, bullet.h);
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(bullet.x + 1, bullet.y + 2, 1, Math.max(1, bullet.h - 4));
}

function drawParticle(ctx: CanvasRenderingContext2D, particle: Particle): void {
  const alpha = Math.max(0, Math.min(1, particle.life / particle.maxLife));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = FX_COLORS[particle.color];
  if (particle.kind === "spark") {
    ctx.fillRect(particle.x - particle.size, particle.y, particle.size * 3, particle.size);
    ctx.fillRect(particle.x, particle.y - particle.size, particle.size, particle.size * 3);
  } else if (particle.kind === "trail") {
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size * 3);
  } else {
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
  }
}

function drawSignalOverlay(ctx: CanvasRenderingContext2D, strength: number): void {
  if (strength <= 0) return;
  const { w, h } = CONFIG.arena;
  ctx.fillStyle = COLORS.signal;
  ctx.globalAlpha = Math.min(0.18, strength * 0.18);
  ctx.fillRect(0, 18, w, 2);
  ctx.fillRect(0, 23, w, 1);
  ctx.fillRect(4, 4, w - 8, 1);
  ctx.fillRect(4, h - 5, w - 8, 1);
  ctx.fillRect(4, 4, 1, h - 8);
  ctx.fillRect(w - 5, 4, 1, h - 8);
  ctx.globalAlpha = 1;
}

export function draw(ctx: CanvasRenderingContext2D, state: GameState, fx: FxState): void {
  const { w, h } = CONFIG.arena;
  ctx.imageSmoothingEnabled = false;
  drawBackdrop(ctx, state, fx.reducedMotion);

  ctx.save();
  if (fx.shake > 0 && !fx.reducedMotion) {
    ctx.translate(
      renderJitter(fx.rng, state.tick, 0, fx.shake),
      renderJitter(fx.rng, state.tick, 1, fx.shake),
    );
  }

  const alive = state.aliens.reduce((count, alien) => count + (alien.alive ? 1 : 0), 0);
  const total = Math.max(1, state.aliens.length);
  const pulse = fx.reducedMotion ? 0.52 : 0.52 + Math.sin(state.tick * 0.09) * 0.22;
  const energized = pulse * (0.65 + (alive / total) * 0.35) > 0.5;
  ctx.fillStyle = COLORS.hero;
  drawFormationLattice(ctx, state, energized);

  for (const alien of state.aliens) {
    if (!alien.alive) continue;
    const palette = ROW_PALETTES[alien.row] ?? ROW_PALETTES[ROW_PALETTES.length - 1];
    drawAlienGlyph(ctx, alien, palette.body, palette.core, energized && !fx.reducedMotion);
  }

  if (state.ufo?.alive) {
    const ufo = state.ufo;
    const trailX = ufo.dir === 1 ? ufo.x - 24 : ufo.x + ufo.w;
    ctx.fillStyle = COLORS.signal;
    ctx.globalAlpha = fx.reducedMotion ? 0.12 : 0.2;
    ctx.fillRect(trailX, ufo.y + 3, 24, 1);
    ctx.fillRect(ufo.dir === 1 ? trailX + 8 : trailX, ufo.y + 7, 16, 1);
    ctx.globalAlpha = 1;
    drawUfoGlyph(ctx, ufo, COLORS.signal, COLORS.paper);
  }

  for (const block of state.bunkers) drawBunker(ctx, block);
  for (const bullet of state.playerBullets) drawPlayerShot(ctx, bullet, fx.reducedMotion);
  for (const bullet of state.alienBullets) drawAlienShot(ctx, bullet, fx.reducedMotion);

  // Blink stays well below the photosensitivity threshold. Reduced-motion mode
  // uses a steady dim state, preserving invulnerability feedback without flash.
  const invulnerable = state.invulnMs > 0;
  const blinkOff = !fx.reducedMotion && invulnerable && Math.floor(state.invulnMs / 180) % 2 === 0;
  if (!blinkOff) {
    ctx.globalAlpha = fx.reducedMotion && invulnerable ? 0.56 : 1;
    drawPlayerGlyph(ctx, state.player, COLORS.hero, COLORS.paper);
    ctx.globalAlpha = 1;
    if (!fx.reducedMotion && !invulnerable) {
      const exhaust = 2 + ((state.tick >> 2) % 3);
      ctx.fillStyle = COLORS.shot;
      ctx.globalAlpha = 0.72;
      ctx.fillRect(state.player.x + 5, state.player.y + state.player.h, 2, exhaust);
      ctx.fillRect(state.player.x + state.player.w - 7, state.player.y + state.player.h, 2, exhaust);
      ctx.globalAlpha = 1;
    }
  }

  for (const particle of fx.particles) drawParticle(ctx, particle);
  ctx.globalAlpha = 1;
  ctx.restore();

  drawSignalOverlay(ctx, fx.reducedMotion ? 0 : fx.signal);
  if (fx.flash > 0 && !fx.reducedMotion) {
    ctx.fillStyle = COLORS.danger;
    ctx.globalAlpha = Math.min(0.22, fx.flash * 0.22);
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const scorePopup of fx.popups) {
    const alpha = Math.max(0, Math.min(1, scorePopup.life / scorePopup.maxLife));
    ctx.font = `700 ${scorePopup.size}px 'JetBrains Mono', monospace`;
    ctx.globalAlpha = alpha * 0.7;
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(scorePopup.text, scorePopup.x + 1, scorePopup.y + 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = FX_COLORS[scorePopup.color];
    ctx.fillText(scorePopup.text, scorePopup.x, scorePopup.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}
