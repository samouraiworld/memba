import type { GameEvent } from "../engine";

// Audio is a cosmetic layer driven by the deterministic event channel — like
// the fx layer, it reads events but never touches the simulation. WebAudio is
// feature-detected and every call is guarded, so it's a safe no-op where the
// API is missing (SSR, jsdom tests, locked-down browsers).

export type SoundId = "shoot" | "explosion" | "hit" | "wave" | "ufo" | "march";

const EVENT_SOUND: Partial<Record<GameEvent["type"], SoundId>> = {
  playerFired: "shoot",
  alienKilled: "explosion",
  ufoKilled: "ufo",
  playerHit: "hit",
  waveCleared: "wave",
  alienStep: "march",
};

/** Pure map from a frame's events to the sounds to play (order preserved). */
export function soundsForEvents(events: GameEvent[]): SoundId[] {
  const out: SoundId[] = [];
  for (const e of events) {
    const s = EVENT_SOUND[e.type];
    if (s) out.push(s);
  }
  return out;
}

const MUTE_KEY = "memba.space-invaders.muted";

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* storage unavailable — best effort */
  }
}

export interface AudioEngine {
  readonly muted: boolean;
  /** Resume the context inside a user gesture (mobile autoplay unlock). */
  unlock(): void;
  play(id: SoundId): void;
  setMuted(muted: boolean): void;
}

type ACtor = typeof AudioContext;

export function createAudioEngine(): AudioEngine {
  const AC: ACtor | undefined =
    typeof window !== "undefined"
      ? window.AudioContext || (window as unknown as { webkitAudioContext?: ACtor }).webkitAudioContext
      : undefined;

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = loadMuted();
  let marchStep = 0;
  const MARCH_NOTES = [110, 98, 87, 82]; // iconic 4-note descending bass cycle

  function ensure(): boolean {
    if (!AC) return false;
    if (!ctx) {
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.25;
        master.connect(ctx.destination);
      } catch {
        ctx = null;
        return false;
      }
    }
    return !!ctx && !!master;
  }

  function blip(freq: number, ms: number, type: OscillatorType, gain: number): void {
    if (!ensure() || !ctx || !master) return;
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + ms / 1000);
    } catch {
      /* ignore */
    }
  }

  function noise(ms: number): void {
    if (!ensure() || !ctx || !master) return;
    try {
      const t = ctx.currentTime;
      const frames = Math.floor((ctx.sampleRate * ms) / 1000);
      const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0.6;
      src.connect(g);
      g.connect(master);
      src.start(t);
    } catch {
      /* ignore */
    }
  }

  return {
    get muted() {
      return muted;
    },
    unlock() {
      if (ensure() && ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    },
    play(id) {
      switch (id) {
        case "shoot":
          blip(660, 70, "square", 0.5);
          break;
        case "explosion":
          noise(160);
          break;
        case "hit":
          blip(120, 200, "sawtooth", 0.7);
          break;
        case "wave":
          blip(440, 130, "triangle", 0.6);
          break;
        case "ufo":
          blip(880, 180, "sine", 0.5);
          break;
        case "march":
          blip(MARCH_NOTES[marchStep % MARCH_NOTES.length], 90, "square", 0.4);
          marchStep++;
          break;
      }
    },
    setMuted(m) {
      muted = m;
      saveMuted(m);
      if (master) master.gain.value = m ? 0 : 0.25;
    },
  };
}
