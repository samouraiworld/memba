import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame, spawnWave } from "./spawn";
import { CONFIG, alienFireCooldownMs } from "./config";
import type { GameState, InputIntent } from "./types";

const idle: InputIntent = { move: 0, fire: false, pause: false };

describe("difficulty — alien fire scaling, fire-from-bottom, capped kill-wall", () => {
  it("alien fire cooldown shrinks with the wave, bounded by a minimum", () => {
    expect(alienFireCooldownMs(1)).toBe(CONFIG.alienFire.cooldownMs);
    expect(alienFireCooldownMs(5)).toBeLessThan(alienFireCooldownMs(1));
    expect(alienFireCooldownMs(100)).toBe(CONFIG.alienFire.cooldownMinMs);
    expect(alienFireCooldownMs(100)).toBeGreaterThanOrEqual(CONFIG.alienFire.cooldownMinMs);
  });

  it("uses the wave-scaled cooldown after an alien fires", () => {
    let s: GameState = {
      ...newGame(3),
      phase: "playing",
      wave: 4,
      alienFireMs: 0, // ready to fire this step
    };
    s = step(s, 16, idle);
    expect(s.alienBullets.length).toBeGreaterThan(0);
    expect(s.alienFireMs).toBe(alienFireCooldownMs(4));
  });

  it("fires from the bottom-most alien of a column (not a mid-formation one)", () => {
    // A full column stacked vertically; the shooter must be the lowest (max y),
    // regardless of which the RNG would have picked among them.
    let s: GameState = {
      ...newGame(1),
      phase: "playing",
      alienFireMs: 0,
      aliens: [0, 1, 2, 3, 4].map((row) => ({
        x: 60,
        y: 40 + row * 20,
        w: 16,
        h: 12,
        alive: true,
        row,
        col: 0,
      })),
    };
    s = step(s, 16, idle);
    expect(s.alienBullets.length).toBe(1);
    // Bottom alien is at y=120 → bullet spawns just below it, never higher up.
    expect(s.alienBullets[0].y).toBeGreaterThanOrEqual(120);
  });

  it("still spawns lower on early waves", () => {
    const y1 = Math.min(...spawnWave(1).aliens.map((a) => a.y));
    const y3 = Math.min(...spawnWave(3).aliens.map((a) => a.y));
    expect(y3).toBeGreaterThan(y1);
  });

  it("caps the spawn depth so deep waves never start inside the kill line", () => {
    const deepA = Math.min(...spawnWave(50).aliens.map((a) => a.y));
    const deepB = Math.min(...spawnWave(200).aliens.map((a) => a.y));
    expect(deepA).toBe(deepB); // capped — no unbounded descent
    const lowestBottom = Math.max(...spawnWave(200).aliens.map((a) => a.y + a.h));
    expect(lowestBottom).toBeLessThan(CONFIG.player.baselineY);
  });
});
