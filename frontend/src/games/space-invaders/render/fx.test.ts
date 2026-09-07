import { describe, it, expect } from "vitest";
import { createFx, fxConsume, fxUpdate } from "./fx";
import type { GameEvent } from "../engine";

const kill: GameEvent = { type: "alienKilled", x: 100, y: 50, row: 0 };
const hit: GameEvent = { type: "playerHit" };

// The cosmetic layer reads the deterministic event channel and produces
// visual-only effects using its OWN rng — it must never touch or depend on the
// simulation, so an onchain replay stays byte-identical regardless of juice.
describe("cosmetic fx layer", () => {
  it("spawns particles and honest non-numeric feedback on alienKilled", () => {
    const fx = createFx(1);
    fxConsume(fx, [kill]);
    expect(fx.particles.length).toBeGreaterThan(0);
    expect(fx.popups.length).toBe(1);
    expect(fx.popups[0]?.text).toBe("HIT");
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
    fxConsume(fx, [kill, hit, { type: "waveCleared" }, { type: "ufoSpawned" }]);
    expect(fx.particles.length).toBe(0);
    expect(fx.shake).toBe(0);
    expect(fx.flash).toBe(0);
    expect(fx.signal).toBe(0);
    expect(fx.popups.length).toBeGreaterThan(0);
  });

  it("caps particles so juice cannot exhaust memory", () => {
    const fx = createFx(1);
    for (let i = 0; i < 500; i++) fxConsume(fx, [kill]);
    expect(fx.particles.length).toBeLessThanOrEqual(300);
    expect(fx.popups.length).toBeLessThanOrEqual(120);
  });

  it("produces identical cosmetic bursts for identical seeds and events", () => {
    const first = createFx(123);
    const second = createFx(123);
    const events: GameEvent[] = [kill, { type: "ufoKilled", x: 30, y: 22, points: 300 }];
    fxConsume(first, events);
    fxConsume(second, events);
    expect(second).toEqual(first);
  });

  it("compacts expired effects in place instead of allocating frame arrays", () => {
    const fx = createFx(5);
    fxConsume(fx, [kill]);
    const particles = fx.particles;
    const popups = fx.popups;
    fxUpdate(fx, 100);
    expect(fx.particles).toBe(particles);
    expect(fx.popups).toBe(popups);
  });
});
