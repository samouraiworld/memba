import { useCallback, useEffect, useRef, useState } from "react";
import { initGame, step, type GameState, type Modifier, type Move } from "../engine";
import { setLocalBest } from "../lib/localStore";

export type GameMode = "ranked" | "practice";

type Internal = { game: GameState; log: string; seed: number };

function fresh(seed: number, modifier: Modifier): Internal {
  return { game: initGame(seed, modifier), log: "", seed };
}

/**
 * Rebuild a round from its move log through the engine's public step API.
 * Returns null unless every move is accepted exactly as live play would have
 * accepted it: no no-op moves, nothing after game over, nothing past the
 * budget. The backend applies the same rules to a submitted replay.
 */
export function replayLog(seed: number, modifier: Modifier, log: string, budget: number): Internal | null {
  let game = initGame(seed, modifier);
  for (let i = 0; i < log.length; i++) {
    const m = log[i];
    if (game.over || i >= budget || (m !== "U" && m !== "R" && m !== "D" && m !== "L")) return null;
    const next = step(game, m);
    if (next === game) return null;
    game = next;
  }
  return { game, log, seed };
}

export function useGame(opts: { seed: number; modifier: Modifier; mode: GameMode; moveBudget: number }) {
  const { modifier, mode, moveBudget } = opts;
  const [internal, setInternal] = useState<Internal>(() => fresh(opts.seed, modifier));
  const seedRef = useRef(opts.seed);

  const play = useCallback((m: Move) => {
    setInternal((prev) => {
      if (prev.game.over) return prev;
      if (mode === "ranked" && prev.game.moves >= moveBudget) return prev;
      const next = step(prev.game, m);
      if (next === prev.game) return prev; // no-op: unchanged, not counted, not logged
      return { game: next, log: prev.log + m, seed: prev.seed };
    });
  }, [mode, moveBudget]);

  /**
   * Start a round on `seed`. A non-empty `log` resumes a saved round by
   * replaying it; an invalid log starts fresh instead. Returns whether the log
   * was restored (always true for an empty log).
   */
  const restart = useCallback((seed?: number, log = ""): boolean => {
    const s = seed ?? seedRef.current;
    seedRef.current = s;
    const restored = log ? replayLog(s, modifier, log, mode === "ranked" ? moveBudget : Infinity) : null;
    setInternal(restored ?? fresh(s, modifier));
    return log === "" || restored !== null;
  }, [modifier, mode, moveBudget]);

  /** Practice only: step back one accepted move by replaying the shorter log. */
  const undo = useCallback(() => {
    if (mode !== "practice") return;
    setInternal((prev) => {
      if (prev.log.length === 0) return prev;
      return replayLog(prev.seed, prev.game.modifier, prev.log.slice(0, -1), Infinity) ?? prev;
    });
  }, [mode]);

  const game = internal.game;
  const movesUsed = game.moves;
  const budgetReached = mode === "ranked" && movesUsed >= moveBudget;

  // Practice has no result sheet when the board still has legal moves, so
  // persisting only at game-over loses a personal best on refresh or a tab
  // crash. Write monotonically as the score advances; the storage helper is
  // guarded for private browsing and quota failures.
  useEffect(() => {
    if (mode === "practice") setLocalBest("practice", game.score);
  }, [mode, game.score]);

  return {
    board: game.board,
    score: game.score,
    movesUsed,
    movesLeft: mode === "ranked" ? Math.max(0, moveBudget - movesUsed) : Infinity,
    over: game.over || budgetReached,
    moveLog: internal.log,
    /** The seed and modifier the current round was actually dealt from. */
    roundSeed: internal.seed,
    roundModifier: game.modifier,
    canUndo: mode === "practice" && internal.log.length > 0,
    play,
    restart,
    undo,
  };
}
