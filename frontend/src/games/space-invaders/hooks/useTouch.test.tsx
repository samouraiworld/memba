import { afterEach, describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { useTouch, steerAmount } from "./useTouch";

// The hook splits the play area at its horizontal midpoint (element-relative:
// rect.left + clientWidth / 2): a press on the left half claims the steer
// pointer (drag distance from the press point maps through steerAmount), a
// press on the right half claims the fire pointer. Releases clear each slot.
//
// jsdom has no PointerEvent constructor and no barricade test dispatches
// pointer events either, so we dispatch MouseEvents under the pointer event
// names with `pointerId` defined — the hook only reads pointerId/clientX.

const LEFT = 100; // rect.left
const WIDTH = 300; // clientWidth → midpoint at clientX = 250

function makeArea(): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ left: LEFT, top: 0, right: LEFT + WIDTH, bottom: 200, width: WIDTH, height: 200, x: LEFT, y: 0, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(el, "clientWidth", { value: WIDTH, configurable: true });
  Object.defineProperties(el, {
    setPointerCapture: { value: vi.fn(), configurable: true },
    releasePointerCapture: { value: vi.fn(), configurable: true },
    hasPointerCapture: { value: vi.fn(() => true), configurable: true },
  });
  return el;
}

function pointer(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "lostpointercapture",
  pointerId: number,
  clientX: number,
): Event {
  const ev = new MouseEvent(type, { bubbles: true, clientX });
  Object.defineProperty(ev, "pointerId", { value: pointerId });
  return ev;
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
}

afterEach(() => setVisibility("visible"));

function mount() {
  const el = makeArea();
  const ref = { current: el } as RefObject<HTMLElement>;
  const rendered = renderHook(() => useTouch(ref));
  return { el, ...rendered };
}

