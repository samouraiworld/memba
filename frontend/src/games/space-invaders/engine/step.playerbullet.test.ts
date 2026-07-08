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

describe("step — player bullets (rapid fire)", () => {
  it("spawns a bullet on fire", () => {
    const s = step(playing(), 16, fire);
    expect(s.playerBullets.length).toBe(1);
  });

  it("respects the fire cooldown between shots", () => {
    let s = step(playing(), 16, fire);
    const firstY = s.playerBullets[0].y;
    s = step(s, 16, fire); // cooldown still active → no new bullet
    expect(s.playerBullets.length).toBe(1);
    expect(s.playerBullets[0].y).toBeLessThan(firstY); // and it moved up
  });

  it("moves bullets upward and despawns them off the top / on impact", () => {
    let s = step(playing(), 16, fire);
    for (let i = 0; i < 200; i++) s = step(s, 16, idle);
    expect(s.playerBullets.length).toBe(0);
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
    expect(s.playerBullets.length).toBe(0);
    expect(s.score).toBe(CONFIG.points[0]); // first kill: combo x1
  });
});
