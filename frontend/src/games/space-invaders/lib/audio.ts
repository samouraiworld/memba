import type { GameEvent, GameState } from "../engine";
import type { ChainCue } from "./results";

// Audio is a cosmetic layer driven by the deterministic event channel — like
// the fx layer, it reads events but never touches the simulation. WebAudio is
// feature-detected and every call is guarded, so it's a safe no-op where the
// API is missing (SSR, jsdom tests, locked-down browsers).

export type SoundId =
  | "shoot"
  | "explosion"
  | "hit"
  | "wave"
  | "ufo"
  | "march"
  | "ufoArrive"
  | "lifeLost"
  | "gameOver"
  | "chainUp"
  | "chainBreak";

const EVENT_SOUND: Partial<Record<GameEvent["type"], SoundId>> = {
  playerFired: "shoot",
  alienKilled: "explosion",
  ufoKilled: "ufo",
  playerHit: "hit",
  lifeLost: "lifeLost",
  waveCleared: "wave",
  alienStep: "march",
  ufoSpawned: "ufoArrive",
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

/** Sounds for the chain cues derived from the same events (see chainCues). */
export function soundsForChainCues(cues: readonly ChainCue[]): SoundId[] {
  return cues.map((c) => (c.type === "tierUp" ? "chainUp" : "chainBreak"));
}

/** The UFO drone runs only while a live UFO crosses a running game — never on
 *  pause, the menu, the ready screen or game over. */
export function ufoDroneWanted(state: Pick<GameState, "phase" | "ufo">): boolean {
  return state.phase === "playing" && !!state.ufo?.alive;
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
  /** Start or stop the looping UFO drone. Idempotent; never sounds while muted. */
  setDrone(on: boolean): void;
  /** True while the drone oscillator is running (for tests and debugging). */
  readonly droning: boolean;
  setMuted(muted: boolean): void;
  /** Permanently release this engine's WebAudio resources. Idempotent. */
  dispose(): void;
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
  let disposed = false;
  let resumeAfterVisibility = false;
  const MARCH_NOTES = [110, 98, 87, 82]; // iconic 4-note descending bass cycle
  let drone: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;

  function ensure(): boolean {
    if (!AC || disposed) return false;
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

  // Browsers normally suspend hidden tabs themselves, but doing it explicitly
  // avoids an orphaned context consuming resources on platforms that do not.
  // Resume only when this already-unlocked context was running before the tab
  // was hidden; a newly-created context still requires unlock() from a gesture.
  const onVisibilityChange = () => {
    if (!ctx || disposed) return;
    if (document.visibilityState !== "visible") {
      resumeAfterVisibility = ctx.state === "running";
      if (resumeAfterVisibility) ctx.suspend().catch(() => {});
    } else if (resumeAfterVisibility && ctx.state === "suspended") {
      resumeAfterVisibility = false;
      ctx.resume().catch(() => {});
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
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

  // A pitch glide from `from` to `to` Hz, optionally delayed so layered cues
  // (a hit, then the life-lost fall, then game over) stay distinguishable.
  function sweep(from: number, to: number, ms: number, type: OscillatorType, gain: number, delayMs = 0): void {
    if (!ensure() || !ctx || !master) return;
    try {
      const t = ctx.currentTime + delayMs / 1000;
      const end = t + ms / 1000;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, end);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(end);
    } catch {
      /* ignore */
    }
  }

  function stopDrone(): void {
    const d = drone;
    drone = null;
    if (!d || !ctx) return;
    try {
      const t = ctx.currentTime;
      d.gain.gain.cancelScheduledValues(t);
      d.gain.gain.setValueAtTime(d.gain.gain.value, t);
      d.gain.gain.linearRampToValueAtTime(0, t + 0.08);
      d.osc.stop(t + 0.1);
      d.lfo.stop(t + 0.1);
    } catch {
      /* ignore */
    }
  }

  function startDrone(): void {
    if (drone || muted || !ensure() || !ctx || !master) return;
    try {
      const t = ctx.currentTime;
      // Classic saucer warble: a triangle tone wobbled by a slow sine LFO.
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(560, t);
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(7, t);
      depth.gain.setValueAtTime(70, t);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.15);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      lfo.start(t);
      drone = { osc, lfo, gain };
    } catch {
      drone = null;
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
    get droning() {
      return drone !== null;
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
        case "ufoArrive":
          sweep(420, 980, 260, "sine", 0.45);
          sweep(980, 700, 160, "sine", 0.3, 260);
          break;
        case "lifeLost":
          sweep(440, 90, 520, "sawtooth", 0.5, 90);
          break;
        case "gameOver":
          sweep(330, 300, 190, "square", 0.45, 260);
          sweep(262, 240, 190, "square", 0.45, 480);
          sweep(196, 98, 620, "square", 0.5, 700);
          break;
        case "chainUp":
          blip(660, 70, "triangle", 0.45);
          sweep(880, 1320, 120, "triangle", 0.45, 60);
          break;
        case "chainBreak":
          sweep(360, 150, 180, "square", 0.3);
          break;
      }
    },
    setDrone(on) {
      if (on) startDrone();
      else stopDrone();
    },
    setMuted(m) {
      muted = m;
      saveMuted(m);
      if (master) master.gain.value = m ? 0 : 0.25;
      if (m) stopDrone();
    },
    dispose() {
      if (disposed) return;
      stopDrone();
      disposed = true;
      resumeAfterVisibility = false;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      const active = ctx;
      ctx = null;
      master = null;
      if (active && active.state !== "closed") active.close().catch(() => {});
    },
  };
}
