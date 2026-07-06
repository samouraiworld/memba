import { useCallback, useRef, useState } from "react";
import { initGame, step, type GameState, type Modifier, type Move } from "../engine";

export type GameMode = "ranked" | "practice";

type Internal = { game: GameState; log: string };

export function useGame(opts: { seed: number; modifier: Modifier; mode: GameMode; moveBudget: number }) {
  const { modifier, mode, moveBudget } = opts;
  const [internal, setInternal] = useState<Internal>(() => ({ game: initGame(opts.seed, modifier), log: "" }));
  const seedRef = useRef(opts.seed);

  const play = useCallback((m: Move) => {
    setInternal((prev) => {
      if (prev.game.over) return prev;
      if (mode === "ranked" && prev.game.moves >= moveBudget) return prev;
      const next = step(prev.game, m);
      if (next === prev.game) return prev; // no-op: unchanged, not counted, not logged
      return { game: next, log: prev.log + m };
    });
  }, [mode, moveBudget]);

  const restart = useCallback((seed?: number) => {
    const s = seed ?? seedRef.current;
    seedRef.current = s;
    setInternal({ game: initGame(s, modifier), log: "" });
  }, [modifier]);

  const game = internal.game;
  const movesUsed = game.moves;
  const budgetReached = mode === "ranked" && movesUsed >= moveBudget;

  return {
    board: game.board,
    score: game.score,
    movesUsed,
    movesLeft: mode === "ranked" ? Math.max(0, moveBudget - movesUsed) : Infinity,
    over: game.over || budgetReached,
    moveLog: internal.log,
    play,
    restart,
  };
}
