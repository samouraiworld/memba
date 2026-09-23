import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { soundsForEvents, soundsForChainCues, ufoDroneWanted, loadMuted, saveMuted, createAudioEngine } from "./audio";
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

  it("gives UFO arrival and a lost life their own sounds", () => {
    expect(soundsForEvents([{ type: "ufoSpawned" }, { type: "playerHit" }, { type: "lifeLost" }])).toEqual([
      "ufoArrive",
      "hit",
      "lifeLost",
    ]);
  });

  it("ignores events with no sound", () => {
    expect(soundsForEvents([{ type: "shotMissed" }])).toEqual([]);
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

describe("derived cues", () => {
  it("maps chain tier jumps and breaks to their sounds", () => {
    expect(
      soundsForChainCues([
        { type: "tierUp", mult10: 15, x: 0, y: 0 },
        { type: "broken", mult10: 15 },
      ]),
    ).toEqual(["chainUp", "chainBreak"]);
  });

  it("wants the UFO drone only while a live UFO crosses a running game", () => {
    const ufo = { x: 0, y: 22, w: 24, h: 10, dir: 1 as const, alive: true };
    expect(ufoDroneWanted({ phase: "playing", ufo })).toBe(true);
    expect(ufoDroneWanted({ phase: "playing", ufo: null })).toBe(false);
    expect(ufoDroneWanted({ phase: "playing", ufo: { ...ufo, alive: false } })).toBe(false);
    for (const phase of ["paused", "gameover", "ready"] as const) expect(ufoDroneWanted({ phase, ufo })).toBe(false);
  });
});

function installOscillatorContext() {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const oscillators: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const context = {
    state: "running" as AudioContextState,
    currentTime: 0,
    destination: {},
    sampleRate: 48_000,
    createGain: vi.fn(() => ({ gain: param(), connect: vi.fn() })),
    createOscillator: vi.fn(() => {
      const osc = { type: "sine", frequency: param(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      oscillators.push(osc);
      return osc;
    }),
    resume: vi.fn(() => Promise.resolve()),
    suspend: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
  vi.stubGlobal("AudioContext", vi.fn(function AudioContextMock() {
    return context;
  }));
  return { context, oscillators };
}

describe("UFO drone", () => {
  it("starts once, is idempotent, and stops on request", () => {
    const { oscillators } = installOscillatorContext();
    const e = createAudioEngine();
    e.setDrone(true);
    e.setDrone(true);
    expect(e.droning).toBe(true);
    expect(oscillators).toHaveLength(2); // tone + LFO, created once
    e.setDrone(false);
    expect(e.droning).toBe(false);
    for (const osc of oscillators) expect(osc.stop).toHaveBeenCalled();
    e.dispose();
  });

  it("never drones while muted, and muting silences a running drone", () => {
    installOscillatorContext();
    const e = createAudioEngine();
    e.setDrone(true);
    e.setMuted(true);
    expect(e.droning).toBe(false);
    e.setDrone(true);
    expect(e.droning).toBe(false);
    e.setMuted(false);
    e.setDrone(true);
    expect(e.droning).toBe(true);
    e.dispose();
    expect(e.droning).toBe(false);
  });

  it("synthesizes the new cues without throwing", () => {
    const { oscillators } = installOscillatorContext();
    const e = createAudioEngine();
    for (const id of ["ufoArrive", "lifeLost", "gameOver", "chainUp", "chainBreak"] as const) e.play(id);
    expect(oscillators.length).toBeGreaterThanOrEqual(9);
    e.dispose();
  });
});
