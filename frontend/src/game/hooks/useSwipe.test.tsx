import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSwipe } from "./useSwipe";
import type { Move } from "../engine";

function ptr(x: number, y: number) {
  return { clientX: x, clientY: y, preventDefault() {} } as unknown as React.PointerEvent;
}

describe("useSwipe", () => {
  it("maps a rightward drag past threshold to 'R'", () => {
    const onMove = vi.fn<(m: Move) => void>();
    const { result } = renderHook(() => useSwipe(onMove));
    result.current.onPointerDown(ptr(10, 10));
    result.current.onPointerUp(ptr(60, 14)); // dx=50 (>24), dy small => R
    expect(onMove).toHaveBeenCalledWith("R");
  });
  it("ignores a sub-threshold tap", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useSwipe(onMove));
    result.current.onPointerDown(ptr(10, 10));
    result.current.onPointerUp(ptr(15, 12));
    expect(onMove).not.toHaveBeenCalled();
  });
});
