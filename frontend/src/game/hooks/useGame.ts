import { useCallback, useRef, useState } from "react";
import { initGame, step, type GameState, type Modifier, type Move } from "../engine";

export type GameMode = "ranked" | "practice";

export function useGame(opts: { seed: number; modifier: Modifier; mode: GameMode; moveBudget: number }) {
  const { modifier, mode, moveBudget } = opts;
  const [state, setState] = useState<GameState>(() => initGame(opts.seed, modifier));
  const [moveLog, setMoveLog] = useState("");
  const seedRef = useRef(opts.seed);

  const movesUsed = state.moves;
  const budgetReached = mode === "ranked" && movesUsed >= moveBudget;

  const play = useCallback((m: Move) => {
    setState((prev) => {
      if (prev.over) return prev;
      if (mode === "ranked" && prev.moves >= moveBudget) return prev;
      const next = step(prev, m);
      if (next === prev) return prev; // no-op: not counted, not logged
      setMoveLog((log) => log + m);
      return next;
    });
  }, [mode, moveBudget]);

  const restart = useCallback((seed?: number) => {
    const s = seed ?? seedRef.current;
    seedRef.current = s;
    setState(initGame(s, modifier));
    setMoveLog("");
  }, [modifier]);

  return {
    board: state.board,
    score: state.score,
    movesUsed,
    movesLeft: mode === "ranked" ? Math.max(0, moveBudget - movesUsed) : Infinity,
    over: state.over || budgetReached,
    moveLog,
    play,
    restart,
  };
}
