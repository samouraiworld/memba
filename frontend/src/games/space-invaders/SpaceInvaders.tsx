import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject, type CSSProperties } from "react";
import { newGame, comboMultiplier10, type GameState } from "./engine";
import { advanceWithEvents, drainAccumulator } from "./hooks/useGameLoop";
import { useKeyboard } from "./hooks/useKeyboard";
import { useTouch } from "./hooks/useTouch";
import { usePlayfieldSize } from "./hooks/usePlayfieldSize";
import type { SpaceInvadersLaunchIntent, SpaceInvadersReplayResult } from "./lib/launch";
import { Canvas } from "./render/Canvas";
import { FullscreenButton } from "./screens/FullscreenButton";
import { draw } from "./render/draw";
import { createFx, fxChainCues, fxConsume, fxUpdate, type FxState } from "./render/fx";
import { loadBest, saveBest } from "./lib/highScore";
import { newRunSeed } from "./lib/seed";
import { vibrate } from "./lib/haptics";
import {
  createAudioEngine,
  soundsForChainCues,
  soundsForEvents,
  loadMuted,
  ufoDroneWanted,
  type AudioEngine,
} from "./lib/audio";
import { dailySeedString, seedFromSeedString, formatStateHash } from "./lib/daily";
import { createInputRecorder, REPLAY_VERSION, type InputRecorder } from "./lib/replay";
import { simulateReplay, hashState } from "./lib/verify";
import { combineInput, toWireDeltas, fromWireDeltas, MAX_CERTIFY_FINAL_TICK, MAX_CERTIFY_EVENTS } from "./lib/wire";
import { isSpaceInvadersEnabled, isSpaceInvadersCertifyEnabled } from "../../lib/config";
import { MenuScreen } from "./screens/MenuScreen";
import { PausedScreen } from "./screens/PausedScreen";
import { GameOverScreen } from "./screens/GameOverScreen";
import type { RunMode } from "./screens/types";
import { prefersReducedMotion } from "./lib/motion";
import { chainCues, createChainTracker, summarizeRun, trackChain, isNewBest, type ChainTracker } from "./lib/results";
import { HOWTO_MIN_MS, WAVE_BANNER_MS, loadHowtoSeen, saveHowtoSeen } from "./lib/intro";
import { shareUrlFromLocation } from "./lib/shareText";
import { useWindowActive } from "../../os/page/WindowActivity";
import "./space-invaders.css";

// The on-chain certify control is a lazy chunk (it pulls in the wallet hooks),
// so the no-wallet play path never loads them — mirror of BarricadeCertify.
const SpaceInvadersCertify = lazy(() => import("./SpaceInvadersCertify"));


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

// Snapshotted at the gameover transition for the results card: the stored
// best as it stood BEFORE this run was saved (so a new best can be told
// apart from a tie with itself), and the longest no-miss chain of the run.
interface RunResult {
  previousBest: number;
  bestChain: number;
}

