import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import { CONFIG } from "./config";
import type { GameState, InputIntent } from "./types";

const fire: InputIntent = { move: 0, fire: true, pause: false };
const idle: InputIntent = { move: 0, fire: false, pause: false };

function playing(seed = 1): GameState {
  return { ...newGame(seed), phase: "playing" };
}

describe("step — player bullet", () => {
  it("spawns a bullet on fire when none is in flight", () => {
    const s = step(playing(), 16, fire);
    expect(s.playerBullet).not.toBeNull();
  });

  it("does not spawn a second bullet while one is live", () => {
    let s = step(playing(), 16, fire);
    const firstY = s.playerBullet!.y;
    s = step(s, 16, fire);
    // still exactly one bullet, and it moved (not replaced at spawn Y)
    expect(s.playerBullet).not.toBeNull();
    expect(s.playerBullet!.y).toBeLessThan(firstY);
  });

  it("moves the bullet upward and despawns it off the top", () => {
    let s = step(playing(), 16, fire);
    for (let i = 0; i < 200; i++) s = step(s, 16, idle);
    expect(s.playerBullet).toBeNull();
  });

  it("kills an alien on contact, frees the bullet, and scores", () => {
    let s = playing();
    // Target directly above the player; a decoy kept alive so the wave isn't cleared.
    const target = { ...s.aliens[0], x: s.player.x, y: s.player.y - 40, alive: true, row: 0, col: 0 };
    const decoy = { ...s.aliens[0], x: 10, y: 10, alive: true, row: 1, col: 5 };
    s = { ...s, aliens: [target, decoy] };
    s = step(s, 16, fire);
    for (let i = 0; i < 20; i++) s = step(s, 16, idle);
    expect(s.wave).toBe(1); // wave not cleared (decoy alive)
    expect(s.aliens[0].alive).toBe(false); // target destroyed
    expect(s.playerBullet).toBeNull();
    expect(s.score).toBe(CONFIG.points[0]);
  });
});
