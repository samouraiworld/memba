import { afterEach, describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { keyAction, useKeyboard } from "./useKeyboard";
import { combineInput, toWireDeltas } from "../lib/wire";
import { createInputRecorder } from "../lib/replay";

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

describe("keyAction (alternate keys map onto the existing actions)", () => {
  it("maps WASD, AZERTY and arrow keys onto move, fire, pause and confirm", () => {
    expect(["ArrowLeft", "a", "A", "q", "Q"].map(keyAction)).toEqual(Array(5).fill("left"));
    expect(["ArrowRight", "d", "D"].map(keyAction)).toEqual(Array(3).fill("right"));
    expect([" ", "Spacebar", "w", "W", "z", "Z"].map(keyAction)).toEqual(Array(6).fill("fire"));
    expect(["p", "P", "Escape", "Esc"].map(keyAction)).toEqual(Array(4).fill("pause"));
    expect(keyAction("Enter")).toBe("confirm");
  });

  it("leaves unrelated keys alone (S has no action; Tab keeps focus navigation)", () => {
    for (const k of ["s", "S", "Tab", "Shift", "x", "ArrowUp", "ArrowDown"]) expect(keyAction(k)).toBeNull();
  });
});

describe("useKeyboard alternate keys", () => {
  it("A/D/W poll exactly like arrows/Space", () => {
    const { result } = renderHook(() => useKeyboard());
    key("keydown", "a");
    key("keydown", "w");
    expect(result.current()).toEqual({ move: -1, fire: true, pause: false });
    key("keyup", "a");
    key("keydown", "d");
    expect(result.current()).toEqual({ move: 1, fire: true, pause: false });
    key("keyup", "d");
    key("keyup", "w");
    expect(result.current()).toEqual({ move: 0, fire: false, pause: false });
  });

  it("keeps an action held while any of its keys is still down", () => {
    const { result } = renderHook(() => useKeyboard());
    key("keydown", "ArrowLeft");
    key("keydown", "a");
    key("keyup", "a");
    expect(result.current().move).toBe(-1);
    key("keyup", "ArrowLeft");
    expect(result.current().move).toBe(0);

    key("keydown", " ");
    key("keydown", "W"); // Shift+W reports an uppercase key
    key("keyup", " ");
    expect(result.current().fire).toBe(true);
    key("keyup", "w"); // released after Shift: lowercase key
    expect(result.current().fire).toBe(false);
  });

  it("prevents page scrolling for every movement and fire key on the surface", () => {
    renderHook(() => useKeyboard());
    for (const k of ["a", "d", "w", "q", "z"]) {
      expect(key("keydown", k).defaultPrevented).toBe(true);
      key("keyup", k);
    }
  });

  it("Escape is a one-shot pause edge like P, and ignores auto-repeat", () => {
    const { result } = renderHook(() => useKeyboard());
    key("keydown", "Escape");
    expect(result.current().pause).toBe(true);
    expect(result.current().pause).toBe(false);
    key("keydown", "Escape", true);
    expect(result.current().pause).toBe(false);
  });

  it("Escape still pauses from a button on the surface, but never from a text field", () => {
    const { result } = renderHook(() => useKeyboard());
    const button = document.createElement("button");
    const input = document.createElement("input");
    document.body.append(button, input);
    key("keydown", "Escape", false, input);
    expect(result.current().pause).toBe(false);
    key("keydown", "Escape", false, button);
    expect(result.current().pause).toBe(true);
    // P keeps its old guard: a focused button does not pause.
    key("keydown", "p", false, button);
    expect(result.current().pause).toBe(false);
    button.remove();
    input.remove();
  });

  it("Enter calls onConfirm once per press and never reaches the polled input", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKeyboard(undefined, { onConfirm }));
    const enter = key("keydown", "Enter");
    expect(enter.defaultPrevented).toBe(true);
    key("keydown", "Enter", true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(result.current()).toEqual({ move: 0, fire: false, pause: false });
  });

  it("does not double-fire Enter on a focused button (the button's own activation wins)", () => {
    const onConfirm = vi.fn();
    renderHook(() => useKeyboard(undefined, { onConfirm }));
    const button = document.createElement("button");
    document.body.append(button);
    const enter = key("keydown", "Enter", false, button);
    expect(enter.defaultPrevented).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
    button.remove();
  });

  it("uses the latest onConfirm without re-subscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useKeyboard(undefined, { onConfirm: cb }), { initialProps: { cb: first } });
    rerender({ cb: second });
    key("keydown", "Enter");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("replay input is unchanged for equivalent keys", () => {
  // Drive one scripted session through the real hook → input seam → recorder
  // for each key layout. The recorded log (and its wire form) must be
  // byte-identical: alternate keys are aliases, not new inputs.
  const layouts = {
    arrows: { left: "ArrowLeft", right: "ArrowRight", fire: " " },
    wasd: { left: "a", right: "d", fire: "w" },
    azerty: { left: "q", right: "d", fire: "z" },
  } as const;
  type Layout = (typeof layouts)[keyof typeof layouts];

  function record(layout: Layout) {
    const { result, unmount } = renderHook(() => useKeyboard());
    const recorder = createInputRecorder(42);
    const idleTouch = { move: 0, fire: false, pause: false };
    const script: Array<[number, "keydown" | "keyup", keyof Layout]> = [
      [3, "keydown", "right"],
      [9, "keydown", "fire"],
      [12, "keyup", "fire"],
      [20, "keyup", "right"],
      [21, "keydown", "left"],
      [25, "keydown", "fire"],
      [30, "keyup", "left"],
      [34, "keyup", "fire"],
    ];
    for (let tick = 0; tick < 40; tick++) {
      for (const [at, type, action] of script) if (at === tick) key(type, layout[action]);
      const input = combineInput(result.current(), idleTouch);
      recorder.record(tick, { move: input.move, fire: input.fire, pause: false });
    }
    unmount();
    return recorder.build(40);
  }

  it("records the same log and wire tuples on arrows, WASD and AZERTY", () => {
    const arrows = record(layouts.arrows);
    expect(arrows.inputs.length).toBeGreaterThan(4);
    for (const other of [record(layouts.wasd), record(layouts.azerty)]) {
      expect(other).toEqual(arrows);
      expect(toWireDeltas(other)).toEqual(toWireDeltas(arrows));
    }
  });
});
