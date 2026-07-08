import { describe, it, expect } from "vitest";
import { newGame, step } from "./index";
import type { InputIntent } from "./index";

// A fixed scripted input sequence; same seed must yield identical final state.
function run(seed: number) {
  const script: InputIntent[] = [];
  for (let i = 0; i < 300; i++) {
    script.push({ move: (i % 3) - 1 as -1 | 0 | 1, fire: i % 7 === 0, pause: false });
  }
  let s = newGame(seed);
  for (const input of script) s = step(s, 16, input);
  return s;
}

describe("engine determinism", () => {
  it("same seed + same inputs → identical state", () => {
    expect(run(2026)).toEqual(run(2026));
  });

  it("different seeds diverge", () => {
    expect(run(1)).not.toEqual(run(2));
  });
});
