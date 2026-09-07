import { describe, it, expect } from "vitest";
import { draw, renderJitter } from "./draw";
import { createFx, fxConsume } from "./fx";
import { newGame } from "../engine";
import type { GameState } from "../engine";

type DrawOp = { kind: string; values: number[] };

function stubCtx(ops: DrawOp[] = []) {
  return {
    save() {},
    restore() {},
    translate(x: number, y: number) { ops.push({ kind: "translate", values: [x, y] }); },
    clearRect(x: number, y: number, w: number, h: number) { ops.push({ kind: "clear", values: [x, y, w, h] }); },
    fillRect(x: number, y: number, w: number, h: number) { ops.push({ kind: "rect", values: [x, y, w, h] }); },
    fillText(_text: string, x: number, y: number) { ops.push({ kind: "text", values: [x, y] }); },
    set fillStyle(_v: string) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
    set imageSmoothingEnabled(_v: boolean) {},
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

  it("is repeatable for the same simulation and cosmetic state", () => {
    const fx = createFx(29);
    fxConsume(fx, [{ type: "playerHit" }, { type: "alienKilled", x: 16, y: 40, row: 2 }]);
    const state: GameState = { ...newGame(29), phase: "playing", tick: 77 };
    const first: DrawOp[] = [];
    const second: DrawOp[] = [];
    draw(stubCtx(first), state, fx);
    draw(stubCtx(second), state, fx);
    expect(second).toEqual(first);
  });

  it("derives shake without Math.random or simulation mutation", () => {
    expect(renderJitter(9, 42, 0, 5)).toBe(renderJitter(9, 42, 0, 5));
    expect(renderJitter(9, 42, 0, 0)).toBe(0);
    expect(Math.abs(renderJitter(9, 42, 1, 5))).toBeLessThanOrEqual(5);
  });

  it("does not translate the scene under reduced motion", () => {
    const fx = createFx(1, { reducedMotion: true });
    fx.shake = 8;
    const ops: DrawOp[] = [];
    draw(stubCtx(ops), { ...newGame(1), phase: "playing" }, fx);
    expect(ops.some((op) => op.kind === "translate")).toBe(false);
  });
});
