import { describe, it, expect } from "vitest";
import { combineInput, quantizeMove } from "./lib/wire";
import { steerAmount } from "./hooks/useTouch";

// Determinism fix 2 — touch quantization at the input seam. combineInput is
// the shell's single point where keyboard + touch merge into the engine's
// InputIntent; everything it emits must be a wire-representable tenth
// (move10 = move*10 an exact int), or the recorded log and the lived run
// disagree on the very first analog touch-steer.

const idle = { move: 0, fire: false, pause: false };

describe("combineInput (the live-input seam)", () => {
  it("quantizes analog touch steering to tenths before the engine sees it", () => {
    expect(combineInput(idle, { move: 0.234, fire: false, pause: false }).move).toBe(0.2);
    expect(combineInput(idle, { move: -0.987, fire: false, pause: false }).move).toBe(-1);
    expect(combineInput(idle, { move: 0.04, fire: false, pause: false }).move).toBe(0);
  });

  it("keeps keyboard semantics intact (±1/0 pass through, keyboard wins over touch)", () => {
    expect(combineInput({ move: 1, fire: false, pause: false }, { move: -0.4, fire: false, pause: false }).move).toBe(1);
    expect(combineInput({ move: -1, fire: false, pause: false }, idle).move).toBe(-1);
    // keyboard move 0 falls through to touch (the pre-existing || rule)
    expect(combineInput({ move: 0, fire: false, pause: false }, { move: -0.4, fire: false, pause: false }).move).toBe(-0.4);
  });

  it("ORs fire and passes the pause edge straight through (keyboard-only)", () => {
    expect(combineInput({ move: 0, fire: true, pause: false }, idle).fire).toBe(true);
    expect(combineInput(idle, { move: 0, fire: true, pause: false }).fire).toBe(true);
    expect(combineInput({ move: 0, fire: false, pause: true }, { move: 0, fire: false, pause: false }).pause).toBe(true);
  });

  it("every steerAmount output leaves the seam wire-representable (move10 exact int in [-10,10])", () => {
    // Sweep the real touch pipeline: raw drag px -> steerAmount -> the seam.
    for (let dx = -80; dx <= 80; dx++) {
      const seamMove = combineInput(idle, { move: steerAmount(dx), fire: false, pause: false }).move;
      const move10 = Math.round(seamMove * 10);
      expect(Number.isInteger(move10)).toBe(true);
      expect(move10).toBeGreaterThanOrEqual(-10);
      expect(move10).toBeLessThanOrEqual(10);
      // The wire decode (move10/10) reproduces the exact live value.
      expect(move10 / 10).toBe(seamMove);
      // And the seam is a fixed point (already-quantized values pass through).
      expect(quantizeMove(seamMove)).toBe(seamMove);
    }
  });
});