export default function SpaceInvaders({
  initialState,
  seed,
  launch,
  onReplayReady,
  onLaunchConsumed,
}: {
  launch?: SpaceInvadersLaunchIntent;
  onLaunchConsumed?: (id: string) => void;
  onReplayReady?: (result: SpaceInvadersReplayResult) => void;
  initialState?: Partial<GameState>;
  // Fixed seed (e.g. tests). Omitted → a fresh random seed per free run, so no
  // two free games are identical. Daily runs derive their seed from the UTC
  // day instead (lib/daily.ts) and ignore this.
  seed?: number;
}) {
  const windowActive = useWindowActive();
  // Commit activity before paint: a frame queued by the previous active render
  // must not consume a launch or input after this window becomes inactive.
  const windowActiveRef = useRef(windowActive);
  useLayoutEffect(() => { windowActiveRef.current = windowActive; }, [windowActive]);
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
  // mirrored into React state for render. Both modes record a bounded replay;
  // publishing a free run is a separate adapter, never an automatic side effect.
  const [mode, setMode] = useState<RunMode>("free");
  const [runArmed, setRunArmed] = useState(() => initialState?.phase != null && initialState.phase !== "ready");
  const [dailyDay, setDailyDay] = useState("");
  const [replayOutcome, setReplayOutcome] = useState<SpaceInvadersReplayResult | null>(null);
  const [dailyOutcome, setDailyOutcome] = useState<DailyOutcome | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const resultFocusPendingRef = useRef(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  // Cosmetic chain tracking from step events (the engine keeps only the live
  // combo). Presentation-only: never read by the simulation or the recorder.
  const chainRef = useRef<ChainTracker>(createChainTracker(initialState?.combo));
  const modeRef = useRef<RunMode>("free");
  const runArmedRef = useRef(initialState?.phase != null && initialState.phase !== "ready");
  const dailySeedStrRef = useRef("");
  const recorderRef = useRef<InputRecorder | null>(null);
  const last = useRef<number | null>(null);
  const accRef = useRef(0);
  const lastHudUpdateRef = useRef(0);
  // Enter on the armed ready screen launches the run. It is delivered to the
  // engine as a fire press (an existing action, exactly like Space) and held
  // until a real simulation step consumes it, so a zero-step frame on a
  // high-refresh display cannot swallow it.
  const launchPendingRef = useRef(false);
  const menuFocusPendingRef = useRef(false);
  // Presentation-only overlays driven from step events; never read by the sim.
  const [waveBanner, setWaveBanner] = useState<{ wave: number; id: number } | null>(null);
  const [howtoOpen, setHowtoOpen] = useState(false);
  const howtoRef = useRef<{ open: boolean; shownAt: number }>({ open: false, shownAt: 0 });
  const confirmRef = useRef<() => void>(() => {});
  const launchRef = useRef<() => void>(() => {});
  // The host delivers one pending intent and removes it on acknowledgement.
  // Remember that current ID, not an unbounded history of user actions.
  const lastConsumedLaunchId = useRef<string | null>(null);
  const replayReadyRef = useRef(onReplayReady);
  useEffect(() => { replayReadyRef.current = onReplayReady; }, [onReplayReady]);

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

  // The wave banner is a moment, not a state: it clears itself.
  useEffect(() => {
    if (!waveBanner) return;
    const timer = setTimeout(() => setWaveBanner(null), WAVE_BANNER_MS);
    return () => clearTimeout(timer);
  }, [waveBanner]);

  const rootRef = useRef<HTMLElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const fieldSize = usePlayfieldSize(rootRef, fieldRef);
  const [fullscreenError, setFullscreenError] = useState("");
  // Below half the logical bitmap size, steering/targets are not usable.
  // Protect independently of fullscreen support: browser permission may fail.
  const measured = fieldSize.availableHeight > 0 || fieldSize.width > 0 || fieldSize.height > 0;
  const spaceBlocked = measured && (fieldSize.width < 160 || fieldSize.height < 200);
  const spaceBlockedRef = useRef(spaceBlocked);
  const resumeReadyRef = useRef(false);
  const showSpaceGuard = spaceBlocked && (state.phase !== "gameover" || menuOpen);
  const focusGameSurface = useCallback(() => {
    if (windowActive) areaRef.current?.focus({ preventScroll: true });
  }, [windowActive]);
  const onConfirm = useCallback(() => confirmRef.current(), []);
  const getKeyInput = useKeyboard(areaRef, { onConfirm, active: windowActive && !spaceBlocked });
  // useTouch's signature predates the stricter RefObject<T | null> inference;
  // the ref is always non-null by the time the effect inside useTouch runs.
  const { read: getTouchInput, consumeFire: consumeTouchFire, reset: resetTouchInput } = useTouch(areaRef as RefObject<HTMLElement>);

  useLayoutEffect(() => {
    spaceBlockedRef.current = spaceBlocked;
    if (!spaceBlocked) return; // More room never resumes a run automatically.
    // The protected rAF returns before normal audio reconciliation.
    audioRef.current?.setDrone(false);
    accRef.current = 0;
    last.current = null;
    resetTouchInput();
    const cur = stateRef.current;
    if (cur.phase === "playing" || (cur.phase === "ready" && runArmedRef.current)) {
      resumeReadyRef.current = cur.phase === "ready";
      const paused = { ...cur, phase: "paused" as const };
      stateRef.current = paused;
      setState(paused);
    }
  }, [spaceBlocked, resetTouchInput]);

  useEffect(() => {
    if (showSpaceGuard && windowActive && rootRef.current?.contains(document.activeElement)) {
      rootRef.current.querySelector<HTMLElement>(".si-space-guard h2")?.focus({ preventScroll: true });
    }
  }, [showSpaceGuard, windowActive]);

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

  useEffect(() => {
    if (windowActive) return;
    const cur = stateRef.current;
    if (cur.phase !== "playing") return;
    const next = { ...cur, phase: "paused" as const };
    stateRef.current = next;
    accRef.current = 0;
    resetTouchInput();
    setState(next);
  }, [windowActive, resetTouchInput]);

  useEffect(() => {
    if (!windowActive || showSpaceGuard || menuOpen || (state.phase !== "paused" && state.phase !== "gameover")) return;
    const surface = areaRef.current;
    if (!surface || (!resultFocusPendingRef.current && !rootRef.current?.contains(document.activeElement))) return;
    resultFocusPendingRef.current = false;
    const target = state.phase === "paused"
      ? surface.querySelector<HTMLElement>(".si-pause-sheet button")
      : surface.querySelector<HTMLElement>(".si-gameover h2");
    target?.focus({ preventScroll: true });
  }, [windowActive, state.phase, menuOpen, showSpaceGuard]);

  useEffect(() => {
    if (!windowActive || !menuOpen || !menuFocusPendingRef.current) return;
    menuFocusPendingRef.current = false;
    areaRef.current?.querySelector<HTMLElement>(".si-menu button")?.focus({ preventScroll: true });
  }, [windowActive, menuOpen]);

  // Quantize steering to tenths AT THE INPUT SEAM (combineInput): the live
  // engine, the recorder, and the server's replay (which reconstructs move as
  // move10/10) must all consume the identical value, or a certified run's
  // re-simulation diverges on the first analog touch-steer.
  const getInput = useCallback(
    () => combineInput(getKeyInput(), getTouchInput()),
    [getKeyInput, getTouchInput],
  );

  // Snapshot any finished run: build the recorded log at the gameover
  // tick, encode it to the certify wire form, and self-verify by re-simulating
  // the DECODED wire — precisely the simulation the server will run. A run past
  // the backend caps (>1h or >10k input changes) can never certify, so the
  // bounded re-sim is skipped and the run stays unverified.
  const finishRun = useCallback((final: GameState) => {
    const rec = recorderRef.current;
    if (!rec) return;
    const seedStr = dailySeedStrRef.current;
    const log = rec.build(final.tick);
    const events = toWireDeltas(log);
    const withinCaps =
      final.tick > 0 && final.tick <= MAX_CERTIFY_FINAL_TICK && events.length <= MAX_CERTIFY_EVENTS;
    let verified = false;
    if (withinCaps) {
      const sim = simulateReplay({
        version: REPLAY_VERSION,
        seed: seedRef.current,
        finalTick: final.tick,
        inputs: fromWireDeltas(events),
      });
      verified = sim.score === final.score && sim.hash === hashState(final);
    }
    const outcome: SpaceInvadersReplayResult = {
      game: "space-invaders",
      mode: modeRef.current, seed: seedRef.current, simVersion: REPLAY_VERSION,
      finalTick: final.tick, events, score: final.score,
      hash: formatStateHash(hashState(final)), verified,
    };
    setReplayOutcome(outcome);
    replayReadyRef.current?.(outcome);
    if (modeRef.current !== "daily") return;
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
    // OS game windows remain mounted while minimised. The inactive window has
    // already paused above, so it needs no input polling or render frames.
    // Drop the old clock before reactivation to avoid counting parked time.
    if (!windowActive) return;
    last.current = null;
    accRef.current = 0;
    let raf = 0;
    let lastPaintedState: GameState | null = null;
    const tick = (time: number) => {
      if (!windowActiveRef.current) return;
      launchRef.current();
      if (spaceBlockedRef.current) {
        last.current = null;
        accRef.current = 0;
        raf = requestAnimationFrame(tick);
        return;
      }
      if (last.current == null) last.current = time;
      const frameMs = time - last.current;
      last.current = time;
      const phaseBeforeInput = stateRef.current.phase;
      // Inputs made on inactive screens must not be replayed on resume/start.
      if (phaseBeforeInput === "paused" || phaseBeforeInput === "gameover" ||
        (phaseBeforeInput === "ready" && !runArmedRef.current)) resetTouchInput();
      let input = getInput();
      if ((phaseBeforeInput !== "ready" && !(phaseBeforeInput === "paused" && resumeReadyRef.current)) || !runArmedRef.current) launchPendingRef.current = false;
      else if (launchPendingRef.current && !input.fire) input = { ...input, fire: true };

      // Pause edge handled once per frame (never per sub-step).
      if (input.pause) {
        const cur = stateRef.current;
        if (cur.phase === "playing" || cur.phase === "paused") {
          const phase: GameState["phase"] = cur.phase === "playing" ? "paused" : resumeReadyRef.current ? "ready" : "playing";
          resumeReadyRef.current = false;
          const next = { ...cur, phase };
          stateRef.current = next;
          setState(next);
          resetTouchInput();
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
          // Polling a zero-step rAF must not acknowledge a completed touch tap.
          consumeTouchFire();
          launchPendingRef.current = false;
          const prev = stateRef.current;
          const engineInput = { move: input.move, fire: input.fire, pause: false };
          // Both modes record the exact input the engine is about to consume,
          // stamped with the tick the replay will resolve it at (delta-encoded;
          // it covers all of this frame's sub-steps).
          if (recorderRef.current && prev.phase !== "gameover") {
            recorderRef.current.record(prev.tick, engineInput);
          }
          // Integer step count straight through (no float ms round-trip); collect
          // the frame's events for the cosmetic + haptic layers.
          const { state: next, events } = advanceWithEvents(prev, steps, engineInput);
          stateRef.current = next;
          // Chain cues read the chain as it stood BEFORE this frame's events.
          const cues = chainCues(chainRef.current.chain, events);
          fxConsume(fxRef.current, events);
          fxChainCues(fxRef.current, cues);
          chainRef.current = trackChain(chainRef.current, events);
          for (const s of soundsForEvents(events)) audioRef.current?.play(s);
          for (const s of soundsForChainCues(cues)) audioRef.current?.play(s);
          const launched = prev.phase === "ready" && next.phase === "playing";
          if (next.phase === "playing" && (launched || next.wave > prev.wave)) {
            const wave = next.wave;
            setWaveBanner((b) => ({ wave, id: (b?.id ?? 0) + 1 }));
          }
          if (launched && next.wave === 1 && !loadHowtoSeen()) {
            howtoRef.current = { open: true, shownAt: time };
            setHowtoOpen(true);
          }
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
            const previousBest = loadBest();
            setBest(saveBest(next.score));
            setRunResult({ previousBest, bestChain: chainRef.current.best });
            audioRef.current?.play("gameOver");
            vibrate(120);
            finishRun(next);
          }
        }
      }

      // The one-time how-to leaves on the first move or fire once it has been
      // readable for a moment, and never outlives wave 1 or the run.
      const howto = howtoRef.current;
      if (howto.open) {
        const cur = stateRef.current;
        const acted = cur.phase === "playing" && time - howto.shownAt >= HOWTO_MIN_MS && (input.move !== 0 || input.fire);
        if (acted || cur.phase === "gameover" || cur.wave > 1) {
          howtoRef.current = { open: false, shownAt: 0 };
          if (acted) saveHowtoSeen();
          setHowtoOpen(false);
        }
      }
      // The saucer drone follows the live state, so pause, game over, the menu
      // and mute all silence it without extra bookkeeping.
      audioRef.current?.setDrone(ufoDroneWanted(stateRef.current));

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
  }, [windowActive, getInput, finishRun, focusGameSurface, consumeTouchFire, resetTouchInput]);

  // Reset into a fresh run. Daily seeds from the shared UTC day string (a
  // restart within the day REUSES the day's seed — the realm's re-attest only
  // ever raises a score, so replaying the daily is safe); free play keeps its
  // crypto-random per-run seed. Both modes record the same input seam. Plain handler (not
  // memoized) — only ever called from click handlers.
  const closeOverlays = () => {
    launchPendingRef.current = false;
    howtoRef.current = { open: false, shownAt: 0 };
    setHowtoOpen(false);
    setWaveBanner(null);
  };

  const beginRun = (nextMode: RunMode) => {
    if (spaceBlockedRef.current) {
      if (stateRef.current.phase === "gameover") setMenuOpen(true);
      return;
    }
    resumeReadyRef.current = false;
    setMenuOpen(false);
    resultFocusPendingRef.current = false;
    resetTouchInput();
    closeOverlays();
    let nextSeed: number;
    if (nextMode === "daily") {
      const seedStr = dailySeedString();
      dailySeedStrRef.current = seedStr;
      nextSeed = seedFromSeedString(seedStr);
      recorderRef.current = createInputRecorder(nextSeed, MAX_CERTIFY_EVENTS + 1);
      setDailyDay(seedStr.slice(-10));
    } else {
      dailySeedStrRef.current = "";
      nextSeed = seed ?? newRunSeed();
      recorderRef.current = createInputRecorder(nextSeed, MAX_CERTIFY_EVENTS + 1);
      setDailyDay("");
    }
    modeRef.current = nextMode;
    setMode(nextMode);
    runArmedRef.current = true;
    setRunArmed(true);
    setDailyOutcome(null);
    setReplayOutcome(null);
    setRunResult(null);
    chainRef.current = createChainTracker();
    seedRef.current = nextSeed;
    const fresh = newGame(nextSeed);
    stateRef.current = fresh;
    last.current = null;
    accRef.current = 0;
    fxRef.current = createFx(nextSeed, { reducedMotion });
    setState(fresh);
    launchPendingRef.current = true;
    // A browser may scroll the chooser into view on a short classic page.
    // Starting a run must also bring its HUD back into the visible viewport.
    if (rootRef.current && rootRef.current.getBoundingClientRect().top < 0) {
      rootRef.current.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
    }
    focusGameSurface();
  };

  const restart = () => beginRun(modeRef.current);

  const openMenu = () => {
    // The menu is presentation only. Keep the finished snapshot and replay
    // until the player explicitly starts another run (future publish/retry).
    menuFocusPendingRef.current = true;
    resetTouchInput();
    setMenuOpen(true);
  };

  const returnToResult = () => {
    resultFocusPendingRef.current = true;
    setMenuOpen(false);
  };

  const togglePause = () => {
    if (spaceBlockedRef.current) return;
    const cur = stateRef.current;
    if (cur.phase !== "playing" && cur.phase !== "paused") return;
    resetTouchInput();
    const phase: GameState["phase"] = cur.phase === "playing" ? "paused" : resumeReadyRef.current ? "ready" : "playing";
    resumeReadyRef.current = false;
    const next = { ...cur, phase };
    stateRef.current = next;
    setState(next);
    focusGameSurface();
  };

  // Enter on the game surface: pick the primary (free) transmission from the
  // menu, launch an armed run, resume a held one, or play again after game
  // over. Focused buttons keep their native Enter, so nothing fires twice.
  const handleConfirm = () => {
    if (spaceBlockedRef.current) return;
    const cur = stateRef.current;
    if (menuOpen) beginRun("free");
    else if (cur.phase === "gameover") restart();
    else if (cur.phase === "paused") togglePause();
    else if (cur.phase === "ready") {
      if (!runArmedRef.current) beginRun("free");
      else launchPendingRef.current = true;
    }
  };
  useEffect(() => {
    confirmRef.current = handleConfirm;
    launchRef.current = () => {
      if (!windowActive || !windowActiveRef.current) return;
      if (!launch || launch.game !== "space-invaders" || lastConsumedLaunchId.current === launch.id) return;
      if (document.visibilityState !== "visible" || document.querySelector('[aria-modal="true"], dialog[open]')) return;
      const surface = areaRef.current;
      if (!surface?.getBoundingClientRect().width) return;
      lastConsumedLaunchId.current = launch.id;
      if (spaceBlockedRef.current && stateRef.current.phase !== "gameover") {
        // Acknowledge the store gesture, but require a fresh Play/Resume once
        // space is available. No deferred auto-start after rotation/fullscreen.
        rootRef.current?.querySelector<HTMLElement>(".si-space-guard h2")?.focus({ preventScroll: true });
        onLaunchConsumed?.(launch.id);
        return;
      }
      // Play from the store never discards an existing run OR its result.
      if (runArmedRef.current) {
        if (menuOpen) returnToResult();
        const target = stateRef.current.phase === "paused"
          ? surface.querySelector<HTMLElement>(".si-pause-sheet button")
          : stateRef.current.phase === "gameover"
            ? surface.querySelector<HTMLElement>(".si-gameover h2")
            : surface;
        target?.focus({ preventScroll: true });
      } else beginRun(launch.mode);
      onLaunchConsumed?.(launch.id);
    };
  });

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
        ? `Signal lost. Final score ${state.score}.${runResult && isNewBest(state.score, runResult.previousBest) ? " New best." : ""}`
        : runArmed
          ? `${mode === "daily" ? "Daily signal" : "Free signal"} starting.`
          : "Choose daily run or free play.";

  return (
    <section className={`si-root si-root--fitted${fieldSize.landscape ? " si-root--landscape" : ""}`} aria-labelledby="si-title" ref={rootRef}
      style={{ "--si-available-height": fieldSize.availableHeight ? `${fieldSize.availableHeight}px` : undefined } as CSSProperties}>
      <header className="si-heading">
        <div>
          <p className="si-eyebrow">Memba // Gno signal network</p>
          <h1 id="si-title">Space Invaders</h1>
          <p className="si-deck">Signal Defense — hold the relay, clear the swarm, keep the network online.</p>
        </div>
        <div className={`si-phase si-phase--${state.phase}`}>
          <span aria-hidden="true" />
          {runArmed ? `${mode === "daily" ? `Daily · ${dailyDay}` : "Free play"} · ` : ""}{phaseLabel}
        </div>
        <FullscreenButton root={rootRef} onChange={focusGameSurface} onError={setFullscreenError} showError={!showSpaceGuard} />
      </header>

      <div className="si-cabinet">
        <section className="si-console" aria-label="Space Invaders: Signal Defense arcade cabinet">
          <div className="si-hud" aria-label="Current run status" inert={showSpaceGuard} aria-hidden={showSpaceGuard}>
            <div className="si-stat si-stat--score"><span>Score</span><strong>{state.score.toLocaleString()}</strong></div>
            <div className="si-stat si-stat--best"><span>Best</span><strong>{best.toLocaleString()}</strong></div>
            <div className="si-stat si-stat--wave"><span>Wave</span><strong>{state.wave}</strong></div>
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
                className="si-icon-button si-icon-button--pause"
                onClick={togglePause}
                aria-keyshortcuts="P Escape"
                aria-label={state.phase === "paused" ? "Resume" : "Pause"}
                title={state.phase === "paused" ? "Resume" : "Pause"}
                disabled={state.phase !== "playing" && state.phase !== "paused"}
              >
                <span aria-hidden="true">{state.phase === "paused" ? "▶" : "Ⅱ"}</span>
              </button>
            </div>
          </div>

          <div className="si-playfield" ref={fieldRef} inert={showSpaceGuard} aria-hidden={showSpaceGuard}>
          <div
            style={fieldSize.width > 0 ? { width: fieldSize.width, height: fieldSize.height } : undefined}
            className={`si-stage${state.phase === "playing" ? "" : " si-stage--overlay"}${fieldSize.height > 0 && fieldSize.height < 250 ? " si-stage--compact" : ""}`}
            ref={areaRef}
            role="group"
            tabIndex={0}
            aria-label="Space Invaders: Signal Defense game surface"
            aria-describedby="si-controls"
          >
            <Canvas canvasRef={canvasRef} />
            {((state.phase === "ready" && runArmed) || state.phase === "playing") && (
              <div className={`si-touch-hints${state.phase === "playing" ? " si-touch-hints--live" : ""}`} aria-hidden="true">
                <div className="si-touch-zone si-touch-steer">drag · steer</div>
                <div className="si-touch-zone si-touch-fire">tap · fire</div>
              </div>
            )}
            {state.phase === "playing" && waveBanner && (
              <div key={waveBanner.id} className="si-wave-banner" aria-hidden="true" data-testid="si-wave-banner">
                <span>Incoming signal</span>
                <strong>Wave {waveBanner.wave}</strong>
              </div>
            )}
            {state.phase === "playing" && howtoOpen && (
              <div className="si-howto" aria-hidden="true" data-testid="si-howto">
                <p className="si-howto-keys">
                  <kbd>←</kbd><kbd>→</kbd> or <kbd>A</kbd><kbd>D</kbd> move · <kbd>Space</kbd> fire · <kbd>Esc</kbd> pause
                </p>
                <p className="si-howto-touch">Drag on the left half to steer · tap the right half to fire</p>
                <p className="si-howto-tip">Chain hits without missing to raise your multiplier</p>
              </div>
            )}
            {((state.phase === "ready" && !runArmed) || menuOpen) && (
              <MenuScreen onReturnResult={menuOpen ? returnToResult : undefined} certifyOn={certifyOn} onDaily={() => beginRun("daily")} onFree={() => beginRun("free")} />
            )}
            {state.phase === "paused" && <PausedScreen onResume={togglePause} />}
            {state.phase === "gameover" && !menuOpen && (
              <GameOverScreen
                mode={mode}
                day={dailyDay}
                summary={summarizeRun(state, runResult?.bestChain)}
                best={best}
                previousBest={runResult?.previousBest ?? null}
                shareUrl={shareUrlFromLocation(typeof window !== "undefined" ? window.location : undefined)}
                reducedMotion={reducedMotion}
                verification={replayOutcome ? { day: dailyDay, verified: replayOutcome.verified } : null}
                certifySlot={certifyOn && mode === "daily" && dailyOutcome?.verified ? (
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
                ) : null}
                onRestart={restart}
                onMenu={openMenu}
              />
            )}
          </div>
          </div>
          {showSpaceGuard && <div className="si-space-guard" role="region" aria-live="polite" aria-label="More room to play">
            <h2 tabIndex={-1}>More room to play</h2>
            <p>Turn your phone to portrait or enlarge the window. You can also choose Game fullscreen above.</p>
            {fullscreenError && <p role="alert">{fullscreenError}</p>}
            <p>{state.phase === "gameover" ? "Your result is kept." : runArmed ? "Your run is paused and kept. Resume explicitly once there is more room." : "No run has started. Choose Play once there is more room."}</p>
            {state.phase === "gameover" && <button type="button" className="si-button si-button--primary" onClick={returnToResult}>Back to result</button>}
          </div>}
        </section>

        <aside className="si-brief si-sr-only" aria-label="Operator briefing">
          <section className="si-brief-card si-brief-card--status">
            <p className="si-brief-label">Current link</p>
            <strong>{phaseLabel}</strong>
            <p>{mode === "daily" && runArmed ? `UTC signal ${dailyDay}` : runArmed ? "Free play signal" : "No transmission selected"}</p>
          </section>
          <section className="si-brief-card" id="si-controls">
            <p className="si-brief-label">Controls</p>
            <dl className="si-controls">
              <div><dt><kbd>←</kbd><kbd>→</kbd><kbd>A</kbd><kbd>D</kbd></dt><dd>Move relay</dd></div>
              <div><dt><kbd>Space</kbd><kbd>W</kbd></dt><dd>Fire pulse</dd></div>
              <div><dt><kbd>P</kbd><kbd>Esc</kbd></dt><dd>Hold signal</dd></div>
              <div><dt><kbd>Enter</kbd></dt><dd>Launch · play again</dd></div>
              <div><dt>Touch</dt><dd>Drag left · tap right</dd></div>
            </dl>
            <p className="si-controls-note">On AZERTY, Z Q D work too.</p>
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
