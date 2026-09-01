import { lazy, Suspense, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { newGame, comboMultiplier10, type GameState } from "./engine";
import { advanceWithEvents, drainAccumulator } from "./hooks/useGameLoop";
import { useKeyboard } from "./hooks/useKeyboard";
import { useTouch } from "./hooks/useTouch";
import { Canvas } from "./render/Canvas";
import { draw } from "./render/draw";
import { createFx, fxConsume, fxUpdate, type FxState } from "./render/fx";
import { loadBest, saveBest } from "./lib/highScore";
import { newRunSeed } from "./lib/seed";
import { vibrate } from "./lib/haptics";
import { createAudioEngine, soundsForEvents, loadMuted, type AudioEngine } from "./lib/audio";
import { dailySeedString, seedFromSeedString, formatStateHash } from "./lib/daily";
import { createInputRecorder, REPLAY_VERSION, type InputRecorder } from "./lib/replay";
import { simulateReplay, hashState } from "./lib/verify";
import { combineInput, toWireDeltas, fromWireDeltas, MAX_CERTIFY_FINAL_TICK, MAX_CERTIFY_EVENTS } from "./lib/wire";
import { isSpaceInvadersEnabled, isSpaceInvadersCertifyEnabled } from "../../lib/config";
import "./space-invaders.css";

// The on-chain certify control is a lazy chunk (it pulls in the wallet hooks),
// so the no-wallet play path never loads them — mirror of BarricadeCertify.
const SpaceInvadersCertify = lazy(() => import("./SpaceInvadersCertify"));

type RunMode = "free" | "daily";

// The finished daily run, snapshotted into state at the gameover transition
// (never read from refs during render). `events` is the certify wire form
// ([tick, move10, fire, pause] int tuples); `verified` means the wire-decoded
// log re-simulated to the identical score + state hash — the same check the
// backend performs — AND the run fits the backend caps.
interface DailyOutcome {
  seed: string; // the daily seed STRING (invaders-YYYY-MM-DD)
  day: string;
  finalTick: number;
  events: number[][];
  score: number;
  hash: string; // 8 lowercase hex chars, zero-padded
  verified: boolean;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export default function SpaceInvaders({
  initialState,
  seed,
}: {
  initialState?: Partial<GameState>;
  // Fixed seed (e.g. tests). Omitted → a fresh random seed per free run, so no
  // two free games are identical. Daily runs derive their seed from the UTC
  // day instead (lib/daily.ts) and ignore this.
  seed?: number;
}) {
  const reducedMotion = prefersReducedMotion();
  // Stable initial seed for this mount (a plain value, safe to read during
  // render). seedRef holds the *current* run's seed and is mutated only in
  // beginRun() — never read during render.
  const [runSeed] = useState<number>(() => seed ?? newRunSeed());
  const seedRef = useRef<number>(runSeed);
  // Merge onto a full newGame() base so partial overrides (e.g. from tests)
  // still produce a valid GameState — draw() assumes all fields are present.
  const [state, setState] = useState<GameState>(() => ({ ...newGame(runSeed), ...initialState }));
  const stateRef = useRef(state);
  const [best, setBest] = useState(() => loadBest());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fxRef = useRef<FxState>(createFx(runSeed, { reducedMotion }));
  const audioRef = useRef<AudioEngine>(createAudioEngine());
  const [muted, setMuted] = useState(() => loadMuted());

  // Daily-challenge state. The refs feed the rAF loop; mode/day/outcome are
  // mirrored into React state for render. Free play records NOTHING — the
  // recorder ref stays null, so the loop's certify path is a single null check.
  const [mode, setMode] = useState<RunMode>("free");
  const [dailyDay, setDailyDay] = useState("");
  const [dailyOutcome, setDailyOutcome] = useState<DailyOutcome | null>(null);
  const modeRef = useRef<RunMode>("free");
  const dailySeedStrRef = useRef("");
  const recorderRef = useRef<InputRecorder | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Unlock WebAudio on the first user gesture (mobile autoplay policy).
  useEffect(() => {
    const unlock = () => {
      audioRef.current.unlock();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const areaRef = useRef<HTMLDivElement>(null);
  const getKeyInput = useKeyboard();
  // useTouch's signature predates the stricter RefObject<T | null> inference;
  // the ref is always non-null by the time the effect inside useTouch runs.
  const getTouchInput = useTouch(areaRef as RefObject<HTMLElement>);

  // Quantize steering to tenths AT THE INPUT SEAM (combineInput): the live
  // engine, the recorder, and the server's replay (which reconstructs move as
  // move10/10) must all consume the identical value, or a certified run's
  // re-simulation diverges on the first analog touch-steer.
  const getInput = useCallback(
    () => combineInput(getKeyInput(), getTouchInput()),
    [getKeyInput, getTouchInput],
  );

  // Snapshot the finished daily run: build the recorded log at the gameover
  // tick, encode it to the certify wire form, and self-verify by re-simulating
  // the DECODED wire — precisely the simulation the server will run. A run past
  // the backend caps (>1h or >10k input changes) can never certify, so the
  // bounded re-sim is skipped and the run stays unverified.
  const finishDailyRun = useCallback((final: GameState) => {
    const rec = recorderRef.current;
    if (modeRef.current !== "daily" || !rec) return;
    const seedStr = dailySeedStrRef.current;
    const log = rec.build(final.tick);
    const events = toWireDeltas(log);
    const withinCaps =
      final.tick > 0 && final.tick <= MAX_CERTIFY_FINAL_TICK && events.length <= MAX_CERTIFY_EVENTS;
    let verified = false;
    if (withinCaps) {
      const sim = simulateReplay({
        version: REPLAY_VERSION,
        seed: seedFromSeedString(seedStr),
        finalTick: final.tick,
        inputs: fromWireDeltas(events),
      });
      verified = sim.score === final.score && sim.hash === hashState(final);
    }
    setDailyOutcome({
      seed: seedStr,
      day: seedStr.slice(-10),
      finalTick: final.tick,
      events,
      score: final.score,
      hash: formatStateHash(hashState(final)),
      verified,
    });
  }, []);

  // rAF loop (inline so tests can stub rAF). The canvas is drawn every frame
  // from the mutable state ref + fx layer — never from React state.
  const last = useRef<number | null>(null);
  const accRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    const tick = (time: number) => {
      if (last.current == null) last.current = time;
      const frameMs = time - last.current;
      last.current = time;
      const input = getInput();

      // Pause edge handled once per frame (never per sub-step).
      if (input.pause) {
        const cur = stateRef.current;
        if (cur.phase === "playing" || cur.phase === "paused") {
          const phase: GameState["phase"] = cur.phase === "playing" ? "paused" : "playing";
          const next = { ...cur, phase };
          stateRef.current = next;
          setState(next);
        }
      }

      if (stateRef.current.phase === "paused") {
        // Determinism: a paused game consumes NO ticks. Skip stepping entirely
        // and DROP the accumulator, so paused wall-time never turns into engine
        // steps — the recorded timeline is pause-free and a replay (which runs
        // with pause:false throughout) reproduces the run exactly.
        accRef.current = 0;
      } else {
        const { steps, acc } = drainAccumulator(accRef.current, frameMs);
        accRef.current = acc;
        if (steps > 0) {
          const prev = stateRef.current;
          const engineInput = { move: input.move, fire: input.fire, pause: false };
          // Daily mode: record the exact input the engine is about to consume,
          // stamped with the tick the replay will resolve it at (delta-encoded;
          // it covers all of this frame's sub-steps).
          if (recorderRef.current && prev.phase !== "gameover") {
            recorderRef.current.record(prev.tick, engineInput);
          }
          // Integer step count straight through (no float ms round-trip); collect
          // the frame's events for the cosmetic + haptic layers.
          const { state: next, events } = advanceWithEvents(prev, steps, engineInput);
          stateRef.current = next;
          fxConsume(fxRef.current, events);
          for (const s of soundsForEvents(events)) audioRef.current.play(s);
          if (events.some((e) => e.type === "playerHit")) vibrate(40);
          else if (events.some((e) => e.type === "waveCleared")) vibrate([15, 30, 15]);
          setState(next);
          // Persist the high score exactly on the transition into game over.
          if (next.phase === "gameover" && prev.phase !== "gameover") {
            setBest(saveBest(next.score));
            vibrate(120);
            finishDailyRun(next);
          }
        }
      }

      // Cosmetic layer advances on wall-clock; draw the canvas every frame.
      fxUpdate(fxRef.current, frameMs);
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) draw(ctx, stateRef.current, fxRef.current);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getInput, finishDailyRun]);

  // Reset into a fresh run. Daily seeds from the shared UTC day string (a
  // restart within the day REUSES the day's seed — the realm's re-attest only
  // ever raises a score, so replaying the daily is safe); free play keeps the
  // crypto-random per-run seed and records nothing. Plain handler (not
  // memoized) — only ever called from click handlers.
  const beginRun = (nextMode: RunMode) => {
    let nextSeed: number;
    if (nextMode === "daily") {
      const seedStr = dailySeedString();
      dailySeedStrRef.current = seedStr;
      nextSeed = seedFromSeedString(seedStr);
      recorderRef.current = createInputRecorder(nextSeed);
      setDailyDay(seedStr.slice(-10));
    } else {
      dailySeedStrRef.current = "";
      recorderRef.current = null;
      nextSeed = seed ?? newRunSeed();
      setDailyDay("");
    }
    modeRef.current = nextMode;
    setMode(nextMode);
    setDailyOutcome(null);
    seedRef.current = nextSeed;
    const fresh = newGame(nextSeed);
    stateRef.current = fresh;
    last.current = null;
    accRef.current = 0;
    fxRef.current = createFx(nextSeed, { reducedMotion });
    setState(fresh);
  };

  const restart = () => beginRun(modeRef.current);

  const togglePause = () => {
    const cur = stateRef.current;
    if (cur.phase !== "playing" && cur.phase !== "paused") return;
    const phase: GameState["phase"] = cur.phase === "playing" ? "paused" : "playing";
    const next = { ...cur, phase };
    stateRef.current = next;
    setState(next);
  };

  const certifyOn = isSpaceInvadersEnabled() && isSpaceInvadersCertifyEnabled();

  return (
    <div className="si-root">
      <div className="si-hud">
        <span>Score {state.score}</span>
        <span>Best {best}</span>
        <span>Wave {state.wave}</span>
        {state.combo >= 2 && (
          <span className="si-combo" aria-label={`combo multiplier ${(comboMultiplier10(state.combo) / 10).toFixed(1)} times`}>
            ×{(comboMultiplier10(state.combo) / 10).toFixed(1)}
          </span>
        )}
        <span aria-label={`${Math.max(0, state.lives)} lives`}>
          Lives {"◈".repeat(Math.max(0, state.lives))}
        </span>
        <button
          type="button"
          className="si-pause"
          onClick={() => {
            const m = !muted;
            audioRef.current.setMuted(m);
            setMuted(m);
          }}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <button
          type="button"
          className="si-pause"
          onClick={togglePause}
          aria-label={state.phase === "paused" ? "Resume" : "Pause"}
        >
          {state.phase === "paused" ? "▶" : "⏸"}
        </button>
      </div>

      <div className="si-stage" ref={areaRef}>
        <Canvas canvasRef={canvasRef} />
        {state.phase === "ready" && (
          <div className="si-touch-hints" aria-hidden="true">
            <div className="si-touch-zone si-touch-steer">◀ drag to steer ▶</div>
            <div className="si-touch-zone si-touch-fire">tap · fire</div>
          </div>
        )}
        {state.phase === "ready" && (
          <div className="si-overlay">
            <p>◀ ▶ move · Space fire</p>
            <p className="si-hint">On mobile: drag on the left to steer, tap right to fire</p>
            {mode === "daily" ? (
              <p className="si-daily-chip">Daily · {dailyDay} — make a move to begin</p>
            ) : (
              <p className="si-hint">Everyone gets the same daily board; free play is just for fun.</p>
            )}
            <div className="si-mode-row">
              <button type="button" onClick={() => beginRun("daily")}>Daily run</button>
              <button type="button" onClick={() => beginRun("free")}>Free play</button>
            </div>
          </div>
        )}
        {state.phase === "paused" && <div className="si-overlay"><p>Paused</p></div>}
        {state.phase === "gameover" && (
          <div className="si-overlay si-gameover">
            <h2>Game Over</h2>
            {mode === "daily" && dailyOutcome && (
              <p className="si-daily-chip">
                Daily · {dailyOutcome.day} · {dailyOutcome.verified ? "Verified ✓" : "Unverified"}
              </p>
            )}
            <p>Score {state.score} · Best {best}</p>
            <div className="si-mode-row">
              <button type="button" onClick={restart}>Play again</button>
              {mode === "daily" && (
                <button type="button" onClick={() => beginRun("free")}>Menu</button>
              )}
            </div>
            {certifyOn && mode === "daily" && dailyOutcome?.verified && (
              <div className="si-certify">
                <Suspense fallback={null}>
                  <SpaceInvadersCertify
                    run={{
                      seed: dailyOutcome.seed,
                      simVersion: REPLAY_VERSION,
                      events: dailyOutcome.events,
                      finalTick: dailyOutcome.finalTick,
                      claimedScore: dailyOutcome.score,
                      claimedHash: dailyOutcome.hash,
                    }}
                  />
                </Suspense>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
