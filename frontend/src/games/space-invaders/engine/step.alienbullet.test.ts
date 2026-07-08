import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import { CONFIG } from "./config";
import type { GameState, InputIntent } from "./types";

const idle: InputIntent = { move: 0, fire: false, pause: false };

function playing(seed = 7): GameState {
  return { ...newGame(seed), phase: "playing" };
}

describe("step — alien fire & player damage", () => {
  it("eventually spawns an alien bullet (seeded, deterministic)", () => {
    let a = playing(7);
    let b = playing(7);
    for (let i = 0; i < 120; i++) {
      a = step(a, 16, idle);
      b = step(b, 16, idle);
    }
    expect(a.alienBullets.length).toBeGreaterThan(0);
    expect(a.alienBullets).toEqual(b.alienBullets); // determinism
  });

  it("removes a life and grants invulnerability when a bullet hits the player", () => {
    let s = playing();
    // Craft a bullet just above the player.
    s = {
      ...s,
      alienBullets: [
        { x: s.player.x + 2, y: s.player.y - CONFIG.bullet.h + 1, w: CONFIG.bullet.w, h: CONFIG.bullet.h, alive: true },
      ],
    };
    const before = s.lives;
    s = step(s, 16, idle);
    expect(s.lives).toBe(before - 1);
    expect(s.invulnMs).toBeGreaterThan(0);
    expect(s.alienBullets).toEqual([]);
  });

  it("is immune to damage while invulnerable", () => {
    let s = { ...playing(), invulnMs: 1000 };
    s = {
      ...s,
      alienBullets: [
        { x: s.player.x + 2, y: s.player.y + 1, w: CONFIG.bullet.w, h: CONFIG.bullet.h, alive: true },
      ],
    };
    const before = s.lives;
    s = step(s, 16, idle);
    expect(s.lives).toBe(before);
  });
});
