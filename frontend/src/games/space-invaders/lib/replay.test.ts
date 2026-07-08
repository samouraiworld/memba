import { describe, it, expect } from "vitest";
import { createInputRecorder, inputAtTick, REPLAY_VERSION } from "./replay";
import type { InputIntent } from "../engine";

const idle: InputIntent = { move: 0, fire: false, pause: false };
const right: InputIntent = { move: 1, fire: false, pause: false };
const fire: InputIntent = { move: 0, fire: true, pause: false };

// The input recorder is the replay backbone: seed + tick-indexed input deltas.
// Delta-encoding keeps a full game to a few hundred edges so it is cheap to
// submit and to re-simulate server-side (and, later, onchain) for anti-cheat.
describe("input recorder", () => {
  it("delta-encodes: an unchanged input records only once", () => {
    const rec = createInputRecorder(0xabc);
    rec.record(0, idle);
    rec.record(1, idle);
    rec.record(2, idle);
    const log = rec.build(2);
    expect(log.inputs).toHaveLength(1);
    expect(log.inputs[0].tick).toBe(0);
  });

  it("records every change with its tick", () => {
    const rec = createInputRecorder(0xabc);
    rec.record(0, idle);
    rec.record(1, right);
    rec.record(2, idle);
    const log = rec.build(2);
    expect(log.inputs.map((d) => d.tick)).toEqual([0, 1, 2]);
  });

  it("build() carries seed, finalTick and a version", () => {
    const rec = createInputRecorder(777);
    rec.record(0, fire);
    const log = rec.build(10);
    expect(log.seed).toBe(777);
    expect(log.finalTick).toBe(10);
    expect(log.version).toBe(REPLAY_VERSION);
  });

  it("inputAtTick reconstructs the input active at any tick", () => {
    const rec = createInputRecorder(1);
    rec.record(0, idle);
    rec.record(2, right);
    rec.record(5, idle);
    const log = rec.build(9);
    expect(inputAtTick(log, 0)).toEqual(idle);
    expect(inputAtTick(log, 1)).toEqual(idle);
    expect(inputAtTick(log, 2)).toEqual(right);
    expect(inputAtTick(log, 4)).toEqual(right);
    expect(inputAtTick(log, 7)).toEqual(idle);
  });

  it("inputAtTick is idle before the first recorded delta", () => {
    const rec = createInputRecorder(1);
    rec.record(3, right);
    const log = rec.build(5);
    expect(inputAtTick(log, 0)).toEqual(idle);
  });
});
