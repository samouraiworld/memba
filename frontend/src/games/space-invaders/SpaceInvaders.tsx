import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { newGame, type GameState } from "./engine";
import { advance } from "./hooks/useGameLoop";
import { useKeyboard } from "./hooks/useKeyboard";
import { useTouch } from "./hooks/useTouch";
import { Canvas } from "./render/Canvas";
import { loadBest, saveBest } from "./lib/highScore";
import "./space-invaders.css";

// A fixed seed keeps runs reproducible; vary if a daily hook is added later.
const SEED = 0x5eed;

export default function SpaceInvaders({ initialState }: { initialState?: Partial<GameState> }) {
  // Merge onto a full newGame() base so partial overrides (e.g. from tests)
  // still produce a valid GameState — Canvas etc. assume all fields are present.
  const [state, setState] = useState<GameState>(() => ({ ...newGame(SEED), ...initialState }));
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
  useEffect(() => {
    let raf = 0;
    const tick = (time: number) => {
      if (last.current == null) last.current = time;
      const frameMs = time - last.current;
      last.current = time;
      const next = advance(stateRef.current, frameMs, getInput());
      stateRef.current = next;
      setState(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getInput]);

  // Persist best on game over.
  useEffect(() => {
    if (state.phase === "gameover") setBest(saveBest(state.score));
  }, [state.phase, state.score]);

  const restart = () => {
    const fresh = newGame(SEED);
    stateRef.current = fresh;
    last.current = null;
    setState(fresh);
  };

  const togglePause = () => {
    const p = stateRef.current.phase;
    if (p === "playing") setState({ ...stateRef.current, phase: "paused" });
    else if (p === "paused") setState({ ...stateRef.current, phase: "playing" });
  };

  return (
    <div className="si-root">
      <div className="si-hud">
        <span>Score {state.score}</span>
        <span>Best {best}</span>
        <span>Wave {state.wave}</span>
        <span>Lives {"◈".repeat(Math.max(0, state.lives))}</span>
        <button type="button" className="si-pause" onClick={togglePause} aria-label="Pause">
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
