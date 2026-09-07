import { afterEach, describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboard } from "./useKeyboard";

// The hook attaches window-level key listeners and exposes a poll function the
// game loop calls once per frame. These tests pin the polled contract: held
// arrows/Space are level-triggered, while 'p' is a one-shot edge that the poll
// itself consumes.

function key(type: "keydown" | "keyup", key: string, repeat = false, target: EventTarget = window) {
  const event = new KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
}

afterEach(() => setVisibility("visible"));

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

  it("does not steal Space, arrows, or P from interactive and editable targets", () => {
    const { result } = renderHook(() => useKeyboard());
    const button = document.createElement("button");
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(button, input, editable);

    const space = key("keydown", " ", false, button);
    const arrow = key("keydown", "ArrowRight", false, input);
    key("keydown", "p", false, editable);

    expect(space.defaultPrevented).toBe(false);
    expect(arrow.defaultPrevented).toBe(false);
    expect(result.current()).toEqual({ move: 0, fire: false, pause: false });
  });

  it("leaves browser and OS modifier shortcuts alone", () => {
    const { result } = renderHook(() => useKeyboard());
    const event = new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(result.current().move).toBe(0);
  });

  it("only owns gameplay keys dispatched from an explicit game surface", () => {
    const surface = document.createElement("div");
    const outside = document.createElement("div");
    document.body.append(surface, outside);
    const scopeRef = { current: surface };
    const { result } = renderHook(() => useKeyboard(scopeRef));

    const pageArrow = key("keydown", "ArrowRight", false, outside);
    expect(pageArrow.defaultPrevented).toBe(false);
    expect(result.current().move).toBe(0);

    const gameArrow = key("keydown", "ArrowRight", false, surface);
    expect(gameArrow.defaultPrevented).toBe(true);
    expect(result.current().move).toBe(1);
    key("keyup", "ArrowRight", false, surface);
    surface.remove();
    outside.remove();
  });

  it("clears held keys and pause edges when the window loses focus", () => {
    const { result } = renderHook(() => useKeyboard());
    key("keydown", "ArrowRight");
    key("keydown", " ");
    key("keydown", "p");
    window.dispatchEvent(new Event("blur"));
    expect(result.current()).toEqual({ move: 0, fire: false, pause: false });
  });

  it("clears held input when the document becomes hidden", () => {
    const { result } = renderHook(() => useKeyboard());
    key("keydown", "ArrowLeft");
    key("keydown", " ");
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(result.current()).toEqual({ move: 0, fire: false, pause: false });
  });

  it("stops listening and clears held input after unmount", () => {
    const { result, unmount } = renderHook(() => useKeyboard());
    const poll = result.current;
    key("keydown", "ArrowRight");
    expect(poll().move).toBe(1);
    unmount();
    key("keyup", "ArrowRight");
    expect(poll().move).toBe(0);
  });
});
