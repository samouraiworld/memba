import { CONFIG } from "./config";
import type { Alien, GameState } from "./types";

export function spawnWave(wave: number): { aliens: Alien[] } {
  const { rows, cols, w, h, gapX, gapY, marginX, startY } = CONFIG.alien;
  const dropPerWave = 10;
  const yBase = startY + (wave - 1) * dropPerWave;
  const aliens: Alien[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      aliens.push({
        x: marginX + col * (w + gapX),
        y: yBase + row * (h + gapY),
        w,
        h,
        alive: true,
        row,
        col,
      });
    }
  }
  return { aliens };
}

export function newGame(seed: number): GameState {
  const { aliens } = spawnWave(1);
  return {
    phase: "ready",
    seed,
    rng: seed,
    tick: 0,
    player: {
      x: CONFIG.arena.w / 2 - CONFIG.player.w / 2,
      y: CONFIG.player.baselineY,
      w: CONFIG.player.w,
      h: CONFIG.player.h,
    },
    lives: CONFIG.lives,
    invulnMs: 0,
    score: 0,
    combo: 0,
    shots: 0,
    hits: 0,
    wave: 1,
    aliens,
    dir: 1,
    stepAccumMs: 0,
    playerBullet: null,
    alienBullets: [],
    alienFireMs: CONFIG.alienFire.cooldownMs,
    events: [],
  };
}
