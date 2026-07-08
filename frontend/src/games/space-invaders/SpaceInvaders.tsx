import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { newGame, type GameState } from "./engine";
import { advanceWithEvents, drainAccumulator } from "./hooks/useGameLoop";
import { useKeyboard } from "./hooks/useKeyboard";
import { useTouch } from "./hooks/useTouch";
import { Canvas } from "./render/Canvas";
import { draw } from "./render/draw";
import { createFx, fxConsume, fxUpdate, type FxState } from "./render/fx";
import { loadBest, saveBest } from "./lib/highScore";
import { newRunSeed } from "./lib/seed";
import { vibrate } from "./lib/haptics";
import "./space-invaders.css";

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
  // Fixed seed (e.g. tests, or a future daily challenge). Omitted → a fresh
  // random seed per run, so no two games are identical.
  seed?: number;
}) {
  const reducedMotion = prefersReducedMotion();
  // Stable initial seed for this mount (a plain value, safe to read during
  // render). seedRef holds the *current* run's seed and is mutated only in
  // restart() — never read during render.
  const [runSeed] = useState<number>(() => seed ?? newRunSeed());
  const seedRef = useRef<number>(runSeed);
  // Merge onto a full newGame() base so partial overrides (e.g. from tests)
  // still produce a valid GameState — draw() assumes all fields are present.
  const [state, setState] = useState<GameState>(() => ({ ...newGame(runSeed), ...initialState }));
  const stateRef = useRef(state);
  const [best, setBest] = useState(() => loadBest());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fxRef = useRef<FxState>(createFx(runSeed, { reducedMotion }));

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const areaRef = useRef<HTMLDivElement>(null);
  const getKeyInput = useKeyboard();
  // useTouch's signature predates the stricter RefObject<T | null> inference;
  // the ref is always non-null by the time the effect inside useTouch runs.
  const getTouchInput = useTouch(areaRef as RefObject<HTMLElement>);

  const getInput = useCallback(() => {
    const k = getKeyInput();
    const t = getTouchInput();
    return {
      move: (k.move || t.move) as -1 | 0 | 1,
      fire: k.fire || t.fire,
      pause: k.pause,
    };
  }, [getKeyInput, getTouchInput]);

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

      const { steps, acc } = drainAccumulator(accRef.current, frameMs);
      accRef.current = acc;
      if (steps > 0) {
        const prev = stateRef.current;
        // Integer step count straight through (no float ms round-trip); collect
        // the frame's events for the cosmetic + haptic layers.
        const { state: next, events } = advanceWithEvents(prev, steps, {
          move: input.move,
          fire: input.fire,
          pause: false,
        });
        stateRef.current = next;
        fxConsume(fxRef.current, events);
        if (events.some((e) => e.type === "playerHit")) vibrate(40);
        else if (events.some((e) => e.type === "waveCleared")) vibrate([15, 30, 15]);
        setState(next);
        // Persist the high score exactly on the transition into game over.
        if (next.phase === "gameover" && prev.phase !== "gameover") {
          setBest(saveBest(next.score));
          vibrate(120);
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
  }, [getInput]);

  const restart = () => {
    seedRef.current = seed ?? newRunSeed();
    const fresh = newGame(seedRef.current);
    stateRef.current = fresh;
    last.current = null;
    accRef.current = 0;
    fxRef.current = createFx(seedRef.current, { reducedMotion });
    setState(fresh);
  };

  const togglePause = () => {
    const cur = stateRef.current;
    if (cur.phase !== "playing" && cur.phase !== "paused") return;
    const phase: GameState["phase"] = cur.phase === "playing" ? "paused" : "playing";
    const next = { ...cur, phase };
    stateRef.current = next;
    setState(next);
  };

  return (
    <div className="si-root">
      <div className="si-hud">
        <span>Score {state.score}</span>
        <span>Best {best}</span>
        <span>Wave {state.wave}</span>
        <span aria-label={`${Math.max(0, state.lives)} lives`}>
          Lives {"◈".repeat(Math.max(0, state.lives))}
        </span>
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
          <div className="si-overlay">
            <p>◀ ▶ move · Space fire</p>
            <p className="si-hint">On mobile: steer on the left, tap right to fire</p>
          </div>
        )}
        {state.phase === "paused" && <div className="si-overlay"><p>Paused</p></div>}
        {state.phase === "gameover" && (
          <div className="si-overlay si-gameover">
            <h2>Game Over</h2>
            <p>Score {state.score} · Best {best}</p>
            <button type="button" onClick={restart}>Play again</button>
          </div>
        )}
      </div>
    </div>
  );
}