describe("useTouch", () => {
  it("keeps completed taps across reads until a simulation step consumes them", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 2, 300));
    window.dispatchEvent(pointer("pointerup", 2, 300));
    el.dispatchEvent(pointer("lostpointercapture", 2, 300));
    expect(result.current.read().fire).toBe(true);
    expect(result.current.read().fire).toBe(true);
    result.current.consumeFire();
    expect(result.current.read().fire).toBe(false);
  });

  it.each(["pointercancel", "lostpointercapture"] as const)("does not turn %s into a completed fire tap", type => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 2, 300));
    // The fixture element is detached; cancellation is listened for on window.
    (type === "pointercancel" ? window : el).dispatchEvent(pointer(type, 2, 300));
    expect(result.current.read().fire).toBe(false);
  });

  it("coalesces complete taps and preserves an earlier tap when a later press is cancelled", () => {
    const { el, result } = mount();
    for (const id of [2, 3]) {
      el.dispatchEvent(pointer("pointerdown", id, 300));
      window.dispatchEvent(pointer("pointerup", id, 300));
    }
    el.dispatchEvent(pointer("pointerdown", 4, 300));
    window.dispatchEvent(pointer("pointercancel", 4, 300));
    expect(result.current.read().fire).toBe(true);
    result.current.consumeFire();
    expect(result.current.read().fire).toBe(false);
  });

  it.each(["blur", "hidden", "reset"])("discards a completed but unconsumed tap on %s", boundary => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 2, 300));
    window.dispatchEvent(pointer("pointerup", 2, 300));
    if (boundary === "blur") window.dispatchEvent(new Event("blur"));
    else if (boundary === "hidden") {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    } else result.current.reset();
    expect(result.current.read().fire).toBe(false);
  });

  it("polls neutral input before any pointer activity", () => {
    const { result } = mount();
    expect(result.current.read()).toEqual({ move: 0, fire: false, pause: false });
  });

  it("left-half press then drag steers proportionally; release clears", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 1, 150)); // left of the 250 midpoint
    expect(el.setPointerCapture).toHaveBeenCalledWith(1);
    expect(result.current.read().move).toBe(0); // press point itself is neutral

    el.dispatchEvent(pointer("pointermove", 1, 170)); // dx = +20
    const partial = result.current.read().move;
    expect(partial).toBe(steerAmount(20));
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1); // proportional, not a coarse +1

    el.dispatchEvent(pointer("pointermove", 1, 206)); // dx = +56 → full deflection
    expect(result.current.read().move).toBe(1);

    el.dispatchEvent(pointer("pointermove", 1, 94)); // dx = -56 → full left
    expect(result.current.read().move).toBe(-1);

    window.dispatchEvent(pointer("pointerup", 1, 94));
    expect(result.current.read().move).toBe(0);
  });

  it("a drag inside the deadzone does not steer", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 1, 150));
    el.dispatchEvent(pointer("pointermove", 1, 153)); // dx = 3 ≤ 4px deadzone
    expect(result.current.read().move).toBe(0);
  });

  it("right-half press fires while held; release stops", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 2, 300)); // right of the 250 midpoint
    expect(el.setPointerCapture).toHaveBeenCalledWith(2);
    expect(result.current.read().fire).toBe(true);
    expect(result.current.read().fire).toBe(true); // hold-to-fire, level not edge
    result.current.consumeFire(); // a fixed step actually consumed the hold
    window.dispatchEvent(pointer("pointerup", 2, 300));
    expect(result.current.read().fire).toBe(false);
  });

  it("the zone split is element-relative, not viewport-relative", () => {
    const { el, result } = mount();
    // clientX 240 is far right of the element's own width/2 in local coords,
    // but left of rect.left + clientWidth/2 = 250 — so it must steer, not fire.
    el.dispatchEvent(pointer("pointerdown", 1, 240));
    expect(result.current.read().fire).toBe(false);
    el.dispatchEvent(pointer("pointermove", 1, 240 + 56));
    expect(result.current.read().move).toBe(1);
  });

  it("does not capture or turn button presses inside the stage into game input", () => {
    const { el, result } = mount();
    const button = document.createElement("button");
    el.append(button);
    button.dispatchEvent(pointer("pointerdown", 7, 320));
    expect(result.current.read()).toEqual({ move: 0, fire: false, pause: false });
    expect(el.setPointerCapture).not.toHaveBeenCalled();
  });

  it("steer and fire pointers work simultaneously and release independently", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 1, 150)); // steer finger
    el.dispatchEvent(pointer("pointerdown", 2, 320)); // fire finger
    el.dispatchEvent(pointer("pointermove", 1, 206));
    expect(result.current.read()).toEqual({ move: 1, fire: true, pause: false });

    result.current.consumeFire();
    window.dispatchEvent(pointer("pointerup", 2, 320)); // lift the fire finger
    expect(result.current.read()).toEqual({ move: 1, fire: false, pause: false });

    window.dispatchEvent(pointer("pointerup", 1, 206)); // lift the steer finger
    expect(result.current.read()).toEqual({ move: 0, fire: false, pause: false });
  });

  it("a second same-half pointer cannot steal an active slot", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 1, 150));
    el.dispatchEvent(pointer("pointermove", 1, 206));
    expect(result.current.read().move).toBe(1);

    // second finger lands on the left half: ignored while pointer 1 steers
    el.dispatchEvent(pointer("pointerdown", 3, 160));
    el.dispatchEvent(pointer("pointermove", 3, 100));
    expect(result.current.read().move).toBe(1);

    // releasing the ignored finger must not clear the active steer
    window.dispatchEvent(pointer("pointerup", 3, 100));
    expect(result.current.read().move).toBe(1);

    window.dispatchEvent(pointer("pointerup", 1, 206));
    expect(result.current.read().move).toBe(0);
  });

  it("clears only the pointer that is cancelled or loses capture", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 1, 150));
    el.dispatchEvent(pointer("pointermove", 1, 206));
    el.dispatchEvent(pointer("pointerdown", 2, 320));
    expect(result.current.read()).toEqual({ move: 1, fire: true, pause: false });

    window.dispatchEvent(pointer("pointercancel", 2, 320));
    expect(result.current.read()).toEqual({ move: 1, fire: false, pause: false });

    el.dispatchEvent(pointer("lostpointercapture", 1, 206));
    expect(result.current.read()).toEqual({ move: 0, fire: false, pause: false });
  });

  it("clears every active pointer on blur and visibility loss", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 1, 150));
    el.dispatchEvent(pointer("pointermove", 1, 206));
    el.dispatchEvent(pointer("pointerdown", 2, 320));
    window.dispatchEvent(new Event("blur"));
    expect(result.current.read()).toEqual({ move: 0, fire: false, pause: false });
    expect(el.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(el.releasePointerCapture).toHaveBeenCalledWith(2);

    el.dispatchEvent(pointer("pointerdown", 3, 150));
    el.dispatchEvent(pointer("pointermove", 3, 206));
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(result.current.read()).toEqual({ move: 0, fire: false, pause: false });
    expect(el.releasePointerCapture).toHaveBeenCalledWith(3);
  });

  it("falls back safely when pointer capture is unsupported or rejects", () => {
    const { el, result } = mount();
    vi.mocked(el.setPointerCapture).mockImplementation(() => {
      throw new DOMException("capture unavailable");
    });
    el.dispatchEvent(pointer("pointerdown", 2, 300));
    expect(result.current.read().fire).toBe(true);
    result.current.consumeFire();
    window.dispatchEvent(pointer("pointerup", 2, 300));
    expect(result.current.read().fire).toBe(false);
  });

  it("stops listening and clears active pointers after unmount", () => {
    const { el, result, unmount } = mount();
    const poll = result.current.read;
    el.dispatchEvent(pointer("pointerdown", 2, 300));
    expect(poll().fire).toBe(true);
    unmount();
    window.dispatchEvent(pointer("pointerup", 2, 300));
    expect(poll().fire).toBe(false);
  });
});
