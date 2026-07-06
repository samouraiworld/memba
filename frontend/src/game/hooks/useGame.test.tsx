import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGame } from "./useGame";

describe("useGame", () => {
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
});
