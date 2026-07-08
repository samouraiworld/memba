import { useEffect, useRef } from "react";
import { CONFIG, type GameState } from "../engine";

const COLORS = { bg: "#04120f", player: "#4ff0c0", alien: "#e6f7ef", bullet: "#ffd24d" };

export function Canvas({ state }: { state: GameState }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const { w, h } = CONFIG.arena;
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

    // Player blinks while invulnerable.
    const blink = state.invulnMs > 0 && Math.floor(state.invulnMs / 120) % 2 === 0;
    if (!blink) {
      ctx.fillStyle = COLORS.player;
      ctx.fillRect(state.player.x, state.player.y, state.player.w, state.player.h);
    }
  }, [state]);

  return (
    <canvas
      ref={ref}
      width={CONFIG.arena.w}
      height={CONFIG.arena.h}
      className="si-canvas"
      aria-label="Space Invaders play area"
    />
  );
}
