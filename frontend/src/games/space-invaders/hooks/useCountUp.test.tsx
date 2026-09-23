import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCountUp } from "./useCountUp";

let rafQueue: FrameRequestCallback[] = [];
function flush(time: number) {
  const cbs = rafQueue;
  rafQueue = [];
  act(() => {
    for (const cb of cbs) cb(time);
  });
}

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafQueue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("useCountUp", () => {
  it("returns the target immediately under reduced motion and schedules no frames", () => {
    const { result } = renderHook(() => useCountUp(12340, { reducedMotion: true }));
    expect(result.current).toBe(12340);
    expect(rafQueue).toHaveLength(0);
  });

  it("counts up monotonically on animation frames and lands exactly on the target", () => {
    const { result } = renderHook(() => useCountUp(1000, { durationMs: 400 }));
    expect(result.current).toBe(0);
    flush(0);
    const seen: number[] = [result.current];
    for (const t of [100, 200, 300]) {
      flush(t);
      seen.push(result.current);
    }
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(1000);
    flush(400);
    expect(result.current).toBe(1000);
    expect(rafQueue).toHaveLength(0); // stops once done
  });

  it("restarts from zero when the target changes", () => {
    const { result, rerender } = renderHook(({ n }) => useCountUp(n, { durationMs: 100 }), { initialProps: { n: 50 } });
    flush(0);
    flush(100);
    expect(result.current).toBe(50);
    rerender({ n: 80 });
    expect(result.current).toBe(0);
    flush(200);
    flush(300);
    expect(result.current).toBe(80);
  });

  it("does not animate a zero score", () => {
    const { result } = renderHook(() => useCountUp(0));
    expect(result.current).toBe(0);
    expect(rafQueue).toHaveLength(0);
  });
});
