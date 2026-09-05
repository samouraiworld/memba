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

const HUD_UPDATE_MS = 100;

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
  const audioRef = useRef<AudioEngine | null>(null);
  const [muted, setMuted] = useState(() => loadMuted());

  // Daily-challenge state. The refs feed the rAF loop; mode/day/outcome are
  // mirrored into React state for render. Free play records NOTHING — the
  // recorder ref stays null, so the loop's certify path is a single null check.
  const [mode, setMode] = useState<RunMode>("free");
  const [runArmed, setRunArmed] = useState(() => initialState?.phase != null && initialState.phase !== "ready");
  const [dailyDay, setDailyDay] = useState("");
  const [dailyOutcome, setDailyOutcome] = useState<DailyOutcome | null>(null);
  const modeRef = useRef<RunMode>("free");
  const runArmedRef = useRef(initialState?.phase != null && initialState.phase !== "ready");
  const dailySeedStrRef = useRef("");
  const recorderRef = useRef<InputRecorder | null>(null);
  const last = useRef<number | null>(null);
  const accRef = useRef(0);
  const lastHudUpdateRef = useRef(0);

  // Construct WebAudio inside the effect that owns it. This remains correct
  // under React StrictMode's setup → cleanup → setup development cycle and
  // prevents render-time listener leaks during the throttled HUD updates.
  useEffect(() => {
    const audio = createAudioEngine();
    audioRef.current = audio;
    const unlock = () => {
      audio.unlock();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      audio.dispose();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, []);

  const areaRef = useRef<HTMLDivElement>(null);
  const focusGameSurface = useCallback(() => {
    areaRef.current?.focus({ preventScroll: true });
  }, []);
  const getKeyInput = useKeyboard(areaRef);
  // useTouch's signature predates the stricter RefObject<T | null> inference;
  // the ref is always non-null by the time the effect inside useTouch runs.
  const getTouchInput = useTouch(areaRef as RefObject<HTMLElement>);

  // Losing the page is an explicit pause boundary. No ticks or replay inputs
  // are consumed while the player cannot see or control the run.
  useEffect(() => {
    const pauseForInterruption = () => {
      const cur = stateRef.current;
      if (cur.phase !== "playing") return;
      const next = { ...cur, phase: "paused" as const };
      stateRef.current = next;
      accRef.current = 0;
      setState(next);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") pauseForInterruption();
    };
    window.addEventListener("blur", pauseForInterruption);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", pauseForInterruption);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

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

  // rAF loop (inline so tests can stub rAF). Active play draws from the mutable
  // state ref + fx layer — never from React state; static phases paint on change.
  useEffect(() => {
    let raf = 0;
    let lastPaintedState: GameState | null = null;
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
          // The P shortcut already originates inside the keyboard-owned
          // surface. Reasserting focus keeps that contract explicit across the
          // pause overlay transition without affecting interruption pauses.
          focusGameSurface();
        }
      }

      const currentPhase = stateRef.current.phase;
      if (currentPhase === "paused" || currentPhase === "gameover") {
        // Determinism: a paused game consumes NO ticks. Skip stepping entirely
        // and DROP the accumulator, so paused wall-time never turns into engine
        // steps — the recorded timeline is pause-free and a replay (which runs
        // with pause:false throughout) reproduces the run exactly.
        accRef.current = 0;
      } else if (currentPhase === "ready" && (!runArmedRef.current || (input.move === 0 && !input.fire))) {
        // The menu and an armed-but-idle relay are presentation states. Polling
        // can continue for keyboard/touch input, but the simulation does not.
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
          for (const s of soundsForEvents(events)) audioRef.current?.play(s);
          if (events.some((e) => e.type === "playerHit")) vibrate(40);
          else if (events.some((e) => e.type === "waveCleared")) vibrate([15, 30, 15]);
          // Canvas paint reads the authoritative ref at frame rate. React only
          // needs a compact HUD projection, plus immediate phase transitions.
          const phaseChanged = next.phase !== prev.phase;
          if (phaseChanged || time - lastHudUpdateRef.current >= HUD_UPDATE_MS) {
            lastHudUpdateRef.current = time;
            setState(next);
          }
          // Persist the high score exactly on the transition into game over.
          if (next.phase === "gameover" && prev.phase !== "gameover") {
            setBest(saveBest(next.score));
            vibrate(120);
            finishDailyRun(next);
          }
        }
      }

      // Active play paints at frame rate. Static menu, armed-idle, paused, and
      // game-over states paint exactly once per state change: input polling can
      // stay live without burning mobile CPU/battery on an unchanged canvas.
      const renderState = stateRef.current;
      const activelyAnimating = renderState.phase === "playing";
      if (activelyAnimating) fxUpdate(fxRef.current, frameMs);
      if (activelyAnimating || renderState !== lastPaintedState) {
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) draw(ctx, renderState, fxRef.current);
        lastPaintedState = renderState;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getInput, finishDailyRun, focusGameSurface]);

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
    runArmedRef.current = true;
    setRunArmed(true);
    setDailyOutcome(null);
    seedRef.current = nextSeed;
    const fresh = newGame(nextSeed);
    stateRef.current = fresh;
    last.current = null;
    accRef.current = 0;
    fxRef.current = createFx(nextSeed, { reducedMotion });
    setState(fresh);
    focusGameSurface();
  };

  const restart = () => beginRun(modeRef.current);

  const openMenu = () => {
    const nextSeed = seed ?? newRunSeed();
    modeRef.current = "free";
    runArmedRef.current = false;
    dailySeedStrRef.current = "";
    recorderRef.current = null;
    seedRef.current = nextSeed;
    last.current = null;
    accRef.current = 0;
    fxRef.current = createFx(nextSeed, { reducedMotion });
    const fresh = newGame(nextSeed);
    stateRef.current = fresh;
    setMode("free");
    setRunArmed(false);
    setDailyDay("");
    setDailyOutcome(null);
    setState(fresh);
  };

  const togglePause = () => {
    const cur = stateRef.current;
    if (cur.phase !== "playing" && cur.phase !== "paused") return;
    const phase: GameState["phase"] = cur.phase === "playing" ? "paused" : "playing";
    const next = { ...cur, phase };
    stateRef.current = next;
    setState(next);
    focusGameSurface();
  };

  const certifyOn = isSpaceInvadersEnabled() && isSpaceInvadersCertifyEnabled();

  const phaseLabel = state.phase === "playing"
    ? "Relay online"
    : state.phase === "paused"
      ? "Signal held"
      : state.phase === "gameover"
        ? "Signal lost"
        : runArmed
          ? "Relay standing by"
          : "Choose a transmission";

  const announcement = state.phase === "playing"
    ? `Relay online. Wave ${state.wave}.`
    : state.phase === "paused"
      ? "Signal held. Game paused."
      : state.phase === "gameover"
        ? `Signal lost. Final score ${state.score}.`
        : runArmed
          ? `${mode === "daily" ? "Daily signal" : "Free signal"} armed. Use movement or fire to begin.`
          : "Choose daily run or free play.";

  return (
    <section className="si-root" aria-labelledby="si-title">
      <header className="si-heading">
        <div>
          <p className="si-eyebrow">Memba // Pearl signal network</p>
          <h1 id="si-title">Space Invaders</h1>
          <p className="si-deck">Signal Defense — hold the relay, clear the swarm, keep Pearl online.</p>
        </div>
        <div className={`si-phase si-phase--${state.phase}`}>
          <span aria-hidden="true" />
          {phaseLabel}
        </div>
      </header>

      <div className="si-cabinet">
        <section className="si-console" aria-label="Space Invaders: Signal Defense arcade cabinet">
          <div className="si-hud" aria-label="Current run status">
            <div className="si-stat si-stat--score"><span>Score</span><strong>{state.score.toLocaleString()}</strong></div>
            <div className="si-stat"><span>Best</span><strong>{best.toLocaleString()}</strong></div>
            <div className="si-stat"><span>Wave</span><strong>{state.wave}</strong></div>
            <div
              className={`si-stat si-combo${state.combo < 2 ? " si-combo--idle" : ""}`}
              aria-hidden={state.combo < 2 ? "true" : undefined}
              aria-label={state.combo >= 2 ? `combo multiplier ${(comboMultiplier10(state.combo) / 10).toFixed(1)} times` : undefined}
            >
              <span>Chain</span><strong>×{(comboMultiplier10(state.combo) / 10).toFixed(1)}</strong>
            </div>
            <div className="si-stat si-stat--lives" aria-label={`${Math.max(0, state.lives)} lives`}>
              <span>Relays</span><strong aria-hidden="true">{"◆".repeat(Math.max(0, state.lives)) || "—"}</strong>
            </div>
            <div className="si-actions">
              <button
                type="button"
                className="si-icon-button"
                onClick={() => {
                  const m = !muted;
                  audioRef.current?.setMuted(m);
                  setMuted(m);
                  focusGameSurface();
                }}
                aria-label={muted ? "Unmute" : "Mute"}
                title={muted ? "Unmute" : "Mute"}
              >
                <span aria-hidden="true">{muted ? "×" : "♪"}</span>
              </button>
              <button
                type="button"
                className="si-icon-button"
                onClick={togglePause}
                aria-label={state.phase === "paused" ? "Resume" : "Pause"}
                title={state.phase === "paused" ? "Resume" : "Pause"}
                disabled={state.phase !== "playing" && state.phase !== "paused"}
              >
                <span aria-hidden="true">{state.phase === "paused" ? "▶" : "Ⅱ"}</span>
              </button>
            </div>
          </div>

          <div
            className={`si-stage${state.phase === "playing" ? "" : " si-stage--overlay"}`}
            ref={areaRef}
            role="group"
            tabIndex={0}
            aria-label="Space Invaders: Signal Defense game surface"
            aria-describedby="si-controls"
          >
            <Canvas canvasRef={canvasRef} />
            {state.phase === "ready" && runArmed && (
              <div className="si-touch-hints" aria-hidden="true">
                <div className="si-touch-zone si-touch-steer">drag · steer</div>
                <div className="si-touch-zone si-touch-fire">tap · fire</div>
              </div>
            )}
            {state.phase === "ready" && !runArmed && (
              <div className="si-overlay si-menu">
                <p className="si-overlay-kicker">Choose transmission</p>
                <h2>Defend the Pearl relay</h2>
                <p className="si-overlay-copy">One shared signal. One score to beat. The daily run is locally replay-checked when it ends.</p>
                <div className="si-mode-stack">
                  <button className="si-button si-button--primary si-mode-button" type="button" onClick={() => beginRun("daily")}>
                    <span>Daily run</span>
                    <small>Shared UTC signal · replay eligible</small>
                  </button>
                  <button className="si-button si-button--secondary si-mode-button" type="button" onClick={() => beginRun("free")}>
                    <span>Free play</span>
                    <small>Fresh signal · practice without certification</small>
                  </button>
                </div>
              </div>
            )}
            {state.phase === "ready" && runArmed && (
              <div className="si-overlay si-ready">
                <p className="si-overlay-kicker">{mode === "daily" ? `Daily signal · ${dailyDay}` : "Free signal"}</p>
                <h2>Relay standing by</h2>
                <p className="si-control-line">← → move · Space fire</p>
                <p className="si-overlay-copy">Make a move to begin. On touch, drag left to steer and tap right to fire.</p>
                <button className="si-text-button" type="button" onClick={openMenu}>Change transmission</button>
              </div>
            )}
            {state.phase === "paused" && (
              <div className="si-overlay si-pause-sheet">
                <p className="si-overlay-kicker">Signal held</p>
                <h2>Relay paused</h2>
                <p className="si-overlay-copy">The simulation is frozen. Resume when you are ready.</p>
                <button className="si-button si-button--primary" type="button" onClick={togglePause}>Resume defense</button>
              </div>
            )}
            {state.phase === "gameover" && (
              <div className="si-overlay si-gameover">
                <p className="si-overlay-kicker">Signal lost</p>
                <h2>Game Over</h2>
                <div className="si-result-score"><span>Final score</span><strong>{state.score.toLocaleString()}</strong></div>
                <p className="si-result-best">Best signal {best.toLocaleString()}</p>
                {mode === "daily" && dailyOutcome && (
                  <p className={`si-verification ${dailyOutcome.verified ? "si-verification--ok" : "si-verification--pending"}`}>
                    <span aria-hidden="true">{dailyOutcome.verified ? "✓" : "…"}</span>
                    Daily · {dailyOutcome.day} · {dailyOutcome.verified ? "Verified locally" : "Verification pending"}
                  </p>
                )}
                <div className="si-mode-row">
                  <button className="si-button si-button--primary" type="button" onClick={restart}>Play again</button>
                  <button className="si-button si-button--secondary" type="button" onClick={openMenu}>Menu</button>
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
        </section>

        <aside className="si-brief" aria-label="Operator briefing">
          <section className="si-brief-card si-brief-card--status">
            <p className="si-brief-label">Current link</p>
            <strong>{phaseLabel}</strong>
            <p>{mode === "daily" && runArmed ? `UTC signal ${dailyDay}` : runArmed ? "Unranked practice signal" : "No transmission selected"}</p>
          </section>
          <section className="si-brief-card" id="si-controls">
            <p className="si-brief-label">Controls</p>
            <dl className="si-controls">
              <div><dt><kbd>←</kbd><kbd>→</kbd></dt><dd>Move relay</dd></div>
              <div><dt><kbd>Space</kbd></dt><dd>Fire pulse</dd></div>
              <div><dt><kbd>P</kbd></dt><dd>Hold signal</dd></div>
              <div><dt>Touch</dt><dd>Drag left · tap right</dd></div>
            </dl>
          </section>
          <section className="si-brief-card si-brief-card--mission">
            <p className="si-brief-label">Operator note</p>
            <p>Chain clean hits to amplify your signal. Every miss breaks the multiplier.</p>
          </section>
        </aside>
      </div>

      <p className="si-sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    </section>
  );
}
