import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import { CONFIG, comboMultiplier10 } from "./config";
import type { GameState, InputIntent } from "./types";

const fire: InputIntent = { move: 0, fire: true, pause: false };
const idle: InputIntent = { move: 0, fire: false, pause: false };

function playing(seed = 1): GameState {
  return { ...newGame(seed), phase: "playing" };
}

// Fire once at a target parked directly above the player, then coast until the
// bullet resolves. A decoy elsewhere keeps the wave from clearing.
function killTargetAbovePlayer(base: GameState): GameState {
  const target = { ...base.aliens[0], x: base.player.x, y: base.player.y - 40, alive: true, row: 0, col: 0 };
  const decoy = { ...base.aliens[0], x: 8, y: 8, alive: true, row: 1, col: 5 };
  let s: GameState = { ...base, aliens: [target, decoy] };
  s = step(s, 16, fire);
  for (let i = 0; i < 25 && s.aliens[0].alive; i++) s = step(s, 16, idle);
  return s;
}

describe("scoring — combo, accuracy, bonuses (all in the pure reducer)", () => {
  it("starts combo/shots/hits at zero", () => {
    const g = newGame(1);
    expect(g.combo).toBe(0);
    expect(g.shots).toBe(0);
    expect(g.hits).toBe(0);
  });

  it("firing increments the shot counter", () => {
    expect(step(playing(), 16, fire).shots).toBe(1);
  });

  it("a hit increments hits and combo", () => {
    const s = killTargetAbovePlayer(playing());
    expect(s.aliens[0].alive).toBe(false);
    expect(s.hits).toBe(1);
    expect(s.combo).toBe(1);
  });

  it("first kill scores base points at x1 (keeps combo backward-compatible)", () => {
    const s = killTargetAbovePlayer({ ...playing(), score: 0 });
    expect(s.score).toBe(CONFIG.points[0]);
  });

  it("comboMultiplier10 steps up by streak tier (integer x10)", () => {
    expect(comboMultiplier10(0)).toBe(10);
    expect(comboMultiplier10(1)).toBe(10);
    expect(comboMultiplier10(2)).toBe(15);
    expect(comboMultiplier10(4)).toBe(20);
    expect(comboMultiplier10(7)).toBe(30);
    expect(comboMultiplier10(10)).toBe(40);
    expect(comboMultiplier10(999)).toBe(40);
  });

  it("combo multiplies the score of the next kill", () => {
    // combo already 3 → this hit makes it 4 → x2.0 (mult10 = 20).
    const s = killTargetAbovePlayer({ ...playing(), combo: 3, score: 0 });
    expect(s.combo).toBe(4);
    expect(s.score).toBe(Math.floor((CONFIG.points[0] * comboMultiplier10(4)) / 10));
  });

  it("a missed shot resets the combo and emits shotMissed", () => {
    // One alien parked far left so the upward shot never connects.
    let s: GameState = {
      ...playing(),
      combo: 5,
      aliens: [{ x: 0, y: 0, w: 16, h: 12, alive: true, row: 0, col: 0 }],
    };
    s = step(s, 16, fire);
    let missed = false;
    for (let i = 0; i < 90 && s.playerBullet; i++) {
      s = step(s, 16, idle);
      missed = missed || s.events.some((e) => e.type === "shotMissed");
    }
    expect(missed).toBe(true);
    expect(s.combo).toBe(0);
  });

  it("awards an accuracy bonus at game over (floor(hits*K/shots))", () => {
    let s: GameState = {
      ...playing(),
      lives: 1,
      invulnMs: 0,
      shots: 4,
      hits: 2,
      score: 0,
      alienBullets: [{ x: 0, y: 0, w: 3, h: 8, alive: true }],
    };
    // Move alien formation away so nothing else scores; drive a lethal hit.
    s = { ...s, alienBullets: [{ x: s.player.x + 2, y: s.player.y, w: 3, h: 8, alive: true }] };
    s = step(s, 16, idle);
    expect(s.phase).toBe("gameover");
    expect(s.score).toBe(Math.floor((2 * CONFIG.scoring.accuracyBonusK) / 4));
  });

  it("awards a remaining-lives bonus at game over", () => {
    let s: GameState = {
      ...playing(),
      lives: 3,
      shots: 0,
      score: 0,
      aliens: [{ x: 50, y: 0, w: 16, h: 12, alive: true, row: 0, col: 0 }],
    };
    // Park an alien on the player baseline → immediate game over with lives left.
    s = { ...s, aliens: [{ x: 50, y: s.player.y, w: 16, h: 12, alive: true, row: 0, col: 0 }] };
    s = step(s, 16, idle);
    expect(s.phase).toBe("gameover");
    expect(s.score).toBe(3 * CONFIG.scoring.livesBonus);
  });
});
