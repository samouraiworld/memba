import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import type { GameState, InputIntent } from "./types";

const idle: InputIntent = { move: 0, fire: false, pause: false };
const fire: InputIntent = { move: 0, fire: true, pause: false };

function playing(seed = 1): GameState {
  return { ...newGame(seed), phase: "playing" };
}

// The deterministic event channel is a pure function of (state, input). It is
// the single seam that feeds the cosmetic juice layer, audio, and the
// verification hash — none of which may perturb the simulation. Events are
// per-step and reset each call (bounded).
describe("engine events channel", () => {
  it("is an empty array on a quiet step (reset each step, bounded)", () => {
    // First step from ready→playing with no cadence elapsed: nothing happens.
    expect(step(playing(), 16, idle).events).toEqual([]);
  });

  it("emits playerFired when a bullet spawns", () => {
    const s = step(playing(), 16, fire);
    expect(s.events.some((e) => e.type === "playerFired")).toBe(true);
  });

  it("emits alienKilled when a player bullet destroys an alien", () => {
    let s = playing();
    const target = { ...s.aliens[0], x: s.player.x, y: s.player.y - 40, alive: true, row: 0, col: 0 };
    const decoy = { ...s.aliens[0], x: 10, y: 10, alive: true, row: 1, col: 5 };
    s = { ...s, aliens: [target, decoy] };
    s = step(s, 16, fire);
    let killed = s.events.some((e) => e.type === "alienKilled");
    for (let i = 0; i < 20 && !killed; i++) {
      s = step(s, 16, idle);
      killed = killed || s.events.some((e) => e.type === "alienKilled");
    }
    expect(killed).toBe(true);
  });

  it("emits waveCleared when the last alien dies", () => {
    let s = playing();
    s = { ...s, aliens: s.aliens.map((a) => ({ ...a, alive: false })) };
    s = step(s, 16, idle);
    expect(s.events.some((e) => e.type === "waveCleared")).toBe(true);
  });

  it("emits playerHit when an alien bullet strikes the player", () => {
    let s = { ...playing(), lives: 3, invulnMs: 0 };
    s = {
      ...s,
      alienBullets: [{ x: s.player.x + 2, y: s.player.y, w: 3, h: 8, alive: true }],
    };
    s = step(s, 16, idle);
    expect(s.events.some((e) => e.type === "playerHit")).toBe(true);
  });
});
