import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { newGame, type GameState } from "./engine";
import { advanceSteps, drainAccumulator } from "./hooks/useGameLoop";
import { useKeyboard } from "./hooks/useKeyboard";
import { useTouch } from "./hooks/useTouch";
import { Canvas } from "./render/Canvas";
import { loadBest, saveBest } from "./lib/highScore";
import "./space-invaders.css";

// Default seed. Injectable via prop so a daily-challenge / per-run-random seed
// can drive the game (W1+); the recorded seed is what a replay is verified
// against. Kept fixed by default to preserve reproducibility for tests.
const SEED = 0x5eed;

export default function SpaceInvaders({
  initialState,
  seed = SEED,
}: {
  initialState?: Partial<GameState>;
  seed?: number;
}) {
  // Merge onto a full newGame() base so partial overrides (e.g. from tests)
  // still produce a valid GameState — Canvas etc. assume all fields are present.
  const [state, setState] = useState<GameState>(() => ({ ...newGame(seed), ...initialState }));
  const stateRef = useRef(state);
  const [best, setBest] = useState(() => loadBest());

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

  // rAF loop (inline so tests can stub rAF).
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
        // Pass the integer step count straight through — no float ms round-trip.
        const next = advanceSteps(prev, steps, {
          move: input.move,
          fire: input.fire,
          pause: false,
        });
        stateRef.current = next;
        setState(next);
        // Persist the high score exactly on the transition into game over.
        if (next.phase === "gameover" && prev.phase !== "gameover") {
          setBest(saveBest(next.score));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getInput]);

  const restart = () => {
    const fresh = newGame(seed);
    stateRef.current = fresh;
    last.current = null;
    accRef.current = 0;
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
        <span>Lives {"◈".repeat(Math.max(0, state.lives))}</span>
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
        <Canvas state={state} />
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
