import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import { CONFIG } from "./config";
import type { GameState, InputIntent } from "./types";

const idle: InputIntent = { move: 0, fire: false, pause: false };
const fire: InputIntent = { move: 0, fire: true, pause: false };

function playing(seed = 1): GameState {
  return { ...newGame(seed), phase: "playing" };
}

function ufoAt(x: number, y: number) {
  return { x, y, w: CONFIG.ufo.w, h: CONFIG.ufo.h, dir: 1 as const, alive: true };
}

describe("UFO mystery ship", () => {
  it("starts with no UFO and a spawn timer", () => {
    const g = newGame(1);
    expect(g.ufo).toBeNull();
    expect(g.ufoTimerMs).toBeGreaterThan(0);
  });

  it("spawns a UFO when the timer elapses", () => {
    let s: GameState = { ...playing(), ufoTimerMs: 0 };
    s = step(s, 16, idle);
    expect(s.ufo).not.toBeNull();
    expect(s.ufo!.alive).toBe(true);
    expect(s.events.some((e) => e.type === "ufoSpawned")).toBe(true);
  });

  it("moves the UFO horizontally", () => {
    let s: GameState = { ...playing(), ufo: ufoAt(100, CONFIG.ufo.y), ufoTimerMs: 999999 };
    const x0 = s.ufo!.x;
    s = step(s, 16, idle);
    expect(s.ufo!.x).not.toBe(x0);
  });

  it("despawns the UFO when it exits the arena (no points)", () => {
    let s: GameState = { ...playing(), ufo: ufoAt(CONFIG.arena.w - 1, CONFIG.ufo.y), ufoTimerMs: 999999, score: 0 };
    for (let i = 0; i < 200 && s.ufo; i++) s = step(s, 16, idle);
    expect(s.ufo).toBeNull();
    expect(s.score).toBe(0);
  });

  it("scores and emits ufoKilled when a player bullet hits it", () => {
    let s: GameState = {
      ...playing(),
      score: 0,
      shots: 1,
      aliens: [{ x: 8, y: 8, w: 16, h: 12, alive: true, row: 0, col: 0 }], // far decoy
      ufo: ufoAt(newGame(1).player.x, newGame(1).player.y - 40),
      ufoTimerMs: 999999,
    };
    s = step(s, 16, fire);
    let killed = s.events.some((e) => e.type === "ufoKilled");
    for (let i = 0; i < 20 && !killed; i++) {
      s = step(s, 16, idle);
      killed = killed || s.events.some((e) => e.type === "ufoKilled");
    }
    expect(killed).toBe(true);
    expect(s.ufo).toBeNull();
    expect(s.score).toBeGreaterThan(0);
  });

  it("awards the 300 bonus when the hitting shot lands on a parity count", () => {
    // shots at parity-1 → firing makes it a multiple of parityShot at hit time.
    let s: GameState = {
      ...playing(),
      score: 0,
      shots: CONFIG.ufo.parityShot - 1,
      aliens: [{ x: 8, y: 8, w: 16, h: 12, alive: true, row: 0, col: 0 }],
      ufo: ufoAt(newGame(1).player.x, newGame(1).player.y - 40),
      ufoTimerMs: 999999,
    };
    s = step(s, 16, fire); // shots -> parityShot (a multiple)
    for (let i = 0; i < 20 && s.ufo; i++) s = step(s, 16, idle);
    expect(s.ufo).toBeNull();
    expect(s.score).toBe(CONFIG.ufo.bonusPoints); // 300, distinct from base 50/100/150
  });
});
