import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import { CONFIG } from "./config";
import type { GameState, InputIntent } from "./types";

const idle: InputIntent = { move: 0, fire: false, pause: false };

function playing(seed = 1): GameState {
  return { ...newGame(seed), phase: "playing" };
}

describe("step — end conditions", () => {
  it("game over when lives reach zero", () => {
    let s = { ...playing(), lives: 1, invulnMs: 0 };
    s = {
      ...s,
      alienBullets: [
        { x: s.player.x + 2, y: s.player.y - CONFIG.bullet.h + 1, w: CONFIG.bullet.w, h: CONFIG.bullet.h, alive: true },
      ],
    };
    s = step(s, 16, idle);
    expect(s.phase).toBe("gameover");
  });

  it("game over when an alien reaches the player baseline", () => {
    let s = playing();
    s = { ...s, aliens: [{ x: 50, y: s.player.y, w: 16, h: 12, alive: true, row: 0, col: 0 }] };
    s = step(s, 16, idle);
    expect(s.phase).toBe("gameover");
  });

  it("advances to the next wave when all aliens are dead", () => {
    let s = playing();
    s = { ...s, aliens: s.aliens.map((a) => ({ ...a, alive: false })), wave: 1 };
    s = step(s, 16, idle);
    expect(s.wave).toBe(2);
    expect(s.aliens.length).toBe(CONFIG.alien.rows * CONFIG.alien.cols);
    expect(s.aliens.every((a) => a.alive)).toBe(true);
  });
});
