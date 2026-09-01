import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboard } from "./useKeyboard";

// The hook attaches window-level key listeners and exposes a poll function the
// game loop calls once per frame. These tests pin the polled contract: held
// arrows/Space are level-triggered, while 'p' is a one-shot edge that the poll
// itself consumes.

function key(type: "keydown" | "keyup", key: string, repeat = false) {
  window.dispatchEvent(new KeyboardEvent(type, { key, repeat }));
}

describe("useKeyboard", () => {
  it("polls neutral input before any key event", () => {
    const { result } = renderHook(() => useKeyboard());
    expect(result.current()).toEqual({ move: 0, fire: false, pause: false });
  });

  it("ArrowRight held polls move=1 until keyup", () => {
    const { result } = renderHook(() => useKeyboard());
    key("keydown", "ArrowRight");
    expect(result.current().move).toBe(1);
    // still held: level-triggered, not an edge
    expect(result.current().move).toBe(1);
    key("keyup", "ArrowRight");
    expect(result.current().move).toBe(0);
  });

  it("ArrowLeft held polls move=-1 until keyup", () => {
    const { result } = renderHook(() => useKeyboard());
    key("keydown", "ArrowLeft");
    expect(result.current().move).toBe(-1);
    key("keyup", "ArrowLeft");
    expect(result.current().move).toBe(0);
  });

  it("both arrows held cancel out to move=0", () => {
    const { result } = renderHook(() => useKeyboard());
    key("keydown", "ArrowLeft");
    key("keydown", "ArrowRight");
    expect(result.current().move).toBe(0);
    key("keyup", "ArrowLeft");
    expect(result.current().move).toBe(1);
    key("keyup", "ArrowRight");
    expect(result.current().move).toBe(0);
  });

  it("Space held polls fire=true, released polls fire=false", () => {
    const { result } = renderHook(() => useKeyboard());
    key("keydown", " ");
    expect(result.current().fire).toBe(true);
    expect(result.current().fire).toBe(true); // held, still firing
    key("keyup", " ");
    expect(result.current().fire).toBe(false);
  });

  it("'p' produces a one-shot pause edge that the poll consumes", () => {
    const { result } = renderHook(() => useKeyboard());
    key("keydown", "p");
    expect(result.current().pause).toBe(true);
    // consumed on read: the very next poll is false even with no keyup
    expect(result.current().pause).toBe(false);
  });

  it("uppercase 'P' also arms the pause edge", () => {
    const { result } = renderHook(() => useKeyboard());
    key("keydown", "P");
    expect(result.current().pause).toBe(true);
    expect(result.current().pause).toBe(false);
  });

  it("OS auto-repeat of 'p' does not re-arm the pause edge", () => {
    const { result } = renderHook(() => useKeyboard());
    key("keydown", "p");
    expect(result.current().pause).toBe(true);
    // holding the key fires repeat keydowns — none of them re-arm
    key("keydown", "p", true);
    key("keydown", "p", true);
    expect(result.current().pause).toBe(false);
    // a fresh (non-repeat) press arms again
    key("keydown", "p");
    expect(result.current().pause).toBe(true);
  });

  it("stops listening after unmount", () => {
    const { result, unmount } = renderHook(() => useKeyboard());
    const poll = result.current;
    key("keydown", "ArrowRight");
    expect(poll().move).toBe(1);
    unmount();
    key("keyup", "ArrowRight");
    // the keyup after unmount is not observed: the last polled state sticks
    expect(poll().move).toBe(1);
  });
});
