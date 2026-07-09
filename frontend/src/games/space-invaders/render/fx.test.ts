import { describe, it, expect } from "vitest";
import { createFx, fxConsume, fxUpdate } from "./fx";
import type { GameEvent } from "../engine";

const kill: GameEvent = { type: "alienKilled", x: 100, y: 50, row: 0 };
const hit: GameEvent = { type: "playerHit" };

// The cosmetic layer reads the deterministic event channel and produces
// visual-only effects using its OWN rng — it must never touch or depend on the
// simulation, so an onchain replay stays byte-identical regardless of juice.
describe("cosmetic fx layer", () => {
  it("spawns particles and a score popup on alienKilled", () => {
    const fx = createFx(1);
    fxConsume(fx, [kill]);
    expect(fx.particles.length).toBeGreaterThan(0);
    expect(fx.popups.length).toBe(1);
  });

  it("adds screen shake on playerHit", () => {
    const fx = createFx(1);
    fxConsume(fx, [hit]);
    expect(fx.shake).toBeGreaterThan(0);
  });

  it("expires particles over time", () => {
    const fx = createFx(1);
    fxConsume(fx, [kill]);
    for (let i = 0; i < 200; i++) fxUpdate(fx, 16);
    expect(fx.particles.length).toBe(0);
  });

  it("decays shake to zero over time", () => {
    const fx = createFx(1);
    fxConsume(fx, [hit]);
    for (let i = 0; i < 200; i++) fxUpdate(fx, 16);
    expect(fx.shake).toBe(0);
  });

  it("suppresses particles and shake under reduced motion", () => {
    const fx = createFx(1, { reducedMotion: true });
    fxConsume(fx, [kill, hit]);
    expect(fx.particles.length).toBe(0);
    expect(fx.shake).toBe(0);
  });

  it("caps particles so juice cannot exhaust memory", () => {
    const fx = createFx(1);
    for (let i = 0; i < 500; i++) fxConsume(fx, [kill]);
    expect(fx.particles.length).toBeLessThanOrEqual(300);
  });
});
