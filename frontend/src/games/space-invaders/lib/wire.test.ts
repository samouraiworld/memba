import { describe, it, expect } from "vitest";
import { quantizeMove, toWireDeltas, fromWireDeltas, MAX_CERTIFY_FINAL_TICK, MAX_CERTIFY_EVENTS } from "./wire";
import { createInputRecorder } from "./replay";

describe("quantizeMove (the live-input seam)", () => {
  it("rounds analog steering to exact tenths", () => {
    expect(quantizeMove(0.234)).toBe(0.2);
    expect(quantizeMove(0.25)).toBe(0.3); // Math.round half-up
    expect(quantizeMove(-0.734)).toBe(-0.7);
    expect(quantizeMove(0.999)).toBe(1);
  });

  it("keeps keyboard full-deflection exact (no behavior change for ±1/0)", () => {
    expect(quantizeMove(1)).toBe(1);
    expect(quantizeMove(-1)).toBe(-1);
    expect(quantizeMove(0)).toBe(0);
  });

  it("clamps out-of-range input so move10 stays in [-10, 10] by construction", () => {
    expect(quantizeMove(1.7)).toBe(1);
    expect(quantizeMove(-42)).toBe(-1);
  });

  it("never emits negative zero (wire and engine equality both compare ===)", () => {
    expect(Object.is(quantizeMove(-0.04), 0)).toBe(true);
    expect(Object.is(quantizeMove(-0), 0)).toBe(true);
  });

  it("round-trips every representable step through the wire exactly", () => {
    // The full contract: for each of the 21 quantized values q, the wire's
    // move10 is an exact int and the server's q' = move10/10 is the SAME
    // double the live engine consumed. This is what makes live === replay.
    for (let k = -10; k <= 10; k++) {
      const q = quantizeMove(k / 10);
      const move10 = Math.round(q * 10);
      expect(move10).toBe(k);
      expect(move10 / 10).toBe(q);
    }
  });

  it("is idempotent (quantizing a quantized value is a no-op)", () => {
    for (let k = -10; k <= 10; k++) {
      const q = k / 10;
      expect(quantizeMove(q)).toBe(q === 0 ? 0 : q);
    }
  });
});

describe("wire delta codec", () => {
  it("encodes a recorded log as strict int 4-tuples", () => {
    const rec = createInputRecorder(7);
    rec.record(0, { move: 0, fire: false, pause: false });
    rec.record(5, { move: 1, fire: false, pause: false });
    rec.record(60, { move: -0.3, fire: true, pause: false });
    const wire = toWireDeltas(rec.build(600));
    expect(wire).toEqual([
      [0, 0, 0, 0],
      [5, 10, 0, 0],
      [60, -3, 1, 0],
    ]);
    for (const t of wire) for (const n of t) expect(Number.isInteger(n)).toBe(true);
  });

  it("produces strictly increasing ticks from a recorder-built log", () => {
    const rec = createInputRecorder(1);
    const moves = [0, 0.1, 0.1, -0.5, -0.5, 0];
    moves.forEach((m, i) => rec.record(i * 7, { move: m, fire: i % 2 === 0, pause: false }));
    const wire = toWireDeltas(rec.build(100));
    for (let i = 1; i < wire.length; i++) expect(wire[i][0]).toBeGreaterThan(wire[i - 1][0]);
  });

  it("decodes exactly the way the verify worker does (move10/10, ===1 booleans)", () => {
    const decoded = fromWireDeltas([
      [5, 10, 0, 0],
      [60, -3, 1, 0],
      [90, 0, 0, 1],
    ]);
    expect(decoded).toEqual([
      { tick: 5, move: 1, fire: false, pause: false },
      { tick: 60, move: -0.3, fire: true, pause: false },
      { tick: 90, move: 0, fire: false, pause: true },
    ]);
  });

  it("encode -> decode round-trips a quantized log bit-for-bit", () => {
    const rec = createInputRecorder(9);
    const script = [0.3, -0.7, 1, -1, 0.1, 0];
    script.forEach((m, i) => rec.record(i * 11, { move: quantizeMove(m), fire: i % 3 === 0, pause: false }));
    const log = rec.build(600);
    expect(fromWireDeltas(toWireDeltas(log))).toEqual(log.inputs);
  });

  it("pins the backend caps this client gates certifiability on", () => {
    // validate.go: MaxFinalTick 216_000, MaxEventsInvaders 10_000.
    expect(MAX_CERTIFY_FINAL_TICK).toBe(216_000);
    expect(MAX_CERTIFY_EVENTS).toBe(10_000);
  });
});
