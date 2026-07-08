import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame, spawnBunkers } from "./spawn";
import { CONFIG } from "./config";
import type { Block, GameState, InputIntent } from "./types";

const idle: InputIntent = { move: 0, fire: false, pause: false };

function playing(seed = 1): GameState {
  return { ...newGame(seed), phase: "playing", ufoTimerMs: 999999 };
}

// A quiet field: one far decoy alien (so the wave doesn't clear), no UFO.
function withBunkers(bunkers: Block[], extra: Partial<GameState> = {}): GameState {
  return {
    ...playing(),
    aliens: [{ x: 4, y: 4, w: 16, h: 12, alive: true, row: 0, col: 0 }],
    ufo: null,
    bunkers,
    ...extra,
  };
}

const block = (x: number, y: number, hp = CONFIG.bunker.hp): Block => ({ x, y, w: 8, h: 8, hp });

describe("bunkers — 3-HP destructible shields", () => {
  it("newGame places bunkers at full HP", () => {
    const g = newGame(1);
    expect(g.bunkers.length).toBeGreaterThan(0);
    expect(g.bunkers.every((b) => b.hp === CONFIG.bunker.hp)).toBe(true);
  });

  it("spawnBunkers lays out blocks across the arena", () => {
    const bs = spawnBunkers();
    expect(bs.length).toBe(CONFIG.bunker.count * CONFIG.bunker.cols * CONFIG.bunker.rows);
  });

  it("a player shot erodes a block and is consumed", () => {
    let s = withBunkers([block(100, 200)], {
      playerBullets: [{ x: 101, y: 210, w: 3, h: 8, alive: true }],
    });
    s = step(s, 16, idle);
    expect(s.bunkers[0].hp).toBe(CONFIG.bunker.hp - 1);
    expect(s.playerBullets.length).toBe(0);
  });

  it("destroys a block when its HP reaches zero", () => {
    let s = withBunkers([block(100, 200, 1)], {
      playerBullets: [{ x: 101, y: 210, w: 3, h: 8, alive: true }],
    });
    s = step(s, 16, idle);
    expect(s.bunkers.length).toBe(0);
  });

  it("stops an alien bullet at a block (player protected)", () => {
    let s = withBunkers([block(100, 200)], {
      invulnMs: 0,
      alienBullets: [{ x: 101, y: 194, w: 3, h: 8, alive: true }],
    });
    const lives = s.lives;
    s = step(s, 16, idle);
    expect(s.alienBullets.length).toBe(0);
    expect(s.bunkers[0].hp).toBe(CONFIG.bunker.hp - 1);
    expect(s.lives).toBe(lives);
  });

  it("refreshes bunkers on wave clear", () => {
    let s = withBunkers([block(100, 200, 1)]);
    s = { ...s, aliens: s.aliens.map((a) => ({ ...a, alive: false })) };
    s = step(s, 16, idle);
    expect(s.wave).toBe(2);
    expect(s.bunkers.length).toBe(spawnBunkers().length);
    expect(s.bunkers.every((b) => b.hp === CONFIG.bunker.hp)).toBe(true);
  });
});
