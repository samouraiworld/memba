import { useCallback, useEffect, useRef, useState } from "react";
import { initGame, step, type GameState, type Modifier, type Move } from "../engine";
import { newPracticeRunId } from "../freeplay/round";
import { setLocalBest } from "../lib/localStore";

export type GameMode = "ranked" | "practice";

type ReplayState = { game: GameState; log: string; seed: number; mode: GameMode };
type Internal = ReplayState & { actions: string; runId: string | null };

function fresh(seed: number, modifier: Modifier, mode: GameMode): Internal {
  return { game: initGame(seed, modifier), log: "", seed, mode, actions: "", runId: mode === "practice" ? newPracticeRunId() : null };
}

/**
 * Rebuild a round from its move log through the engine's public step API.
 * Returns null unless every move is accepted exactly as live play would have
 * accepted it: no no-op moves, nothing after game over, nothing past the
 * budget. The backend applies the same rules to a submitted replay.
 */
export function replayLog(seed: number, modifier: Modifier, log: string, budget: number, mode: GameMode = "ranked"): ReplayState | null {
  let game = initGame(seed, modifier);
  for (let i = 0; i < log.length; i++) {
    const m = log[i];
    if (game.over || i >= budget || (m !== "U" && m !== "R" && m !== "D" && m !== "L")) return null;
    const next = step(game, m);
    if (next === game) return null;
    game = next;
  }
  return { game, log, seed, mode };
}

export function useGame(opts: { seed: number; modifier: Modifier; mode: GameMode; moveBudget: number }) {
  const { modifier, mode, moveBudget } = opts;
  const [internal, setInternal] = useState<Internal>(() => fresh(opts.seed, modifier, mode));
  const seedRef = useRef(opts.seed);

  const play = useCallback((m: Move) => {
    setInternal((prev) => {
      if (prev.mode !== mode) return prev;
      if (prev.game.over) return prev;
      if (mode === "ranked" && prev.game.moves >= moveBudget) return prev;
      const next = step(prev.game, m);
      if (next === prev.game) return prev; // no-op: unchanged, not counted, not logged
      return { ...prev, game: next, log: prev.log + m, actions: prev.mode === "practice" ? prev.actions + m : prev.actions };
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
    const restored = log ? replayLog(s, modifier, log, mode === "ranked" ? moveBudget : Infinity, mode) : null;
    setInternal(restored ? { ...restored, actions: mode === "practice" ? log : "", runId: mode === "practice" ? newPracticeRunId() : null } : fresh(s, modifier, mode));
    return log === "" || restored !== null;
  }, [modifier, mode, moveBudget]);

  /** Practice only: step back one accepted move by replaying the shorter log. */
  const undo = useCallback(() => {
    if (mode !== "practice") return;
    // Generate outside React's replayable state updater. Undo after a terminal
    // snapshot starts a new certification identity while preserving the full
    // action history, so an already-saved result can never be overwritten.
    const nextRunId = newPracticeRunId();
    setInternal((prev) => {
      if (prev.mode !== "practice" || prev.log.length === 0) return prev;
      const restored = replayLog(prev.seed, prev.game.modifier, prev.log.slice(0, -1), Infinity, "practice");
      return restored ? { ...restored, actions: prev.actions + "Z", runId: prev.game.over ? nextRunId : prev.runId } : prev;
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
    if (mode === "practice" && internal.mode === "practice") setLocalBest("practice", game.score);
  }, [mode, internal.mode, game.score]);

  return {
    board: game.board,
    score: game.score,
    movesUsed,
    movesLeft: mode === "ranked" ? Math.max(0, moveBudget - movesUsed) : Infinity,
    over: game.over || budgetReached,
    moveLog: internal.log,
    /** Certification journal retains accepted moves AND Undo; moveLog still
     * describes the current board for legacy resume and deterministic Undo. */
    actionLog: internal.actions,
    roundId: internal.runId,
    roundMode: internal.mode,
    roundOver: game.over,
    /** The seed and modifier the current round was actually dealt from. */
    roundSeed: internal.seed,
    roundModifier: game.modifier,
    canUndo: mode === "practice" && internal.mode === "practice" && internal.log.length > 0,
    play,
    restart,
    undo,
  };
}
