import { describe, it, expect } from "vitest";
import { draw } from "./draw";
import { createFx, fxConsume } from "./fx";
import { newGame } from "../engine";
import type { GameState } from "../engine";

function stubCtx() {
  return {
    save() {},
    restore() {},
    translate() {},
    clearRect() {},
    fillRect() {},
    fillText() {},
    set fillStyle(_v: string) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
}

describe("draw", () => {
  it("renders state + fx (particles, popups, shake) without throwing", () => {
    const fx = createFx(1);
    fxConsume(fx, [
      { type: "alienKilled", x: 10, y: 10, row: 0 },
      { type: "playerHit" },
    ]);
    const state: GameState = { ...newGame(1), phase: "playing", invulnMs: 500 };
    expect(() => draw(stubCtx(), state, fx)).not.toThrow();
  });
});
