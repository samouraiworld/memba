import { describe, it, expect } from "vitest";
import { step } from "./step";
import { newGame } from "./spawn";
import { CONFIG, formationStepMs } from "./config";
import type { GameState, InputIntent } from "./types";

const idle: InputIntent = { move: 0, fire: false, pause: false };

function playing(seed = 1): GameState {
  return { ...newGame(seed), phase: "playing" };
}

describe("step — formation march", () => {
  it("does not move the formation before the cadence elapses", () => {
    const s = playing();
    const x0 = s.aliens[0].x;
    const s1 = step(s, 16, idle);
    expect(s1.aliens[0].x).toBe(x0);
  });

  it("marches horizontally once accumulated time passes the cadence", () => {
    let s = playing();
    const x0 = s.aliens[0].x;
    for (let i = 0; i < 60; i++) s = step(s, 16, idle); // ~960ms > stepMsMax
    expect(s.aliens[0].x).not.toBe(x0);
  });

  it("drops and reverses at the right edge", () => {
    let s = playing();
    const y0 = Math.max(...s.aliens.map((a) => a.y));
    // Force many marches to hit the right wall.
    for (let i = 0; i < 4000; i++) s = step(s, 16, idle);
    const y1 = Math.max(...s.aliens.map((a) => a.y));
    expect(y1).toBeGreaterThan(y0); // dropped at least once
  });

  it("marches faster when few aliens remain", () => {
    const many = playing();
    const few: GameState = {
      ...playing(),
      aliens: playing().aliens.map((a, i) => ({ ...a, alive: i < 2 })),
    };
    // With fewer alive, cadence is shorter → same elapsed time yields more moves.
    // Assert via formationStepMs indirectly: fewer alive ⇒ smaller cadence.
    const cadenceMany = formationStepMs(
      many.aliens.filter((a) => a.alive).length,
      many.aliens.length
    );
    const cadenceFew = formationStepMs(2, few.aliens.length);
    expect(cadenceFew).toBeLessThan(cadenceMany);
  });
});
