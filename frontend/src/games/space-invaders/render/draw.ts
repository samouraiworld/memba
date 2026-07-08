import { CONFIG, type GameState } from "../engine";
import type { FxColor, FxState } from "./fx";

// Single draw owner for the canvas: the rAF loop calls this once per frame from
// the mutable state ref + the cosmetic fx layer. Nothing here touches the
// simulation. Colors mirror the intentionally-dark arcade screen.
const COLORS = {
  bg: "#04120f",
  player: "#4ff0c0",
  alien: "#e6f7ef",
  bullet: "#ffd24d",
  popup: "#ffd24d",
} as const;

const FX_COLORS: Record<FxColor, string> = {
  phosphor: "#e6f7ef",
  shot: "#ffd24d",
  hero: "#4ff0c0",
};

export function draw(ctx: CanvasRenderingContext2D, state: GameState, fx: FxState): void {
  const { w, h } = CONFIG.arena;

  ctx.save();
  // Screen shake (cosmetic only, suppressed under reduced motion by fxConsume).
  if (fx.shake > 0) {
    const ox = (Math.random() - 0.5) * 2 * fx.shake;
    const oy = (Math.random() - 0.5) * 2 * fx.shake;
    ctx.translate(ox, oy);
  }

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = COLORS.alien;
  for (const a of state.aliens) if (a.alive) ctx.fillRect(a.x, a.y, a.w, a.h);

  ctx.fillStyle = COLORS.bullet;
  if (state.playerBullet) {
    const b = state.playerBullet;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  for (const b of state.alienBullets) ctx.fillRect(b.x, b.y, b.w, b.h);

  // Player: blink while invulnerable (steady-dim under reduced motion to avoid
  // the ~8Hz flash near the photosensitivity threshold).
  const invuln = state.invulnMs > 0;
  if (fx.reducedMotion) {
    ctx.globalAlpha = invuln ? 0.5 : 1;
    ctx.fillStyle = COLORS.player;
    ctx.fillRect(state.player.x, state.player.y, state.player.w, state.player.h);
    ctx.globalAlpha = 1;
  } else {
    const blink = invuln && Math.floor(state.invulnMs / 120) % 2 === 0;
    if (!blink) {
      ctx.fillStyle = COLORS.player;
      ctx.fillRect(state.player.x, state.player.y, state.player.w, state.player.h);
    }
  }

  // Particles (fade with remaining life).
  for (const p of fx.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = FX_COLORS[p.color];
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // Floating score popups.
  ctx.fillStyle = COLORS.popup;
  ctx.font = "8px monospace";
  ctx.textAlign = "center";
  for (const q of fx.popups) {
    ctx.globalAlpha = Math.max(0, q.life / q.maxLife);
    ctx.fillText(q.text, q.x, q.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}
