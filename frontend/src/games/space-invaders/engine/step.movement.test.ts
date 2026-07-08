import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import { CONFIG } from "./config";
import type { InputIntent } from "./types";

const idle: InputIntent = { move: 0, fire: false, pause: false };
const left: InputIntent = { move: -1, fire: false, pause: false };
const right: InputIntent = { move: 1, fire: false, pause: false };

describe("step — movement & phase", () => {
  it("transitions ready→playing when the player moves", () => {
    const s = step(newGame(1), 16, right);
    expect(s.phase).toBe("playing");
  });

  it("moves the player right by speed*dt while playing", () => {
    let s = newGame(1);
    s = step(s, 16, right); // ready→playing + move
    const s2 = step(s, 16, right);
    expect(s2.player.x).toBeGreaterThan(s.player.x);
  });

  it("clamps the player to the left arena edge", () => {
    let s = newGame(1);
    s = step(s, 16, left);
    for (let i = 0; i < 500; i++) s = step(s, 16, left);
    expect(s.player.x).toBeGreaterThanOrEqual(0);
  });

  it("clamps the player to the right arena edge", () => {
    let s = newGame(1);
    s = step(s, 16, right);
    for (let i = 0; i < 500; i++) s = step(s, 16, right);
    expect(s.player.x + s.player.w).toBeLessThanOrEqual(CONFIG.arena.w);
  });

  it("toggles pause on a pause intent edge and freezes movement while paused", () => {
    let s = step(newGame(1), 16, right); // playing
    const paused = step(s, 16, { move: 0, fire: false, pause: true });
    expect(paused.phase).toBe("paused");
    const stillPaused = step(paused, 16, right); // pause held / move ignored
    expect(stillPaused.player.x).toBe(paused.player.x);
  });
});
