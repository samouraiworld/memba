import { describe, it, expect } from "vitest";
import { spawnWave, newGame } from "./spawn";
import { CONFIG } from "./config";

describe("spawnWave", () => {
  it("creates rows*cols living aliens", () => {
    const { aliens } = spawnWave(1);
    expect(aliens.length).toBe(CONFIG.alien.rows * CONFIG.alien.cols);
    expect(aliens.every((a) => a.alive)).toBe(true);
  });

  it("assigns row/col and non-overlapping x positions per row", () => {
    const { aliens } = spawnWave(1);
    const row0 = aliens.filter((a) => a.row === 0).sort((a, b) => a.col - b.col);
    for (let i = 1; i < row0.length; i++) {
      expect(row0[i].x).toBeGreaterThan(row0[i - 1].x);
    }
  });

  it("spawns lower on later waves", () => {
    const y1 = Math.min(...spawnWave(1).aliens.map((a) => a.y));
    const y3 = Math.min(...spawnWave(3).aliens.map((a) => a.y));
    expect(y3).toBeGreaterThan(y1);
  });
});

describe("newGame", () => {
  it("starts ready with full lives, zero score, wave 1, one formation, no bullets", () => {
    const s = newGame(42);
    expect(s.phase).toBe("ready");
    expect(s.lives).toBe(CONFIG.lives);
    expect(s.score).toBe(0);
    expect(s.wave).toBe(1);
    expect(s.aliens.length).toBe(CONFIG.alien.rows * CONFIG.alien.cols);
    expect(s.playerBullets).toEqual([]);
    expect(s.alienBullets).toEqual([]);
    expect(s.rng).toBe(42);
  });
});
