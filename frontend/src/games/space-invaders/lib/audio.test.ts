import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { soundsForEvents, loadMuted, saveMuted, createAudioEngine } from "./audio";
import type { GameEvent } from "../engine";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

function installAudioContext() {
  let state: AudioContextState = "suspended";
  const master = { gain: { value: 0 }, connect: vi.fn() };
  const context = {
    get state() {
      return state;
    },
    currentTime: 0,
    destination: {},
    sampleRate: 48_000,
    createGain: vi.fn(() => master),
    resume: vi.fn(() => {
      state = "running";
      return Promise.resolve();
    }),
    suspend: vi.fn(() => {
      state = "suspended";
      return Promise.resolve();
    }),
    close: vi.fn(() => {
      state = "closed";
      return Promise.resolve();
    }),
  };
  const AudioContextMock = vi.fn(function AudioContextMock() {
    return context;
  });
  vi.stubGlobal("AudioContext", AudioContextMock);
  return { context, AudioContextMock };
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

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
      e.dispose();
    }).not.toThrow();
    expect(e.muted).toBe(true);
  });

  it("unlocks once, suspends while hidden, and resumes only an already-running context", () => {
    const { context, AudioContextMock } = installAudioContext();
    const e = createAudioEngine();

    // Visibility changes must not create or unlock audio before a gesture.
    setVisibility("hidden");
    setVisibility("visible");
    expect(AudioContextMock).not.toHaveBeenCalled();

    e.unlock();
    expect(AudioContextMock).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    expect(context.suspend).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    expect(context.resume).toHaveBeenCalledTimes(2);
    e.dispose();
  });

  it("disposes idempotently, removes lifecycle listeners, and cannot recreate audio", () => {
    const { context, AudioContextMock } = installAudioContext();
    const e = createAudioEngine();
    e.unlock();
    e.dispose();
    e.dispose();

    expect(context.close).toHaveBeenCalledTimes(1);
    setVisibility("hidden");
    expect(context.suspend).not.toHaveBeenCalled();

    e.unlock();
    e.play("shoot");
    expect(AudioContextMock).toHaveBeenCalledTimes(1);
  });
});
