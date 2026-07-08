import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import { CONFIG } from "./config";
import type { GameState, InputIntent } from "./types";

const fire: InputIntent = { move: 0, fire: true, pause: false };
const idle: InputIntent = { move: 0, fire: false, pause: false };

// A lone alien parked far left so upward shots fly free (no accidental kills).
function openField(seed = 1): GameState {
  return {
    ...newGame(seed),
    phase: "playing",
    aliens: [{ x: 0, y: 0, w: 16, h: 12, alive: true, row: 0, col: 0 }],
  };
}

describe("rapid fire — multiple bullets, cooldown, faster shots", () => {
  it("bullets travel faster than the old single-shot speed", () => {
    expect(CONFIG.bullet.playerSpeedPxPerMs).toBeGreaterThanOrEqual(0.55);
  });

  it("spawns a bullet into the playerBullets array on fire", () => {
    const s = step(openField(), 16, fire);
    expect(s.playerBullets.length).toBe(1);
  });

  it("enforces a fire cooldown — cannot fire on consecutive frames", () => {
    let s = step(openField(), 16, fire);
    s = step(s, 16, fire); // cooldown still active (< fireCooldownMs)
    expect(s.playerBullets.length).toBe(1);
  });

  it("allows several bullets in flight, capped at maxBullets", () => {
    let s = openField();
    for (let shot = 0; shot < CONFIG.player.maxBullets + 2; shot++) {
      s = step(s, 16, fire);
      // coast past the cooldown so the next fire is allowed
      for (let i = 0; i < 12; i++) s = step(s, 16, idle);
    }
    expect(s.playerBullets.length).toBeLessThanOrEqual(CONFIG.player.maxBullets);
    expect(s.playerBullets.length).toBeGreaterThan(1);
  });

  it("counts each fired bullet as a shot", () => {
    let s = step(openField(), 16, fire); // shot 1
    for (let i = 0; i < 12; i++) s = step(s, 16, idle);
    s = step(s, 16, fire); // shot 2
    expect(s.shots).toBe(2);
  });

  it("despawns bullets that leave the top of the arena", () => {
    let s = step(openField(), 16, fire);
    for (let i = 0; i < 120 && s.playerBullets.length > 0; i++) s = step(s, 16, idle);
    expect(s.playerBullets.length).toBe(0);
  });
});
