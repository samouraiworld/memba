import { describe, it, expect } from "vitest";
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
  return el;
}

function pointer(type: "pointerdown" | "pointermove" | "pointerup", pointerId: number, clientX: number): Event {
  const ev = new MouseEvent(type, { bubbles: true, clientX });
  Object.defineProperty(ev, "pointerId", { value: pointerId });
  return ev;
}

function mount() {
  const el = makeArea();
  const ref = { current: el } as RefObject<HTMLElement>;
  const rendered = renderHook(() => useTouch(ref));
  return { el, ...rendered };
}

describe("useTouch", () => {
  it("polls neutral input before any pointer activity", () => {
    const { result } = mount();
    expect(result.current()).toEqual({ move: 0, fire: false, pause: false });
  });

  it("left-half press then drag steers proportionally; release clears", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 1, 150)); // left of the 250 midpoint
    expect(result.current().move).toBe(0); // press point itself is neutral

    el.dispatchEvent(pointer("pointermove", 1, 170)); // dx = +20
    const partial = result.current().move;
    expect(partial).toBe(steerAmount(20));
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1); // proportional, not a coarse +1

    el.dispatchEvent(pointer("pointermove", 1, 206)); // dx = +56 → full deflection
    expect(result.current().move).toBe(1);

    el.dispatchEvent(pointer("pointermove", 1, 94)); // dx = -56 → full left
    expect(result.current().move).toBe(-1);

    window.dispatchEvent(pointer("pointerup", 1, 94));
    expect(result.current().move).toBe(0);
  });

  it("a drag inside the deadzone does not steer", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 1, 150));
    el.dispatchEvent(pointer("pointermove", 1, 153)); // dx = 3 ≤ 4px deadzone
    expect(result.current().move).toBe(0);
  });

  it("right-half press fires while held; release stops", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 2, 300)); // right of the 250 midpoint
    expect(result.current().fire).toBe(true);
    expect(result.current().fire).toBe(true); // hold-to-fire, level not edge
    window.dispatchEvent(pointer("pointerup", 2, 300));
    expect(result.current().fire).toBe(false);
  });

  it("the zone split is element-relative, not viewport-relative", () => {
    const { el, result } = mount();
    // clientX 240 is far right of the element's own width/2 in local coords,
    // but left of rect.left + clientWidth/2 = 250 — so it must steer, not fire.
    el.dispatchEvent(pointer("pointerdown", 1, 240));
    expect(result.current().fire).toBe(false);
    el.dispatchEvent(pointer("pointermove", 1, 240 + 56));
    expect(result.current().move).toBe(1);
  });

  it("steer and fire pointers work simultaneously and release independently", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 1, 150)); // steer finger
    el.dispatchEvent(pointer("pointerdown", 2, 320)); // fire finger
    el.dispatchEvent(pointer("pointermove", 1, 206));
    expect(result.current()).toEqual({ move: 1, fire: true, pause: false });

    window.dispatchEvent(pointer("pointerup", 2, 320)); // lift the fire finger
    expect(result.current()).toEqual({ move: 1, fire: false, pause: false });

    window.dispatchEvent(pointer("pointerup", 1, 206)); // lift the steer finger
    expect(result.current()).toEqual({ move: 0, fire: false, pause: false });
  });

  it("a second same-half pointer cannot steal an active slot", () => {
    const { el, result } = mount();
    el.dispatchEvent(pointer("pointerdown", 1, 150));
    el.dispatchEvent(pointer("pointermove", 1, 206));
    expect(result.current().move).toBe(1);

    // second finger lands on the left half: ignored while pointer 1 steers
    el.dispatchEvent(pointer("pointerdown", 3, 160));
    el.dispatchEvent(pointer("pointermove", 3, 100));
    expect(result.current().move).toBe(1);

    // releasing the ignored finger must not clear the active steer
    window.dispatchEvent(pointer("pointerup", 3, 100));
    expect(result.current().move).toBe(1);

    window.dispatchEvent(pointer("pointerup", 1, 206));
    expect(result.current().move).toBe(0);
  });

  it("stops listening after unmount", () => {
    const { el, result, unmount } = mount();
    const poll = result.current;
    el.dispatchEvent(pointer("pointerdown", 2, 300));
    expect(poll().fire).toBe(true);
    unmount();
    window.dispatchEvent(pointer("pointerup", 2, 300));
    // the release after unmount is not observed: last polled state sticks
    expect(poll().fire).toBe(true);
  });
});
