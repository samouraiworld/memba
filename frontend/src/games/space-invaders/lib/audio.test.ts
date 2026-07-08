import { describe, it, expect, beforeEach } from "vitest";
import { soundsForEvents, loadMuted, saveMuted, createAudioEngine } from "./audio";
import type { GameEvent } from "../engine";

beforeEach(() => localStorage.clear());

describe("soundsForEvents", () => {
  it("maps gameplay events to their sounds", () => {
    const events: GameEvent[] = [
      { type: "playerFired", x: 0 },
      { type: "alienKilled", x: 0, y: 0, row: 0 },
      { type: "waveCleared" },
      { type: "ufoKilled", x: 0, y: 0, points: 300 },
      { type: "playerHit" },
      { type: "alienStep", dir: 1 },
    ];
    expect(soundsForEvents(events)).toEqual(["shoot", "explosion", "wave", "ufo", "hit", "march"]);
  });

  it("ignores events with no sound", () => {
    expect(soundsForEvents([{ type: "shotMissed" }, { type: "ufoSpawned" }, { type: "lifeLost" }])).toEqual([]);
  });
});

describe("mute persistence", () => {
  it("defaults to not muted", () => {
    expect(loadMuted()).toBe(false);
  });
  it("round-trips through localStorage", () => {
    saveMuted(true);
    expect(loadMuted()).toBe(true);
    saveMuted(false);
    expect(loadMuted()).toBe(false);
  });
});

describe("audio engine (feature-detected, never throws)", () => {
  it("is a safe no-op when WebAudio is unavailable (jsdom)", () => {
    const e = createAudioEngine();
    expect(() => {
      e.unlock();
      e.play("shoot");
      e.play("explosion");
      e.setMuted(true);
    }).not.toThrow();
    expect(e.muted).toBe(true);
  });
});
