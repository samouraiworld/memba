import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { useGame } from "./useGame";
import { initGame, step, type Move } from "../engine";

/** A legal log of `n` accepted moves for seed/modifier, found by trying each direction in turn. */
function legalLog(seed: number, n: number): string {
  let g = initGame(seed, "standard");
  let log = "";
  const dirs: Move[] = ["L", "U", "R", "D"];
  for (let i = 0; log.length < n && i < n * 8 && !g.over; i++) {
    const next = step(g, dirs[i % 4]);
    if (next !== g) { g = next; log += dirs[i % 4]; }
  }
  return log;
}

describe("useGame", () => {
  beforeEach(() => localStorage.clear());
  it("records only board-changing moves into the move log", () => {
    const { result } = renderHook(() =>
      useGame({ seed: 12345, modifier: "standard", mode: "ranked", moveBudget: 30 }));
    const before = result.current.moveLog.length;
    act(() => result.current.play("L"));
    // a real move appends exactly one char; a no-op appends none
    expect(result.current.moveLog.length === before || result.current.moveLog.length === before + 1).toBe(true);
    // moveLog chars are only U/R/D/L
    expect(/^[URDL]*$/.test(result.current.moveLog)).toBe(true);
  });

  it("ranked mode stops accepting moves at the budget", () => {
    const { result } = renderHook(() =>
      useGame({ seed: 777, modifier: "standard", mode: "ranked", moveBudget: 3 }));
    const dirs = ["U", "R", "D", "L", "U", "R", "D", "L"] as const;
    act(() => { for (const d of dirs) result.current.play(d); });
    expect(result.current.movesUsed).toBeLessThanOrEqual(3);
    expect(result.current.moveLog.length).toBeLessThanOrEqual(3);
  });

  it("is deterministic: same seed + same moves => same board & log", () => {
    const a = renderHook(() => useGame({ seed: 42, modifier: "standard", mode: "ranked", moveBudget: 30 }));
    const b = renderHook(() => useGame({ seed: 42, modifier: "standard", mode: "ranked", moveBudget: 30 }));
    act(() => { a.result.current.play("U"); a.result.current.play("L"); });
    act(() => { b.result.current.play("U"); b.result.current.play("L"); });
    expect(a.result.current.board).toEqual(b.result.current.board);
    expect(a.result.current.moveLog).toBe(b.result.current.moveLog);
  });

  it("does not double-append a move under StrictMode", () => {
    const { result } = renderHook(
      () => useGame({ seed: 12345, modifier: "standard", mode: "ranked", moveBudget: 30 }),
      { wrapper: StrictMode },
    );
    const dirs = ["U", "R", "D", "L"] as const;
    for (const d of dirs) {
      const before = result.current.moveLog.length;
      act(() => result.current.play(d));
      if (result.current.moveLog.length > before) {
        expect(result.current.moveLog.length).toBe(before + 1); // exactly one, never two
        return;
      }
    }
    throw new Error("no board-changing move found to test");
  });

  it("persists a practice best as score changes", async () => {
    const { result } = renderHook(() =>
      useGame({ seed: 12345, modifier: "standard", mode: "practice", moveBudget: Infinity }));
    const dirs = ["U", "R", "D", "L"] as const;
    for (let i = 0; i < 12 && result.current.score === 0; i++) {
      act(() => result.current.play(dirs[i % dirs.length]));
    }
    expect(result.current.score).toBeGreaterThan(0);
    await waitFor(() => expect(Number(localStorage.getItem("bp:best:practice"))).toBe(result.current.score));
  });

  it("restart(seed, log) resumes a saved round by replaying it", () => {
    const log = legalLog(12345, 6);
    const live = renderHook(() => useGame({ seed: 12345, modifier: "standard", mode: "ranked", moveBudget: 30 }));
    act(() => { for (const m of log) live.result.current.play(m as Move); });
    expect(live.result.current.moveLog).toBe(log);

    const { result } = renderHook(() => useGame({ seed: 0, modifier: "standard", mode: "ranked", moveBudget: 30 }));
    let ok = false;
    act(() => { ok = result.current.restart(12345, log); });
    expect(ok).toBe(true);
    expect(result.current.moveLog).toBe(log);
    expect(result.current.board).toEqual(live.result.current.board);
    expect(result.current.score).toBe(live.result.current.score);
    expect(result.current.roundSeed).toBe(12345);
  });

  it("a restored log that fills the budget restores as finished", () => {
    const log = legalLog(12345, 4);
    const { result } = renderHook(() => useGame({ seed: 12345, modifier: "standard", mode: "ranked", moveBudget: 4 }));
    act(() => { result.current.restart(12345, log); });
    expect(result.current.over).toBe(true);
    expect(result.current.movesLeft).toBe(0);
  });

  it("rejects a log with a no-op move or one past the budget, starting fresh", () => {
    const { result } = renderHook(() => useGame({ seed: 12345, modifier: "standard", mode: "ranked", moveBudget: 3 }));
    const fresh = initGame(12345, "standard").board;
    // Find a direction that does nothing on the opening board.
    const noop = (["U", "R", "D", "L"] as Move[]).find((m) => step(initGame(12345, "standard"), m) === initGame(12345, "standard"))
      ?? null;
    if (noop) {
      let ok = true;
      act(() => { ok = result.current.restart(12345, noop); });
      expect(ok).toBe(false);
      expect(result.current.moveLog).toBe("");
      expect(result.current.board).toEqual(fresh);
    }
    let ok = true;
    act(() => { ok = result.current.restart(12345, legalLog(12345, 5)); });
    expect(ok).toBe(false);
    expect(result.current.moveLog).toBe("");
  });

  it("undo steps back in Practice, one move at a time", () => {
    const { result } = renderHook(() => useGame({ seed: 12345, modifier: "standard", mode: "practice", moveBudget: Infinity }));
    const start = result.current.board;
    expect(result.current.canUndo).toBe(false);
    const log = legalLog(12345, 2);
    act(() => { result.current.play(log[0] as Move); });
    const afterOne = result.current.board;
    act(() => { result.current.play(log[1] as Move); });
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.moveLog).toBe(log[0]);
    expect(result.current.board).toEqual(afterOne);
    act(() => result.current.undo());
    expect(result.current.moveLog).toBe("");
    expect(result.current.board).toEqual(start);
    expect(result.current.canUndo).toBe(false);
  });

  it("undo is never available in ranked play", () => {
    const { result } = renderHook(() => useGame({ seed: 12345, modifier: "standard", mode: "ranked", moveBudget: 30 }));
    const log = legalLog(12345, 1);
    act(() => { result.current.play(log[0] as Move); });
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.undo());
    expect(result.current.moveLog).toBe(log);
  });
});
